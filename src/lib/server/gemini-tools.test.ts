import { afterEach, describe, expect, it, vi } from 'vitest';
import { evidenceSources } from '../../modules/knowledge';
import { calculationSchema, defaultProfile, sourceSchema, type PackageData, type Profile, type TentativeStructuredCandidate } from '../contracts';
import { validateNaturalAnswerText } from '../../modules/inference';
import { assistInput } from './gemini';
import { calculateSavedServing, executeGeminiTool, type GeminiToolContext } from './gemini-tools';

const mocks = vi.hoisted(() => ({ semanticRetrieve: vi.fn(), searchOpenFoodTox: vi.fn(), research: vi.fn() }));
vi.mock('../semantic', () => ({ semanticRetrieve: mocks.semanticRetrieve, searchOpenFoodTox: mocks.searchOpenFoodTox }));
vi.mock('./research', async importOriginal => {
  const actual = await importOriginal<typeof import('./research')>();
  mocks.research.mockImplementation((args: Parameters<typeof actual.research>[0]) => actual.research(args));
  return { ...actual, research: mocks.research };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function context(question: string, line = 'INGREDIENTS: REFINED WHEAT FLOUR; 019', profile?: Profile): GeminiToolContext {
  const packageData: PackageData = {
    id: 'package-test', name: 'Unidentified package', ingredients: [], additives: [], allergens: [], claims: [], nutrients: [],
    observations: [{ id: 'ocr-1', field: 'ocr-line', text: line, side: 'back', confidence: 60, origin: 'ocr', imageId: 'image-1', readingOrder: { runId: 'run-1', blockIndex: 0, paragraphIndex: 0, lineIndex: 0 } }],
    rawText: line, warnings: [], synthetic: true, createdAt: new Date().toISOString(),
  };
  return { question, package: packageData, ...(profile ? { profile } : {}), visualImages: [], searchTerms: new Set(), prepareImage: async image => image.base64 };
}

describe('Gemini tool retrieval boundaries', () => {
  function countedContext(){
    const toolContext=context('Compare five pieces with one serving.');
    toolContext.package.observations.push({...toolContext.package.observations[0],id:'serving-ocr',readingOrder:{runId:'run-1',blockIndex:0,paragraphIndex:0,lineIndex:1}});
    toolContext.package.ocrCaptures=[{runId:'run-1',imageId:'image-1',side:'back',sourceImage:{width:900,height:600},preparedImage:{width:900,height:600},bboxCoordinateSpace:'prepared-image-pixels',engine:{name:'fixture',version:'1',language:'eng',confidenceScale:'0-100',segmentationMode:'auto'},processing:{rotation:0,contrast:false,invert:false,cropPercent:null}}];
    toolContext.package.reconstruction={revision:2,updatedAt:new Date().toISOString(),model:'fixture',current:true,
      identity:{brand:null,name:null,variant:null,status:'unreadable',evidence:{observationIds:[],imageRegions:[]}},
      serving:{printedText:'3 crackers (45 g)',quantity:45,unit:'g',pieceCount:3,pieceDescription:'crackers',status:'provisional',evidence:{observationIds:['serving-ocr'],imageRegions:[]}},
      nutritionRows:[{rowId:'count-carb',nutrient:'carbohydrate',printedLabel:'Carbohydrate',printedValue:'20',value:20,unit:'g',columnLabel:null,basisText:'per 100 g',basisAmount:100,basisUnit:'g',qualifier:null,status:'provisional',evidence:{observationIds:['ocr-1'],imageRegions:[]}}],
      ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Developer fixture.'};
    return toolContext;
  }
  it('converts declared piece counts and fractional servings before deterministic nutrition arithmetic',async()=>{
    const toolContext=countedContext();
    const original=structuredClone(toolContext.package);
    const pieces=await executeGeminiTool('calculate_nutrition',{nutrient:'carbohydrate',amount:5,unit:'pieces',candidateId:'count-carb'},toolContext);
    expect(pieces.status).toBe('ok');
    expect(pieces.calculations?.[0]).toMatchObject({portion:75,portionUnit:'g',result:15,observationIds:['ocr-1','serving-ocr']});
    expect(pieces.output).toMatchObject({portionConversion:{requestedAmount:5,requestedUnit:'pieces',normalizedAmount:75,normalizedUnit:'g',revision:2}});
    expect(pieces.calculations?.[0].assumptions.join(' ')).toContain('remain unverified');
    expect(pieces.calculations?.[0].countedPortion).toEqual({amount:5,unit:'pieces',servingQuantity:45,servingUnit:'g',piecesPerServing:3});
    expect(validateNaturalAnswerText('5 pieces contain 15 g carbohydrate.',{package:toolContext.package,calculations:pieces.calculations}).withheldUnsupportedQuantitySentenceCount).toBe(0);
    expect(calculationSchema.safeParse({...pieces.calculations![0],countedPortion:{...pieces.calculations![0].countedPortion,amount:6}}).success).toBe(false);
    const payload={consent:true,question:toolContext.question,package:toolContext.package,calculations:pieces.calculations};
    const accepted=assistInput.safeParse(payload);
    expect(accepted.success,JSON.stringify(accepted.error?.issues)).toBe(true);
    const forged=structuredClone(payload);
    const forgedCalculation=forged.calculations![0];
    forgedCalculation.countedPortion!.servingQuantity*=2;
    forgedCalculation.portion*=2;forgedCalculation.result*=2;
    expect(calculationSchema.safeParse(forgedCalculation).success).toBe(true);
    expect(assistInput.safeParse(forged).success).toBe(false);
    const servings=await executeGeminiTool('calculate_nutrition',{nutrient:'carbohydrate',amount:1.5,unit:'servings',candidateId:'count-carb'},toolContext);
    expect(servings.calculations?.[0]).toMatchObject({portion:67.5,result:13.5});
    expect(toolContext.package).toEqual(original);
  });
  it('withholds count conversion for stale, ambiguous, disconnected or conflicting serving definitions',async()=>{
    for(const mutate of [
      (c:GeminiToolContext)=>{c.package.reconstruction!.current=false;},
      (c:GeminiToolContext)=>{c.package.reconstruction!.serving!.status='ambiguous';},
      (c:GeminiToolContext)=>{c.package.reconstruction!.serving!.evidence.observationIds=[];},
      (c:GeminiToolContext)=>{c.package.serving={value:60,unit:'g'};},
      (c:GeminiToolContext)=>{c.package.reconstruction!.serving!.pieceCount=null;},
      (c:GeminiToolContext)=>{c.package.reconstruction!.serving!.pieceDescription='g';},
    ]){
      const toolContext=countedContext();mutate(toolContext);
      const result=await executeGeminiTool('calculate_nutrition',{nutrient:'carbohydrate',amount:5,unit:'pieces',candidateId:'count-carb'},toolContext);
      expect(result.status).toBe('withheld');expect(result.calculations).toBeUndefined();
    }
    const result=await executeGeminiTool('calculate_nutrition',{nutrient:'carbohydrate',amount:10000,unit:'servings',candidateId:'count-carb'},countedContext());
    expect(result.status).toBe('withheld');
  });
  it('derives revisioned provisional calculations only from complete evidence-linked saved rows and the declared serving', () => {
    const packageData=context('What about the serving?').package;
    packageData.reconstruction={
      revision:4,updatedAt:new Date().toISOString(),model:'gemini-3.6-flash',current:true,
      identity:{brand:'BISK FARM',name:'Cream Cracker',variant:null,status:'clear',evidence:{observationIds:['ocr-1'],imageRegions:[]}},
      serving:{printedText:'2 biscuits approx. 13.4 g',quantity:13.4,unit:'g',pieceCount:2,pieceDescription:'biscuits',status:'clear',evidence:{observationIds:['ocr-1'],imageRegions:[]}},
      nutritionRows:[
        {rowId:'carb-r4',nutrient:'carbohydrates',printedLabel:'CARBOHYDRATES',printedValue:'69.29',value:69.29,unit:'g',columnLabel:null,basisText:'per 100 g',basisAmount:100,basisUnit:'g',qualifier:null,status:'provisional',evidence:{observationIds:['ocr-1'],imageRegions:[]}},
        {rowId:'sugar-r4',nutrient:'total sugars',printedLabel:'TOTAL SUGARS',printedValue:'<0.5',value:0.5,unit:'g',columnLabel:null,basisText:'per 100 g',basisAmount:100,basisUnit:'g',qualifier:'<',status:'provisional',evidence:{observationIds:['ocr-1'],imageRegions:[]}},
        {rowId:'missing-unit',nutrient:'protein',printedLabel:'PROTEIN',printedValue:'11.4',value:11.4,unit:null,columnLabel:null,basisText:'per 100 g',basisAmount:100,basisUnit:'g',qualifier:null,status:'provisional',evidence:{observationIds:['ocr-1'],imageRegions:[]}},
      ],ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Provisional interpretation.',
    };

    const calculations=calculateSavedServing(packageData);

    expect(calculations).toHaveLength(1);
    expect(calculations[0]).toMatchObject({id:'reconcalc-r4-carb-r4-13.4-g',label:'Carbohydrates per serving (2 biscuits approx. 13.4 g)',nutrient:'carbohydrate',input:69.29,basisAmount:100,portion:13.4,result:69.29*13.4/100,unit:'g',observationIds:['ocr-1'],interpretationIds:['carb-r4']});
    expect(calculations[0].assumptions.join(' ')).toMatch(/remain provisional/i);
  });
  it('calculates from a saved image-linked interpretation when OCR has no matching text line', () => {
    const packageData=context('What about this serving?').package;
    const imageRegion={imageId:'image-1',region:{x:0.08,y:0.06,width:0.42,height:0.35}};
    packageData.reconstruction={
      revision:5,updatedAt:new Date().toISOString(),model:'Gemini',current:true,
      identity:{brand:'BISK FARM',name:'Cream Cracker',variant:'Sugar Free',status:'provisional',evidence:{observationIds:[],imageRegions:[imageRegion]}},
      serving:{printedText:'2 biscuits approx. 13.4 g',quantity:13.4,unit:'g',pieceCount:2,pieceDescription:'biscuits',status:'provisional',evidence:{observationIds:[],imageRegions:[imageRegion]}},
      nutritionRows:[{rowId:'carb-image-r5',nutrient:'carbohydrates',printedLabel:'CARBOHYDRATES',printedValue:'69.29 g',value:69.29,unit:'g',columnLabel:'per 100 g',basisText:'per 100 g',basisAmount:100,basisUnit:'g',qualifier:null,status:'provisional',evidence:{observationIds:[],imageRegions:[imageRegion]}}],
      ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Image-linked provisional interpretation.',
    };

    const calculations=calculateSavedServing(packageData);

    expect(calculations).toHaveLength(1);
    expect(calculations[0]).toMatchObject({nutrient:'carbohydrate',input:69.29,basisAmount:100,portion:13.4,result:69.29*13.4/100,imageIds:['image-1'],observationIds:[],interpretationIds:['carb-image-r5']});
    expect(calculations[0].assumptions.join(' ')).toMatch(/remain provisional/i);
  });
  it('filters out-of-scope country guidance from semantic retrieval before returning it to Gemini', async () => {
    const usGuidance = evidenceSources.find(source => source.id === 'niddk-meals')!;
    mocks.semanticRetrieve.mockResolvedValue({
      status: 'ok', mode: 'hybrid-local-embedding', corpusVersion: 'test', limitations: [], message: null,
      results: [{ source: usGuidance, score: 0.92, exactIdentity: false }],
    });
    const result = await executeGeminiTool('search_knowledge', { query: 'diabetes daily snacking' }, context('Is this suitable for daily snacking with diabetes?'));

    expect(result.status).toBe('empty');
    expect(result.evidence).toEqual([]);
    expect(result.resultCount).toBe(0);
  });

  it('filters the wider retrieval window before limiting applicable evidence for Gemini', async () => {
    const globalSodium = evidenceSources.find(source => source.id === 'who-sodium')!;
    const outOfScopeCandidates = [1, 2, 3].map(index => ({
      ...globalSodium,
      id: `us-sodium-guidance-${index}`,
      jurisdiction: 'United States; general population guidance',
    }));
    mocks.semanticRetrieve.mockResolvedValue({
      status: 'ok', mode: 'hybrid-local-embedding', corpusVersion: 'test', limitations: [], message: null,
      results: [
        ...outOfScopeCandidates.map(source => ({ source, score: 0.95, exactIdentity: false })),
        { source: globalSodium, score: 0.72, exactIdentity: false },
      ],
    });

    const result = await executeGeminiTool('search_knowledge', { query: 'sodium advice for adults in India' }, context('What sodium advice applies to adults in India?'));

    expect(mocks.semanticRetrieve).toHaveBeenCalledWith('sodium advice for adults in India', 5);
    expect(result.status).toBe('ok');
    expect(result.evidence?.map(source => source.id)).toEqual(['who-sodium']);
    expect(result.output).toMatchObject({ status: 'ok' });
  });

  it('returns relevant oat outcome evidence alongside local ingredient identity lookup', async () => {
    const result = await executeGeminiTool(
      'resolve_ingredient',
      { query: 'oats' },
      context('What evidence is there about oats and cholesterol?', 'INGREDIENTS: rolled oats, salt'),
    );

    expect(result.status).toBe('ok');
    expect(result.resultCount).toBeLessThanOrEqual(5);
    expect(result.evidence?.map(source => source.id)).toContain('pubmed-oat-beta-glucan-lipids-2022');
    expect(result.output).toMatchObject({
      relatedIngredientEvidence: [expect.objectContaining({
        id: 'oat-beta-glucan-lipid-outcomes',
        sourceIds: ['pubmed-oat-beta-glucan-lipids-2022'],
        limitations: expect.stringMatching(/does not establish.*dose/i),
      })],
    });
    expect(JSON.stringify(result.output)).toMatch(/do not establish package composition, dose, exposure/i);
  });

  it('abstains when semantically ranked candidates lack topical evidence for an ingredient-effect question', async () => {
    const unrelated = evidenceSources.find(source => source.id === 'fssai-labelling-allergen-faq-2023')!;
    mocks.semanticRetrieve.mockResolvedValue({
      status: 'ok', mode: 'hybrid-local-embedding', corpusVersion: 'test', limitations: [], message: null,
      results: [{ source: unrelated, score: 0.82, exactIdentity: false }],
    });

    const result = await executeGeminiTool('search_knowledge', { query: 'Does beta-glucan in oats affect blood cholesterol?' }, context('Does beta-glucan in oats affect blood cholesterol?'));

    expect(result.status).toBe('empty');
    expect(result.resultCount).toBe(0);
    expect(result.evidence).toEqual([]);
    expect(result.output).toMatchObject({ status: 'empty', message: expect.stringMatching(/topical relevance and applicability/i) });
  });

  it('does not pass general fibre guidance off as evidence about a named substance', async () => {
    const general = {
      ...evidenceSources.find(source => source.id === 'fssai-labelling-allergen-faq-2023')!,
      id: 'general-fibre-guidance',
      title: 'Dietary fibre and digestion',
      summary: 'General guidance about dietary fibre intake and digestion.',
    };
    const query = 'What evidence describes oligofructose in food and dietary fibre?';
    const candidate = { source: general, score: 0.94, exactIdentity: false };
    mocks.semanticRetrieve.mockResolvedValue({
      status: 'ok', mode: 'hybrid-local-embedding', corpusVersion: 'test', limitations: [], message: null,
      results: [candidate],
    });

    const result = await executeGeminiTool('search_knowledge', { query }, context(query));
    expect(result.status).toBe('empty');
    expect(result.evidence).toEqual([]);

    mocks.semanticRetrieve.mockResolvedValue({
      status: 'ok', mode: 'hybrid-local-embedding', corpusVersion: 'test', limitations: [], message: null,
      results: [{ ...candidate, exactIdentity: true }],
    });
    const exact = await executeGeminiTool('search_knowledge', { query }, context(query));
    expect(exact.status).toBe('ok');
    expect(exact.evidence?.map(item => item.id)).toEqual([general.id]);
  });

  it('inspects the full source image when an OCR-guided crop shares its image handle', async () => {
    const imageContext=context('Read the nutrient row.');
    const original={imageId:'image-1',mimeType:'image/jpeg' as const,base64:'b3JpZ2luYWwgaW1hZ2UgYnl0ZXM=',side:'back' as const,sourceImage:{width:1000,height:500},preprocessing:{rotation:0 as const,contrast:false,invert:false,crop:null}};
    const crop={...original,base64:'Y3JvcCBieXRlcw==',preprocessing:{...original.preprocessing,crop:{x:0.1,y:0.2,width:0.4,height:0.3}}};
    imageContext.visualImages.push(crop,original);
    imageContext.prepareImage=vi.fn(async image=>image.base64);

    const result=await executeGeminiTool('inspect_package_image',{imageId:'image-1'},imageContext);

    expect(imageContext.prepareImage).toHaveBeenCalledWith(original);
    expect(result.status).toBe('ok');
    expect(result.output).toMatchObject({imageId:'image-1',side:'back'});
    expect(result.image?.base64).toBe(original.base64);
  });

  it('retrieves India-compatible CKD guidance locally without inventing a potassium allowance', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);

    const result = await executeGeminiTool('get_nutrition_guidance', {
      query: 'How should adults in India with CKD handle sodium and potassium?',
      condition: 'CKD',
      jurisdiction: 'India',
    }, context('How should adults in India with CKD handle sodium and potassium?'));

    expect(result.status).toBe('ok');
    expect(result.evidence?.map(source => source.id)).toEqual(['kdigo-ckd-2024-sodium']);
    expect(sourceSchema.array().safeParse(result.evidence).success).toBe(true);
    expect(result.evidence?.[0].summary).toMatch(/below 2 g\/day/i);
    expect(result.evidence?.[0].limitations).toMatch(/sodium-wasting nephropathy/i);
    expect(result.output).toMatchObject({ externalRequestMade: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('uses global diabetes guidance for India without presenting U.S. guidance as locally applicable', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);

    const result = await executeGeminiTool('get_nutrition_guidance', {
      query: 'What carbohydrate target applies to diabetes in India?',
      condition: 'diabetes',
      jurisdiction: 'India',
    }, context('What carbohydrate target applies to diabetes in India?'));

    expect(result.status).toBe('ok');
    expect(result.evidence?.map(source => source.id)).toEqual(['idf-healthy-nutrition-diabetes-2024']);
    expect(result.evidence?.[0].jurisdiction).toBe('Global');
    expect(result.evidence?.some(source => source.jurisdiction === 'United States')).toBe(false);
    expect(result.output).toMatchObject({ status: 'ok', externalRequestMade: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not retrieve ICMR-NIN 2024 content until its product-use permission is cleared', async () => {
    const result = await executeGeminiTool('get_nutrition_guidance', {
      query: 'ICMR NIN dietary guidelines 2024 balanced diet India',
      jurisdiction: 'India',
    }, context('What does ICMR NIN 2024 say about a balanced diet in India?'));

    expect(result.status).toBe('empty');
    expect(result.evidence).toEqual([]);
  });

  it('does not cross-apply CKD sodium guidance to hypertension without a kidney context', async () => {
    const result = await executeGeminiTool('get_nutrition_guidance', {
      query: 'How should I manage sodium for hypertension in India?',
      condition: 'hypertension',
      jurisdiction: 'India',
    }, context('How should I manage sodium for hypertension in India?'));

    expect(result.status).toBe('empty');
    expect(result.evidence?.some(source => source.id === 'kdigo-ckd-2024-sodium')).toBe(false);
  });

  it('defaults to international guidance when no user jurisdiction is available, but honors an explicit source request', async () => {
    const general = await executeGeminiTool('get_nutrition_guidance', {
      query: 'How should adults with CKD handle sodium and potassium?',
      condition: 'CKD',
    }, context('How should adults with CKD handle sodium and potassium?'));

    expect(general.evidence?.map(source => source.id)).toEqual(['kdigo-ckd-2024-sodium']);

    const explicit = await executeGeminiTool('get_nutrition_guidance', {
      query: 'What does NIDDK say about potassium in CKD?',
    }, context('What does NIDDK say about potassium in CKD?'));

    expect(explicit.evidence?.map(source => source.id)).toEqual(['niddk-ckd-adult-eating', 'kdigo-ckd-2024-sodium']);
    expect(explicit.evidence?.some(source => source.id === 'niddk-celiac-eating-2020')).toBe(false);
  });

  it('uses only the user question or explicitly supplied profile, not invented tool arguments', async () => {
    const irrelevant = await executeGeminiTool('get_nutrition_guidance', {
      query: 'CKD sodium hypertension diabetes potassium',
      condition: 'diabetes',
      jurisdiction: 'United States',
    }, context('What package details are visible?'));

    expect(irrelevant.status).toBe('empty');
    expect(irrelevant.evidence).toEqual([]);

    const profile = { ...defaultProfile, healthConsiderations: 'Chronic kidney disease', country: 'India' };
    const authorized = await executeGeminiTool('get_nutrition_guidance', {
      query: 'CKD sodium', condition: 'CKD', jurisdiction: 'India',
    }, context('How does this fit my context?', 'INGREDIENTS: REFINED WHEAT FLOUR', profile));

    expect(authorized.evidence?.map(source => source.id)).toEqual(['kdigo-ckd-2024-sodium']);
  });

  it('rejects oversized guidance lookups without executing retrieval', async () => {
    const result = await executeGeminiTool('get_nutrition_guidance', {
      query: 'CKD sodium',
      maxResults: 6,
    }, context('What should I eat?'));

    expect(result.status).toBe('error');
    expect(result.output).toMatchObject({ status: 'invalid_arguments' });
  });

  it('withholds prior photo-only nutrition candidates even while the source image is attached', async () => {
    const imageContext = context('How much protein is in 20 g?');
    const candidate: TentativeStructuredCandidate = {
      candidateId: 'visual-protein', kind: 'nutrient', field: 'protein', proposedValue: '8.8 g per 100 g', numericValue: 8.8, unit: 'g',
      basis: { amount: 100, unit: 'g', description: 'per 100 g' }, normalizedEntity: 'protein', status: 'tentative', observationIds: [], sourceIds: [], supportingSpans: [],
      visualEvidence: [
        { imageId: 'package-photo', visibleText: 'PROTEIN 8.8 g', region: { x: 0.1, y: 0.2, width: 0.4, height: 0.1 } },
        { imageId: 'package-photo', visibleText: 'QUANTITY PER 100 g', region: { x: 0.4, y: 0.1, width: 0.3, height: 0.1 } },
      ], uncertainty: 'Tentative photo interpretation; not independently verified.',
    };
    imageContext.interpretedCandidates = [candidate];
    imageContext.visualImages.push({
      imageId: 'package-photo', mimeType: 'image/jpeg', base64: 'a'.repeat(20), side: 'back', sourceImage: { width: 100, height: 100 },
      preprocessing: { rotation: 0, contrast: false, invert: false, crop: null },
    });

    const result = await executeGeminiTool('calculate_nutrition', { nutrient: 'protein', amount: 20, unit: 'g', candidateId: candidate.candidateId }, imageContext);
    expect(result.status).toBe('withheld');
    expect(result.output.message).toMatch(/exact OCR words must corroborate/i);
    expect(result.calculations).toBeUndefined();
    imageContext.visualImages = [];
    expect((await executeGeminiTool('calculate_nutrition', { nutrient: 'protein', amount: 20, unit: 'g', candidateId: candidate.candidateId }, imageContext)).status).toBe('withheld');
  });

  it('does not send a numeric OCR fragment to the product catalog', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const result = await executeGeminiTool('lookup_product', { query: '019' }, context('What does INS 319 mean?'));
    expect(result.status).toBe('withheld');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('requires a valid exact GTIN before an exact product lookup', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const result = await executeGeminiTool('lookup_product', { barcode: '8901928202754' }, context('Check barcode 8901928202754'));
    expect(result.status).toBe('withheld');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('normalizes a grouped visual barcode and returns only the exact catalog code', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 1, product: {
      code: '8901928202755', product_name: 'Bisk Farm Sugar Free Cream Cracker', brands: 'Bisk Farm', quantity: '200 g', countries_tags: ['en:india'],
      nutrition_data_per: '100g', nutriments: { sugars_100g: 0 },
    } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    const imageContext = context('Check the printed barcode and product record.');
    imageContext.visualImages.push({
      imageId: 'package-photo', mimeType: 'image/jpeg', base64: 'a'.repeat(20), side: 'back', sourceImage: { width: 100, height: 100 },
      preprocessing: { rotation: 0, contrast: false, invert: false, crop: null },
    });
    const result = await executeGeminiTool('lookup_product', { query: '8 901928 202755' }, imageContext);
    expect(result.status).toBe('ok');
    expect(result.output.candidates).toMatchObject([{ barcode: '8901928202755', match: 'barcode' }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('filters semantically nearby records that share no specific query term', async () => {
    const relevant = evidenceSources.find(source => source.id === 'who-sugars-2015')!;
    const irrelevant = evidenceSources.find(source => source.id === 'fssai-industrial-trans-fat-2021')!;
    mocks.semanticRetrieve.mockResolvedValue({
      status: 'ok', mode: 'hybrid-local-embedding', corpusVersion: 'test',
      results: [
        { source: irrelevant, score: 0.49, exactIdentity: false },
        { source: relevant, score: 0.44, exactIdentity: false },
      ], limitations: [],
    });
    const result = await executeGeminiTool('search_knowledge', { query: 'added sugar' }, context('Does this contain added sugar?'));
    expect(result.status).toBe('ok');
    expect(result.evidence?.map(source => source.id)).toEqual(['who-sugars-2015']);
  });

  it('permits a second research step using a name returned by exact local additive resolution', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ resultList: { result: [] } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    const toolContext = context('What does EFSA say about exposure from INS 319?', 'ANTIOXIDANT (319)');

    const blocked = await executeGeminiTool('search_research', { query: 'TBHQ EFSA exposure', topic: 'science' }, toolContext);
    expect(blocked.status).toBe('withheld');
    expect(fetcher).not.toHaveBeenCalled();

    const identity = await executeGeminiTool('resolve_ingredient', { query: '319' }, toolContext);
    expect(identity.status).toBe('ok');
    for (const term of identity.searchTerms ?? []) toolContext.searchTerms.add(term);

    const followup = await executeGeminiTool('search_research', { query: 'TBHQ EFSA exposure', topic: 'science' }, toolContext);
    expect(followup.status).toBe('empty');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(new URL(String(fetcher.mock.calls[0][0])).hostname).toBe('www.ebi.ac.uk');
  });

  it('expands an India regulation lookup with one exactly resolved additive identity', async () => {
    mocks.research.mockResolvedValueOnce({
      status: 'ok',
      items: [{
        id: 'fssai-additive-compendium-appendix-a', title: 'FSSAI Food Products Standards and Food Additives Compendium, Appendix A',
        url: 'https://www.fssai.gov.in/docs/food-law/regulations/compendium/food-products-standards/Appendix%20A(4).pdf',
        publisher: 'Food Safety and Standards Authority of India', publishedAt: null, retrievedAt: '2026-10-23T00:00:00.000Z',
        category: 'food standards and additives compendium; navigation aid only',
        summary: 'Official PDF excerpt; Tertiary butylhydroquinone INS 319 100 mg/kg.',
        limitations: 'Navigation aid only; category and applicable notification remain unverified.',
      }],
      message: 'Source discovery only.',
    });
    const toolContext = context('Does this additive have an applicable authorization in India?', 'INGREDIENTS: antioxidant (319)');
    const identity = await executeGeminiTool('resolve_ingredient', { query: '319' }, toolContext);
    expect(identity.status).toBe('ok');
    for (const term of identity.searchTerms ?? []) toolContext.searchTerms.add(term);

    const result = await executeGeminiTool('search_research', { query: 'authorization India', topic: 'regulation' }, toolContext);

    expect(result.status).toBe('ok');
    expect(mocks.research).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'regulation', query: 'INS 319 food additive India',
    }));
    expect(result.evidence?.[0]).toMatchObject({ id: 'fssai-additive-compendium-appendix-a', category: 'regulation' });
    expect(result.evidence?.[0].limitations).toMatch(/category and applicable notification remain unverified/i);
  });

  it('expands same-round India regulation calls from an explicit INS mention without relying on tool order', async () => {
    mocks.research.mockResolvedValueOnce({ status: 'empty', items: [], message: 'No matching text was returned.' });
    const toolContext = context('Please check the FSSAI rules for INS 319 in India.', 'INGREDIENTS: antioxidant (319)');
    toolContext.searchTerms.add('INS 955');

    const result = await executeGeminiTool('search_research', { query: 'INS 319', topic: 'regulation' }, toolContext);

    expect(result.status).toBe('empty');
    expect(mocks.research).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'regulation', query: 'INS 319 food additive India',
    }));
  });

  it('keeps an exact Indian additive identity when the model labels the research topic as a claim', async () => {
    mocks.research.mockResolvedValueOnce({ status: 'empty', items: [], message: 'No matching text was returned.' });
    const toolContext = context('Does INS 319 have applicable authorization in India?');

    await executeGeminiTool('search_research', { query: 'INS 319 authorization India', topic: 'claims' }, toolContext);

    expect(mocks.research).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'claims', query: 'INS 319 food additive India',
    }));
  });

  const liveResearchIt = process.env.NUTRISCAN_LIVE_RESEARCH_TEST === 'true' ? it : it.skip;
  it('canonicalizes a context-linked additive code when identity and research tools run in parallel', async () => {
    const toolContext = context(
      'What does the label code 319 refer to, and can the FSSAI entry mentioning 100 mg/kg apply to this cream cracker?',
      'INGREDIENTS: refined wheat flour; antioxidant (319)',
    );
    mocks.research.mockResolvedValueOnce({ status: 'ok', items: [], message: 'fixture response' });

    await Promise.all([
      executeGeminiTool('resolve_ingredient', { query: '319' }, toolContext),
      executeGeminiTool('search_research', { query: 'FSSAI 100 mg/kg cream cracker', topic: 'claims' }, toolContext),
    ]);

    expect(mocks.research).toHaveBeenCalledWith(expect.objectContaining({ query: 'INS 319 food additive India', topic: 'claims' }));
  });

  liveResearchIt('retrieves the official INS excerpt through the Gemini research-tool boundary', async () => {
    const toolContext = context(
      'What does the label code 319 refer to, and can the FSSAI entry mentioning 100 mg/kg apply to this cream cracker?',
      'INGREDIENTS: refined wheat flour; antioxidant (319)',
    );
    const [, result] = await Promise.all([
      executeGeminiTool('resolve_ingredient', { query: '319' }, toolContext),
      executeGeminiTool('search_research', { query: 'FSSAI 100 mg/kg cream cracker', topic: 'claims' }, toolContext),
    ]);
    const excerpt = result.evidence?.find(item => item.id === 'fssai-additive-compendium-appendix-a');

    expect(mocks.research).toHaveBeenCalledWith(expect.objectContaining({ query: 'INS 319 food additive India', topic: 'claims' }));
    expect(result.status).toBe('ok');
    expect(excerpt?.summary).toMatch(/Tertiary butylhydroquinon.{0,80}319.{0,40}100 mg\/kg/i);
    expect(excerpt?.limitations).toMatch(/exact food category and conditions of use/i);
  }, 30_000);

  it('resolves INS 319 to the WHO JECFA assessment without implying dose or exposure', async () => {
    const result = await executeGeminiTool('resolve_ingredient', { query: 'INS 319' }, context('What does INS 319 mean?'));
    expect(result.status).toBe('ok');
    expect(result.output).toMatchObject({ status: 'identity_match', identity: { name: 'Tertiary butylhydroquinone', code: '319' } });
    expect(result.evidence?.map(source => source.id)).toEqual(['who-jecfa-tbhq-319', 'codex-gsfa-tbhq-319']);
    expect(result.evidence?.[0].summary).toContain('0–0.7 mg/kg body weight');
    expect(result.evidence?.[0].limitations).toContain('ingredient declaration alone cannot establish dose');
  });

  it('uses FoodOn for an observed ordinary ingredient and returns attributed identity candidates only', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const toolContext = {
      ...context('What is white flour?', 'INGREDIENTS: WHITE FLOUR; SALT'),
      profile: { ...defaultProfile, allergies: 'private profile should never be sent' },
    };

    const result = await executeGeminiTool('resolve_ingredient', { query: 'white flour' }, toolContext);

    expect(result.status).toBe('ok');
    expect(result.output).toMatchObject({ status: 'ontology_identity_candidates', candidates: [{ title: 'white wheat flour (FOODON_03302339)', matchedBy: 'exact-synonym' }], sourceVersion: '2026-09-20' });
    expect(result.evidence?.[0]).toMatchObject({
      id: 'foodon-foodon_03302339', publisher: expect.stringContaining('FoodOn'),
      url: 'https://purl.obolibrary.org/obo/FOODON_03302339', category: 'registry',
      license: expect.stringContaining('CC BY 4.0'),
    });
    expect(result.evidence?.[0].limitations).toContain('does not establish that the ingredient is present');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('uses the attributed Indian label crosswalk before FoodOn for maida without querying the network', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const result = await executeGeminiTool('resolve_ingredient', { query: 'maida' }, context('What is maida?', 'INGREDIENTS: refined wheat flour (maida)'));
    expect(result.status).toBe('ok');
    expect(result.output).toMatchObject({
      status: 'regional_label_identity_candidate',
      identity: { canonicalName: 'Refined wheat flour (maida)', sourceId: 'fssai-atta-maida-nomenclature-2019' },
      sourceId: 'fssai-atta-maida-nomenclature-2019',
    });
    expect(result.evidence?.[0]).toMatchObject({
      publisher: 'Food Safety and Standards Authority of India',
      category: 'regulation',
      limitations: expect.stringContaining('does not establish that a package contains'),
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('withholds local ontology candidates for an ingredient not supported by the question or package', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const result = await executeGeminiTool('resolve_ingredient', { query: 'unobserved rare compound' }, context('What is in this product?', 'INGREDIENTS: wheat flour; salt'));

    expect(result.status).toBe('withheld');
    expect(result.output).toMatchObject({ status: 'query_not_in_evidence' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns an attributed Indian ingredient identity candidate from the local index', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const result = await executeGeminiTool('resolve_ingredient', { query: 'besan' }, context('What does besan mean?', 'INGREDIENTS: besan; salt'));

    expect(result.status).toBe('ok');
    expect(result.output).toMatchObject({ status: 'ontology_identity_candidates', candidates: [{ title: 'gram flour (FOODON_03601071)', matchedBy: 'exact-synonym', matchedText: 'besan' }] });
    expect(result.evidence?.[0]).toMatchObject({ publisher: 'FoodOn Food Ontology', license: expect.stringContaining('CC BY 4.0') });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('resolves an observed INS base code through Codex and excludes numeric prefix collisions', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: [
        { Id: 'wrong-prefix', Label: 'Starch sodium octenyl succinate', InsNumber: '1450', Language: 'en', MatchType: 'INS Partial', MatchedSynonym: null },
        { Id: 'subtype-i', Label: 'Ammonium carbonate', InsNumber: '503(i)', Language: 'en', MatchType: 'INS Partial', MatchedSynonym: null },
        { Id: 'subtype-ii', Label: 'Ammonium hydrogen carbonate', InsNumber: '503(ii)', Language: 'en', MatchType: 'INS Partial', MatchedSynonym: null },
      ],
      count: 3,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    const result = await executeGeminiTool('resolve_ingredient', { query: '503' }, context('What do the raising agents mean?', 'INGREDIENTS: RAISING AGENTS [500(i), 503(ii)]'));

    expect(result.status).toBe('ok');
    expect(result.output).toMatchObject({
      status: 'codex_identity_candidates',
      requestedCode: '503',
      candidates: [
        { name: 'Ammonium carbonate', insNumber: '503(i)' },
        { name: 'Ammonium hydrogen carbonate', insNumber: '503(ii)' },
      ],
    });
    expect(result.evidence?.map(source => source.title)).toEqual([
      'Ammonium carbonate (INS 503(i)) — Codex GSFA',
      'Ammonium hydrogen carbonate (INS 503(ii)) — Codex GSFA',
    ]);
    expect(result.evidence?.[0]).toMatchObject({
      publisher: 'Codex Alimentarius Commission (FAO/WHO)',
      category: 'registry',
      jurisdiction: expect.stringContaining('not an Indian authorization'),
      license: expect.stringContaining('non-commercial'),
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe('https://codex.fao.org/codex-texts/codex-online-databases/gsfa/gsfa-database-search/SearchAdditivesByInsNumber/');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('insNumber=503');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/x-www-form-urlencoded' });
  });

  it('links a subtype-specific Codex identity to only an exact-name EFSA record', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: [{ Id: 'exact', Label: 'Disodium diphosphate', InsNumber: '450(i)', Language: 'en', MatchType: 'INS Exact', MatchedSynonym: null }],
      count: 1,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    mocks.searchOpenFoodTox.mockResolvedValue({
      status: 'ok',
      source: { version: '3.0', sourceSha256: 'a'.repeat(64), sourceUrl: 'https://doi.org/10.5281/zenodo.19388272', releaseDate: '2026-04-30', license: 'CC BY-ND 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-nd/4.0/', attribution: 'European Food Safety Authority (EFSA), OpenFoodTox 3.0.' },
      statistics: { substances: 7880, assessmentRowsWithAdi: 1228 },
      results: [{
        score: 95, matchedBy: 'exact-name',
        substance: { substanceId: 'sub-disodium-diphosphate', name: 'Disodium diphosphate', referenceSubstanceId: 'ref-disodium-diphosphate', aliases: [], identifiers: { casNumber: '7758-16-9' }, type: ['substance'], references: [{ dossierId: 'dossier-450', title: 'EFSA phosphate group assessment', date: '2024-01-01', persistentId: 'doi:10.2903/j.efsa.2024.1', foodDomain: 'food additives' }], assessments: [] },
      }],
    });
    const result = await executeGeminiTool('resolve_ingredient', { query: 'INS 450(i)' }, context('What is INS 450(i)?', 'INGREDIENTS: RAISING AGENT (INS 450(i))'));

    expect(result.status).toBe('ok');
    expect(result.output).toMatchObject({ status: 'codex_identity_match', requestedCode: '450(i)', linkedExactEfsaRecords: [{ name: 'Disodium diphosphate', assessmentCount: 0 }] });
    expect(result.evidence?.map(source => source.id)).toEqual(['codex-gsfa-ins-450-i', 'openfoodtox-v3-sub-disodium-diphosphate']);
    expect(mocks.searchOpenFoodTox).toHaveBeenCalledWith('Disodium diphosphate', 3);
  });

  it('does not query Codex for an unobserved additive code or an ordinary number', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const missing = await executeGeminiTool('resolve_ingredient', { query: 'INS 503' }, context('What is in the product?', 'INGREDIENTS: wheat flour; salt'));
    const ordinaryNumber = await executeGeminiTool('resolve_ingredient', { query: '500' }, context('What is the package amount?', 'PACKAGE SIZE 500 g'));

    expect(missing.status).toBe('withheld');
    expect(ordinaryNumber.status).toBe('empty');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not resolve an unobserved INS subtype from a neighboring family code', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const result = await executeGeminiTool('resolve_ingredient', { query: 'INS 450(i)' }, context('What does the label\'s raising agent mean?', 'INGREDIENTS: RAISING AGENT (INS 450(ii))'));

    expect(result.status).not.toBe('ok');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('offers exact EFSA assessment records to Gemini with source and exposure limits', async () => {
    const source = {
      version: '3.0' as const, sourceSha256: 'a'.repeat(64), sourceUrl: 'https://doi.org/10.5281/zenodo.19388272',
      releaseDate: '2026-04-30', license: 'CC BY-ND 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-nd/4.0/',
      attribution: 'European Food Safety Authority (EFSA), OpenFoodTox 3.0.',
    };
    mocks.searchOpenFoodTox.mockResolvedValue({
      status: 'ok', source, statistics: { substances: 7880, assessmentRowsWithAdi: 1228 },
      results: [{
        score: 95, matchedBy: 'exact-name',
        substance: {
          substanceId: 'sub-tbhq', name: 'Tertiary-butyl hydroquinone (TBHQ)', referenceSubstanceId: 'ref-tbhq',
          aliases: ['TBHQ'], identifiers: { casNumber: '1948-33-0', pubchemCid: 16043 }, type: ['mono-constituent substance'],
          references: [{ dossierId: 'dossier-1', title: 'EFSA opinion on TBHQ', date: '2025-01-01', persistentId: 'doi:10.2903/j.efsa.2025.1', foodDomain: 'food additives' }],
          assessments: [{ assessmentId: 'assessment-1', adi: { 'Adi.lowerValue': 0.7, 'Adi.Unit': 'mg/kg bw/day', Population: 'consumers', OverallUncertainty: 100 }, acuteReferenceDose: null }],
        },
      }],
    });
    const result = await executeGeminiTool('get_substance_assessments', { query: 'INS 319' }, context('What does INS 319 mean?'));
    expect(result.status).toBe('ok');
    expect(mocks.searchOpenFoodTox).toHaveBeenCalledWith(expect.stringMatching(/hydroquinone/i), 3);
    expect(result.evidence?.[0]).toMatchObject({ id: 'openfoodtox-v3-sub-tbhq', publisher: expect.stringContaining('EFSA'), category: 'assessment' });
    expect(result.evidence?.[0].summary).toContain('ADI: 0.7 mg/kg bw/day');
    expect(result.evidence?.[0].limitations).toContain('not proof of package presence');
    expect(JSON.stringify(result.output)).not.toContain('profile');
  });

  it('does not substitute the small curated index when the local EFSA import is missing', async () => {
    mocks.searchOpenFoodTox.mockResolvedValue({ status: 'unavailable', reason: 'not-imported', results: [] });
    const result = await executeGeminiTool('get_substance_assessments', { query: 'Tertiary butylhydroquinone' }, context('What is TBHQ?'));
    expect(result.status).toBe('unavailable');
    expect(result.output).toMatchObject({ status: 'unavailable', reason: 'not-imported' });
    expect(result.evidence).toBeUndefined();
  });

  it('returns PubChem chemical identity candidates only for names in current text evidence', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ PropertyTable: { Properties: [{ CID: 16043, Title: 'tert-Butylhydroquinone', MolecularFormula: 'C10H14O2', IUPACName: '2-tert-butylbenzene-1,4-diol', InChIKey: 'XHFSVYHZBICRDT-UHFFFAOYSA-N' }] } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    const result = await executeGeminiTool('lookup_chemical_identity', { query: 'TBHQ' }, context('What is TBHQ?', 'INGREDIENTS: antioxidant TBHQ'));
    expect(result.status).toBe('ok');
    expect(result.evidence?.[0]).toMatchObject({ id: 'pubchem-cid-16043', category: 'registry', publisher: expect.stringContaining('PubChem') });
    expect(JSON.stringify(result.output)).not.toContain('profile');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const requestedUrl = new URL(String(fetcher.mock.calls[0][0]));
    expect(requestedUrl.hostname).toBe('pubchem.ncbi.nlm.nih.gov');
    expect(requestedUrl.pathname).toContain('/compound/name/TBHQ/property/');
  });

  it('does not turn an INS number alone into a scientific literature search', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const result = await executeGeminiTool('search_research', { query: 'INS 319', topic: 'science' }, context('What is INS 319?'));
    expect(result.status).toBe('withheld');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
