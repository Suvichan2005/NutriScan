import {afterEach,expect,it,vi} from 'vitest';
import sharp from 'sharp';
import {analysisMethods,packageForSelectedMethod} from '../analysis-method';
import {packageSchema,type AnalysisMethod} from '../contracts';
import {assist,assistInput,sanitizePackageReconstruction,reconstructPackageForEvaluation} from './gemini';
import {resetGeminiUsageLedgerForTests} from './gemini-provider';

const evidence={observationIds:[] as string[],imageRegions:[] as {imageId:string;region:{x:number;y:number;width:number;height:number}}[]};
const capture=(reader:'tesseract'|'paddle',suffix='')=>({runId:`run-${reader}${suffix}`,imageId:'photo-1',side:'back' as const,sourceImage:{width:8,height:8},preparedImage:{width:8,height:8},bboxCoordinateSpace:'prepared-image-pixels' as const,engine:{name:reader==='tesseract'?'tesseract.js':'@paddleocr/paddleocr-js/PP-OCRv6-tiny',version:'test',language:'eng',confidenceScale:'0-100' as const,segmentationMode:'auto'},processing:{rotation:0 as const,contrast:false,invert:false,cropPercent:null}});
const packet=()=>packageSchema.parse({id:'method-fixture',name:'OLD_PARSED_IDENTITY',brand:'OLD_BRAND',ingredients:['OLD_PARSED_INGREDIENT'],additives:[],allergens:[],claims:[],nutrients:[],warnings:[],synthetic:false,createdAt:'2026-10-26T00:00:00Z',rawText:'OLD_RAW_TEXT',ocrCaptures:[capture('tesseract','-old'),capture('tesseract'),capture('paddle')],observations:['tesseract-old','tesseract','paddle'].map(reader=>({id:`obs-${reader}`,field:'ocr-line',origin:'ocr',text:`OCR_${reader}_EVIDENCE`,side:'back',confidence:90,imageId:'photo-1',readingOrder:{runId:`run-${reader}`,blockIndex:0,paragraphIndex:0,lineIndex:0}}))});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});

it('retains only the selected latest OCR capture and its raw lines without mutating stored evidence',()=>{
 const original=packet(),before=structuredClone(original);
 for(const method of analysisMethods){
  const selected=packageForSelectedMethod(original,method.value);
  expect(selected.name).toBe('Unidentified package');expect(selected.ingredients).toEqual([]);
  expect(selected.rawText).toBe(method.reader?`OCR_${method.reader}_EVIDENCE`:'');
  expect(selected.ocrCaptures?.map(c=>c.runId)).toEqual(method.reader?[`run-${method.reader}`]:[]);
 }
 expect(original).toEqual(before);
});

it('rejects invalid method/evidence combinations before credentials or provider use',async()=>{
 const pkg=packet(),base={consent:true as const,question:'Read this package',package:pkg,images:[{handle:'photo-1',side:'back' as const,width:8,height:8}]};
 expect(assistInput.safeParse({...base,analysisMethod:'automatic-other-reader'}).success).toBe(false);
 const photo={imageId:'photo-1',mimeType:'image/jpeg' as const,base64:'a'.repeat(16),side:'back' as const,sourceImage:{width:8,height:8},preprocessing:{rotation:0 as const,contrast:false,invert:false,crop:null},regionRole:'full-image' as const};
 await expect(assist(assistInput.parse({...base,analysisMethod:'tesseract-text',visualImages:[photo]}))).rejects.toMatchObject({code:'analysis_method_images_forbidden'});
 await expect(assist(assistInput.parse({...base,analysisMethod:'vision'}))).rejects.toMatchObject({code:'analysis_method_images_required'});
 await expect(assist(assistInput.parse({...base,analysisMethod:'vision',visualImages:[{...photo,regionRole:'nutrition-table'}]}))).rejects.toMatchObject({code:'analysis_method_originals_required'});
 await expect(assist(assistInput.parse({...base,analysisMethod:'paddle-text',package:{...pkg,observations:[],ocrCaptures:[],rawText:''}}))).rejects.toMatchObject({code:'analysis_method_reader_required'});
});

it('does not accept unseen image-region citations as support for text-only reconstruction',()=>{
 const input=assistInput.parse({analysisMethod:'tesseract-text',consent:true,question:'Read the OCR',package:packageForSelectedMethod(packet(),'tesseract-text'),images:[]});
 const unsupported={identity:{name:'Invented from an unseen image',brand:null,variant:null,status:'clear',evidence:{observationIds:[],imageRegions:[{imageId:'photo-1',region:{x:0,y:0,width:1,height:1}}]}},serving:null,nutritionRows:[],ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Unsupported image-only claim'};
 expect(sanitizePackageReconstruction(unsupported,input)).toBeNull();
});

it.each([...analysisMethods.map(m=>({method:m.value,sparse:false})),{method:'tesseract-vision' as AnalysisMethod,sparse:true}])('enforces $method (sparse OCR: $sparse) through reconstruction and compact follow-up',async({method,sparse})=>{
 resetGeminiUsageLedgerForTests();vi.stubEnv('ENABLE_GEMINI','true');vi.stubEnv('GEMINI_PROVIDER','free');vi.stubEnv('GEMINI_MODEL','gemini-3.8-flash');vi.stubEnv('FREE_GEMINI_API_KEY','offline-test-placeholder');vi.stubEnv('ENABLE_GEMINI_SEARCH','false');vi.stubEnv('ENABLE_PAID_GEMINI_FALLBACK','false');vi.stubEnv('NUTRISCAN_GEMINI_EVAL_CAPTURE','0');
 const policy=analysisMethods.find(m=>m.value===method)!;
 const bodies:any[]=[];
 const fetcher=vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>{
  const body=JSON.parse(String(init?.body));bodies.push(body);
  const refs=policy.reader&&!sparse?{...evidence,observationIds:[`obs-${policy.reader}`]}:{...evidence,imageRegions:[{imageId:'photo-1',region:{x:0,y:0,width:1,height:1}}]};
  const content={identity:{name:'Example package',brand:null,variant:null,status:'provisional',evidence:refs},serving:null,nutritionRows:[],ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Controlled contract fixture'};
  return new Response(JSON.stringify({candidates:[{content:{role:'model',parts:bodies.length===1?[{functionCall:{id:'reconstruct-1',name:'submit_package_reconstruction',args:content}}]:[{text:'The package reading is available for review.'}]},finishReason:'STOP'}],modelVersion:'gemini-3.8-flash-test',usageMetadata:{promptTokenCount:10,candidatesTokenCount:10,totalTokenCount:20}}),{headers:{'content-type':'application/json'}});
 });vi.stubGlobal('fetch',fetcher);
 const base64=(await sharp({create:{width:8,height:8,channels:3,background:'#ccc'}}).jpeg().toBuffer()).toString('base64');
 const pkg=packet();pkg.observations.push({id:'user-correction',field:'protein',text:'USER_CORRECTION: Protein 11.5 g per 100 g',side:'text',confidence:null,origin:'user'});pkg.nutrients.push({key:'protein',value:11.5,unit:'g',basis:{amount:100,unit:'g',description:'per 100 g'},observationIds:['user-correction'],status:'corrected'});if(sparse){pkg.observations=pkg.observations.filter(o=>o.origin==='user');pkg.ocrCaptures=[];pkg.rawText='';}const before=structuredClone(pkg);
 const result=await assist(assistInput.parse({analysisMethod:method,consent:true,question:'What is this package?',package:pkg,images:[{handle:'photo-1',side:'back',width:8,height:8,description:'OLD_IMAGE_DESCRIPTION'}],...(policy.images?{visualImages:[{imageId:'photo-1',mimeType:'image/jpeg',base64,side:'back',sourceImage:{width:8,height:8},preprocessing:{rotation:0,contrast:false,invert:false,crop:null},regionRole:'full-image'}]}:{})}));
 expect(bodies).toHaveLength(2);
 const initial=JSON.stringify(bodies[0].contents);
 expect(initial).not.toContain('USER_CORRECTION');expect(JSON.stringify(bodies[1].contents)).toContain('USER_CORRECTION');expect(initial).not.toContain('OLD_PARSED');expect(initial).not.toContain('OLD_RAW_TEXT');expect(initial).not.toContain('OLD_BRAND');expect(initial).not.toContain('OLD_IMAGE_DESCRIPTION');
 for(const reader of ['tesseract','paddle'])expect(initial.includes(`OCR_${reader}_EVIDENCE`)).toBe(policy.reader===reader&&!sparse);
 expect(initial).not.toContain('OCR_tesseract-old_EVIDENCE');
 expect(bodies[0].contents[0].parts.some((part:any)=>part.inlineData)).toBe(policy.images);
 const toolNames=bodies[1].tools.flatMap((tool:any)=>tool.functionDeclarations??[]).map((tool:any)=>tool.name);
 expect(toolNames.includes('inspect_package_image')).toBe(policy.images);
 expect(result.analysisReceipt).toMatchObject({method,model:'gemini-3.8-flash-test',ocrRunIds:policy.reader&&!sparse?[`run-${policy.reader}`]:[],imageIds:policy.images?['photo-1']:[]});
 expect(pkg).toEqual(before);
 const saved=packageSchema.parse({...pkg,...(policy.images?{visionCaptures:[{runId:'saved-vision',imageId:'photo-1',side:'back',sourceImage:{width:8,height:8},processing:{rotation:0,contrast:false,invert:false,crop:null},model:result.analysisReceipt!.model}]}:{}),reconstruction:{...result.packageReconstruction,revision:2,model:result.analysisReceipt!.model,updatedAt:'2026-10-26T00:00:00Z',current:true,analysisMethod:method}});
 await assist(assistInput.parse({consent:true,question:'Tell me more about the saved package',package:saved}));
 expect(bodies).toHaveLength(3);
 expect(bodies[2].contents[0].parts.some((part:any)=>part.inlineData)).toBe(false);
 expect(JSON.stringify(bodies[2].contents[0].parts)).toContain('Example package');
});


it.each(analysisMethods)('controlled $value extraction retains valid sections despite invalid optional metadata',async policy=>{
 resetGeminiUsageLedgerForTests();vi.stubEnv('NODE_ENV','development');vi.stubEnv('ENABLE_GEMINI','true');vi.stubEnv('GEMINI_PROVIDER','free');vi.stubEnv('GEMINI_MODEL','gemini-3.8-flash');vi.stubEnv('FREE_GEMINI_API_KEY','offline-test-placeholder');vi.stubEnv('ENABLE_PAID_GEMINI_FALLBACK','false');vi.stubEnv('NUTRISCAN_GEMINI_EVAL_CAPTURE','0');
 const bodies:any[]=[];
 vi.stubGlobal('fetch',vi.fn(async(_input,init)=>{
  const body=JSON.parse(String(init?.body));bodies.push(body);
  const refs=policy.reader?{...evidence,observationIds:[`obs-${policy.reader}`]}:{...evidence,imageRegions:[{imageId:'photo-1',region:{x:0,y:0,width:1,height:1}}]};
  const content={identity:{name:'Test source',brand:null,variant:null,status:'provisional',evidence:refs},serving:null,nutritionRows:[],ingredients:[],additives:[],statements:[],regions:[],unresolved:[],quantityDeclarations:[{kind:'servings-per-package',printedText:null,quantity:1,unit:'g',status:'provisional',evidence:refs}],interpretationNote:'Synthetic contract, no accuracy claim'};
  return new Response(JSON.stringify({candidates:[{content:{role:'model',parts:[{functionCall:{id:'one-stage',name:'submit_package_reconstruction',args:content}}]},finishReason:'STOP'}],modelVersion:'gemini-3.8-flash-test',usageMetadata:{promptTokenCount:10,candidatesTokenCount:5,totalTokenCount:15}}),{headers:{'content-type':'application/json'}});
 }));
 const base64=(await sharp({create:{width:8,height:8,channels:3,background:'#ccc'}}).jpeg().toBuffer()).toString('base64');
 const result=await reconstructPackageForEvaluation({analysisMethod:policy.value,consent:true,question:'Reconstruct the package',package:packet(),images:policy.images?[{handle:'photo-1',side:'back',width:8,height:8}]:[],...(policy.images?{visualImages:[{imageId:'photo-1',mimeType:'image/jpeg',base64,side:'back',sourceImage:{width:8,height:8},preprocessing:{rotation:0,contrast:false,invert:false,crop:null},regionRole:'full-image'}]}:{})});
 expect(bodies).toHaveLength(1);expect(bodies[0].tools[0].functionDeclarations.map((t:any)=>t.name)).toEqual(['submit_package_reconstruction']);
 expect(JSON.stringify(bodies[0].contents).includes('OLD_PARSED')).toBe(false);
 expect(result).toMatchObject({actualStage:'initial-reconstruction',analysisMethod:policy.value,recoveryCalls:0,answerGenerationCalls:0,actualTier:'free',fallbackOccurred:false,usage:{promptTokenCount:10,candidatesTokenCount:5},actualInputSelection:{analysisMethod:policy.value,evidence:[...(policy.reader?[policy.reader+'-observations']:[]),...(policy.images?['original-images']:[])]}});
 expect(result.actualGenerationConfig.maxOutputTokens).toBe(bodies[0].generationConfig.maxOutputTokens);expect(result.packageReconstruction.quantityDeclarations).toEqual([]);expect(result.packageReconstruction.unresolved).toEqual(expect.arrayContaining([expect.objectContaining({field:'quantityDeclarations'})]));
});
it('controlled reconstruction is development-only and rejects profile/context before providers',async()=>{
 const input={analysisMethod:'tesseract-text',consent:true,question:'Read',package:packet()};
 vi.stubEnv('NODE_ENV','production');await expect(reconstructPackageForEvaluation(input)).rejects.toMatchObject({code:'evaluation_local_only'});
 vi.stubEnv('NODE_ENV','development');await expect(reconstructPackageForEvaluation({...input,profile:{dietaryPattern:'',allergies:'',intolerances:'',healthConsiderations:'',goals:'',ageGroup:'',sexOrReferenceGroup:'',country:'',locality:''}})).rejects.toMatchObject({code:'evaluation_input'});
 await expect(reconstructPackageForEvaluation({...input,conversationContext:[{question:'prior',answer:'context'}]})).rejects.toMatchObject({code:'evaluation_input'});
});
