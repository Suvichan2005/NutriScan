import { createWorker, PSM } from 'tesseract.js';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseLabel } from '../src/lib/parser';
import type { NutrientKey, PackageData } from '../src/lib/contracts';

type Expected={key:NutrientKey;value:number;unit:string};
type RecordEntry={file:string;hash:string;code:string;type:string;manualAnnotation?:{basis:{amount:number;unit:'g'|'ml'}|null;nutrients:Expected[];status:string}};
const manifest=JSON.parse(await fs.readFile('data/semantic-photo-manifest.json','utf8')) as {records:RecordEntry[]};
const records=manifest.records.filter(r=>r.manualAnnotation?.basis&&r.manualAnnotation.nutrients.length>0);
const modes=['eng-auto-native','eng-single-native','eng-sparse-native','eng-auto-browser-prepared','eng-single-column-browser-prepared','eng-single-browser-prepared','eng-single-enhanced'] as const;
type Mode=typeof modes[number];
const aggregate=Object.fromEntries(modes.map(mode=>[mode,{expected:0,correct:0,incorrect:0,omitted:0,withheld:0,fields:[]}])) as Record<Mode,{expected:number;correct:number;incorrect:number;omitted:number;withheld:number;fields:{code:string;file:string;key:NutrientKey;expected:number;unit:string;result:'correct'|'incorrect'|'omitted'|'withheld';read:number|null}[]}>;
const worker=await createWorker('eng',1,{langPath:path.resolve('public/ocr')});
const rawRun:Record<string,{confidence:number;chars:number;numericTokens:number;basis:boolean;labelTerms:number;parsedNutrients:number;explicitBasisNutrients:number;unconflictedBasisNutrients:number;conflictedNutrients:number;ingredientLines:number;claims:number}>={};
function normalized(key:NutrientKey,value:number,unit:string){
 if(key==='energy')return unit==='kJ'?value/4.184:value;
 if(key==='sodium')return unit==='g'?value*1000:value;
 return unit==='mg'?value/1000:value;
}
function signal(text:string){return {chars:text.length,numericTokens:(text.match(/\d+(?:[.,]\d+)?/g)??[]).length,basis:/\bper\s*:?[\s\n]*100\s*(?:g|ml|mL)\b/i.test(text),labelTerms:(text.match(/carbohyd|glucid|carb|protein|prote[ií]n|sugar|suc|fat|gras|energy|energi|kcal|kj|salt|sel|sodium|sodiu|fiber|fibre|ingredient/gi)??[]).length};}
try{
 const output:{schemaVersion:1;kind:'node-local-ocr-diagnostic';generatedAt:string;source:string;licenseUrl:string;photos:number;manualFields:number;modes:Record<string,unknown>;limitations:string[]}={schemaVersion:1,kind:'node-local-ocr-diagnostic',generatedAt:new Date().toISOString(),source:'Open Food Facts photo manifest; no photographs are copied into this result.',licenseUrl:manifest.records.length?'https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/tutorials/license-be-on-the-legal-side/':'',photos:records.length,manualFields:records.reduce((sum,r)=>sum+(r.manualAnnotation?.nutrients.length??0),0),modes:{},limitations:['Node Tesseract diagnostic only; not a browser end-to-end result.','English trained data only.','Small source-manifest sample with human-read labels, not independent blinded ground truth or a population accuracy estimate.','Only annotated nutrient fields and the printed basis are compared; ingredients, claims, barcode and total-character accuracy are out of scope.','An exact OCR match does not establish the package variant, source-image license, or label truth.']};
 for(const record of records){
  const imagePath=path.join('docs/evidence/private',record.file);const bytes=await fs.readFile(imagePath);const hash=crypto.createHash('sha256').update(bytes).digest('hex');
  if(hash!==record.hash)throw new Error(`Source hash mismatch for ${record.file}`);
  const browserPrepared=await sharp(bytes).rotate().resize({width:3000,height:3000,fit:'inside',withoutEnlargement:false}).jpeg({quality:98}).toBuffer();
  const enhanced=await sharp(bytes).rotate().resize({width:3000,height:3000,fit:'inside',withoutEnlargement:false}).grayscale().normalize().sharpen().jpeg({quality:98}).toBuffer();
  const attempts:[Mode,number,Buffer][]=[['eng-auto-native',PSM.AUTO,bytes],['eng-single-native',PSM.SINGLE_BLOCK,bytes],['eng-sparse-native',PSM.SPARSE_TEXT,bytes],['eng-auto-browser-prepared',PSM.AUTO,browserPrepared],['eng-single-column-browser-prepared',PSM.SINGLE_COLUMN,browserPrepared],['eng-single-browser-prepared',PSM.SINGLE_BLOCK,browserPrepared],['eng-single-enhanced',PSM.SINGLE_BLOCK,enhanced]];
  for(const [mode,psm,input] of attempts){
   await worker.setParameters({tessedit_pageseg_mode:psm,preserve_interword_spaces:'1'});
   const result=await worker.recognize(input);const text=result.data.text;const pkg:PackageData=parseLabel(text,{origin:'ocr',confidence:result.data.confidence,side:'extra'});const aggregateMode=aggregate[mode];const metrics=signal(text);const detail={confidence:Number(result.data.confidence.toFixed(2)),...metrics,parsedNutrients:pkg.nutrients.length,explicitBasisNutrients:pkg.nutrients.filter(n=>n.basis).length,unconflictedBasisNutrients:pkg.nutrients.filter(n=>n.basis&&n.status!=='conflict').length,conflictedNutrients:pkg.nutrients.filter(n=>n.status==='conflict').length,ingredientLines:pkg.ingredients.length,claims:pkg.claims.length};rawRun[`${record.code}:${mode}`]=detail;
   for(const expected of record.manualAnnotation!.nutrients){
    aggregateMode.expected++;
    const rows=pkg.nutrients.filter(n=>n.key===expected.key&&n.basis?.amount===record.manualAnnotation!.basis!.amount&&n.basis?.unit===record.manualAnnotation!.basis!.unit);
    const usable=rows.filter(n=>n.status!=='conflict');let outcome:'correct'|'incorrect'|'omitted'|'withheld';let read:number|null=null;
    if(rows.some(n=>n.status==='conflict'))outcome='withheld';
    else if(!usable.length)outcome=pkg.nutrients.some(n=>n.key===expected.key)?'withheld':'omitted';
    else{
     read=normalized(expected.key,usable[0].value,usable[0].unit);
     const target=normalized(expected.key,expected.value,expected.unit);
     const correct=usable.some(n=>Math.abs(normalized(expected.key,n.value,n.unit)-target)<=Math.max(.015,Math.abs(target)*.005));
     outcome=correct?'correct':'incorrect';
    }
    aggregateMode[outcome]++;
    aggregateMode.fields.push({code:record.code,file:record.file,key:expected.key,expected:expected.value,unit:expected.unit,result:outcome,read});
   }
  }
 }
 for(const mode of modes){const row=aggregate[mode];const byLanguage=Object.fromEntries([...new Set(records.map(r=>r.type.match(/English|French|Spanish/i)?.[0]??'unspecified'))].map(language=>{const photos=records.filter(r=>(r.type.match(/English|French|Spanish/i)?.[0]??'unspecified')===language);const fields=row.fields.filter(f=>photos.some(r=>r.code===f.code&&r.file===f.file));return [language,{photos:photos.length,expected:fields.length,correct:fields.filter(f=>f.result==='correct').length,incorrect:fields.filter(f=>f.result==='incorrect').length,omitted:fields.filter(f=>f.result==='omitted').length,withheld:fields.filter(f=>f.result==='withheld').length}]}));output.modes[mode]={expectedFields:row.expected,correct:row.correct,incorrect:row.incorrect,omitted:row.omitted,withheld:row.withheld,fieldAccuracy:row.expected?Number((row.correct/row.expected).toFixed(4)):null,byLanguage,ocrSignals:records.map(r=>({code:r.code,file:r.file,...rawRun[`${r.code}:${mode}`]})),photos:records.map(r=>({code:r.code,file:r.file,language:r.type.match(/English|French|Spanish/i)?.[0]??'unspecified',fields:row.fields.filter(f=>f.code===r.code&&f.file===r.file)}))};}
 await fs.writeFile('docs/evidence/real-ocr-evaluation.json',JSON.stringify(output,null,2)+'\n');
 console.log(JSON.stringify({output:'docs/evidence/real-ocr-evaluation.json',photos:output.photos,manualFields:output.manualFields,modes:Object.fromEntries(modes.map(mode=>{const m=aggregate[mode];return [mode,{correct:m.correct,incorrect:m.incorrect,omitted:m.omitted,withheld:m.withheld,accuracy:Number((m.correct/m.expected).toFixed(4))}]}))},null,2));
}finally{await worker.terminate();}
