import { createWorker, PSM } from 'tesseract.js';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseLabel } from '../src/lib/parser';
import type { NutrientKey, PackageData } from '../src/lib/contracts';

type Expected = { key: NutrientKey; value: number; unit: string };
type Photo = { file: string; hash: string; code: string; manualAnnotation?: { basis: { amount: number; unit: 'g'|'ml' }|null; nutrients: Expected[] } };
const manifest = JSON.parse(await fs.readFile('data/semantic-photo-manifest.json','utf8')) as { records: Photo[] };
const photos = manifest.records.filter(photo => photo.manualAnnotation?.basis && photo.manualAnnotation.nutrients.length);
const sizes = [3000, 4500, 6000] as const;
const aggregate = Object.fromEntries(sizes.map(size => [size,{expected:0,correct:0,incorrect:0,omitted:0,withheld:0,photos:[]}])) as Record<typeof sizes[number], {expected:number;correct:number;incorrect:number;omitted:number;withheld:number;photos:unknown[]}>;
const worker = await createWorker('eng',1,{langPath:path.resolve('public/ocr')});
function normalized(key:NutrientKey,value:number,unit:string){
 if(key==='energy')return unit==='kJ'?value/4.184:value;
 if(key==='sodium')return unit==='g'?value*1000:value;
 return unit==='mg'?value/1000:value;
}
try {
 for(const photo of photos){
  const bytes=await fs.readFile(path.join('docs/evidence/private',photo.file));
  if(crypto.createHash('sha256').update(bytes).digest('hex')!==photo.hash)throw new Error(`Source hash mismatch for ${photo.file}`);
  for(const size of sizes){
   const prepared=await sharp(bytes).rotate().resize({width:size,height:size,fit:'inside',withoutEnlargement:false}).jpeg({quality:98}).toBuffer();
   await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_BLOCK,preserve_interword_spaces:'1'});
   const result=await worker.recognize(prepared);
   const pkg:PackageData=parseLabel(result.data.text,{origin:'ocr',confidence:result.data.confidence,side:'extra'});
   const expected=photo.manualAnnotation!.nutrients;
   let correct=0,incorrect=0,omitted=0,withheld=0;
   const fields=expected.map(field=>{
    const rows=pkg.nutrients.filter(row=>row.key===field.key&&row.basis?.amount===photo.manualAnnotation!.basis!.amount&&row.basis?.unit===photo.manualAnnotation!.basis!.unit);
    let outcome:'correct'|'incorrect'|'omitted'|'withheld';
    if(rows.some(row=>row.status==='conflict'))outcome='withheld';
    else if(!rows.length)outcome=pkg.nutrients.some(row=>row.key===field.key)?'withheld':'omitted';
    else outcome=rows.some(row=>Math.abs(normalized(field.key,row.value,row.unit)-normalized(field.key,field.value,field.unit))<=Math.max(.015,Math.abs(normalized(field.key,field.value,field.unit))*.005))?'correct':'incorrect';
    if(outcome==='correct')correct++;else if(outcome==='incorrect')incorrect++;else if(outcome==='omitted')omitted++;else withheld++;
    return {key:field.key,result:outcome};
   });
   const row=aggregate[size];row.expected+=expected.length;row.correct+=correct;row.incorrect+=incorrect;row.omitted+=omitted;row.withheld+=withheld;
   row.photos.push({file:photo.file,code:photo.code,expected:expected.length,correct,incorrect,omitted,withheld,characters:result.data.text.length,parsedNutrients:pkg.nutrients.length,explicitBasisNutrients:pkg.nutrients.filter(item=>item.basis).length,unconflictedBasisNutrients:pkg.nutrients.filter(item=>item.basis&&item.status!=='conflict').length,fields});
  }
 }
} finally { await worker.terminate(); }
const output={schemaVersion:1,kind:'real-photo-upscale-probe',generatedAt:new Date().toISOString(),source:'Hash-verified Open Food Facts photo manifest; source photos remain ignored by Git.',photos:photos.length,annotatedFields:photos.reduce((sum,photo)=>sum+photo.manualAnnotation!.nutrients.length,0),method:'Node Tesseract.js English, PSM.SINGLE_BLOCK, JPEG quality 98; only maximum long-edge size varied.',results:Object.fromEntries(sizes.map(size=>{const row=aggregate[size];return [String(size),{...row,fieldAccuracy:row.expected?Number((row.correct/row.expected).toFixed(4)):null}]})),limitations:['Exploratory comparison on five selected package images; not a held-out or population accuracy estimate.','Image scaling is the only intended variable; Node evaluation is not browser end-to-end validation.','Only human-annotated nutrient fields at the declared basis are scored; no source image or raw OCR text is written to this result.','A matching OCR value does not establish package identity, formulation, label truth or clinical relevance.']};
await fs.writeFile('docs/evidence/real-ocr-upscale-probe.json',JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({output:'docs/evidence/real-ocr-upscale-probe.json',photos:output.photos,annotatedFields:output.annotatedFields,results:Object.fromEntries(sizes.map(size=>{const row=aggregate[size];return [String(size),{correct:row.correct,incorrect:row.incorrect,omitted:row.omitted,withheld:row.withheld,fieldAccuracy:Number((row.correct/row.expected).toFixed(4))}]}))},null,2));
