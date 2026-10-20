/** Local developer diagnostic, not browser acceptance. Uses ignored attributed public photos. */
import { createWorker, PSM } from 'tesseract.js';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
const worker=await createWorker('eng',1,{langPath:path.resolve('public/ocr')});
await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_BLOCK,preserve_interword_spaces:'1'});
const file='docs/evidence/private/saffola-veggie-oats-nutrition-off-8901088068758.jpg';
try{
 const original=await fs.readFile(file);
 for(const [label,bytes] of [['original',original],['resized',await sharp(original).resize({width:2200}).jpeg({quality:94}).toBuffer()]] as const){
  const result=await worker.recognize(bytes);await fs.writeFile(`docs/evidence/private/diagnostic-${label}.txt`,result.data.text);
  console.log(JSON.stringify({mode:'Node diagnostic only, not browser OCR',label,confidence:result.data.confidence,characters:result.data.text.length,recognizesCarbohydrate:/carbohydrate/i.test(result.data.text),recognizesSodium:/sodium/i.test(result.data.text)}));
 }
}finally{await worker.terminate();}
