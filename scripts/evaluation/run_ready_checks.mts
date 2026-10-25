/** Offline evaluation activation. Developer reference invariants, not photo/clinical accuracy. */
import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {packageSchema,type PackageData} from '../../src/lib/contracts';
import {applyNutrientCorrection} from '../../src/lib/correction';
import {calculateSavedServing,executeGeminiTool,type GeminiToolContext} from '../../src/lib/server/gemini-tools';
import {assistInput} from '../../src/lib/server/gemini';
import {readFoodOnConcept} from '../../src/modules/knowledge/server';
import {readFoodCompositionSource} from '../../src/lib/server/food-composition-records';
import {readOpenFoodToxRecords} from '../../src/modules/knowledge/openfoodtox-records';

const root=process.cwd();
const option=(name:string)=>{const index=process.argv.indexOf(name);return index<0?null:process.argv[index+1]??null;};
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const output=path.resolve(root,option('--output')??`.data/final-validation/${new Date().toISOString().replace(/[:.]/g,'-')}-${revision.slice(0,8)}/baseline`);
const allowed=path.resolve(root,'.data/final-validation')+path.sep;
if(!output.startsWith(allowed)||path.basename(output)!=='baseline')throw new Error('Outputs must be a new .data/final-validation/<run>/baseline directory');
await mkdir(path.dirname(output),{recursive:true});await mkdir(output);
const scopedFiles=['src/lib/contracts.ts','src/lib/correction.ts','src/lib/portion.ts','src/lib/server/gemini.ts','src/lib/server/gemini-tools.ts','src/lib/server/food-composition.ts','src/lib/server/food-composition-records.ts','src/modules/knowledge/server.ts','src/modules/knowledge/openfoodtox-records.ts','src/components/package-reconstruction.tsx','data/foodon-index.json','.data/knowledge/openfoodtox-3.0.manifest.json','.data/food-composition/fdc-source-records.manifest.json','scripts/evaluation/run_ready_checks.mts'];
const hashes=[];
for(const file of scopedFiles){try{const bytes=await readFile(file);hashes.push({path:file,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});}catch{hashes.push({path:file,sha256:null,bytes:null});}}
const freeze={schemaVersion:1,revision,capturedAt:new Date().toISOString(),claimScope:'developer-authored-offline-invariants',files:hashes,workingTree:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim().split('\n').filter(Boolean),providerCalls:0,method:'Existing native calculator/validation/source interfaces; expected quantities predeclared as independent arithmetic examples, not product ground truth.'};
await writeFile(path.join(output,'freeze.json'),JSON.stringify(freeze,null,2),{flag:'wx'});

function context(unit:'g'|'ml'='g'):GeminiToolContext{
 const line='Synthetic arithmetic fixture; carbohydrate 20 g per 100 units.';
 const pkg:PackageData={id:'offline-invariant',name:'Synthetic invariant fixture',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],observations:[{id:'ocr-1',field:'ocr-line',text:line,side:'back',confidence:60,origin:'ocr',imageId:'image-1',readingOrder:{runId:'run-1',blockIndex:0,paragraphIndex:0,lineIndex:0}},{id:'serving-ocr',field:'ocr-line',text:`3 pieces (45 ${unit})`,side:'back',confidence:60,origin:'ocr',imageId:'image-1',readingOrder:{runId:'run-1',blockIndex:0,paragraphIndex:0,lineIndex:1}},{id:'net-ocr',field:'ocr-line',text:`Net contents 250 ${unit}`,side:'back',confidence:60,origin:'ocr',imageId:'image-1',readingOrder:{runId:'run-1',blockIndex:0,paragraphIndex:0,lineIndex:2}}],rawText:line,warnings:[],synthetic:true,createdAt:'2026-10-25T00:00:00.000Z',ocrCaptures:[{runId:'run-1',imageId:'image-1',side:'back',sourceImage:{width:900,height:600},preparedImage:{width:900,height:600},bboxCoordinateSpace:'prepared-image-pixels',engine:{name:'developer-fixture',version:'1',language:'eng',confidenceScale:'0-100',segmentationMode:'auto'},processing:{rotation:0,contrast:false,invert:false,cropPercent:null}}],reconstruction:{revision:2,updatedAt:'2026-10-25T00:00:00.000Z',model:'developer-fixture',current:true,identity:{brand:null,name:null,variant:null,status:'unreadable',evidence:{observationIds:[],imageRegions:[]}},serving:{printedText:`3 pieces (45 ${unit})`,quantity:45,unit,pieceCount:3,pieceDescription:'pieces',status:'provisional',evidence:{observationIds:['serving-ocr'],imageRegions:[]}},quantityDeclarations:[{kind:'net-content',printedText:`Net contents 250 ${unit}`,quantity:250,unit,status:'provisional',evidence:{observationIds:['net-ocr'],imageRegions:[]}}],nutritionRows:[{rowId:'row-1',nutrient:'carbohydrate',nutrientKey:'carbohydrate',printedLabel:'Carbohydrate',printedValue:'20',value:20,unit:'g',columnLabel:null,basisText:`per 100 ${unit}`,basisAmount:100,basisUnit:unit,qualifier:null,status:'provisional',evidence:{observationIds:['ocr-1'],imageRegions:[]}}],ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Developer-authored source-linked arithmetic fixture; no photographed product.'}};
 return{question:'Offline quantity invariant.',package:packageSchema.parse(pkg),visualImages:[],searchTerms:new Set(),prepareImage:async image=>image.base64};
}
type Row={caseId:string;family:string;referenceStatus:string;expected:unknown;actual:unknown;status:'PASS'|'FAIL'|'UNAVAILABLE';elapsedMs:number;[key:string]:unknown};
const rows:Row[]=[];
async function check(caseId:string,family:string,expected:unknown,action:()=>Promise<unknown>|unknown){const started=performance.now();let actual:unknown;try{actual=await action();}catch(error){actual={error:error instanceof Error?error.name:'UnknownError'};}rows.push({caseId,family,referenceStatus:'developer-authored-or-pinned-source',expected,actual,status:JSON.stringify(actual)===JSON.stringify(expected)?'PASS':'FAIL',elapsedMs:Math.round((performance.now()-started)*1000)/1000});}
async function quantity(id:string,c:GeminiToolContext,args:Record<string,unknown>,value:number|null,expectedStatus='ok'){
 const before=JSON.stringify(c.package);
 await check(id,'native-quantity',{status:expectedStatus,value,unchanged:true,unit:value===null?null:c.package.reconstruction!.nutritionRows[0].unit,basis:value===null?null:args.unit},async()=>{const result=await executeGeminiTool('calculate_nutrition',args,c);const calculation=result.calculations?.[0];return{status:result.status,value:calculation?.result??null,unchanged:JSON.stringify(c.package)===before,unit:calculation?.unit??null,basis:calculation?.countedPortion?.unit??(calculation?.packagePortion?'package':calculation?.portionUnit)??null};});
}
await quantity('mass-30g',context(),{candidateId:'row-1',amount:30,unit:'g'},6);
await quantity('volume-30ml',context('ml'),{candidateId:'row-1',amount:30,unit:'ml'},6);
await quantity('count-five-pieces',context(),{candidateId:'row-1',amount:5,unit:'pieces'},15);
await quantity('servings-one-and-half',context(),{candidateId:'row-1',amount:1.5,unit:'servings'},13.5);
await quantity('half-250g-package',context(),{candidateId:'row-1',amount:0.5,unit:'package'},25);
for(const scenario of [{id:'calcium-volume',name:'Calcium',value:142,unit:'mg',basis:150,dimension:'ml' as const,amount:75,result:71},{id:'iron-mass',name:'Iron',value:4,unit:'mg',basis:100,dimension:'g' as const,amount:30,result:1.2},{id:'b12-microgram',name:'Vitamin B12',value:2.5,unit:'µg',basis:100,dimension:'g' as const,amount:40,result:1},{id:'soluble-fibre',name:'Soluble fibre',value:4.4,unit:'g',basis:100,dimension:'g' as const,amount:50,result:2.2}]){
 const c=context(scenario.dimension);Object.assign(c.package.reconstruction!.nutritionRows[0],{nutrient:scenario.name,nutrientKey:null,printedLabel:scenario.name,value:scenario.value,unit:scenario.unit,basisAmount:scenario.basis});await quantity(scenario.id,c,{candidateId:'row-1',amount:scenario.amount,unit:scenario.dimension},scenario.result);
}
const zero=context();zero.package.reconstruction!.nutritionRows[0].value=0;await quantity('printed-zero-remains-zero',zero,{candidateId:'row-1',amount:30,unit:'g'},0);
for(const [id,change] of [['qualified-boundary',{qualifier:'<'}],['conflicting-reading',{status:'conflict'}],['percentage-not-absolute',{unit:'%RDA'}],['mass-volume-density-unknown',{basisUnit:'ml'}]] as const){const c=context();Object.assign(c.package.reconstruction!.nutritionRows[0],change);await quantity(id,c,{candidateId:'row-1',amount:30,unit:'g'},null,'withheld');}
const stale=context();stale.package.reconstruction!.current=false;await quantity('stale-reconstruction',stale,{candidateId:'row-1',amount:30,unit:'g'},null,'withheld');
await quantity('unknown-row',context(),{candidateId:'not-a-row',amount:30,unit:'g'},null,'withheld');
await quantity('negative-portion',context(),{candidateId:'row-1',amount:-1,unit:'g'},null,'error');
const corrected=context();const old=await executeGeminiTool('calculate_nutrition',{candidateId:'row-1',amount:5,unit:'pieces'},corrected);const original=JSON.stringify(corrected.package.reconstruction);corrected.package=applyNutrientCorrection(corrected.package,{key:'carbohydrate',value:25,unit:'g',basisAmount:100,basisUnit:'g'});
await quantity('standard-correction-precedence',corrected,{candidateId:'row-1',amount:5,unit:'pieces'},18.75);
await check('correction-preserves-model-original','state-provenance',true,()=>JSON.stringify(corrected.package.reconstruction)===original);
await check('stale-derived-input-rejected','state-provenance',false,()=>assistInput.safeParse({consent:true,question:'Offline quantity invariant.',package:corrected.package,calculations:old.calculations}).success);
await check('saved-serving-current-correction','state-provenance',11.25,()=>calculateSavedServing(corrected.package)[0]?.result??null);

await check('foodon-exact-gram-flour','source-access',{status:'ok',concept:'FOODON_03601071'},async()=>{const result=await readFoodOnConcept({id:'FOODON_03601071',relation:'parents'});return{status:result.status,concept:'concept' in result?result.concept.id:null};});
await check('foodon-unknown','source-access','no_match',async()=>(await readFoodOnConcept({id:'FOODON_99999999'})).status);
await check('fdc-exact-protein-source','source-access',{status:'ok',value:21.3,derivation:'NC'},async()=>{const result=await readFoodCompositionSource({release:'fdc-foundation-2026-04',fdcId:2644282,field:'foodNutrients',nutrientId:1003});const item=('results' in result?result.results?.[0]:null) as {amount?:number;foodNutrientDerivation?:{code:string}}|null;return{status:result.status,value:item?.amount??null,derivation:item?.foodNutrientDerivation?.code??null};});
await check('fdc-unknown-record','source-access','no_match',async()=>(await readFoodCompositionSource({release:'fdc-foundation-2026-04',fdcId:999999999})).status);
await check('efsa-known-substance-records','source-access','ok',async()=>(await readOpenFoodToxRecords({substanceId:'1f492311-b3ff-4d1e-80ac-27645fd0ea93',section:'overview',limit:1})).status);
await check('efsa-unknown-substance','source-access','no_match',async()=>(await readOpenFoodToxRecords({substanceId:'00000000-0000-4000-8000-000000000000',section:'overview',limit:1})).status);
const changed=[];for(const entry of freeze.files){if(entry.sha256){const bytes=await readFile(entry.path);if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)changed.push(entry.path);}}
const summary={schemaVersion:1,revision,claimScope:freeze.claimScope,executedCases:rows.length,passed:rows.filter(row=>row.status==='PASS').length,failed:rows.filter(row=>row.status==='FAIL').length,productAccuracyDenominator:0,independentHumanReferenceDenominator:0,providerCalls:0,sourceFilesChangedDuringRun:changed,blockedStudies:[{family:'modality/secondary OCR',state:'BLOCKED',reason:'Independent adjudicated references, rights/splits and controlled production modality adapter acceptance pending.'},{family:'retrieval/answer quality',state:'BLOCKED ON A + HUMAN REFERENCES',reason:'Source/applicability snapshots, independently graded query pool and blinded answer raters pending.'}],scope:'Offline calculator/source regression receipts only. No image reconstruction, clinical usefulness, held-out or distribution-level accuracy claims.'};
await writeFile(path.join(output,'cases.json'),JSON.stringify(rows,null,2),{flag:'wx'});await writeFile(path.join(output,'summary.json'),JSON.stringify(summary,null,2),{flag:'wx'});
const cell=(value:unknown)=>'"'+String(typeof value==='object'?JSON.stringify(value):value).replaceAll('"','""')+'"';
await writeFile(path.join(output,'cases.csv'),[['caseId','family','referenceStatus','expected','actual','status','elapsedMs'].join(','),...rows.map(row=>[row.caseId,row.family,row.referenceStatus,row.expected,row.actual,row.status,row.elapsedMs].map(cell).join(','))].join('\n')+'\n',{flag:'wx'});
console.log(JSON.stringify({output,...summary}));if(summary.failed||changed.length)process.exitCode=1;
