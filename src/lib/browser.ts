import { get, set, del } from 'idb-keyval';
import { hasUserContext, profileSchema, savedScanSchema, type ImageAsset, type Observation, type Profile, type SavedScanRecord } from './contracts';
import { detectRetailBarcodes } from './barcode';

export type SavedScan = SavedScanRecord;
const historyKey='nutriscan.history.v1';
const rememberedProfileKey='nutriscan.user-context.v1';
export async function readHistory():Promise<SavedScan[]> { const data:unknown=await get(historyKey); return Array.isArray(data)?data.flatMap(item=>{const parsed=savedScanSchema.safeParse(item);return parsed.success?[parsed.data]:[];}).slice(0,20):[]; }
export async function saveScan(input:SavedScan) { const scan=savedScanSchema.parse(input);const history=await readHistory();await set(historyKey,[scan,...history.filter(x=>x.id!==scan.id)].slice(0,20)); }
export async function removeSavedScan(id:string) { const history=await readHistory();await set(historyKey,history.filter(scan=>scan.id!==id)); }
export async function clearHistory(){ await del(historyKey); }

/** Optional user context is stored separately from scan and conversation history. */
export async function readRememberedProfile():Promise<Profile|null>{
 const value:unknown=await get(rememberedProfileKey);
 if(value===undefined)return null;
 const parsed=profileSchema.safeParse(value);
 if(!parsed.success){await del(rememberedProfileKey);return null;}
 return hasUserContext(parsed.data)?parsed.data:null;
}
export async function saveRememberedProfile(input:Profile):Promise<void>{
 const profile=profileSchema.parse(input);
 if(!hasUserContext(profile)){await del(rememberedProfileKey);return;}
 await set(rememberedProfileKey,profile);
}
export async function deleteRememberedProfile():Promise<void>{await del(rememberedProfileKey);}

export async function loadImage(file:Blob,side:ImageAsset['side'],name='Package photograph'):Promise<ImageAsset>{
 if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Choose a JPG, PNG or WebP photo. HEIC needs conversion first.');
 if (file.size>12*1024*1024) throw new Error('This photo is larger than 12 MB. Choose a smaller image.');
 const bitmap=await createImageBitmap(file);
 const {width,height}=bitmap; bitmap.close();
 if (width*height>40_000_000) throw new Error('This image is too large to process comfortably. Choose a photo below 40 megapixels.');
 return {id:crypto.randomUUID(),side,blob:file,url:URL.createObjectURL(file),width,height,name};
}

export type Crop = {x:number;y:number;width:number;height:number};
export async function prepareImage(asset:ImageAsset,rotation=0,contrast=false,crop?:Crop,invert=false):Promise<Blob>{
 const bitmap=await createImageBitmap(asset.blob);
 const box=crop?{x:bitmap.width*crop.x/100,y:bitmap.height*crop.y/100,w:bitmap.width*crop.width/100,h:bitmap.height*crop.height/100}:{x:0,y:0,w:bitmap.width,h:bitmap.height};
 const scale=Math.min(3,3000/Math.max(box.w,box.h));
 const width=Math.round(box.w*scale),height=Math.round(box.h*scale);
 const canvas=document.createElement('canvas');
 const swap=rotation%180!==0; canvas.width=swap?height:width;canvas.height=swap?width:height;
 const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Your browser could not prepare this image. Try another photo.');
 ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);
 ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(rotation*Math.PI/180);
 ctx.filter=[contrast?'grayscale(1) contrast(1.5)':'',invert?'invert(1)':''].filter(Boolean).join(' ')||'none';
 ctx.drawImage(bitmap,box.x,box.y,box.w,box.h,-width/2,-height/2,width,height);bitmap.close();
 return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Image preparation failed.')),'image/jpeg',0.98));
}

export async function readImages(assets:ImageAsset[],onProgress:(label:string,progress:number)=>void,signal:AbortSignal,options:{rotation:number;contrast:boolean;invert?:boolean;crop?:Crop;cropTarget?:string}):Promise<{text:string;observations:Observation[];confidence:number;barcodes:{code:string;imageId:string;side:ImageAsset['side']}[]}>{
 const { createWorker, PSM }=await import('tesseract.js');
 let worker:Awaited<ReturnType<typeof createWorker>>|undefined;
 let cancelled=false;
 let rejectAbort:((reason:Error)=>void)|undefined;
 const abortPromise=new Promise<never>((_,reject)=>{rejectAbort=reject;});
 const abort=()=>{cancelled=true;void worker?.terminate();rejectAbort?.(new Error('Reading stopped. Your photos are still here.'));};signal.addEventListener('abort',abort);
 const timeout=setTimeout(abort,120000);
 try{
  onProgress('Preparing the on-device reader',0.02);
  worker=await Promise.race([createWorker('eng',1,{workerPath:'/ocr/worker.min.js',corePath:'/ocr/',langPath:'/ocr/',workerBlobURL:false,logger:m=>{if(!cancelled)onProgress(m.status,Math.max(.02,m.progress||0));}}).then(w=>{if(cancelled)void w.terminate();return w;}),abortPromise]);
  if(cancelled)throw new Error('Reading stopped. Your photos are still here.');
  await worker.setParameters({preserve_interword_spaces:'1'});
  const texts:string[]=[];const observations:Observation[]=[];const barcodes:{code:string;imageId:string;side:ImageAsset['side']}[]=[];let confidence=0;
  for(let i=0;i<assets.length;i++){
   if(cancelled)throw new Error('Reading stopped. Your photos are still here.');
   onProgress(`Reading photo ${i+1} of ${assets.length}`,i/assets.length);
   const barcodeValues=await Promise.race([detectRetailBarcodes(assets[i].blob),abortPromise]);
   for(const code of barcodeValues)barcodes.push({code,imageId:assets[i].id,side:assets[i].side});
   await worker.setParameters({tessedit_pageseg_mode:assets[i].role==='nutrition'||assets[i].role==='ingredients'||assets[i].side==='back'?PSM.SINGLE_BLOCK:PSM.AUTO});
   const image=await prepareImage(assets[i],assets[i].rotation??options.rotation,options.contrast,options.cropTarget===assets[i].id?options.crop:undefined,options.invert);
   const result=await Promise.race([worker.recognize(image,{}, {text:true,blocks:true,tsv:true}),abortPromise]);
   texts.push(result.data.text);confidence+=result.data.confidence;
   for(const block of result.data.blocks??[]) for(const paragraph of block.paragraphs??[]) for(const line of paragraph.lines??[]){
    observations.push({id:crypto.randomUUID(),field:'ocr-line',text:line.text,side:assets[i].side,confidence:line.confidence,bbox:line.bbox,origin:'ocr',imageId:assets[i].id});
   }
  }
  if(cancelled)throw new Error('Reading stopped. Your photos are still here.');
  return {text:texts.join('\n\n'),observations,confidence:confidence/assets.length,barcodes};
 }catch(error){ if(cancelled)throw new Error('Reading stopped or timed out. Try a smaller, tightly cropped photo.');throw error;
 }finally{clearTimeout(timeout);signal.removeEventListener('abort',abort);await worker?.terminate().catch(()=>{});}
}

export async function imageBase64(blob:Blob):Promise<string>{return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Image could not be read.'));reader.readAsDataURL(blob);});}
export function downloadJson(name:string,value:unknown){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
