import {packageSchema,type AnalysisMethod,type PackageData} from './contracts';

export const analysisMethods:readonly{value:AnalysisMethod;label:string;reader:'tesseract'|'paddle'|null;images:boolean;description:string}[]=[
 {value:'tesseract-text',label:'Tesseract OCR → Gemini',reader:'tesseract',images:false,description:'Runs Tesseract locally. Only its text and layout observations are sent to Gemini; photos stay here.'},
 {value:'paddle-text',label:'PaddleOCR → Gemini',reader:'paddle',images:false,description:'Runs PaddleOCR locally, with model startup/download overhead. Only its observations are sent to Gemini.'},
 {value:'vision',label:'Gemini Vision',reader:null,images:true,description:'Sends the selected photos to Gemini without running OCR or including earlier OCR readings.'},
 {value:'tesseract-vision',label:'Tesseract + Gemini Vision',reader:'tesseract',images:true,description:'Runs Tesseract locally, then sends its observations and the selected photos to Gemini.'},
 {value:'paddle-vision',label:'PaddleOCR + Gemini Vision',reader:'paddle',images:true,description:'Runs PaddleOCR locally, then sends its observations and the selected photos to Gemini.'},
];
export const analysisMethodPolicy=(method:AnalysisMethod)=>analysisMethods.find(item=>item.value===method)!;

/** Initial reconstruction input only. Saved facts/corrections stay in the app. */
export function packageForSelectedMethod(pkg:PackageData,method:AnalysisMethod,imageIds?:readonly string[]){
 const policy=analysisMethodPolicy(method);
 const selectedImages=imageIds?new Set(imageIds):null;
 const latest=new Map<string,NonNullable<PackageData['ocrCaptures']>[number]>();
 for(const capture of pkg.ocrCaptures??[]){
  if(selectedImages&&!selectedImages.has(capture.imageId))continue;
  if(policy.reader==='tesseract'?capture.engine.name==='tesseract.js':policy.reader==='paddle'?capture.engine.name.startsWith('@paddleocr/paddleocr-js/'):false)latest.set(capture.imageId,capture);
 }
 const captures=[...latest.values()];
 const runIds=new Set(captures.map(c=>c.runId));
 const observations=pkg.observations.filter(o=>o.origin==='ocr'&&o.field==='ocr-line'&&o.readingOrder&&runIds.has(o.readingOrder.runId));
 return packageSchema.parse({id:pkg.id,name:'Unidentified package',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],observations,ocrCaptures:captures,rawText:observations.map(o=>o.text).join('\n').slice(0,40000),warnings:[],synthetic:pkg.synthetic,createdAt:pkg.createdAt});
}
