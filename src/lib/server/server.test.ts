import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, fixedFetch, input, localGate, readBounded, route } from './http';
import { lookupProducts, normalizeProduct, productInput } from './products';
import { assist, assistInput, assistOutput, assistPromptPayload, focusedLabelRecoverySchema, geminiResponseJsonSchema, getAgentSystemInstruction, getPackageReconstructionSystemInstruction, linkVisionResponseToCapture, mergeFocusedLabelRecovery, normalizeGeminiPackageRegionCoordinates, normalizeProviderPackageReconstructionShape, parseAgentProviderOutput, providerAssistOutput, providerStatus, replaceReferenceIds, sanitizePackageReconstruction, selectNutritionRecoveryRegion, validateClaims, validateImage, vision, visionInput } from './gemini';
import { applicationGeminiContext, committedPaidSpendUsd, countGoogleSearchQueries, freeTierSyntheticSmokeContext, resetGeminiUsageLedgerForTests, safeProviderFailure } from './gemini-provider';
import { research, researchInput, researchRecalls } from './research';
import { getNutritionGuidance } from './nutrition-guidance';
import { packageReconstructionContentSchema, packageSchema, type Observation, type PackageReconstructionContent } from '../contracts';
import type { GeminiToolImage } from './gemini-tools';
import { packageForAssist } from '../../modules/inference';
import { calculationsFromReconstruction } from '../portion';
import sharp from 'sharp';
import { z } from 'zod';

beforeEach(() => { resetGeminiUsageLedgerForTests(); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const request = (body: unknown, origin = 'http://127.0.0.1:3400') => new Request('http://127.0.0.1:3400/api/test', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const visionTestImage={imageId:'package-photo-1',mimeType:'image/png' as const,base64:'a'.repeat(20),side:'back' as const,sourceImage:{width:1600,height:2400},preprocessing:{rotation:90 as const,contrast:true,invert:false,crop:{x:0.1,y:0.15,width:0.8,height:0.7}}};
const modelResponse=(parts:unknown[],usageMetadata={promptTokenCount:120,candidatesTokenCount:80,totalTokenCount:200})=>JSON.stringify({candidates:[{content:{parts,role:'model'},finishReason:'STOP',index:0}],modelVersion:'gemini-3.8-flash-test',usageMetadata});
const toolCallPart=(id:string,name:string,args:unknown)=>({functionCall:{id,name,args}});

describe('bounded server boundary', () => {
  it('rejects other origins before executing work', async () => {
    const work = vi.fn(); const response = await route(request({}, 'https://evil.example'), 'test-origin', work);
    expect(response.status).toBe(403); expect(work).not.toHaveBeenCalled();
  });
  it('accepts the real loopback Host when Next normalizes Request.url, and rejects hostile Host', async () => {
    const normalized = new Request('http://localhost:3400/api/test', { method: 'POST', headers: { host: '127.0.0.1:3400', origin: 'http://127.0.0.1:3400', 'content-type': 'application/json' }, body: '{}' });
    const release = localGate(normalized, 'next-host-test'); release();
    const hostile = new Request('http://localhost:3400/api/test', { method: 'POST', headers: { host: 'evil.example:3400', origin: 'http://evil.example:3400', 'content-type': 'application/json' }, body: '{}' });
    expect(() => localGate(hostile, 'evil-host-test')).toThrow('local NutriScan hostname');
  });
  it('requires consent even when a caller supplies valid image metadata', () => {
    expect(visionInput.safeParse({ consent: false, image: visionTestImage }).success).toBe(false);
  });
  it('bounds workspace portion state independently of the amount requested in conversation', () => {
    const input={consent:true,question:'What about 100 ml instead?',workspacePortion:{amount:250,unit:'ml'},package:{id:'workspace-fixture',name:'Label text',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],observations:[],rawText:'',warnings:[],synthetic:true,createdAt:new Date().toISOString()}};
    expect(assistPromptPayload(assistInput.parse(input)).workspacePortion).toEqual({amount:250,unit:'ml'});
    for(const workspacePortion of [{amount:0,unit:'g'},{amount:10001,unit:'g'},{amount:1,unit:'pieces'},{amount:1,unit:'ml',extra:'not allowed'}])expect(assistInput.safeParse({...input,workspacePortion}).success).toBe(false);
  });
  it('requires bounded source-image dimensions and preprocessing provenance', () => {
    expect(visionInput.safeParse({consent:true,image:visionTestImage}).success).toBe(true);
    expect(visionInput.safeParse({consent:true,image:{...visionTestImage,sourceImage:{width:40000,height:1}}}).success).toBe(true);
    const {imageId,...missingImageId}=visionTestImage;
    expect(visionInput.safeParse({consent:true,image:missingImageId}).success).toBe(false);
    expect(visionInput.safeParse({consent:true,image:{...visionTestImage,sourceImage:{width:0,height:2400}}}).success).toBe(false);
    expect(visionInput.safeParse({consent:true,image:{...visionTestImage,sourceImage:{width:40001,height:2400}}}).success).toBe(false);
    expect(visionInput.safeParse({consent:true,image:{...visionTestImage,preprocessing:{...visionTestImage.preprocessing,rotation:45}}}).success).toBe(false);
    expect(visionInput.safeParse({consent:true,image:{...visionTestImage,preprocessing:{...visionTestImage.preprocessing,crop:{x:0.8,y:0,width:0.3,height:0.5}}}}).success).toBe(false);
  });
  it('accepts consented OCR-plus-image analysis only when every inline photo matches a live handle', () => {
    const packageData={id:'package-1',name:'Unidentified package',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],observations:[],rawText:'',warnings:[],synthetic:false,createdAt:new Date().toISOString()};
    const imageHandle={handle:visionTestImage.imageId,side:visionTestImage.side,width:visionTestImage.sourceImage.width,height:visionTestImage.sourceImage.height,role:'nutrition' as const};
    const combined={consent:true,question:'What do the unclear numbers say?',package:packageData,images:[imageHandle],visualImages:[visionTestImage]};
    expect(assistInput.safeParse(combined).success).toBe(true);
    expect(assistInput.safeParse({...combined,images:[]}).success).toBe(false);
    expect(assistInput.safeParse({...combined,visualImages:[{...visionTestImage,sourceImage:{width:1500,height:2400}}]}).success).toBe(false);
    expect(assistInput.safeParse({...combined,visualImages:[visionTestImage,visionTestImage]}).success).toBe(false);
  });
  it('accepts one original plus one OCR-guided crop under the original handle and keeps source-relative crop metadata', () => {
    const packageData={id:'package-1',name:'Unidentified package',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],observations:[],rawText:'',warnings:[],synthetic:false,createdAt:new Date().toISOString()};
    const original={...visionTestImage,preprocessing:{...visionTestImage.preprocessing,crop:null}};
    const crop={...visionTestImage,preprocessing:{...visionTestImage.preprocessing,crop:{x:0.12,y:0.28,width:0.48,height:0.31}}};
    const handle={handle:original.imageId,side:original.side,width:original.sourceImage.width,height:original.sourceImage.height};
    const input={consent:true,question:'Read the small nutrition values.',package:packageData,images:[handle],visualImages:[original,crop]};
    const parsed=assistInput.parse(input);
    const prompt=assistPromptPayload(parsed);
    expect(parsed.visualImages).toHaveLength(2);
    expect(parsed.visualImages?.map(image=>image.imageId)).toEqual([original.imageId,original.imageId]);
    expect(prompt.visualImages?.[1]).toMatchObject({imageId:original.imageId,sourceImage:original.sourceImage,preprocessing:{crop:{x:0.12,y:0.28,width:0.48,height:0.31}}});
    expect(JSON.stringify(prompt)).not.toContain(original.base64);
  });
  it('allows focused crops for two package photos, requires each full view, and caps aggregate image bytes', () => {
    const packageData={id:'package-1',name:'Unidentified package',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],observations:[],rawText:'',warnings:[],synthetic:false,createdAt:new Date().toISOString()};
    const image=(imageId:string,crop:{x:number;y:number;width:number;height:number}|null,base64=visionTestImage.base64)=>({...visionTestImage,imageId,base64,preprocessing:{...visionTestImage.preprocessing,crop}});
    const handle=(imageId:string)=>({handle:imageId,side:'back' as const,width:1600,height:2400});
    const base={consent:true,question:'Read the nutrition table.',package:packageData};
    const source=image('photo-a',null); const cropA=image('photo-a',{x:0.1,y:0.2,width:0.4,height:0.3});
    expect(assistInput.safeParse({...base,images:[handle('photo-a')],visualImages:[source,cropA]}).success).toBe(true);
    const sourceB=image('photo-b',null); const sourceC=image('photo-c',null);
    expect(assistInput.safeParse({...base,images:[handle('photo-a'),handle('photo-b'),handle('photo-c')],visualImages:[source,cropA,sourceB,sourceC]}).success).toBe(true);
    expect(assistInput.safeParse({...base,images:[handle('photo-a')],visualImages:[cropA]}).success).toBe(true); // A single saved crop remains a normal package-photo attachment.
    expect(assistInput.safeParse({...base,images:[handle('photo-a'),handle('photo-b')],visualImages:[source,cropA,image('photo-b',null),image('photo-b',{x:0.2,y:0.2,width:0.3,height:0.3})]}).success).toBe(true);
    expect(assistInput.safeParse({...base,images:[handle('photo-a'),handle('photo-b')],visualImages:[source,cropA,image('photo-b',null),image('photo-b',{x:0.2,y:0.2,width:0.3,height:0.3}),image('photo-a',{x:0.5,y:0.1,width:0.2,height:0.2})]}).success).toBe(false);
    const large='A'.repeat(1_000_000);
    const largeViews=['one','two','three','four'].map(id=>image(id,null,large));
    expect(assistInput.safeParse({...base,images:largeViews.map(item=>handle(item.imageId)),visualImages:largeViews}).success).toBe(false);
  });
  it('keeps image bytes out of the serialized text prompt while retaining photo lineage', () => {
    const data=assistInput.parse({consent:true,question:'What does the package say?',package:{id:'package-1',name:'Unidentified package',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],observations:[],rawText:'',warnings:[],synthetic:false,createdAt:new Date().toISOString()},images:[{handle:visionTestImage.imageId,side:visionTestImage.side,width:1600,height:2400}],visualImages:[visionTestImage]});
    const prompt=assistPromptPayload(data);
    expect(JSON.stringify(prompt)).not.toContain(visionTestImage.base64);
    expect(prompt.visualImages?.[0]).toMatchObject({imageId:visionTestImage.imageId,mimeType:visionTestImage.mimeType,sourceImage:visionTestImage.sourceImage});
  });
  it('accepts compact saved reconstruction context on a photo-free follow-up', () => {
    const pkg=packageSchema.parse({
      id:'saved-reconstruction',name:'Unidentified package',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],
      observations:[{id:'ocr-line-1',field:'ocr-line',text:'CARBOHYDRATES 69.29 g',side:'back',confidence:74,origin:'ocr',imageId:'saved-photo',readingOrder:{runId:'saved-run',blockIndex:0,paragraphIndex:0,lineIndex:0},bbox:{x0:12,y0:20,x1:280,y1:60},ocrWords:[{wordIndex:0,text:'CARBOHYDRATES',confidence:91,bbox:{x0:12,y0:20,x1:170,y1:60}}]}],
      ocrCaptures:[{runId:'saved-run',imageId:'saved-photo',side:'back',sourceImage:{width:900,height:363},preparedImage:{width:900,height:363},bboxCoordinateSpace:'prepared-image-pixels',engine:{name:'fixture-reader',version:'1',language:'eng',confidenceScale:'0-100',segmentationMode:'auto'},processing:{rotation:0,contrast:false,invert:false,cropPercent:null}}],
      reconstruction:{identity:{brand:'Example',name:'Cracker',variant:null,status:'provisional',evidence:{observationIds:['ocr-line-1'],imageRegions:[]}},serving:null,nutritionRows:[{rowId:'carbs-per-100g',nutrient:'Carbohydrates',printedLabel:'CARBOHYDRATES',printedValue:'69.29 g',value:69.29,unit:'g',columnLabel:'Per 100 g',basisText:'per 100 g',basisAmount:100,basisUnit:'g',qualifier:null,status:'provisional',evidence:{observationIds:['ocr-line-1'],imageRegions:[]}}],ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Saved package interpretation.',revision:1,updatedAt:'2026-10-23T00:00:00.000Z',model:'fixture-model',current:true},
      rawText:'CARBOHYDRATES 69.29 g',warnings:[],synthetic:true,createdAt:'2026-10-23T00:00:00.000Z',
    });
    const compact=packageForAssist(pkg);
    const parsed=assistInput.safeParse({consent:true,question:'What about one serving?',package:compact});
    expect(parsed.success).toBe(true);
    expect(compact.observations[0].readingOrder).toEqual({runId:'saved-run',blockIndex:0,paragraphIndex:0,lineIndex:0});
    expect(compact.observations[0].bbox).toBeUndefined();
    expect(compact.observations[0].ocrWords).toBeUndefined();
    expect(compact.ocrCaptures).toHaveLength(1);
  });
  it('links an offline vision response to its source image and capture without provider calls', () => {
    const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
    const linked=linkVisionResponseToCapture({observations:[{field:'nutrition-row',text:'Fibre 8 g',confidence:62}],limitations:['Transcription is uncertain.']},visionTestImage,'gemini-test','vision-run-1');
    expect(linked.visionCapture).toEqual({runId:'vision-run-1',imageId:'package-photo-1',side:'back',sourceImage:{width:1600,height:2400},processing:visionTestImage.preprocessing,model:'gemini-test'});
    expect(linked.observations).toHaveLength(1);
    expect(linked.observations[0]).toMatchObject({field:'nutrition-row',text:'Fibre 8 g',side:'back',origin:'vision',imageId:'package-photo-1',visionRunId:'vision-run-1'});
    expect(linked.observations[0].id).toMatch(/^vision-/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('retains vision image lineage at the later text-assist boundary and checks any live handle', () => {
    const linked=linkVisionResponseToCapture({observations:[{field:'nutrition-row',text:'Fibre 8 g',confidence:62}],limitations:[]},visionTestImage,'gemini-test','vision-run-2');
    const pkg={id:'package-1',name:'Unidentified package',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],observations:linked.observations,visionCaptures:[linked.visionCapture],rawText:'Fibre 8 g',warnings:[],synthetic:false,createdAt:new Date().toISOString()};
    const request={consent:true as const,question:'What was read?',package:pkg,images:[{handle:'package-photo-1',side:'back' as const,width:1600,height:2400}]};
    const parsed=assistInput.parse(request);
    expect(parsed.package.visionCaptures?.[0]).toEqual(linked.visionCapture);
    expect(parsed.package.observations[0]).toMatchObject({imageId:'package-photo-1',visionRunId:'vision-run-2',origin:'vision'});
    expect(assistInput.safeParse({...request,images:[{...request.images[0],width:1500}]}).success).toBe(false);
    expect(assistInput.safeParse({...request,images:[{...request.images[0],side:'front'}]}).success).toBe(false);
  });
  it('keeps remote image analysis disabled until explicitly enabled', async () => {
    vi.stubEnv('ENABLE_GEMINI','false');vi.stubEnv('GEMINI_API_KEY','test-only-placeholder');vi.stubEnv('GEMINI_MODEL','gemini-test');
    const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
    const input=visionInput.parse({consent:true,image:visionTestImage});
    await expect(vision(input)).rejects.toMatchObject({code:'provider_disabled'});
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('keeps text-plus-image package interpretation disabled before preparing or transmitting images', async () => {
    vi.stubEnv('ENABLE_GEMINI','false');vi.stubEnv('GEMINI_API_KEY','test-only-placeholder');vi.stubEnv('GEMINI_MODEL','gemini-test');
    const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
    const data=assistInput.parse({consent:true,question:'What does the package say?',package:{id:'package-1',name:'Unidentified package',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],observations:[],rawText:'',warnings:[],synthetic:false,createdAt:new Date().toISOString()},images:[{handle:visionTestImage.imageId,side:visionTestImage.side,width:1600,height:2400}],visualImages:[visionTestImage]});
    await expect(assist(data)).rejects.toMatchObject({code:'provider_disabled'});
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects untrusted URL destinations without fetching', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(fixedFetch(new URL('https://www.ebi.ac.uk.evil.example/search'))).rejects.toMatchObject({ code: 'url_rejected' });
    await expect(fixedFetch(new URL('http://127.0.0.1/private'))).rejects.toMatchObject({ code: 'url_rejected' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('fetches official Delhi High Court PDFs through the exact fixed-source host allowlist', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]), { headers: { 'content-type': 'application/pdf' } })); vi.stubGlobal('fetch', fetcher);
    const result = await fixedFetch(new URL('https://delhihighcourt.nic.in/app/showFileJudgment/case.pdf'), 'pdf');
    expect(result).toHaveLength(8);
    expect(fetcher).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ redirect: 'error' }));
    await expect(fixedFetch(new URL('https://delhihighcourt.nic.in.evil.example/case.pdf'), 'pdf')).rejects.toMatchObject({ code: 'url_rejected' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects oversized streams, invalid JSON, and extra request fields', async () => {
    await expect(readBounded(new Response('a'.repeat(30)).body, 20)).rejects.toMatchObject({ code: 'too_large' });
    await expect(input(request({ query: 'oats', injected: true }), productInput)).rejects.toMatchObject({ code: 'invalid_input' });
    const malformed = new Request('http://127.0.0.1:3400/api/test', { method: 'POST', body: '{' });
    await expect(input(malformed, z.object({}))).rejects.toMatchObject({ code: 'invalid_json' });
  });
  it('bounds concurrent work and per-minute calls', () => {
    const a = localGate(request({}), 'concurrency-test', 5); const b = localGate(request({}), 'concurrency-test', 5);
    expect(() => localGate(request({}), 'concurrency-test', 5)).toThrow(ApiError); a(); b();
    const release = localGate(request({}), 'rate-test', 1); release();
    expect(() => localGate(request({}), 'rate-test', 1)).toThrow(ApiError);
  });
  it('does not serialize upstream errors with request data', async () => {
    const result = await route(request({}), 'error-test', async () => { throw new Error('SECRET request image payload'); });
    expect(await result.text()).not.toContain('SECRET');
  });
  it('turns a Gemini quota response into safe retry guidance without exposing provider text', async () => {
    const providerError = Object.assign(new Error('SECRET provider response body'), { status: 429 });
    const response = await route(request({}), 'gemini', async () => { throw providerError; });
    const body = await response.json();
    expect(response.status).toBe(429);
    expect(body).toMatchObject({
      status: 'unavailable',
      code: 'provider_rate_limited',
      message: 'Google Gemini is rate- or quota-limited. Check the configured Google project before retrying. Local analysis remains available.',
    });
    expect(JSON.stringify(body)).not.toContain('SECRET');
  });
  it('classifies Gemini authentication and access denials without returning provider text', async () => {
    for (const [status, code] of [[401, 'provider_authentication_failed'], [403, 'provider_access_denied'], [404, 'provider_model_unavailable']] as const) {
      const providerError = Object.assign(new Error('SECRET provider body with request details'), { status });
      const response = await route(request({}), 'gemini', async () => { throw providerError; });
      const body = await response.json();
      expect(response.status).toBe(502);
      expect(body).toMatchObject({ status: 'unavailable', code });
      expect(JSON.stringify(body)).not.toContain('SECRET');
      expect(JSON.stringify(body)).not.toContain('request details');
    }
  });
  it('does not follow redirects and rejects invalid upstream JSON', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('not-json', { headers: { 'content-type': 'application/json' } })); vi.stubGlobal('fetch', fetcher);
    await expect(fixedFetch(new URL('https://www.ebi.ac.uk/europepmc/webservices/rest/search'))).rejects.toMatchObject({ code: 'upstream_invalid' });
    expect(fetcher.mock.calls[0][1].redirect).toBe('error');
  });
  it('accepts bounded PDF bytes only from a fixed FSSAI source', async () => {
    const url = new URL('https://www.fssai.gov.in/upload/notifications/test.pdf');
    const pdf = new Uint8Array([...new TextEncoder().encode('%PDF-1.7\n'), 1, 2, 3]);
    const fetcher = vi.fn().mockResolvedValue(new Response(pdf, { headers: { 'content-type': 'application/pdf' } })); vi.stubGlobal('fetch', fetcher);
    const result = await fixedFetch(url, 'pdf', 100);
    expect(result).toEqual(pdf);
    expect(fetcher.mock.calls[0][1].headers.Accept).toBe('application/pdf');
    fetcher.mockResolvedValueOnce(new Response('<html>challenge</html>', { headers: { 'content-type': 'text/html' } }));
    await expect(fixedFetch(url, 'pdf', 100)).rejects.toMatchObject({ code: 'unexpected_content' });
    fetcher.mockResolvedValueOnce(new Response('not a PDF', { headers: { 'content-type': 'application/pdf' } }));
    await expect(fixedFetch(url, 'pdf', 100)).rejects.toMatchObject({ code: 'unexpected_content' });
    await expect(fixedFetch(new URL('https://evil.example/test.pdf'), 'pdf', 100)).rejects.toMatchObject({ code: 'url_rejected' });
  });
});

describe('paid Gemini spend accounting', () => {
  it('releases completed call headroom but keeps uncertain failed spend reserved', () => {
    const accounted = committedPaidSpendUsd([
      { state: 'completed', reservedUsd: 0.1, estimatedActualUsd: 0.012, estimatedGroundingCostUpperUsd: 0.014 },
      { state: 'failed', reservedUsd: 0.1, estimatedActualUsd: null, estimatedGroundingCostUpperUsd: null },
      { state: 'completed', reservedUsd: 0.1, estimatedActualUsd: null, estimatedGroundingCostUpperUsd: null },
    ]);
    expect(accounted).toBeCloseTo(0.226);
  });

  it('counts native Search queries from grounding metadata or echoed server-side tool calls', () => {
    expect(countGoogleSearchQueries({ candidates: [{ groundingMetadata: { webSearchQueries: ['one', 'two'] } }] } as never)).toBe(2);
    expect(countGoogleSearchQueries({ candidates: [{ content: { parts: [{ toolCall: { toolType: 'GOOGLE_SEARCH_WEB', args: { queries: ['one', 'two', 'three'] } } }] } }] } as never)).toBe(3);
    expect(countGoogleSearchQueries({ candidates: [{ groundingMetadata: { webSearchQueries: ['one'] }, content: { parts: [{ toolCall: { toolType: 'GOOGLE_SEARCH_WEB', args: { queries: ['one', 'two'] } } }] } }] } as never)).toBe(2);
    expect(countGoogleSearchQueries({ candidates: [{ content: { parts: [{ toolCall: { toolType: 'URL_CONTEXT', args: { urls: ['https://example.org'] } } }] } }] } as never)).toBe(0);
  });
});

describe('public source normalization', () => {
  it('uses the current Open Food Facts v3 endpoint for exact barcode records and keeps its source fields separate', async () => {
    const code = '8901088068758';
    const payload = { product: { code, product_name: 'Saffola Masala Veggie Twist Oats', brands: 'Saffola', countries_tags: ['en:india'], nutrition_data_per: '100g', product_quantity_unit: 'g', nutriments: { 'energy-kcal_100g': 376, sugars_100g: 5.1 }, ingredients_text: 'Community record ingredient string', allergens_tags: ['en:milk'], last_modified_t: 1791608054 } };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } })); vi.stubGlobal('fetch', fetcher);
    const result = await lookupProducts({ barcode: code });
    const url = fetcher.mock.calls[0][0] as URL;
    expect(url.hostname).toBe('world.openfoodfacts.org'); expect(url.pathname).toBe(`/api/v3/product/${code}.json`); expect(url.searchParams.get('fields')).toContain('ingredients_text');
    expect(result.products[0]).toMatchObject({ name: 'Saffola Masala Veggie Twist Oats', barcode: code, ingredients: 'Community record ingredient string', allergens: ['en:milk'], countries: ['en:india'], match: 'barcode' });
  });
  it('preserves missing vs zero, sodium conversion, and explicit liquid basis', () => {
    const product = normalizeProduct({ code: '8901234567890', product_name: 'Drink', nutrition_data_per: '100ml', nutriments: { sugars_100g: 0, sodium_100g: 0.02, fat_100g: -1 } }, '8901234567890')!;
    expect(product.nutrients).toEqual([{ key: 'sugars', value: 0, unit: 'g', basis: { amount: 100, unit: 'ml' } }, { key: 'sodium', value: 20, unit: 'mg', basis: { amount: 100, unit: 'ml' } }]);
    expect(product.match).toBe('barcode'); expect(product.availability).toBe('local stock unverified');
  });
  it('uses a per-100ml basis for a volume-packaged product in an explicit beverage category', () => {
    const product = normalizeProduct({ code: '5449000000996', product_name: 'Cola', nutrition_data_per: '100g', product_quantity_unit: 'ml', categories_tags: ['en:beverages'], nutriments: { 'energy-kcal_100g': 42.4, sugars_100g: 10.6 } }, '5449000000996')!;
    expect(product.nutrients).toEqual([
      { key: 'energy', value: 42.4, unit: 'kcal', basis: { amount: 100, unit: 'ml' } },
      { key: 'sugars', value: 10.6, unit: 'g', basis: { amount: 100, unit: 'ml' } },
    ]);
    expect(product.warnings?.join(' ')).toContain('basis was inferred from the volume unit and beverage category; check it against the exact package');
    expect(product.warnings?.join(' ')).not.toContain('basis could not be established');
  });
  it('withholds basis and comparability for a volume package outside a recognized beverage category', () => {
    const product = normalizeProduct({ code: '8901234567890', product_name: 'Unclassified product', nutrition_data_per: '100g', product_quantity_unit: 'ml', categories_tags: ['en:food-products'], nutriments: { sugars_100g: 8, fat_100g: 0 } })!;
    expect(product.nutrients).toEqual([
      { key: 'sugars', value: 8, unit: 'g', basis: null },
      { key: 'fat', value: 0, unit: 'g', basis: null },
    ]);
    expect(product.warnings?.join(' ')).toContain('basis could not be established. Do not compare these values');
  });
  it('does not invent a mass/volume basis from package volume', () => {
    const product = normalizeProduct({ code: '8901234567890', product_name: 'Drink', product_quantity_unit: 'ml', nutriments: { sugars_100g: 8 } })!;
    expect(product.nutrients[0].basis).toBeNull(); expect(product.warnings?.join(' ')).toContain('could not be established');
  });
  it('uses mass for an explicitly declared 100g basis when the package unit is not volume', () => {
    const product = normalizeProduct({ code: '8901234567890', product_name: 'Oats', nutrition_data_per: '100g', product_quantity_unit: 'g', nutriments: { sugars_100g: 0 } })!;
    expect(product.nutrients[0]).toEqual({ key: 'sugars', value: 0, unit: 'g', basis: { amount: 100, unit: 'g' } });
  });
  it('filters candidates to an explicitly selected country without asserting stock', async () => {
    expect(productInput.safeParse({query:'oats',alternatives:true,country:'France'}).success).toBe(true);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ products: [{ code: '8901234567890', product_name: 'Oats', countries_tags: ['en:india'] }, { code: '3017620422003', product_name: 'Other', countries_tags: ['en:france'] }] }), { headers: { 'content-type': 'application/json' } })); vi.stubGlobal('fetch', fetcher);
    const result = await lookupProducts({ query: 'oats', alternatives: true, country:'France' });
    expect(result.products).toHaveLength(1); expect(result.message).toContain('does not establish local stock');
    const url = fetcher.mock.calls[0][0] as URL; expect(url.hostname).toBe('search.openfoodfacts.org'); expect(url.pathname).toBe('/search'); expect(JSON.parse(fetcher.mock.calls[0][1].body).q).toBe('oats countries_tags:"en:france"');
  });
  it('searches candidate products without assuming a country or local stock', async () => {
    expect(productInput.safeParse({query:'oats',alternatives:true}).success).toBe(true);
    const payload = { products: [{ code: '8901234567890', product_name: 'Oats India', countries_tags: ['en:india'] }, { code: '3017620422003', product_name: 'Oats France', countries_tags: ['en:france'] }] };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } })); vi.stubGlobal('fetch', fetcher);
    const result = await lookupProducts({ query: 'oats', alternatives: true, excludeBarcode:'3017620422003' });
    expect(result.products).toHaveLength(1); expect(result.products[0].barcode).toBe('8901234567890'); expect(result.message).toContain('Country tags may be missing or stale'); expect(result.message).toContain('current stock is unverified'); expect(result.message).toContain('no better formulation is implied');
    const body = JSON.parse(fetcher.mock.calls[0][1].body); expect(body.q).toBe('oats');
  });
  it('rejects the removed nonfunctional alternatives topic on the research endpoint', () => {
    expect(researchInput.safeParse({ query: 'local alternatives', topic: 'alternatives' }).success).toBe(false);
    expect(researchInput.safeParse({ query: 'sugar', topic: 'unknown' }).success).toBe(false);
  });
  it('scopes natural-language Europe PMC topics to title and abstract while preserving source metadata', async () => {
    const paper = { id: '12345', source: 'MED', title: 'Oat beta-glucan and LDL cholesterol', firstPublicationDate: '2024-01-02', abstractText: 'A bounded source abstract.', doi: '10.1234/example.1', journalInfo: { journal: { title: 'Example Journal' } }, pubTypeList: { pubType: ['Randomized Controlled Trial'] } };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ resultList: { result: [paper] } }), { headers: { 'content-type': 'application/json' } })); vi.stubGlobal('fetch', fetcher);
    const result = await research({ query: 'How does oat beta-glucan affect LDL cholesterol?', topic: 'science' });
    const url = fetcher.mock.calls[0][0] as URL;
    expect(url.searchParams.get('query')).toBe('TITLE_ABS:"oat" AND TITLE_ABS:"beta" AND TITLE_ABS:"glucan" AND TITLE_ABS:"affect" AND TITLE_ABS:"ldl" AND TITLE_ABS:"cholesterol"');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: 'epmc-MED-12345', title: paper.title, url: 'https://europepmc.org/article/MED/12345', publisher: 'Example Journal', publishedAt: '2024-01-02', category: 'Randomized Controlled Trial', summary: paper.abstractText, doi: paper.doi });
    expect(result.items[0].limitations).toContain('not been assessed');
    expect(result.message).toContain('candidate publications');
  });
  it('keeps Europe PMC query operators inert and rejects a query with no topic terms', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ resultList: { result: [] } }), { headers: { 'content-type': 'application/json' } })); vi.stubGlobal('fetch', fetcher);
    await research({ query: 'oats OR (TITLE_ABS:*)', topic: 'science' });
    expect((fetcher.mock.calls[0][0] as URL).searchParams.get('query')).toBe('TITLE_ABS:"oats" AND TITLE_ABS:"title" AND TITLE_ABS:"abs"');
    fetcher.mockClear();
    await expect(research({ query: 'and of the', topic: 'science' })).rejects.toMatchObject({ code: 'invalid_input', status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('keeps US FDA historical reports attributable and jurisdiction-bounded', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ meta: { last_updated: '2026-10-01' }, results: [{ recall_number: 'F-1234-2024', product_description: '<b>Example oats</b>', recalling_firm: 'Example Foods', reason_for_recall: 'Undeclared milk', classification: 'Class II', status: 'Ongoing', report_date: '20240320', recall_initiation_date: '20240312', distribution_pattern: 'US retail', code_info: 'Lot ABC' }] }), { headers: { 'content-type': 'application/json' } })); vi.stubGlobal('fetch', fetcher);
    const result = await researchRecalls('Example OR oats:foo');
    expect(result.items).toHaveLength(1); expect(result.items[0].publishedAt).toBe('2024-03-20'); expect(result.items[0].summary).toContain('Initiation date: 2024-03-12'); expect(result.items[0].limitations).toContain('not an Indian recall'); expect(result.items[0].title).not.toContain('<b>');
    const url = fetcher.mock.calls[0][0] as URL; expect(url.hostname).toBe('api.fda.gov'); expect(url.searchParams.get('limit')).toBe('4'); expect(url.searchParams.get('search')).toBe('recalling_firm:"example oats foo" OR product_description:"example oats foo"');
  });
  it('does not call a no-match FDA search a clean safety result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'No matches found!' } }), { status: 404, headers: { 'content-type': 'application/json' } })));
    const result = await researchRecalls('nonexistent public test product');
    expect(result.status).toBe('empty'); expect(result.items).toEqual([]); expect(result.message).toContain('does not prove');
  });
  it('rejects a thin client-rendered regulatory shell as evidence', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response('<html><title>FSSAI</title><div id="root"></div><script src="app.js"></script></html>', { headers: { 'content-type': 'text/html' } })));
    const result = await research({ query: 'FSSAI label regulations India', topic: 'regulation' });
    expect(result.status).toBe('unavailable');
    expect(result.items.length).toBeGreaterThan(0);
    const fssaiLinks = result.items.filter(item => item.publisher === 'FSSAI');
    const gazetteSearch = result.items.find(item => item.id === 'egazette-search-navigation');
    expect(fssaiLinks.length).toBeGreaterThan(0);
    expect(fssaiLinks.every(item => /could not retrieve usable source text/i.test(item.summary))).toBe(true);
    expect(fssaiLinks.every(item => /navigation only/i.test(item.limitations))).toBe(true);
    expect(gazetteSearch?.summary).toMatch(/No document text was fetched/i);
    expect(gazetteSearch?.limitations).toMatch(/not legal evidence/i);
    expect(result.message).toMatch(/no source text.*current-law verdict/i);
  });
});

describe('provider validation, independent of provider invocation', () => {
  it('requests a focused reread when OCR sees multiple printed bases but the reconstruction omits one whole column',()=>{
    const imageId='bagrry-layout-regression';
    const evidence={observationIds:[],imageRegions:[{imageId,region:null}]};
    const nutrientNames=['energy','protein','carbohydrate','sugars','dietary fibre','fat','saturated fat','sodium'];
    const serving={printedText:'Serving size = 35 g',quantity:35,unit:'g' as const,pieceCount:null,pieceDescription:null,status:'provisional' as const,evidence};
    const perServingRows=nutrientNames.map((nutrient,index)=>({
      rowId:`${nutrient}-${index}-35g`,nutrient,printedLabel:nutrient,printedValue:'1 g',value:1,unit:nutrient==='energy'?'kcal':'g',
      columnLabel:'Per 35g#',basisText:'Per 35g#',basisAmount:35,basisUnit:'g' as const,qualifier:null,status:'provisional' as const,evidence,
    }));
    const reconstruction={
      nutritionRows:perServingRows,regions:[],serving,
      ingredients:[{position:0,name:'Oats',printedText:'Oats',printedPercentage:null,normalizedName:'oats',status:'provisional' as const,evidence}],
    } satisfies Pick<PackageReconstructionContent,'nutritionRows'|'regions'|'serving'|'ingredients'>;
    const original:GeminiToolImage={imageId,mimeType:'image/jpeg',base64:'a'.repeat(32),side:'extra',sourceImage:{width:1942,height:2639},preprocessing:{rotation:0,contrast:false,invert:false,crop:null},regionRole:'full-image'};
    const crop:GeminiToolImage={...original,preprocessing:{...original.preprocessing,crop:{x:0,y:.02,width:.98,height:.8}},regionRole:'other'};
    const header:Observation={id:'printed-basis-header',field:'ocr-line',text:'Nutrients Per 100g# Per 35g#',side:'extra',confidence:94,origin:'ocr',imageId,readingOrder:{runId:'reader-a',blockIndex:0,paragraphIndex:0,lineIndex:1}};

    const selected=selectNutritionRecoveryRegion(reconstruction,[original,crop],new Set(),[header]);
    expect(selected).toMatchObject({source:'attached-label-detail-crop',trigger:'missing-detected-basis-column',missingBasisColumns:['per 100 g'],image:{imageId},region:{region:{x:0,y:.02,width:.98,height:.8}}});

    const withBothColumns=[...perServingRows,...perServingRows.map(row=>({...row,rowId:`${row.rowId}-100g`,columnLabel:'Per 100g#',basisText:'Per 100g#',basisAmount:100}))];
    expect(selectNutritionRecoveryRegion({...reconstruction,nutritionRows:withBothColumns},[original,crop],new Set(),[header])).toBeNull();

    const servingLabeledRows=perServingRows.map(row=>({...row,columnLabel:'Per serving',basisText:'Per serving'}));
    const servingLabeledReconstruction={...reconstruction,serving:null,nutritionRows:servingLabeledRows};
    expect(selectNutritionRecoveryRegion(servingLabeledReconstruction,[original,crop],new Set(),[header])).toMatchObject({missingBasisColumns:['per 100 g']});
  });
  it('fills missing serving fields from a focused photo reread while retaining both evidence links',()=>{
    const crop={x:0.1,y:0.2,width:0.7,height:0.4};
    const existing:PackageReconstructionContent={
      identity:{brand:null,name:null,variant:null,status:'unreadable',evidence:{observationIds:[],imageRegions:[]}},
      serving:{printedText:'SERVING SIZE: 2 biscuits (approx. 13.4)',quantity:null,unit:null,pieceCount:2,pieceDescription:'biscuits',status:'provisional',evidence:{observationIds:['serving-line'],imageRegions:[]}},
      nutritionRows:[],ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Partial package reading.',
    };
    const recovered=focusedLabelRecoverySchema.parse({nutritionRows:[],serving:{printedText:'SERVING SIZE: 2 biscuits (approx. 13.4 g)',quantity:13.4,unit:'g',pieceCount:2,pieceDescription:'biscuits',status:'provisional',evidence:{observationIds:['serving-line']}},ingredients:[],additives:[],statements:[]});
    const merged=mergeFocusedLabelRecovery(existing,recovered,'photo-back',crop,new Set(['serving-line']));
    expect(merged.serving).toMatchObject({quantity:13.4,unit:'g',pieceCount:2,pieceDescription:'biscuits',status:'provisional'});
    expect(merged.serving?.evidence.observationIds).toContain('serving-line');
    expect(merged.serving?.evidence.imageRegions).toContainEqual({imageId:'photo-back',region:crop});
    expect(merged.unresolved).toEqual([]);
  });
  it('preserves genuinely conflicting serving readings instead of merging them',()=>{
    const crop={x:0.1,y:0.2,width:0.7,height:0.4};
    const existing:PackageReconstructionContent={
      identity:{brand:null,name:null,variant:null,status:'unreadable',evidence:{observationIds:[],imageRegions:[]}},
      serving:{printedText:'1 serving = 30 g',quantity:30,unit:'g',pieceCount:null,pieceDescription:null,status:'provisional',evidence:{observationIds:['serving-line'],imageRegions:[]}},
      nutritionRows:[],ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Saved package reading.',
    };
    const recovered=focusedLabelRecoverySchema.parse({nutritionRows:[],serving:{printedText:'Serving size 35 g',quantity:35,unit:'g',pieceCount:null,pieceDescription:null,status:'provisional',evidence:{observationIds:[]}},ingredients:[],additives:[],statements:[]});
    const merged=mergeFocusedLabelRecovery(existing,recovered,'photo-back',crop,new Set());
    expect(merged.serving?.quantity).toBe(30);
    expect(merged.unresolved).toHaveLength(1);
    expect(merged.unresolved[0].field).toBe('serving');
    expect(merged.unresolved[0].reason).toContain('mass 30 g vs 35 g');
  });
  it('keeps optional quote spans available as audit aids in the structured provider response schema', () => {
    const providerSchema = z.toJSONSchema(assistOutput);
    expect(JSON.stringify(providerSchema)).toContain('supportingSpans');
    expect(JSON.stringify(providerSchema)).toContain('quote');
    expect(JSON.stringify(providerSchema)).toContain('mode');
    expect(JSON.stringify(providerSchema)).toContain('visualEvidence');
    expect(JSON.stringify(providerSchema)).toContain('visibleText');
    expect(providerAssistOutput.safeParse({answer:'A natural paraphrase.',answerParts:[{text:'A natural paraphrase.',claimIndexes:[0]}],claims:[{mode:'synthesis',text:'A natural paraphrase.',observationIds:['o1'],sourceIds:[]}],limitations:[],inspectImage:null}).success).toBe(true);
  });
  it('reduces Zod JSON Schema to Google-supported grammar while retaining full local validation', () => {
    const schema = geminiResponseJsonSchema(providerAssistOutput) as Record<string, unknown>;
    const keys = new Set<string>();
    const walk = (value: unknown) => {
      if (Array.isArray(value)) { value.forEach(walk); return; }
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) { keys.add(key); walk(child); }
    };
    walk(schema);
    expect(keys.has('$schema')).toBe(false);
    expect(keys.has('anyOf')).toBe(false);
    expect(keys.has('const')).toBe(false);
    expect(keys.has('maxItems')).toBe(false);
    expect(keys.has('exclusiveMinimum')).toBe(false);
    expect(((schema.required as string[]) ?? [])).toContain('answerParts');
    expect(((schema.required as string[]) ?? [])).toContain('claims');
    expect(((schema.required as string[]) ?? [])).not.toContain('packageReconstruction');
    expect(providerAssistOutput.safeParse({ answer: '', answerParts: [], claims: [], limitations: [], inspectImage: null }).success).toBe(true);
    expect((schema as { required?: string[] }).required).toContain('answer');
    expect((schema as { properties?: Record<string, unknown> }).properties).toHaveProperty('tentativeCandidates');
  });
  it('keeps required and optional members aligned in nested provider objects',()=>{
    const schema=geminiResponseJsonSchema(z.object({
      requiredField:z.string(),
      optionalField:z.string().optional(),
      nested:z.object({requiredNested:z.number(),optionalNested:z.boolean().optional()}),
    })) as {required:string[];properties:Record<string,{required?:string[];properties?:Record<string,unknown>}>};
    expect(schema.required).toEqual(['requiredField','nested']);
    expect(schema.properties).toHaveProperty('optionalField');
    expect(schema.properties.nested.required).toEqual(['requiredNested']);
    expect(schema.properties.nested.properties).toHaveProperty('optionalNested');
  });
  it('keeps complete OCR text, geometry and the OCR-run-to-reader link without replaying parser diagnostics',()=>{
    const data=assistInput.parse({consent:true,question:'Reconstruct this label',package:{id:'compact-label',name:'Unidentified package',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],observations:[{id:'line-1',field:'ocr-line',text:'CARBOHYDRATES 6329g 928g',side:'back',confidence:91,origin:'ocr',imageId:'back-1',readingOrder:{runId:'ocr-run',blockIndex:0,paragraphIndex:0,lineIndex:1},bbox:{x0:10,y0:20,x1:300,y1:60},ocrWords:[{wordIndex:0,text:'CARBOHYDRATES',confidence:94,bbox:{x0:10,y0:22,x1:120,y1:58}},{wordIndex:1,text:'6329g',confidence:68,bbox:{x0:180,y0:20,x1:220,y1:60}}]}],ocrCaptures:[{runId:'ocr-run',imageId:'back-1',side:'back',sourceImage:{width:900,height:363},preparedImage:{width:900,height:363},bboxCoordinateSpace:'prepared-image-pixels',engine:{name:'Tesseract',version:'7.0',language:'eng',confidenceScale:'0-100',segmentationMode:'auto'},processing:{rotation:0,contrast:false,invert:false,cropPercent:null}}],parserDiagnostics:[{field:'carbohydrate',decision:'conflict',reasonCodes:['cross-reading-conflict'],sourceObservationIds:['line-1'],numericCandidates:[],basisCandidates:[]}],rawText:'CARBOHYDRATES 6329g 928g',warnings:['A parser warning that belongs in local diagnostics.'],synthetic:false,createdAt:new Date().toISOString()}});
    const prompt=assistPromptPayload(data) as {package:Record<string,unknown>&{observations:unknown[][];ocrCaptures:{runId:string;engine:string;version:string;language:string}[]};visualImages?:unknown};
    const encoded=JSON.stringify(prompt);
    expect(prompt.package).not.toHaveProperty('parserDiagnostics');
    expect(prompt.package).not.toHaveProperty('rawText');
    expect(encoded).toContain('CARBOHYDRATES 6329g 928g');
    expect(encoded).toContain('[0.011,0.055,0.333,0.165]');
    expect(encoded).toContain('[1,"6329g",68,[0.2,0.055,0.244,0.165]]');
    expect(prompt.package.observations[0][5]).toEqual(['ocr-run',0,0,1]);
    expect(prompt.package.ocrCaptures).toEqual([expect.objectContaining({runId:'ocr-run',engine:'Tesseract',version:'7.0',language:'eng'})]);
    expect(JSON.stringify(data).length).toBeGreaterThan(encoded.length);
    expect(prompt.visualImages).toBeUndefined();
  });
  it('uses a focused package-only instruction for reconstruction and a compact conversation instruction afterward',()=>{
    const reconstruction=getPackageReconstructionSystemInstruction();
    const conversation=getAgentSystemInstruction();
    expect(reconstruction).toContain('readingOrder.runId links to the ocrCaptures entry');
    expect(reconstruction).toContain('image geometry');
    expect(reconstruction).toContain('Do not answer the user’s food or health question');
    expect(reconstruction).not.toContain('Before making a health-specific suitability recommendation');
    expect(conversation).toContain('Answer directly in plain text');
    expect(conversation).not.toContain('readingOrder.runId');
  });
  it('reuses the complete saved package while omitting raw OCR from ordinary follow-ups',()=>{
    const imageEvidence={observationIds:[],imageRegions:[{imageId:'back-1',region:null}]};
    const rows=[
      ['carb-100','Carbohydrates','69.29 g',69.29,'Per 100 g',100],
      ['carb-serving','Carbohydrates','9.28 g',9.28,'Per serving',13.4],
      ['sugar-100','Total sugars','<0.5 g',0.5,'Per 100 g',100],
      ['sugar-serving','Total sugars','0.067 g',0.067,'Per serving',13.4],
      ['protein-100','Protein','11.42 g',11.42,'Per 100 g',100],
      ['protein-serving','Protein','1.53 g',1.53,'Per serving',13.4],
      ['fat-100','Total fat','17.79 g',17.79,'Per 100 g',100],
      ['fat-serving','Total fat','2.38 g',2.38,'Per serving',13.4],
      ['added-100','Added sugars','0 g',0,'Per 100 g',100],
      ['added-serving','Added sugars','0 g',0,'Per serving',13.4],
    ].map(([rowId,nutrient,printedValue,value,columnLabel,basisAmount])=>({rowId,nutrient,printedLabel:nutrient,printedValue,value,unit:'g',columnLabel,basisText:columnLabel==='Per serving'?'per serving':'per 100 g',basisAmount,basisUnit:'g',qualifier:null,status:'provisional',evidence:imageEvidence}));
    const ingredients=Array.from({length:13},(_,index)=>({position:index,name:index===0?'Refined wheat flour':`Package ingredient ${index+1}`,printedText:index===0?'REFINED WHEAT FLOUR (MAIDA) (89.98%)':`Package ingredient ${index+1}`,printedPercentage:index===0?89.98:null,normalizedName:index===0?'refined wheat flour':null,status:'provisional',evidence:imageEvidence}));
    const additives=Array.from({length:9},(_,index)=>({printedName:`Additive ${index+1}`,code:index===0?'319':null,normalizedName:null,status:'provisional',evidence:imageEvidence}));
    const statements=Array.from({length:7},(_,index)=>({kind:index===0?'claim':'other',label:index===0?'Sugar free':null,text:index===0?'No added sugar':`Package statement ${index+1}`,status:'provisional',evidence:imageEvidence}));
    const reconstruction={revision:1,updatedAt:new Date().toISOString(),model:'fixture',current:true,identity:{brand:'Bisk Farm',name:'Cream Cracker',variant:'Sugar Free',status:'provisional',evidence:imageEvidence},serving:{printedText:'2 biscuits, approximately 13.4 g',quantity:13.4,unit:'g',pieceCount:2,pieceDescription:'biscuits',status:'provisional',evidence:imageEvidence},nutritionRows:rows,ingredients,additives,statements,regions:[{imageId:'back-1',role:'nutrition-table',region:{x:0,y:0,width:.5,height:.3},observationIds:[]}],unresolved:[],interpretationNote:'Provisional package reconstruction.'};
    const observations=Array.from({length:18},(_,index)=>({id:`line-${index}`,field:'ocr-line',text:`Unrelated manufacturer address and packaging text ${index} ${'detail '.repeat(24)}`,side:'back',confidence:80,origin:'ocr',imageId:'back-1',readingOrder:{runId:'ocr-run',blockIndex:0,paragraphIndex:0,lineIndex:index},bbox:{x0:10,y0:index*10,x1:500,y1:index*10+8}}));
    const pkg={id:'saved-bisk',name:'Unidentified package',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],observations,ocrCaptures:[{runId:'ocr-run',imageId:'back-1',side:'back',sourceImage:{width:900,height:363},preparedImage:{width:900,height:363},bboxCoordinateSpace:'prepared-image-pixels',engine:{name:'Tesseract',version:'7.0',language:'eng',confidenceScale:'0-100',segmentationMode:'auto'},processing:{rotation:0,contrast:false,invert:false,cropPercent:null}}],reconstruction,rawText:'Full raw package text '.repeat(100),warnings:[],synthetic:false,createdAt:new Date().toISOString()};
    const followup=assistInput.parse({consent:true,question:'What about just two biscuits?',conversationContext:[{question:'Is this good for diabetic patients daily for snacking?',answer:'It is not a strong everyday default; the label appears to list refined wheat flour and 9.28 g carbohydrate per serving.'}],package:pkg});
    const prompt=assistPromptPayload(followup) as {package:Record<string,unknown>;packageFacts:{id:string}[]};
    const serialized=JSON.stringify(prompt);
    const compactPackage=prompt.package as {reconstruction:{nutritionRows:unknown[];ingredients:unknown[];regions:unknown[]};observations:unknown[]};
    expect(compactPackage.reconstruction.nutritionRows).toHaveLength(rows.length);
    expect(compactPackage.reconstruction.ingredients).toHaveLength(13);
    expect(compactPackage.reconstruction.regions).toHaveLength(1);
    expect(compactPackage.observations).toEqual([]);
    expect(prompt.packageFacts.map(fact=>fact.id)).toContain('package-fact:serving');
    expect(prompt.packageFacts.map(fact=>fact.id)).toContain('package-fact:ingredient:0');
    expect(prompt.packageFacts.map(fact=>fact.id)).toContain('package-fact:additive:0');
    expect(serialized).not.toContain('Full raw package text');
    expect(serialized).not.toContain('Unrelated manufacturer address');
    // Follow-ups reuse the full interpreted package while avoiding a replay
    // of raw OCR lines and token geometry.
    expect(followup.package.reconstruction?.ingredients).toHaveLength(13);
    expect(followup.package.reconstruction?.additives).toHaveLength(9);
    expect(followup.package.observations).toHaveLength(18);
    const ingredientQuestion=assistInput.parse({...followup,question:'Please list all ingredients and additives.'});
    const ingredientPrompt=assistPromptPayload(ingredientQuestion) as {package:Record<string,unknown>;packageFacts:{id:string}[]};
    expect((ingredientPrompt.package.reconstruction as {ingredients:unknown[]}).ingredients).toHaveLength(13);
    expect(ingredientPrompt.packageFacts.map(fact=>fact.id)).toContain('package-fact:ingredient:12');
    expect(ingredientPrompt.packageFacts.map(fact=>fact.id)).toContain('package-fact:additive:8');
  });
  it('normalizes only explicitly printed package quantities and converts their units consistently',()=>{
    const normalized=normalizeProviderPackageReconstructionShape({
      answer:'The outer pack lists its printed contents.',answerParts:[],claims:[],
      packageReconstruction:{
        identity:{brand:'Example',name:'Assorted food pack',variant:null,status:'provisional',evidence:{observationIds:['net-line'],imageRegions:[]}},
        serving:null,nutritionRows:[],ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'',
        quantityDeclarations:[
          {kind:'net_content',printed_text:'Net weight 0.5 kg',quantity:0.5,unit:'kg',observation_ids:['net-line']},
          {kind:'unit_count',printed_text:'10 sachets',quantity:10,observation_ids:['count-line']},
          {kind:'servings_per_package',printed_text:'About 20 servings',quantity:20,observation_ids:['servings-line']},
        ],
      },
    }) as {packageReconstruction:{quantityDeclarations:Array<Record<string,unknown>>}};
    expect(normalized.packageReconstruction.quantityDeclarations).toEqual([
      expect.objectContaining({kind:'net-content',printedText:'Net weight 0.5 kg',quantity:500,unit:'g',evidence:{observationIds:['net-line'],imageRegions:[]}}),
      expect.objectContaining({kind:'unit-count',printedText:'10 sachets',quantity:10,unit:'pieces'}),
      expect.objectContaining({kind:'servings-per-package',printedText:'About 20 servings',quantity:20,unit:'servings'}),
    ]);
    // Text is retained as printed; normalized conversion does not claim the
    // package itself printed a gram quantity.
    expect(normalized.packageReconstruction.quantityDeclarations[0].printedText).toBe('Net weight 0.5 kg');
    const observations=['net-line','count-line','servings-line'].map((id,index)=>({id,field:'label-note',text:['Net weight 0.5 kg','10 sachets','About 20 servings'][index],side:'back' as const,confidence:91,origin:'ocr' as const}));
    const data=assistInput.parse({consent:true,question:'Summarize printed package quantities.',package:{id:'quantity-adapter-fixture',name:'Unidentified package',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],observations,rawText:observations.map(item=>item.text).join('\n'),warnings:[],synthetic:false,createdAt:new Date().toISOString()}});
    const sanitized=sanitizePackageReconstruction((normalized as {packageReconstruction:unknown}).packageReconstruction,data);
    expect(sanitized?.content.quantityDeclarations).toMatchObject([
      {kind:'net-content',quantity:500,unit:'g',evidence:{observationIds:['net-line']}},
      {kind:'unit-count',quantity:10,unit:'pieces',evidence:{observationIds:['count-line']}},
      {kind:'servings-per-package',quantity:20,unit:'servings',evidence:{observationIds:['servings-line']}},
    ]);
    const servingOnly=normalizeProviderPackageReconstructionShape({packageReconstruction:{identity:{brand:null,name:'Example',variant:null},serving:{printedText:'Serving size 30 g',quantity:30,unit:'g',observationIds:['net-line']},nutritionRows:[],ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:''}}) as {packageReconstruction:{quantityDeclarations:Array<unknown>}};
    expect(servingOnly.packageReconstruction.quantityDeclarations).toEqual([]);
  });
  it('keeps reconstructed package quantities evidence-linked in compact follow-up context',()=>{
    const observation={id:'net-content-line',field:'ocr-line',text:'NET CONTENTS 500 g; 10 sachets; 20 servings per package',side:'back' as const,confidence:91,origin:'ocr' as const,imageId:'back-image',readingOrder:{runId:'quantity-capture',blockIndex:0,paragraphIndex:0,lineIndex:0}};
    const evidence={observationIds:[observation.id],imageRegions:[]};
    const reconstruction={revision:1,updatedAt:new Date().toISOString(),model:'fixture',current:true,
      identity:{brand:'Example',name:'Food pack',variant:null,status:'provisional' as const,evidence},serving:null,
      quantityDeclarations:[
        {kind:'net-content' as const,printedText:'NET CONTENTS 500 g',quantity:500,unit:'g' as const,status:'provisional' as const,evidence},
        {kind:'unit-count' as const,printedText:'10 sachets',quantity:10,unit:'pieces' as const,status:'provisional' as const,evidence},
        {kind:'servings-per-package' as const,printedText:'20 servings per package',quantity:20,unit:'servings' as const,status:'provisional' as const,evidence},
      ],nutritionRows:[],ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Fixture package.'};
    const pkg=packageSchema.parse({id:'quantity-followup',name:'Food pack',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],observations:[observation],
      ocrCaptures:[{runId:'quantity-capture',imageId:'back-image',side:'back',sourceImage:{width:900,height:600},preparedImage:{width:900,height:600},bboxCoordinateSpace:'prepared-image-pixels',engine:{name:'fixture-reader',version:'1',language:'eng',confidenceScale:'0-100',segmentationMode:'auto'},processing:{rotation:0,contrast:false,invert:false,cropPercent:null}}],
      reconstruction,rawText:observation.text,warnings:[],synthetic:false,createdAt:new Date().toISOString()});
    const followup=assistInput.parse({consent:true,question:'How many servings are in the pack?',package:pkg});
    const prompt=assistPromptPayload(followup) as {package:Record<string,unknown>;packageFacts:Array<{id:string}>};
    expect(prompt.packageFacts.map(fact=>fact.id)).toEqual(expect.arrayContaining(['package-fact:quantity:0','package-fact:quantity:1','package-fact:quantity:2']));
    const compact=prompt.package as {rawText?:string;reconstruction:{quantityDeclarations:Array<{kind:string;printedText:string;quantity:number;unit:string}>};observations:Array<{id:string}>};
    expect(compact.reconstruction.quantityDeclarations).toHaveLength(3);
    expect(compact.reconstruction.quantityDeclarations[2]).toMatchObject({kind:'servings-per-package',printedText:'20 servings per package',quantity:20,unit:'servings'});
    expect(compact.observations).toEqual([]);
    expect(compact.rawText).toBeUndefined();
  });
  it('normalizes Gemini 0-1000 image regions into the saved 0-1 evidence contract',()=>{
    const candidate={
      identity:{brand:'Bisk Farm',name:'Cream Cracker',variant:'Sugar Free',status:'clear',evidence:{observationIds:['ocr-front'],imageRegions:[{imageId:'front-image',region:{x:215,y:55,width:125,height:44}}]}},
      serving:null,nutritionRows:[],ingredients:[],additives:[],statements:[],
      regions:[
        {imageId:'back-image',role:'nutrition-table',region:{x:80,y:100,width:890,height:210},observationIds:[]},
        {imageId:'back-image',role:'ingredients',region:{x:0,y:0,width:500,height:381},observationIds:[]},
      ],
      unresolved:[],interpretationNote:'',
    };
    const normalized=normalizeGeminiPackageRegionCoordinates(candidate) as typeof candidate;
    expect(normalized.identity.evidence.imageRegions[0].region).toEqual({x:0.215,y:0.055,width:0.125,height:0.044});
    expect(normalized.regions).toHaveLength(2);
    expect(normalized.regions[0].region).toEqual({x:0.08,y:0.1,width:0.89,height:0.21});
    expect(packageReconstructionContentSchema.safeParse(normalized).success).toBe(true);
    const invalid={...candidate,regions:[{imageId:'back-image',role:'nutrition-table',region:{x:990,y:0,width:20,height:1001},observationIds:[]}]};
    expect((normalizeGeminiPackageRegionCoordinates(invalid) as typeof candidate).regions).toEqual([]);
    const malformedNormalized={...candidate,regions:[{imageId:'back-image',role:'nutrition-table',region:{x:0.9,y:0.1,width:0.3,height:0.1},observationIds:[]}]};
    expect((normalizeGeminiPackageRegionCoordinates(malformedNormalized) as typeof candidate).regions).toEqual([]);
  });
  it('preserves dense-region links to more than 32 OCR observations',()=>{
    const observationIds=Array.from({length:48},(_,index)=>`dense-label-line-${index+1}`);
    const reconstruction={
      identity:{brand:null,name:null,variant:null,status:'unreadable',evidence:{observationIds:[],imageRegions:[]}},
      serving:null,nutritionRows:[],ingredients:[],additives:[],statements:[],
      regions:[{imageId:'dense-back-photo',role:'nutrition-table',region:{x:0,y:0,width:1,height:1},observationIds}],
      unresolved:[],interpretationNote:'A dense label region with full OCR lineage.',
    };

    const parsed=packageReconstructionContentSchema.parse(reconstruction);

    expect(parsed.regions[0].observationIds).toEqual(observationIds);
  });
  it('does not guess a provider project from key presence', () => {
    vi.stubEnv('ENABLE_GEMINI', 'true'); vi.stubEnv('ENABLE_GEMINI_SEARCH', 'false'); vi.stubEnv('GEMINI_PROVIDER', ''); vi.stubEnv('GEMINI_API_KEY', 'paid-placeholder'); vi.stubEnv('FREE_GEMINI_API_KEY', ''); vi.stubEnv('GEMINI_MODEL', 'gemini-3.8-flash');
    expect(providerStatus()).toMatchObject({ configured: false, enabled: false, tier: 'free', searchEnabled: false });
    expect(JSON.stringify(providerStatus())).not.toContain('placeholder');
  });
  it('selects only the explicit free-tier project and never falls back to the paid key', () => {
    vi.stubEnv('ENABLE_GEMINI', 'true'); vi.stubEnv('GEMINI_PROVIDER', 'free'); vi.stubEnv('GEMINI_MODEL', 'gemini-3.8-flash'); vi.stubEnv('FREE_GEMINI_API_KEY', 'free-placeholder'); vi.stubEnv('GEMINI_API_KEY', 'paid-placeholder');
    expect(providerStatus()).toMatchObject({ configured: true, enabled: true, tier: 'free', model: 'gemini-3.8-flash' });
    vi.stubEnv('FREE_GEMINI_API_KEY', '');
    expect(providerStatus()).toMatchObject({ configured: false, enabled: false, tier: 'free' });
  });
  it('keeps the paid project disabled without positive explicit caps and prices', () => {
    vi.stubEnv('ENABLE_GEMINI', 'true'); vi.stubEnv('GEMINI_PROVIDER', 'paid'); vi.stubEnv('GEMINI_MODEL', 'gemini-3.8-flash'); vi.stubEnv('GEMINI_API_KEY', 'paid-placeholder'); vi.stubEnv('ENABLE_PAID_GEMINI', 'true'); vi.stubEnv('GEMINI_FREE_PROJECT_ID', 'free-project'); vi.stubEnv('GEMINI_PAID_PROJECT_ID', 'paid-project');
    expect(providerStatus()).toMatchObject({ configured: true, enabled: false, tier: 'paid', paidAuthorized: false });
    expect(JSON.stringify(providerStatus())).not.toContain('paid-placeholder');
  });
  it('keeps provider HTTP attempts visible instead of hiding SDK retries', async () => {
    vi.stubEnv('ENABLE_GEMINI', 'true'); vi.stubEnv('GEMINI_PROVIDER', 'free'); vi.stubEnv('GEMINI_MODEL', 'gemini-3.8-flash'); vi.stubEnv('FREE_GEMINI_API_KEY', 'offline-test-key');
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 503, message: 'temporarily unavailable', status: 'UNAVAILABLE' } }), { status: 503, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    const context = applicationGeminiContext();
    await expect(context.client.models.generateContent({ model: context.model, contents: 'offline retry probe' })).rejects.toMatchObject({ status: 503 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('reconstructs a scanned package with a native tool call, then accepts a plain conversational answer', async () => {
    vi.stubEnv('ENABLE_GEMINI', 'true'); vi.stubEnv('GEMINI_PROVIDER', 'free'); vi.stubEnv('GEMINI_MODEL', 'gemini-3.8-flash'); vi.stubEnv('FREE_GEMINI_API_KEY', 'offline-test-key');
    const image=await sharp({create:{width:8,height:8,channels:3,background:'#f2f1eb'}}).png().toBuffer();
    const imageId='package-front';
    const reconstruction={identity:{brand:'Bisk Farm',name:'Cream Cracker',variant:'Sugar Free',status:'provisional',evidence:{observationIds:['OBS_1'],imageRegions:[]}},serving:null,nutritionRows:[],ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'A provisional interpretation linked to the package image and OCR.'};
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(modelResponse([toolCallPart('reconstruct-1','submit_package_reconstruction',reconstruction)]), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(modelResponse([{text:'This appears to be a Bisk Farm Cream Cracker marked sugar free.'}]), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    const data = assistInput.parse({ consent: true, question: 'What product is this?', package: { id: 'package-1', name: 'Unidentified package', ingredients: [], additives: [], allergens: [], claims: [], nutrients: [], observations: [{ id: 'input-1', field: 'ocr-line', text: 'BISK FARM CREAM CRACKER', side: 'front', confidence: 91, origin: 'ocr', imageId, readingOrder:{runId:'ocr-run',blockIndex:0,paragraphIndex:0,lineIndex:0} }],ocrCaptures:[{runId:'ocr-run',imageId,side:'front',sourceImage:{width:8,height:8},preparedImage:{width:8,height:8},bboxCoordinateSpace:'prepared-image-pixels',engine:{name:'fixture-reader',version:'1',language:'eng',confidenceScale:'0-100',segmentationMode:'auto'},processing:{rotation:0,contrast:false,invert:false,cropPercent:null}}], rawText: 'BISK FARM CREAM CRACKER', warnings: [], synthetic: false, createdAt: new Date().toISOString() }, images:[{handle:imageId,side:'front',width:8,height:8,role:'front'}],visualImages:[{imageId,mimeType:'image/png',base64:image.toString('base64'),side:'front',sourceImage:{width:8,height:8},preprocessing:{rotation:0,contrast:false,invert:false,crop:null}}] });

    const result=await assist(data);
    expect(result).toMatchObject({status:'ok',answer:'This appears to be a Bisk Farm Cream Cracker marked sugar free.',packageReconstruction:{identity:{brand:'Bisk Farm',name:'Cream Cracker',variant:'Sugar Free'}}});
    expect(fetcher).toHaveBeenCalledTimes(2);
    const reconstructionRequest=JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    const answerRequest=JSON.parse(String(fetcher.mock.calls[1][1]?.body));
    expect(reconstructionRequest.tools[0].functionDeclarations.map((tool:{name:string})=>tool.name)).toEqual(['submit_package_reconstruction']);
    expect(reconstructionRequest.toolConfig.functionCallingConfig.allowedFunctionNames).toEqual(['submit_package_reconstruction']);
    expect(reconstructionRequest.generationConfig).not.toHaveProperty('responseMimeType');
    expect(reconstructionRequest.generationConfig).not.toHaveProperty('responseJsonSchema');
    expect(JSON.stringify(reconstructionRequest.contents)).toContain('BISK FARM CREAM CRACKER');
    expect(JSON.stringify(reconstructionRequest.contents)).toContain('inlineData');
    expect(JSON.stringify(reconstructionRequest.systemInstruction)).toContain('readingOrder.runId links to the ocrCaptures entry');
    expect(JSON.stringify(reconstructionRequest.systemInstruction)).not.toContain('thoughtful, knowledgeable food companion');
    const reconstructionPayload=JSON.parse(reconstructionRequest.contents[0].parts[0].text) as {package:{observations:unknown[][];ocrCaptures:{runId:string;engine:string}[]}};
    expect(reconstructionPayload.package.observations[0][5]).toEqual(['ocr-run',0,0,0]);
    expect(reconstructionPayload.package.ocrCaptures).toEqual([expect.objectContaining({runId:'ocr-run',engine:'fixture-reader'})]);
    expect(answerRequest.tools).toBeDefined();
    expect(answerRequest.generationConfig).not.toHaveProperty('responseMimeType');
    expect(answerRequest.generationConfig).not.toHaveProperty('responseJsonSchema');
    expect(JSON.stringify(answerRequest.contents)).not.toContain('inlineData');
    expect(JSON.stringify(answerRequest.systemInstruction)).toContain('Answer directly in plain text');
    expect(JSON.stringify(answerRequest.systemInstruction)).not.toContain('readingOrder.runId');
    expect(JSON.stringify(answerRequest.systemInstruction)).not.toContain('questionCoverageInstruction');
  });
  it('carries an exact Codex identity tool result through the agent loop into a validated answer claim', async()=>{
    vi.stubEnv('ENABLE_GEMINI','true');vi.stubEnv('GEMINI_PROVIDER','free');vi.stubEnv('GEMINI_MODEL','gemini-3.8-flash');vi.stubEnv('FREE_GEMINI_API_KEY','offline-test-key');
    const answer='INS 450(i) is Disodium diphosphate. The identity record does not establish the amount in this package or Indian authorization.';
    const reconstruction={
      identity:{brand:null,name:null,variant:null,status:'unreadable',evidence:{observationIds:[],imageRegions:[]}},
      serving:null,nutritionRows:[],ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'No product facts are reconstructed in this fixture.',
      revision:1,updatedAt:new Date().toISOString(),model:'fixture',current:true,
    };
    const data=assistInput.parse({consent:true,question:'What does INS 450(i) mean?',package:{
      id:'codex-identity-agent-loop',name:'Unidentified package',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],reconstruction,
      observations:[{id:'ingredient-line',field:'ocr-line',text:'INGREDIENTS: raising agent INS 450(i)',side:'back',confidence:80,origin:'ocr',imageId:'package-back',readingOrder:{runId:'ocr-run',blockIndex:0,paragraphIndex:0,lineIndex:0}}],
      ocrCaptures:[{runId:'ocr-run',imageId:'package-back',side:'back',sourceImage:{width:900,height:363},preparedImage:{width:900,height:363},bboxCoordinateSpace:'prepared-image-pixels',engine:{name:'tesseract',version:'fixture',language:'eng',confidenceScale:'0-100',segmentationMode:'auto'},processing:{rotation:0,contrast:false,invert:false,cropPercent:null}}],
      rawText:'INGREDIENTS: raising agent INS 450(i)',warnings:[],synthetic:true,createdAt:new Date().toISOString(),
    }});
    const providerResponse=(value:unknown)=>JSON.stringify({candidates:[{content:{parts:[value as never],role:'model'},finishReason:'STOP',index:0}],modelVersion:'gemini-3.8-flash-test',usageMetadata:{promptTokenCount:80,candidatesTokenCount:45,totalTokenCount:125}});
    let providerCalls=0;
    const outbound:Array<{url:string;body:BodyInit|null|undefined}> = [];
    const fetcher=vi.fn().mockImplementation(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);
      outbound.push({url,body:init?.body});
      if(url.includes('generativelanguage.googleapis.com')){
        providerCalls+=1;
        const body=providerCalls===1
          ?{...toolCallPart('resolve-call-1','resolve_ingredient',{query:'INS 450(i)'}),thoughtSignature:'protocol-signature-for-test'}
          :{text:answer};
        return new Response(providerResponse(body),{status:200,headers:{'content-type':'application/json'}});
      }
      if(url.includes('SearchAdditivesByInsNumber'))return new Response(JSON.stringify({
        success:true,data:[{Id:'exact',Label:'Disodium diphosphate',InsNumber:'450(i)',Language:'en',MatchType:'INS Exact',MatchedSynonym:null}],count:1,
      }),{status:200,headers:{'content-type':'application/json'}});
      throw new Error(`Unexpected test request to ${new URL(url).hostname}`);
    });
    vi.stubGlobal('fetch',fetcher);

    const result=await assist(data);

    expect(providerCalls).toBe(2);
    expect(result.status).toBe('ok');
    expect(result.answer).toBe(answer);
    expect(result.agentDiagnostics).toMatchObject({contract:'native-tools-and-natural-text',answerStatus:'answer-ready',generationCount:2,toolCallCount:1});
    expect(result.agentDiagnostics.retrievedSourceCount).toBeGreaterThan(0);
    expect(result.agentEvidence).toContainEqual(expect.objectContaining({id:'codex-gsfa-ins-450-i',publisher:'Codex Alimentarius Commission (FAO/WHO)'}));
    expect(result.agentTrace).toContainEqual(expect.objectContaining({name:'resolve_ingredient',status:'ok'}));
    expect(result.agentTrace.some(step=>/repair|final_structure/.test(step.name))).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(new URLSearchParams(String(outbound.find(request=>request.url.includes('SearchAdditivesByInsNumber'))?.body)).get('insNumber')).toBe('450(i)');
    const providerRequests=outbound.filter(request=>request.url.includes('generativelanguage.googleapis.com'));
    expect(providerRequests).toHaveLength(2);
    const toolRoundBodies=providerRequests.map(request=>JSON.parse(String(request.body)));
    for(const body of toolRoundBodies){
      expect(body.tools).toBeDefined();
      expect(body.generationConfig).not.toHaveProperty('responseMimeType');
      expect(body.generationConfig).not.toHaveProperty('responseJsonSchema');
    }
    expect(JSON.stringify(JSON.parse(String(providerRequests[1].body)).contents)).toContain('protocol-signature-for-test');
    expect(JSON.stringify(JSON.parse(String(providerRequests[1].body)).contents)).not.toContain('inlineData');
  });
  it('validates an image-linked ingredient and nutrition row from one reconstruction without heuristic parser acceptance',async()=>{
    vi.stubEnv('ENABLE_GEMINI','true');vi.stubEnv('GEMINI_PROVIDER','free');vi.stubEnv('GEMINI_MODEL','gemini-3.8-flash');vi.stubEnv('FREE_GEMINI_API_KEY','offline-test-key');
    const image=await sharp({create:{width:8,height:8,channels:3,background:'#f2f1eb'}}).png().toBuffer();
    const imageId='package-photo-contract-test';
    const ingredient='The package appears to list refined wheat flour first; a provisional table reading shows 69.29 g carbohydrate per 100 g.';
    const packageReconstruction={
      identity:{brand:'Bisk Farm',name:'Cream Cracker',variant:'Sugar Free',status:'provisional',evidence:{observationIds:['stale-identity-id'],imageRegions:[]}},
      serving:null,
      nutritionRows:[{rowId:'carbohydrate-per-100g',nutrient:'Carbohydrate',printedLabel:'Carbohydrates',printedValue:'69.29 g',value:69.29,unit:'g',columnLabel:'Per 100 g',basisText:'per 100 g',basisAmount:100,basisUnit:'g',qualifier:null,status:'provisional',evidence:{observationIds:['stale-nutrition-id'],imageRegions:[]}}],
      ingredients:[{position:0,name:'Refined wheat flour',printedText:'REFINED WHEAT FLOUR (MAIDA) (89.98%)',printedPercentage:89.98,normalizedName:'refined wheat flour',status:'provisional',evidence:{observationIds:['stale-ingredient-id'],imageRegions:[]}}],
      additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'A provisional visual interpretation of the attached package photo.',
    };
    const fetcher=vi.fn()
      .mockResolvedValueOnce(new Response(modelResponse([toolCallPart('reconstruct-1','submit_package_reconstruction',packageReconstruction)]),{status:200,headers:{'content-type':'application/json'}}))
      .mockResolvedValueOnce(new Response(modelResponse([{text:ingredient}]),{status:200,headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetcher);
    const data=assistInput.parse({consent:true,question:'What does this packet show?',package:{id:'reconstruction-contract-test',name:'Unidentified package',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],observations:[],rawText:'',warnings:[],synthetic:false,createdAt:new Date().toISOString()},images:[{handle:imageId,side:'back',width:8,height:8,role:'unknown'}],visualImages:[{imageId,mimeType:'image/png',base64:image.toString('base64'),side:'back',sourceImage:{width:8,height:8},preprocessing:{rotation:0,contrast:false,invert:false,crop:null}}]});

    const result=await assist(data);
    expect(result.answer).toBe(ingredient);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.packageReconstruction).toMatchObject({ingredients:[{name:'Refined wheat flour',status:'provisional',evidence:{imageRegions:[{imageId,region:null}]}}],nutritionRows:[{nutrient:'Carbohydrate',value:69.29,status:'provisional',evidence:{imageRegions:[{imageId,region:null}]}}]});
  });
  it('returns cited local guidance evidence to the conversation UI', async () => {
    vi.stubEnv('ENABLE_GEMINI', 'true'); vi.stubEnv('GEMINI_PROVIDER', 'free'); vi.stubEnv('GEMINI_MODEL', 'gemini-3.8-flash'); vi.stubEnv('FREE_GEMINI_API_KEY', 'offline-test-key');
    const question = 'Is this good to have for diabetic patients daily for snacking?';
    const source = getNutritionGuidance({ query: question, jurisdiction: 'India', maxResults: 3 }).find(item => item.id === 'idf-healthy-nutrition-diabetes-2024');
    expect(source).toBeDefined();
    const answer = 'IDF patient education says refined carbohydrates can raise blood glucose more quickly than high-fibre choices, and that snack choices should be individualized.';
    const fetcher = vi.fn().mockResolvedValue(new Response(modelResponse([{text:answer}]), { status: 200, headers: { 'content-type': 'application/json' } })); vi.stubGlobal('fetch', fetcher);
    const data = assistInput.parse({ consent: true, question, evidence:[source!], package: { id: 'guidance-ui-test', name: 'Unidentified package', ingredients: [], additives: [], allergens: [], claims: [], nutrients: [], observations: [], rawText: '', warnings: [], synthetic: false, createdAt: new Date().toISOString() } });

    const result = await assist(data);
    expect(String(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).contents[0].parts[0].text)).toContain(source!.title);
    expect(result.agentEvidence).toMatchObject([{ id: source!.id, publisher: 'International Diabetes Federation', jurisdiction: 'Global' }]);
    expect(result.uiComponents).toContainEqual({ type: 'source-reference-cards', observationIds: [], sourceIds: [source!.id], calculationIds: [] });
  });
  it('renders an explicit native source reference and returns its source card without a repair generation',async()=>{
    vi.stubEnv('ENABLE_GEMINI','true');vi.stubEnv('GEMINI_PROVIDER','free');vi.stubEnv('GEMINI_MODEL','gemini-3.8-flash');vi.stubEnv('FREE_GEMINI_API_KEY','offline-test-key');
    const source=getNutritionGuidance({query:'diabetes carbohydrate',jurisdiction:'India',maxResults:3})[0];
    const answer='The supplied reference is SRC_1.\n\nIt is contextual guidance, not a personal target.';
    const fetcher=vi.fn().mockResolvedValue(new Response(modelResponse([{text:answer}]),{status:200,headers:{'content-type':'application/json'}}));vi.stubGlobal('fetch',fetcher);
    const data=assistInput.parse({consent:true,question:'Explain the supplied reference.',evidence:[source],package:{id:'native-source-reference-ui',name:'Unidentified package',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],observations:[],rawText:'',warnings:[],synthetic:true,createdAt:new Date().toISOString()}});
    const result=await assist(data);
    expect(result.answer).toBe(`The supplied reference is ${source.title}.\nIt is contextual guidance, not a personal target.`);
    expect(result.uiComponents).toContainEqual({type:'source-reference-cards',observationIds:[],sourceIds:[source.id],calculationIds:[]});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('keeps unused evidence inspectable without presenting it as a conversational citation',async()=>{
    vi.stubEnv('ENABLE_GEMINI','true');vi.stubEnv('GEMINI_PROVIDER','free');vi.stubEnv('GEMINI_MODEL','gemini-3.8-flash');vi.stubEnv('FREE_GEMINI_API_KEY','offline-test-key');
    const source=getNutritionGuidance({query:'diabetes carbohydrate',jurisdiction:'India',maxResults:3})[0];
    expect(source).toBeDefined();
    const answer='The supplied package frame does not show an ingredient list.';
    const fetcher=vi.fn().mockResolvedValue(new Response(modelResponse([{text:answer}]),{status:200,headers:{'content-type':'application/json'}}));vi.stubGlobal('fetch',fetcher);
    const data=assistInput.parse({consent:true,question:'Does this frame show ingredients?',evidence:[source],package:{id:'uncited-source-ui',name:'Unidentified package',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],observations:[],rawText:'',warnings:[],synthetic:false,createdAt:new Date().toISOString()}});
    const result=await assist(data);
    expect(result.answer).toBe(answer);
    expect(result.agentEvidence.map(item=>item.id)).toContain(source.id);
    expect(result.uiComponents.some(item=>item.type==='source-reference-cards')).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('accepts ordinary prose without a structured-answer repair generation',async()=>{
    vi.stubEnv('ENABLE_GEMINI','true');vi.stubEnv('GEMINI_PROVIDER','free');vi.stubEnv('GEMINI_MODEL','gemini-3.8-flash');vi.stubEnv('FREE_GEMINI_API_KEY','offline-test-key');
    const observation={id:'ingredient-line',field:'ingredients',text:'INGREDIENTS: REFINED WHEAT FLOUR (MAIDA)',side:'back' as const,confidence:82,origin:'user' as const};
    const reconstruction={
      identity:{brand:null,name:null,variant:null,status:'unreadable' as const,evidence:{observationIds:[],imageRegions:[]}},
      serving:null,nutritionRows:[],
      ingredients:[{position:0,name:'Refined wheat flour',printedText:'REFINED WHEAT FLOUR (MAIDA)',printedPercentage:null,normalizedName:'refined wheat flour',status:'provisional' as const,evidence:{observationIds:['ingredient-line'],imageRegions:[]}}],
      additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'A provisional interpretation linked to the package text.',
    };
    const answer='The package text lists refined wheat flour (maida) as an ingredient.';
    const savedReconstruction={...reconstruction,revision:1,updatedAt:new Date().toISOString(),model:'fixture',current:true};
    const fetcher=vi.fn().mockResolvedValue(new Response(modelResponse([{text:answer}]),{status:200,headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetcher);
    const data=assistInput.parse({consent:true,question:'What ingredients are listed?',package:{id:'invalid-json-repair',name:'Unidentified package',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],reconstruction:savedReconstruction,observations:[observation],rawText:observation.text,warnings:[],synthetic:false,createdAt:new Date().toISOString()}});

    const result=await assist(data);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.answer).toBe(answer);
    const requestBody=JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(requestBody.generationConfig).not.toHaveProperty('responseJsonSchema');
    expect(requestBody.generationConfig).not.toHaveProperty('responseMimeType');
    expect(result.agentTrace.some(step=>/repair|final_structure/.test(step.name))).toBe(false);
  });
  it('keeps newly requested calculations ahead of a full historical calculation budget', async () => {
    vi.stubEnv('ENABLE_GEMINI', 'true'); vi.stubEnv('GEMINI_PROVIDER', 'free'); vi.stubEnv('FREE_GEMINI_API_KEY', 'offline-test-key');
    const evidence = { observationIds: ['carbohydrate-line'], imageRegions: [] };
    const saved = { identity: { brand: null, name: null, variant: null, status: 'unreadable', evidence }, serving: null,
      nutritionRows: [{ rowId: 'carbohydrate-row', nutrient: 'Carbohydrate', nutrientKey: 'carbohydrate', printedLabel: 'Carbohydrate', printedValue: '60 g', value: 60, unit: 'g', columnLabel: 'per 100 g', basisText: 'per 100 g', basisAmount: 100, basisUnit: 'g', qualifier: null, status: 'provisional', evidence }],
      ingredients: [], additives: [], statements: [], regions: [], unresolved: [], interpretationNote: 'Synthetic continuity fixture.', revision: 1, updatedAt: '2026-10-26T00:00:00.000Z', model: 'fixture', current: true };
    const calculations = Array.from({ length: 20 }, (_, index) => ({ id: `prior-${index}`, label: 'Historical carbohydrate operation', nutrient: 'carbohydrate', input: 60, inputUnit: 'g', basisAmount: 100, portion: index + 1, portionUnit: 'g', result: 60 * (index + 1) / 100, unit: 'g', formula: '60 × portion ÷ 100', observationIds: ['carbohydrate-line'], assumptions: [] }));
    const answer = 'That works out to 18 g carbohydrate in 30 g.';
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(modelResponse([toolCallPart('calculate-new', 'calculate_nutrition', { nutrient: 'carbohydrate', amount: 30, unit: 'g' })]), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(modelResponse([{ text: answer }]), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    const data = assistInput.parse({ consent: true, question: 'What about 30 g?', workspacePortion: { amount: 40, unit: 'g' }, calculations, package: { id: 'full-history-budget', name: 'Synthetic fixture', ingredients: [], additives: [], allergens: [], claims: [], nutrients: [], observations: [{ id: 'carbohydrate-line', field: 'label-note', text: 'Carbohydrate 60 g per 100 g', side: 'text', confidence: null, origin: 'user' }], rawText: '', warnings: [], synthetic: true, createdAt: '2026-10-26T00:00:00.000Z', reconstruction: saved } });
    const result = await assist(data);
    expect(result.answer).toBe(answer);
    expect(result.calculations).toContainEqual(expect.objectContaining({ portion: 30, result: 18 }));
    expect(result.calculations.length).toBeLessThanOrEqual(20);
  });
  it.each(['g','ml'] as const)('retains an explicitly cited historical %s calculation without inventing an interactive calculator',async(unit)=>{
    vi.stubEnv('ENABLE_GEMINI','true');vi.stubEnv('GEMINI_PROVIDER','free');vi.stubEnv('FREE_GEMINI_API_KEY','offline-test-key');
    const evidence={observationIds:['protein-line'],imageRegions:[]};
    const reconstruction={identity:{brand:null,name:null,variant:null,status:'unreadable',evidence},serving:null,nutritionRows:[{rowId:'protein-row',nutrient:'Protein',nutrientKey:'protein',printedLabel:'Protein',printedValue:'42 g',value:42,unit:'g',columnLabel:`per 100 ${unit}`,basisText:`per 100 ${unit}`,basisAmount:100,basisUnit:unit,qualifier:null,status:'provisional',evidence}],ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Synthetic historical-reference fixture.',revision:1,updatedAt:'2026-10-26T00:00:00.000Z',model:'fixture',current:true};
    const calculation={id:'prior-protein',label:'Saved protein operation',nutrient:'protein',input:42,inputUnit:'g',basisAmount:100,portion:10,portionUnit:unit,result:4.2,unit:'g',formula:'42 × 10 ÷ 100',observationIds:['protein-line'],assumptions:[]};
    const data=assistInput.parse({consent:true,question:'Explain the saved result.',workspacePortion:{amount:35,unit},calculations:[calculation],package:{id:'historical-reference',name:'Synthetic fixture',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],observations:[{id:'protein-line',field:'label-note',text:`Protein 42 g per 100 ${unit}`,side:'text',confidence:null,origin:'user'}],rawText:'',warnings:[],synthetic:true,createdAt:'2026-10-26T00:00:00.000Z',reconstruction}});
    const fetcher=vi.fn().mockImplementation(()=>Promise.resolve(new Response(modelResponse([{text:`The saved result is 4.2 g protein in 10 ${unit}, from CALC_1.`}]),{status:200,headers:{'content-type':'application/json'}})));vi.stubGlobal('fetch',fetcher);
    const result=await assist(data);
    expect(result.calculations).toHaveLength(1);
    expect(result.calculations[0]).toMatchObject({id:'prior-protein',portion:10,portionUnit:unit,result:4.2});
    expect(result.answer).toContain('from saved calculation');
    expect(result.uiComponents.some(component=>component.type==='portion-calculator')).toBe(false);
    fetcher.mockImplementation(()=>Promise.resolve(new Response(modelResponse([{text:`The saved result is 99 g protein in 10 ${unit}, from CALC_1. The label basis still needs review.`}]),{status:200,headers:{'content-type':'application/json'}})));
    const rejected=await assist(data);
    expect(rejected.calculations).toEqual([]);
    expect(rejected.agentDiagnostics.withheldQuantitySentences).toBe(1);
    fetcher.mockImplementation(()=>Promise.resolve(new Response(modelResponse([{text:'The label basis still needs review; CALC_99 is unavailable.'}]),{status:200,headers:{'content-type':'application/json'}})));
    expect((await assist(data)).calculations).toEqual([]);
  });
  it('returns only deterministic calculations referenced by validated claims or generative UI', async () => {
    vi.stubEnv('ENABLE_GEMINI', 'true'); vi.stubEnv('GEMINI_PROVIDER', 'free'); vi.stubEnv('GEMINI_MODEL', 'gemini-3.8-flash'); vi.stubEnv('FREE_GEMINI_API_KEY', 'offline-test-key');
    const calculation = { id: 'calc-carbohydrate-30g', label: 'Carbohydrate in 30 g', nutrient: 'carbohydrate', input: 60, inputUnit: 'g', basisAmount: 100, portion: 30, portionUnit: 'g', result: 18, unit: 'g', formula: '60 g × 30 g ÷ 100 g', observationIds: ['input-1'], assumptions: ['Provisional package reading.'] } as const;
    const reconstruction = { identity: { brand: null, name: 'Unidentified package', variant: null, status: 'provisional', evidence: { observationIds: ['input-1'], imageRegions: [] } }, serving: null, nutritionRows: [{rowId:'carbohydrate-100g',nutrient:'carbohydrate',printedLabel:'Carbohydrate',printedValue:'60 g',value:60,unit:'g',columnLabel:'Per 100 g',basisText:'per 100 g',basisAmount:100,basisUnit:'g',qualifier:null,status:'provisional',evidence:{observationIds:['input-1'],imageRegions:[]}}], ingredients: [], additives: [], statements: [], regions: [], unresolved: [], interpretationNote: 'Saved interpretation.' };
    const answer = 'That works out to 18 g of carbohydrate in 30 g.';
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(modelResponse([toolCallPart('calculate-1','calculate_nutrition',{nutrient:'carbohydrate',amount:30,unit:'g',candidateId:'carbohydrate-100g'})]), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(modelResponse([{text:answer}]), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    const data = assistInput.parse({ consent: true, question: 'How much carbohydrate in 30 g?', calculations: [calculation], package: { id: 'package-calculation-ui', name: 'Unidentified package', ingredients: [], additives: [], allergens: [], claims: [], nutrients: [], observations: [{ id: 'input-1', field: 'label-note', text: 'Carbohydrate 60 g per 100 g', side: 'text', confidence: null, origin: 'user' }], rawText: 'Carbohydrate 60 g per 100 g', warnings: [], synthetic: false, createdAt: new Date().toISOString(), reconstruction: { ...reconstruction, revision: 1, updatedAt: new Date().toISOString(), model: 'Gemini', current: true } } });

    const result = await assist(data);
    expect(result.answer).toBe(answer);
    expect(result.calculations).toHaveLength(1);
    expect(result.calculations[0]).toMatchObject({nutrient:'carbohydrate',portion:30,result:18,unit:'g'});
    expect(result.uiComponents).toContainEqual(expect.objectContaining({type:'portion-calculator',calculationIds:[result.calculations[0].id]}));
  });
  it('renders a requested-portion calculator from saved reconstruction without a redundant model tool call',async()=>{
    vi.stubEnv('ENABLE_GEMINI','true');vi.stubEnv('GEMINI_PROVIDER','free');vi.stubEnv('GEMINI_MODEL','gemini-3.8-flash');vi.stubEnv('FREE_GEMINI_API_KEY','offline-test-key');
    const observation={id:'nutrition-line',field:'label-note',text:'Carbohydrate 66 g per 100 g; dietary fibre 10.2 g per 100 g; total fat 8 g per 100 g',side:'back' as const,confidence:null,origin:'user' as const};
    const reconstruction={
      identity:{brand:null,name:'Example oats',variant:null,status:'provisional' as const,evidence:{observationIds:['nutrition-line'],imageRegions:[]}},
      serving:null,
      nutritionRows:[
        {rowId:'carbohydrate-r1',nutrient:'Carbohydrate',printedLabel:'Carbohydrate',printedValue:'66 g',value:66,unit:'g',columnLabel:'Per 100 g',basisText:'per 100 g',basisAmount:100,basisUnit:'g' as const,qualifier:null,status:'provisional' as const,evidence:{observationIds:['nutrition-line'],imageRegions:[]}},
        {rowId:'fibre-r1',nutrient:'Dietary fibre',printedLabel:'Dietary fibre',printedValue:'10.2 g',value:10.2,unit:'g',columnLabel:'Per 100 g',basisText:'per 100 g',basisAmount:100,basisUnit:'g' as const,qualifier:null,status:'provisional' as const,evidence:{observationIds:['nutrition-line'],imageRegions:[]}},
        {rowId:'fat-r1',nutrient:'Total fat',printedLabel:'Total fat',printedValue:'8 g',value:8,unit:'g',columnLabel:'Per 100 g',basisText:'per 100 g',basisAmount:100,basisUnit:'g' as const,qualifier:null,status:'provisional' as const,evidence:{observationIds:['nutrition-line'],imageRegions:[]}},
      ],
      ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'A saved, evidence-linked interpretation.',
      revision:2,updatedAt:new Date().toISOString(),model:'gemini-3.6-flash',current:true,
    };
    const answer='For 70 g, that works out to 46.2 g of carbohydrate and 7.14 g of dietary fibre.';
    const fetcher=vi.fn().mockResolvedValue(new Response(modelResponse([{text:answer}]),{status:200,headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetcher);
    const data=assistInput.parse({consent:true,question:'How much carbohydrate and fibre in 70 g?',package:{id:'portion-state-calculator',name:'Example oats',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],observations:[observation],rawText:observation.text,warnings:[],synthetic:false,createdAt:new Date().toISOString(),reconstruction}});

    const result=await assist(data);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.answer).toBe(answer);
    expect(result.agentDiagnostics).toMatchObject({contract:'native-tools-and-natural-text',answerStatus:'answer-ready',generationCount:1,calculationCount:2});
    expect(result.calculations.map(calculation=>calculation.nutrient).sort()).toEqual(['carbohydrate','fiber']);
    expect(result.calculations).toEqual(expect.arrayContaining([
      expect.objectContaining({nutrient:'carbohydrate',portion:70,result:46.2,unit:'g'}),
      expect.objectContaining({nutrient:'fiber',portion:70,result:7.14,unit:'g'}),
    ]));
    expect(result.uiComponents).toContainEqual(expect.objectContaining({type:'portion-calculator',calculationIds:result.calculations.map(calculation=>calculation.id)}));
    expect(result.calculations.some(calculation=>calculation.nutrient==='fat')).toBe(false);
    const requestBody=JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(requestBody.generationConfig).not.toHaveProperty('responseJsonSchema');
    const supplied=JSON.parse(requestBody.contents[0].parts[0].text) as {calculations:Array<{portion:number;nutrient:string;result:number}>};
    expect(supplied.calculations).toEqual(expect.arrayContaining([
      expect.objectContaining({nutrient:'carbohydrate',portion:70,result:46.2}),
      expect.objectContaining({nutrient:'fiber',portion:70,result:7.14}),
    ]));
  });
  it('keeps an agent-calculated count portion when the question mentions the printed serving for comparison',async()=>{
    vi.stubEnv('ENABLE_GEMINI','true');vi.stubEnv('GEMINI_PROVIDER','free');vi.stubEnv('GEMINI_MODEL','gemini-3.8-flash');vi.stubEnv('FREE_GEMINI_API_KEY','offline-test-key');
    const observations=[
      {id:'nutrition-line',field:'label-note',text:'Carbohydrates 69.29 g per 100 g',side:'back' as const,confidence:null,origin:'user' as const},
      {id:'serving-line',field:'label-note',text:'Serving size: 2 biscuits (approximately 13.4 g)',side:'back' as const,confidence:null,origin:'user' as const},
    ];
    const reconstruction={
      identity:{brand:'Example',name:'Crackers',variant:null,status:'provisional' as const,evidence:{observationIds:['nutrition-line'],imageRegions:[]}},
      serving:{printedText:'2 biscuits (approximately 13.4 g)',quantity:13.4,unit:'g' as const,pieceCount:2,pieceDescription:'biscuits',status:'provisional' as const,evidence:{observationIds:['serving-line'],imageRegions:[]}},
      nutritionRows:[{rowId:'carbohydrates-per-100g',nutrient:'carbohydrate',printedLabel:'Carbohydrates',printedValue:'69.29 g',value:69.29,unit:'g',columnLabel:'Per 100 g',basisText:'per 100 g',basisAmount:100,basisUnit:'g' as const,qualifier:null,status:'provisional' as const,evidence:{observationIds:['nutrition-line'],imageRegions:[]}}],
      ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Saved evidence-linked interpretation.',revision:1,updatedAt:new Date().toISOString(),model:'fixture',current:true,
    };
    const answer='Five biscuits are about 33.5 g, compared with the printed two-biscuit serving of about 13.4 g.';
    const fetcher=vi.fn()
      .mockResolvedValueOnce(new Response(modelResponse([toolCallPart('five-biscuits','calculate_nutrition',{nutrient:'carbohydrate',amount:5,unit:'pieces',candidateId:'carbohydrates-per-100g'})]),{status:200,headers:{'content-type':'application/json'}}))
      .mockResolvedValueOnce(new Response(modelResponse([{text:answer}]),{status:200,headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetcher);
    const data=assistInput.parse({consent:true,question:'Compare five biscuits with the printed two-biscuit serving.',package:{id:'count-portion-ui',name:'Example Crackers',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],observations,rawText:observations.map(item=>item.text).join('\n'),warnings:[],synthetic:false,createdAt:new Date().toISOString(),reconstruction}});

    const result=await assist(data);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.calculations).toEqual([expect.objectContaining({nutrient:'carbohydrate',portion:33.5,result:expect.closeTo(69.29*33.5/100,10),countedPortion:{amount:5,unit:'pieces',servingQuantity:13.4,servingUnit:'g',piecesPerServing:2}})]);
    expect(result.uiComponents).toContainEqual(expect.objectContaining({type:'portion-calculator',calculatorAmount:33.5,calculatorUnit:'g',calculationIds:[result.calculations[0].id]}));
  });
  it('validates a portion difference without rendering its calculation as a duplicate requested-portion row',async()=>{
    vi.stubEnv('ENABLE_GEMINI','true');vi.stubEnv('GEMINI_PROVIDER','free');vi.stubEnv('GEMINI_MODEL','gemini-3.8-flash');vi.stubEnv('FREE_GEMINI_API_KEY','offline-test-key');
    const observation={id:'energy-label',field:'label-note',text:'Energy 376 kcal per 100 g',side:'back' as const,confidence:null,origin:'user' as const};
    const reconstruction={identity:{brand:null,name:'Example oats',variant:null,status:'provisional' as const,evidence:{observationIds:[observation.id],imageRegions:[]}},serving:null,
      nutritionRows:[{rowId:'energy-row',nutrient:'energy',nutrientKey:'energy' as const,printedLabel:'Energy',printedValue:'376 kcal',value:376,unit:'kcal',columnLabel:'Per 100 g',basisText:'per 100 g',basisAmount:100,basisUnit:'g' as const,qualifier:null,status:'provisional' as const,evidence:{observationIds:[observation.id],imageRegions:[]}}],
      ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Saved evidence-linked interpretation.',revision:1,updatedAt:new Date().toISOString(),model:'fixture',current:true};
    let calls=0;
    const fetcher=vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>{
      calls++;
      if(calls===1)return new Response(modelResponse([toolCallPart('ten-gram-energy-difference','calculate_nutrition',{nutrient:'energy',amount:10,unit:'g'})]),{status:200,headers:{'content-type':'application/json'}});
      const request=JSON.parse(String(init?.body));
      const handle=JSON.stringify(request.contents).match(/\bCALC_[A-Z0-9]+\b/)?.[0];
      expect(handle).toBeTruthy();
      return new Response(modelResponse([{text:`That is a 10 g reduction, equal to 37.6 kcal of energy (${handle}).`}]),{status:200,headers:{'content-type':'application/json'}});
    });
    vi.stubGlobal('fetch',fetcher);
    const data=assistInput.parse({consent:true,question:'What about 30 g now? Compare the energy.',conversationContext:[{question:'How much energy was in 40 g?',answer:'I used the saved package reading.',}],package:{id:'portion-difference-ui',name:'Example oats',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],observations:[observation],rawText:observation.text,warnings:[],synthetic:false,createdAt:new Date().toISOString(),reconstruction}});

    const result=await assist(data);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.answer).toContain('37.6 kcal');
    expect(result.agentDiagnostics).toMatchObject({answerStatus:'answer-ready',withheldQuantitySentences:0});
    expect(result.calculations.map(calculation=>calculation.portion).sort((a,b)=>a-b)).toEqual([10,30]);
    const calculator=result.uiComponents.find(component=>component.type==='portion-calculator');
    expect(calculator).toMatchObject({type:'portion-calculator',calculatorAmount:30,calculatorUnit:'g'});
    expect(calculator?.calculationIds).toHaveLength(1);
    expect(result.calculations.find(calculation=>calculation.portion===calculator?.calculatorAmount)?.portion).toBe(30);
  });
  it('provides a current-row difference result from saved prior typed calculations without a second model tool call',async()=>{
    vi.stubEnv('ENABLE_GEMINI','true');vi.stubEnv('GEMINI_PROVIDER','free');vi.stubEnv('GEMINI_MODEL','gemini-3.8-flash');vi.stubEnv('FREE_GEMINI_API_KEY','offline-test-key');
    const observation={id:'energy-label',field:'label-note',text:'Energy 376 kcal per 100 g',side:'back' as const,confidence:null,origin:'user' as const};
    const reconstruction={identity:{brand:null,name:'Example oats',variant:null,status:'provisional' as const,evidence:{observationIds:[observation.id],imageRegions:[]}},serving:null,
      nutritionRows:[{rowId:'energy-row',nutrient:'energy',nutrientKey:'energy' as const,printedLabel:'Energy',printedValue:'376 kcal',value:376,unit:'kcal',columnLabel:'Per 100 g',basisText:'per 100 g',basisAmount:100,basisUnit:'g' as const,qualifier:null,status:'provisional' as const,evidence:{observationIds:[observation.id],imageRegions:[]}}],
      ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Saved evidence-linked interpretation.',revision:1,updatedAt:new Date().toISOString(),model:'fixture',current:true};
    const pkg={id:'saved-portion-difference',name:'Example oats',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],observations:[observation],rawText:observation.text,warnings:[],synthetic:false,createdAt:new Date().toISOString(),reconstruction};
    const prior=calculationsFromReconstruction(pkg,40,'g');
    const fetcher=vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>{
      const request=JSON.parse(String(init?.body));
      const prompt=JSON.parse(request.contents[0].parts[0].text);
      expect(prompt.calculations).toContainEqual(expect.objectContaining({portion:10,result:37.6,interpretationIds:['ROW_1']}));
      return new Response(modelResponse([{text:'That is 37.6 kcal less than the 40 g amount.'}]),{status:200,headers:{'content-type':'application/json'}});
    });
    vi.stubGlobal('fetch',fetcher);
    const data=assistInput.parse({consent:true,question:'What about 30 g now? Compare the energy.',calculations:prior,conversationContext:[{question:'How much energy was in 40 g?',answer:'I used the saved package reading.'}],package:pkg});

    const result=await assist(data);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.answer).toContain('37.6 kcal');
    expect(result.agentDiagnostics).toMatchObject({answerStatus:'answer-ready',withheldQuantitySentences:0});
    expect(result.calculations.map(calculation=>calculation.portion).sort((a,b)=>a-b)).toEqual([10,30]);
    const calculator=result.uiComponents.find(component=>component.type==='portion-calculator');
    expect(calculator).toMatchObject({type:'portion-calculator',calculatorAmount:30});
    expect(calculator?.calculationIds).toHaveLength(1);
    expect(result.calculations.find(calculation=>calculation.portion===calculator?.calculatorAmount)?.portion).toBe(30);
  });
  it('routes whole-package questions through the explicit net-content calculator and renders the package amount',async()=>{
    vi.stubEnv('ENABLE_GEMINI','true');vi.stubEnv('GEMINI_PROVIDER','free');vi.stubEnv('GEMINI_MODEL','gemini-3.8-flash');vi.stubEnv('FREE_GEMINI_API_KEY','offline-test-key');
    const observations=[
      {id:'nutrition-label',field:'label-note',text:'Carbohydrates 20 g per 100 g',side:'back' as const,confidence:null,origin:'user' as const},
      {id:'net-content-label',field:'label-note',text:'Net contents 250 g',side:'back' as const,confidence:null,origin:'user' as const},
    ];
    const evidence={observationIds:['nutrition-label'],imageRegions:[]};
    const reconstruction={
      identity:{brand:null,name:'Generic food',variant:null,status:'provisional' as const,evidence},
      serving:null,
      quantityDeclarations:[{kind:'net-content' as const,printedText:'Net contents 250 g',quantity:250,unit:'g' as const,status:'provisional' as const,evidence:{observationIds:['net-content-label'],imageRegions:[]}}],
      nutritionRows:[{rowId:'carbohydrate-row',nutrient:'carbohydrate',printedLabel:'Carbohydrates',printedValue:'20 g',value:20,unit:'g',columnLabel:null,basisText:'per 100 g',basisAmount:100,basisUnit:'g' as const,qualifier:null,status:'provisional' as const,evidence}],
      ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Saved evidence-linked interpretation.',revision:1,updatedAt:new Date().toISOString(),model:'fixture',current:true,
    };
    const answer='One 250 g package contains 50 g carbohydrate, using the printed net contents and the reconstructed label row.';
    const fetcher=vi.fn()
      .mockResolvedValueOnce(new Response(modelResponse([toolCallPart('whole-package-carbohydrate','calculate_nutrition',{nutrient:'carbohydrate',amount:1,unit:'package',candidateId:'carbohydrate-row'})]),{status:200,headers:{'content-type':'application/json'}}))
      .mockResolvedValueOnce(new Response(modelResponse([{text:answer}]),{status:200,headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetcher);
    const data=assistInput.parse({consent:true,question:'How much carbohydrate is in the whole package?',package:{id:'whole-package-fixture',name:'Generic food',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],observations,rawText:observations.map(item=>item.text).join('\n'),warnings:[],synthetic:true,createdAt:new Date().toISOString(),reconstruction}});

    const result=await assist(data);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.answer).toContain('50 g carbohydrate');
    expect(result.calculations).toEqual([expect.objectContaining({nutrient:'carbohydrate',portion:250,result:50,packagePortion:{packageCount:1,netContentPerPackage:250,unit:'g',printedText:'Net contents 250 g'}})]);
    expect(result.uiComponents).toContainEqual(expect.objectContaining({type:'portion-calculator',calculatorAmount:250,calculatorUnit:'g',calculationIds:[result.calculations[0].id]}));
  });
  it.each([
    {unit:'g' as const,workspace:20,printedServing:30,requested:50,question:'Use 50 g instead of the amount selected earlier.'},
    {unit:'ml' as const,workspace:250,printedServing:200,requested:250,question:'Use the same glass we discussed.'},
  ])('passes $unit workspace state without injecting a competing default serving calculation',async scenario=>{
    vi.stubEnv('ENABLE_GEMINI','true');vi.stubEnv('GEMINI_PROVIDER','free');vi.stubEnv('GEMINI_MODEL','gemini-3.8-flash');vi.stubEnv('FREE_GEMINI_API_KEY','offline-test-key');
    const evidence={observationIds:['label-quantity'],imageRegions:[]};
    const reconstruction={identity:{brand:null,name:'Generic food',variant:null,status:'provisional',evidence},serving:{printedText:`${scenario.printedServing} ${scenario.unit}`,quantity:scenario.printedServing,unit:scenario.unit,pieceCount:null,pieceDescription:null,status:'provisional',evidence},nutritionRows:[{rowId:'protein-row',nutrient:'protein',printedLabel:'Protein',printedValue:'4 g',value:4,unit:'g',columnLabel:null,basisText:`per 100 ${scenario.unit}`,basisAmount:100,basisUnit:scenario.unit,qualifier:null,status:'provisional',evidence}],ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Developer fixture.',revision:1,updatedAt:new Date().toISOString(),model:'fixture',current:true};
    const answer=`That is ${4*scenario.requested/100} g protein in ${scenario.requested} ${scenario.unit}.`;
    const fetcher=vi.fn()
      .mockResolvedValueOnce(new Response(modelResponse([toolCallPart('portion-choice','calculate_nutrition',{nutrient:'protein',amount:scenario.requested,unit:scenario.unit,candidateId:'protein-row'})]),{status:200,headers:{'content-type':'application/json'}}))
      .mockResolvedValueOnce(new Response(modelResponse([{text:answer}]),{status:200,headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetcher);
    const data=assistInput.parse({consent:true,question:scenario.question,workspacePortion:{amount:scenario.workspace,unit:scenario.unit},conversationContext:[{question:`Use ${scenario.workspace} ${scenario.unit} for later questions.`,answer:''}],package:{id:`workspace-${scenario.unit}`,name:'Generic food',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],observations:[{id:'label-quantity',field:'label-note',text:`Protein 4 g per 100 ${scenario.unit}`,origin:'user',side:'text',confidence:null}],rawText:'',warnings:[],synthetic:true,createdAt:new Date().toISOString(),reconstruction}});
    const result=await assist(data);
    const prompt=JSON.parse(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).contents[0].parts[0].text);
    expect(prompt.workspacePortion).toEqual({amount:scenario.workspace,unit:scenario.unit});
    expect(prompt.calculations).toEqual([]);
    expect(result.answer).toBe(answer);
    expect(result.uiComponents).toContainEqual(expect.objectContaining({type:'portion-calculator',calculatorAmount:scenario.requested,calculatorUnit:scenario.unit}));
    expect(result.agentDiagnostics.generationCount).toBe(2);
  });
  it('carries an unmapped nutrient through native calculation, natural answer and interactive presentation',async()=>{
    vi.stubEnv('ENABLE_GEMINI','true');vi.stubEnv('GEMINI_PROVIDER','free');vi.stubEnv('GEMINI_MODEL','gemini-3.8-flash');vi.stubEnv('FREE_GEMINI_API_KEY','offline-test-key');
    const answer='Based on the provisional label reading, 75 ml provides 71 mg calcium.';
    const fetcher=vi.fn()
      .mockResolvedValueOnce(new Response(modelResponse([toolCallPart('calcium','calculate_nutrition',{candidateId:'calcium-row',amount:75,unit:'ml'})]),{status:200,headers:{'content-type':'application/json'}}))
      .mockResolvedValueOnce(new Response(modelResponse([{text:answer}]),{status:200,headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetcher);
    const evidence={observationIds:['label-calcium'],imageRegions:[]};
    const reconstruction={identity:{brand:null,name:null,variant:null,status:'unreadable',evidence},serving:null,
      nutritionRows:[{rowId:'calcium-row',nutrient:'Calcium',nutrientKey:null,printedLabel:'Calcium',printedValue:'142 mg',value:142,unit:'mg',columnLabel:'per 150 ml',basisText:'per 150 ml',basisAmount:150,basisUnit:'ml',qualifier:null,status:'provisional',evidence}],
      ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Developer fixture.',revision:1,updatedAt:new Date().toISOString(),model:'fixture',current:true};
    const data=assistInput.parse({consent:true,question:'How much calcium is in 75 ml?',package:{id:'custom-nutrient',name:'Example drink',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],observations:[{id:'label-calcium',field:'label-note',text:'Calcium 142 mg per 150 ml',side:'text',origin:'user',confidence:null}],rawText:'',warnings:[],synthetic:true,createdAt:new Date().toISOString(),reconstruction}});
    const result=await assist(data);
    expect(result.answer).toBe(answer);
    expect(result.calculations).toContainEqual(expect.objectContaining({nutrient:null,nutrientLabel:'Calcium',result:71,unit:'mg',interpretationIds:['calcium-row']}));
    expect(result.uiComponents).toContainEqual(expect.objectContaining({type:'portion-calculator',calculatorAmount:75,calculatorUnit:'ml'}));
    expect(result.agentDiagnostics.generationCount).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('rejects malformed package reconstruction once and does not run schema repair', async () => {
    vi.stubEnv('ENABLE_GEMINI','true');vi.stubEnv('GEMINI_PROVIDER','free');vi.stubEnv('GEMINI_MODEL','gemini-3.8-flash');vi.stubEnv('FREE_GEMINI_API_KEY','offline-test-key');
    const fetcher=vi.fn().mockResolvedValue(new Response(modelResponse([toolCallPart('bad-reconstruct','submit_package_reconstruction',{identity:{brand:'BISK FARM'}})]),{status:200,headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetcher);
    const image=await sharp({create:{width:8,height:8,channels:3,background:'#f2f1eb'}}).png().toBuffer();
    const data=assistInput.parse({consent:true,question:'What package is this?',package:{id:'package-repair-test',name:'Unidentified package',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],observations:[{id:'input-1',field:'product-name',text:'BISK FARM CREAM CRACKER',side:'text',confidence:100,origin:'ocr'}],rawText:'BISK FARM CREAM CRACKER',warnings:[],synthetic:true,createdAt:new Date().toISOString()},images:[{handle:'back-image',side:'back',width:8,height:8,role:'nutrition'}],visualImages:[{imageId:'back-image',mimeType:'image/png',base64:image.toString('base64'),side:'back',sourceImage:{width:8,height:8},preprocessing:{rotation:0,contrast:false,invert:false,crop:null}}]});

    await expect(assist(data)).rejects.toMatchObject({code:'package_reconstruction_invalid'});
    expect(fetcher).toHaveBeenCalledTimes(1);
    const initialRequest=JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(initialRequest.tools[0].functionDeclarations.map((tool:{name:string})=>tool.name)).toEqual(['submit_package_reconstruction']);
    expect(JSON.stringify(initialRequest.contents)).toContain('inlineData');
  });
  it('reconstructs from supplied text when no photograph is attached',async()=>{
    vi.stubEnv('ENABLE_GEMINI','true');vi.stubEnv('GEMINI_PROVIDER','free');vi.stubEnv('GEMINI_MODEL','gemini-3.8-flash');vi.stubEnv('FREE_GEMINI_API_KEY','offline-test-key');
    const observations=[
      {id:'input-1',field:'label-note',text:'BISK FARM CREAM CRACKER',side:'text' as const,confidence:null,origin:'user' as const},
      {id:'input-2',field:'label-note',text:'2 biscuits approximately 13.4 g; carbohydrates 69.29 g per 100 g',side:'text' as const,confidence:null,origin:'user' as const},
      {id:'input-3',field:'label-note',text:'REFINED WHEAT FLOUR (MAIDA) (89.98%)',side:'text' as const,confidence:null,origin:'user' as const},
    ];
    const reconstruction={identity:{brand:'Bisk Farm',name:'Cream Cracker',variant:null,status:'provisional',evidence:{observationIds:['OBS_1'],imageRegions:[]}},serving:{printedText:'2 biscuits, approximately 13.4 g',quantity:13.4,unit:'g',pieceCount:2,pieceDescription:'biscuits',status:'provisional',evidence:{observationIds:['OBS_2'],imageRegions:[]}},nutritionRows:[{rowId:'carbs-100',nutrient:'Carbohydrates',nutrientKey:'carbohydrate',printedLabel:'Carbohydrates',printedValue:'69.29 g',value:69.29,unit:'g',columnLabel:'Per 100 g',basisText:'per 100 g',basisAmount:100,basisUnit:'g',qualifier:null,status:'provisional',evidence:{observationIds:['OBS_2'],imageRegions:[]}}],ingredients:[{position:0,name:'Refined wheat flour',printedText:'REFINED WHEAT FLOUR (MAIDA) (89.98%)',printedPercentage:89.98,normalizedName:'refined wheat flour',status:'provisional',evidence:{observationIds:['OBS_3'],imageRegions:[]}}],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Provisional reconstruction from supplied text.'};
    const answer='The package reads Bisk Farm Cream Cracker. A two-biscuit serving provides about 9.28 g of carbohydrate.';
    const fetcher=vi.fn()
      .mockResolvedValueOnce(new Response(modelResponse([toolCallPart('reconstruct-text','submit_package_reconstruction',reconstruction)]),{status:200,headers:{'content-type':'application/json'}}))
      .mockResolvedValueOnce(new Response(modelResponse([{text:answer}]),{status:200,headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetcher);
    const data=assistInput.parse({consent:true,question:'What does this package contain?',package:{id:'package-text-reconstruction',name:'Unidentified package',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],observations,rawText:observations.map(item=>item.text).join('\n'),warnings:[],synthetic:true,createdAt:new Date().toISOString()}});

    const result=await assist(data);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.answer).toBe(answer);
    const answerRequest=JSON.parse(String(fetcher.mock.calls[1][1]?.body));
    const answerPayload=JSON.parse(answerRequest.contents[0].parts[0].text) as {calculations:Array<{nutrient:string;portion:number;result:number}>};
    const servingCalculation=answerPayload.calculations.find(item=>item.nutrient==='carbohydrate');
    expect(servingCalculation).toMatchObject({nutrient:'carbohydrate',portion:13.4});
    expect(servingCalculation?.result).toBeCloseTo(69.29*13.4/100,10);
    expect(result.agentTrace.some(step=>/repair|final_structure/.test(step.name))).toBe(false);
    expect(result.packageReconstruction).toMatchObject({
      identity:{brand:'Bisk Farm',name:'Cream Cracker'},
      serving:{quantity:13.4,pieceCount:2},
      nutritionRows:[{nutrient:'Carbohydrates',value:69.29,unit:'g',basisAmount:100,basisUnit:'g',evidence:{observationIds:['input-2']}}],
      ingredients:[{position:0,name:'Refined wheat flour',printedPercentage:89.98,evidence:{observationIds:['input-3']}}],
    });
    const reconstructionRequest=JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(JSON.stringify(reconstructionRequest.contents)).not.toContain('inlineData');
    expect(reconstructionRequest.generationConfig).not.toHaveProperty('responseJsonSchema');
  });
  it('grounds a claimless follow-up sentence against the compact saved reconstruction without replaying photos or tools', async () => {
    vi.stubEnv('ENABLE_GEMINI','true');vi.stubEnv('GEMINI_PROVIDER','free');vi.stubEnv('GEMINI_MODEL','gemini-3.8-flash');vi.stubEnv('FREE_GEMINI_API_KEY','offline-test-key');
    const reconstruction={identity:{brand:'BISK FARM',name:'Cream Cracker Sugar Free',variant:null,status:'clear',evidence:{observationIds:['input-1'],imageRegions:[]}},serving:{printedText:'2 biscuits, approximately 13.4 g',quantity:13.4,unit:'g',pieceCount:2,pieceDescription:'biscuits',status:'clear',evidence:{observationIds:['input-2'],imageRegions:[]}},nutritionRows:[],ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'A saved, provisional interpretation from the package photos.'};
    const currentReconstruction={...reconstruction,revision:1,updatedAt:new Date().toISOString(),model:'gemini-3.6-flash',current:true};
    const validAnswer='Two biscuits are the package serving, listed at approximately 13.4 g.';
    const fetcher=vi.fn().mockResolvedValueOnce(new Response(modelResponse([{text:validAnswer}]),{status:200,headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetcher);
    const data=assistInput.parse({consent:true,question:'What about just two biscuits?',package:{id:'package-followup-repair',name:'Cream Cracker Sugar Free',brand:'BISK FARM',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],reconstruction:currentReconstruction,observations:[{id:'input-1',field:'product-name',text:'BISK FARM CREAM CRACKER',side:'text',confidence:100,origin:'ocr'},{id:'input-2',field:'serving-size',text:'2 biscuits, approximately 13.4 g',side:'text',confidence:null,origin:'vision'}],rawText:'BISK FARM CREAM CRACKER\n2 biscuits, approximately 13.4 g',warnings:[],synthetic:false,createdAt:new Date().toISOString()}});

    const result=await assist(data);
    expect(result).toMatchObject({status:'ok',answer:validAnswer});
    expect(result).not.toHaveProperty('packageReconstruction');
    expect(result.agentTrace.some(step=>step.name==='package_answer_synthesis')).toBe(false);
    expect(result.agentTrace.some(step=>step.name==='structured_output_repair')).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const initialRequest=JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(initialRequest.contents[0].parts.some((part:{inlineData?:unknown})=>part.inlineData)).toBe(false);
    expect(initialRequest.contents[0].parts[0].text).toContain('Cream Cracker Sugar Free');
    expect(initialRequest.contents[0].parts[0].text).not.toContain('BISK FARM CREAM CRACKER');
    expect(JSON.stringify(initialRequest.systemInstruction)).toContain('Track intent across turns.');
    expect(JSON.stringify(initialRequest.systemInstruction)).toContain('Answer directly in plain text');
  });
  it('normalizes package-native reconstruction fields while preserving explicit claim links', () => {
    const answer='The package appears to list a two-biscuit serving and a nutrition table.';
    const providerOutput={
      answer,
      answerParts:[{text:answer,claimIds:['package-summary']}],
      claims:[{id:'package-summary',mode:'synthesis',text:answer,evidenceIds:['OBS_1']}],
      package:{
        identity:{brand:'Example Foods',productName:'Oat Biscuits',variant:'Original',observationIds:['OBS_1']},
        serving:{statement:'2 biscuits (approx. 13.4 g)',size:13.4,unit:'g',observationIds:['OBS_1']},
        nutritionRows:[{rowId:'ROW_1',nutrient:'Carbohydrates',printedLabel:'CARBOHYDRATES',printedValue:'69.29',value:69.29,unit:'g',columnLabel:'Per 100 g',basisText:'per 100 g',basisAmount:100,basisUnit:'g',observationIds:['OBS_1']}],
        ingredients:[{ingredientId:'ingredient-1',printedLabel:'Refined wheat flour (maida) (89.98%)',normalizedName:'refined wheat flour',percentage:89.98,observationIds:['OBS_1']}],
        additives:[{name:'Citric acid',printedText:'Acidity regulator (330)',code:'330',observationIds:['OBS_1']}],
        claims:[{type:'sugar_free',printedText:'SUGAR FREE - FREE OF SUGAR',observationIds:['OBS_1']}],
        allergens:['Contains wheat'],
        warnings:[{text:'May contain milk',observationIds:['OBS_1']}],
        certifications:[{type:'regulatory-mark',printedText:'FSSAI licence number',observationIds:['OBS_1']}],
        packageFacts:[{type:'manufacturer',label:'Manufacturer',value:'Example Foods Pvt Ltd',observationIds:['OBS_1']}],
      },
      limitations:[],inspectImage:null,
    };

    const parsed=parseAgentProviderOutput(JSON.stringify(providerOutput),true);
    expect(parsed.schemaMode).toBe('adapted-provider-schema');
    expect(parsed.output.answerParts).toEqual([{text:providerOutput.answer,claimIndexes:[0]}]);
    expect(parsed.output.claims).toMatchObject([{text:providerOutput.answer,observationIds:['OBS_1'],sourceIds:[]}]);
    expect(parsed.output.packageReconstruction).toMatchObject({
      identity:{brand:'Example Foods',name:'Oat Biscuits',variant:'Original'},
      serving:{printedText:'2 biscuits (approx. 13.4 g)',quantity:13.4,unit:'g'},
      nutritionRows:[{rowId:'ROW_1',value:69.29,basisText:'per 100 g'}],
      ingredients:[{name:'refined wheat flour',printedText:'Refined wheat flour (maida) (89.98%)',printedPercentage:89.98}],
      additives:[{printedName:'Acidity regulator (330)',normalizedName:'Citric acid',code:'330'}],
    });
    expect(parsed.output.packageReconstruction?.statements.map(item=>item.kind)).toEqual(['claim','warning','contains','regulatory-mark','manufacturer']);
  });
  it('accepts a nested package.reconstruction envelope without a structure-repair call', () => {
    const providerOutput={
      answer:'The photographed panel appears to list 23.1 g of carbohydrate per 35 g.',
      answerParts:[],claims:[],
      uiComponents:[],
      package:{reconstruction:{
        current:true,
        identity:{brand:'Example Foods',name:'Oat Biscuits',variant:null,status:'provisional',evidence:{observationIds:['OBS_1'],imageRegions:[]}},
        serving:{printedText:'35 g',quantity:35,unit:'g',pieceCount:null,pieceDescription:null,status:'provisional',evidence:{observationIds:['OBS_1'],imageRegions:[]}},
        nutritionRows:[{rowId:'ROW_1',nutrient:'carbohydrate',printedLabel:'Carbohydrate',printedValue:'23.1',value:23.1,unit:'g',columnLabel:'Per 35 g',basisText:'per 35 g',basisAmount:35,basisUnit:'g',status:'provisional',evidence:{observationIds:['OBS_1'],imageRegions:[{imageId:'IMG_1',region:{x:-0.1,y:0.2,width:0.4,height:0.3}}]}}],
        ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Provisional label interpretation.',
      }},
    };

    const parsed=parseAgentProviderOutput(JSON.stringify(providerOutput),true);

    expect(parsed.schemaMode).toBe('provider-schema');
    expect(parsed.modelOutputStatus).toBe('no-grounded-claims');
    expect(parsed.discardedRegionCount).toBe(1);
    expect(parsed.output.packageReconstruction).toMatchObject({
      identity:{brand:'Example Foods',name:'Oat Biscuits'},
      serving:{quantity:35,unit:'g'},
      nutritionRows:[{rowId:'ROW_1',nutrient:'carbohydrate',value:23.1,unit:'g',basisAmount:35,basisUnit:'g',status:'provisional',evidence:{observationIds:['OBS_1'],imageRegions:[{imageId:'IMG_1',region:null}]}}],
    });
    expect(parsed.output.answer).toBe(providerOutput.answer);
  });
  it('does not manufacture grounded claims from package prose when the provider omitted evidence links',()=>{
    const observation={id:'flour-observation',field:'label-note',text:'REFINED WHEAT FLOUR (MAIDA) (89.98%)',side:'back' as const,confidence:86,origin:'user' as const};
    const reconstruction={identity:{brand:null,name:'Example biscuits',variant:null,status:'provisional' as const,evidence:{observationIds:[],imageRegions:[]}},serving:null,nutritionRows:[],ingredients:[{position:0,name:'Refined wheat flour',printedText:'REFINED WHEAT FLOUR (MAIDA)',printedPercentage:89.98,normalizedName:'refined wheat flour',status:'provisional' as const,evidence:{observationIds:['flour-observation'],imageRegions:[]}}],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'A provisional saved package interpretation.',revision:1,updatedAt:new Date().toISOString(),model:'fixture',current:true};
    const data=assistInput.parse({consent:true,question:'What is the main ingredient?',package:{id:'claimless-package-answer',name:'Example biscuits',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],reconstruction,observations:[observation],rawText:observation.text,warnings:[],synthetic:false,createdAt:new Date().toISOString()}});
    const answer='The label lists refined wheat flour (maida) at 89.98%.';
    const parsed=parseAgentProviderOutput(JSON.stringify({answer,answerParts:[],claims:[],limitations:[],inspectImage:null}));
    expect(parsed.schemaMode).toBe('provider-schema');
    expect(parsed.output.claims).toEqual([]);
    expect(parsed.output.answerParts).toEqual([]);
    const result=validateClaims(parsed.output,data);
    expect(result.claims).toEqual([]);
    expect(result.answer).not.toContain('89.98%');
  });
  it('keeps package reconstruction while withholding uncited provider prose',()=>{
    const observations=[
      {id:'nutrition-line',field:'label-note',text:'CARBOHYDRATES 8 g per 100 g',side:'back' as const,confidence:86,origin:'ocr' as const},
      {id:'ingredient-line',field:'label-note',text:'INGREDIENTS: WHOLE WHEAT FLOUR',side:'back' as const,confidence:86,origin:'ocr' as const},
      {id:'claim-line',field:'label-note',text:'NO ADDED SUGARS',side:'front' as const,confidence:86,origin:'ocr' as const},
    ];
    const data=assistInput.parse({consent:true,question:'Summarize the package.',package:{id:'unlinked-provider-output',name:'Unidentified package',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],observations,rawText:observations.map(item=>item.text).join('\n'),warnings:[],synthetic:false,createdAt:new Date().toISOString()}});
    const answer='The ingredient list starts with whole wheat flour. The table lists 8 g of carbohydrates per 100 g. The pack says no added sugars.';
    const rawProviderOutput={
      answer,
      answerParts:[],
      claims:[],
      uiComponents:[],
      package:{current:true,identity:{brand:'Example',productName:'Whole Wheat Crackers',variant:null},serving:null,
        nutritionRows:[{rowId:'carbohydrates-100g',nutrient:'Carbohydrates',printedValue:'8 g',value:8,unit:'g',columnLabel:'Per 100 g',basisText:'per 100 g',basisAmount:100,basisUnit:'g',status:'provisional',observationIds:['nutrition-line']}],
        ingredients:[{ingredientId:'ingredient-1',printedLabel:'Whole wheat flour',normalizedName:'whole wheat flour',percentage:null,observationIds:['ingredient-line']}],
        claims:[{claimId:'claim-1',type:'claim',printedText:'NO ADDED SUGARS',observationIds:['claim-line']}],additives:[],allergens:[],warnings:[],certifications:[],packageFacts:[]},
    };
    const parsed=parseAgentProviderOutput(JSON.stringify(rawProviderOutput),true);
    expect(parsed.schemaMode).toBe('adapted-provider-schema');
    expect(parsed.modelOutputStatus).toBe('no-grounded-claims');
    expect(parsed.output.claims).toEqual([]);
    expect(parsed.output.answerParts).toEqual([]);
    const sanitized=sanitizePackageReconstruction(parsed.output.packageReconstruction,data);
    expect(sanitized).not.toBeNull();
    const result=validateClaims({...parsed.output,packageReconstruction:sanitized!.content},data);
    expect(result.claims).toEqual([]);
    expect(result.answer).not.toContain('8 g of carbohydrates');
    expect(result.answer).toContain('can’t establish a reliable answer');
    expect(sanitized!.content.ingredients[0].name).toBe('whole wheat flour');
    expect(sanitized!.content.nutritionRows[0].value).toBe(8);
    expect(sanitized!.content.nutritionRows[0].nutrientKey).toBeNull();
  });
  it('keeps image interpretation and OCR observations separate when columns are merged',()=>{
    const imageId='recovery-evidence-photo';
    const observations=[
      {id:'sugar-line',field:'ocr-line',text:'Sugar 10.2g 3.6g',side:'back' as const,confidence:98,origin:'ocr' as const,imageId,readingOrder:{runId:'ocr-run',blockIndex:0,paragraphIndex:0,lineIndex:0}},
      {id:'fibre-line',field:'ocr-line',text:'Dietary Fibre 4.4g 1.5g',side:'back' as const,confidence:97,origin:'ocr' as const,imageId,readingOrder:{runId:'ocr-run',blockIndex:0,paragraphIndex:0,lineIndex:1}},
      {id:'protein-line',field:'ocr-line',text:'Protein 14.2g 5.79g',side:'back' as const,confidence:94,origin:'ocr' as const,imageId,readingOrder:{runId:'ocr-run',blockIndex:0,paragraphIndex:0,lineIndex:2}},
    ];
    const data=assistInput.parse({consent:true,question:'Reconstruct this label.',images:[{handle:imageId,side:'back',width:900,height:363}],package:{id:'row-evidence-disagreement',name:'Unidentified package',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],observations,ocrCaptures:[{runId:'ocr-run',imageId,side:'back',sourceImage:{width:900,height:363},preparedImage:{width:900,height:363},bboxCoordinateSpace:'prepared-image-pixels',engine:{name:'Tesseract',version:'7.0',language:'eng',confidenceScale:'0-100',segmentationMode:'auto'},processing:{rotation:0,contrast:false,invert:false,cropPercent:null}}],rawText:observations.map(item=>item.text).join('\n'),warnings:[],synthetic:false,createdAt:new Date().toISOString()}});
    const imageEvidence={observationIds:[],imageRegions:[{imageId,region:{x:0.02,y:0.02,width:0.9,height:0.6}}]};
    const row=(rowId:string,nutrient:string,printedLabel:string,value:number,basisAmount:number,observationIds:string[]=[])=>({rowId,nutrient,printedLabel,printedValue:`${value} g`,value,unit:'g',columnLabel:basisAmount===100?'Per 100 g':'Per 35 g serving',basisText:basisAmount===100?'per 100 g':'per 35 g serving',basisAmount,basisUnit:'g' as const,qualifier:null,status:'provisional' as const,evidence:{...imageEvidence,observationIds}});
    const raw={
      identity:{brand:null,name:null,variant:null,status:'unreadable' as const,evidence:imageEvidence},
      serving:{printedText:'Serving size 35 g',quantity:35,unit:'g' as const,pieceCount:null,pieceDescription:null,status:'provisional' as const,evidence:{observationIds:['sugar-line'],imageRegions:[]}},
      nutritionRows:[
        row('sugar-100', 'sugars','Sugar',0,100),
        row('sugar-35', 'sugars','Sugar',3.6,35,['sugar-line']),
        row('fiber-100','dietary_fibre','Dietary Fibre',10.2,100,['sugar-line']),
        row('fiber-35','fiber','Dietary Fibre',1.5,35,['fibre-line']),
        row('protein-35','protein','Protein',5.7,35,['protein-line']),
        row('protein-100','protein','Protein',14.2,100,['protein-line']),
      ],
      ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Provisional visual reconstruction.',
    } satisfies PackageReconstructionContent;
    const sanitized=sanitizePackageReconstruction(raw,data)!;
    expect(sanitized.content.nutritionRows.find(item=>item.rowId==='sugar-100')?.status).toBe('provisional');
    expect(sanitized.content.nutritionRows.find(item=>item.rowId==='fiber-100')?.status).toBe('provisional');
    expect(sanitized.content.nutritionRows.find(item=>item.rowId==='protein-35')?.status).toBe('provisional');
    expect(sanitized.content.nutritionRows.find(item=>item.rowId==='sugar-35')?.status).toBe('provisional');
    expect(sanitized.content.nutritionRows.find(item=>item.rowId==='fiber-35')?.status).toBe('provisional');
    expect(sanitized.content.nutritionRows.find(item=>item.rowId==='protein-100')?.status).toBe('provisional');
    expect(sanitized.content.nutritionRows.map(item=>[item.rowId,item.value,item.basisAmount])).toEqual([
      ['sugar-100',0,100],['sugar-35',3.6,35],['fiber-100',10.2,100],['fiber-35',1.5,35],['protein-35',5.7,35],['protein-100',14.2,100],
    ]);
    const fibreAnswer='The label appears to show 1.5 g of dietary fibre for a 35 g serving.';
    const fibreOutput=parseAgentProviderOutput(JSON.stringify({
      answer:fibreAnswer,
      answerParts:[{text:fibreAnswer,claimIndexes:[0]}],
      claims:[{mode:'synthesis',text:fibreAnswer,observationIds:['fibre-line'],sourceIds:[],interpretationRowIds:['fiber-35'],supportingSpans:[{kind:'observation',id:'fibre-line',quote:'Dietary Fibre 4.4g 1.5g'}]}],
      limitations:[],inspectImage:null,
    })).output;
    const fibreResult=validateClaims({...fibreOutput,packageReconstruction:sanitized.content},data);
    expect(fibreResult.answer).toBe(fibreAnswer);
    expect(fibreResult.claims.flatMap(claim=>claim.interpretationRowIds??[])).toContain('fiber-35');
    expect(fibreResult.claims.flatMap(claim=>claim.interpretationRowIds??[])).not.toContain('fiber-100');
    expect(observations.map(item=>item.text)).toEqual(['Sugar 10.2g 3.6g','Dietary Fibre 4.4g 1.5g','Protein 14.2g 5.79g']);
  });
  it('validates explicit claim links, preserves only supported answer parts, and rejects changed numeric values', async() => {
    const observation={id:'label-line',field:'label-note',text:'SERVING SIZE 2 biscuits approximately 13.4 g; carbohydrates 9.28 g per serving',side:'back' as const,confidence:82,origin:'user' as const};
    const reconstruction={
      identity:{brand:'Example Foods',name:'Biscuits',variant:null,status:'provisional' as const,evidence:{observationIds:['label-line'],imageRegions:[]}},
      serving:{printedText:'2 biscuits approximately 13.4 g',quantity:13.4,unit:'g' as const,pieceCount:2,pieceDescription:'biscuits',status:'provisional' as const,evidence:{observationIds:['label-line'],imageRegions:[]}},
      nutritionRows:[{rowId:'carbohydrates-per-serving',nutrient:'Carbohydrates',printedLabel:'Carbohydrates',printedValue:'9.28 g',value:9.28,unit:'g',columnLabel:'Per serving',basisText:'per serving (13.4 g)',basisAmount:13.4,basisUnit:'g' as const,qualifier:null,status:'provisional' as const,evidence:{observationIds:['label-line'],imageRegions:[]}}],
      ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Provisional reconstructed package reading.',revision:1,updatedAt:new Date().toISOString(),model:'fixture',current:true,
    };
    const calculation={id:'carbohydrate-serving',label:'Carbohydrates in one serving',nutrient:'carbohydrate' as const,input:9.28,inputUnit:'g',basisAmount:13.4,portion:13.4,portionUnit:'g' as const,result:9.28,unit:'g',formula:'9.28 g per serving × 1 serving',observationIds:['label-line'],interpretationIds:['carbohydrates-per-serving'],assumptions:['Provisional package interpretation.']};
    const data=assistInput.parse({consent:true,question:'What about two biscuits?',package:{id:'evidence-id-contract',name:'Biscuits',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],reconstruction:reconstruction as PackageReconstructionContent&{revision:number;updatedAt:string;model:string;current:boolean},observations:[observation],rawText:observation.text,warnings:[],synthetic:false,createdAt:new Date().toISOString()},calculations:[calculation]});
    const answer='Two biscuits (about 13.4 g) are one serving, and the reconstructed label lists 9.28 g of carbohydrates per 13.4 g serving.';
    const evidenceIds=['package-fact:serving','ROW_1','CALC_1'];
    const claimId='portion';
    const parse=(text:string)=>parseAgentProviderOutput(JSON.stringify({
      answer:text,
      answerParts:[{text,claimIds:[claimId]}],
      claims:[{claimId,mode:'synthesis',text,observationIds:[],sourceIds:[],calculationIds:[],interpretationRowIds:[],packageFactIds:[],evidenceIds,supportingSpans:[{kind:'observation',id:'label-line',quote:observation.text}]}],
      limitations:[],inspectImage:null,
    })).output;
    const aliases=new Map([['ROW_1','carbohydrates-per-serving'],['CALC_1','carbohydrate-serving']]);
    const output=replaceReferenceIds(parse(answer),aliases);
    expect(output.claims).toMatchObject([{text:answer,interpretationRowIds:['carbohydrates-per-serving'],calculationIds:['carbohydrate-serving'],packageFactIds:['package-fact:serving']}]);
    expect(output.answerParts).toEqual([{text:answer,claimIndexes:[0]}]);
    const accepted=validateClaims(output,data);
    expect(accepted.claims).toHaveLength(1);
    expect(accepted.claims[0]).toMatchObject({interpretationRowIds:['carbohydrates-per-serving'],calculationIds:['carbohydrate-serving'],packageFactIds:['package-fact:serving']});
    expect(accepted.answer).toContain('9.28 g');

    // Gemini may satisfy the typed response shape with empty arrays and also
    // include the compact evidenceIds representation. The adapter must merge
    // both instead of allowing [] to erase the valid aliases.
    const compactWithEmptyTypedArrays=parseAgentProviderOutput(JSON.stringify({
      answer,
      answerParts:[{text:answer,claimIndexes:[0]}],
      claims:[{mode:'synthesis',text:answer,observationIds:[],sourceIds:[],calculationIds:[],interpretationRowIds:[],packageFactIds:[],profileFieldIds:[],evidenceIds}],
      limitations:[],inspectImage:null,
    })).output;
    const mergedReferences=replaceReferenceIds(compactWithEmptyTypedArrays,aliases);
    expect(mergedReferences.claims[0]).toMatchObject({
      interpretationRowIds:['carbohydrates-per-serving'],calculationIds:['carbohydrate-serving'],packageFactIds:['package-fact:serving'],
    });
    expect(validateClaims(mergedReferences,data).answer).toContain('9.28 g');

    const wrongOutput=replaceReferenceIds(parse(answer.replace('9.28 g','19.28 g')),aliases);
    const decisions:Array<{stage:string;decision:string;reason?:string}>=[];
    const rejected=validateClaims(wrongOutput,data,event=>decisions.push(event));
    expect(rejected.claims).toEqual([]);
    expect(rejected.answer).not.toContain('19.28 g');
    expect(decisions).toContainEqual(expect.objectContaining({stage:'claim',decision:'rejected',reason:'unsupported-numeric-value'}));

    const supportedPart='The label appears to list 9.28 g of carbohydrates per serving.';
    const unsupportedPart='WHO recommends an individualized carbohydrate limit for this snack.';
    const mixedAnswer=`${supportedPart} ${unsupportedPart}`;
    const segmented=replaceReferenceIds(parseAgentProviderOutput(JSON.stringify({
      answer:mixedAnswer,
      answerParts:[{text:supportedPart,claimIndexes:[0]},{text:unsupportedPart,claimIndexes:[1]}],
      claims:[
        {mode:'synthesis',text:supportedPart,observationIds:[],sourceIds:[],calculationIds:[],interpretationRowIds:[],packageFactIds:[],evidenceIds:['package-fact:serving','ROW_1','CALC_1'],supportingSpans:[{kind:'observation',id:'label-line',quote:observation.text}]},
        {mode:'synthesis',text:unsupportedPart,observationIds:[],sourceIds:[],calculationIds:[],interpretationRowIds:[],packageFactIds:[],supportingSpans:[]},
      ],limitations:[],inspectImage:null,
    })).output,aliases);
    expect(segmented.claims).toHaveLength(2);
    const segmentedResult=validateClaims(segmented,data);
    expect(segmentedResult.answer).toBe(supportedPart);
    expect(segmentedResult.answer).not.toContain('WHO recommends');

    const packageAnswerParts=[
      'The package displays Sugar Free.',
      'The first ingredient is refined wheat flour, with a printed percentage of 89.98%.',
      'The table lists 9.28 g of carbohydrates per 13.4 g serving.',
    ];
    const evidenceLinkedAnswer=packageAnswerParts.join(' ');
    const packageWithFlour={...reconstruction,ingredients:[{position:0,name:'Refined wheat flour',printedText:'REFINED WHEAT FLOUR (MAIDA)',printedPercentage:89.98,normalizedName:'refined wheat flour',status:'provisional' as const,evidence:{observationIds:['label-line'],imageRegions:[]}}],statements:[{kind:'claim' as const,label:'Sugar Free',text:'SUGAR FREE - FREE OF SUGAR, FULL OF TASTE',status:'provisional' as const,evidence:{observationIds:['label-line'],imageRegions:[]}}]};
    const reconstructedData=assistInput.parse({...data,package:{...data.package,reconstruction:packageWithFlour as PackageReconstructionContent&{revision:number;updatedAt:string;model:string;current:boolean}}});
    const compactParsed=replaceReferenceIds(parseAgentProviderOutput(JSON.stringify({
      answer:evidenceLinkedAnswer,
      answerParts:packageAnswerParts.map((text,index)=>({text,claimIndexes:[index]})),
      claims:[
        {mode:'synthesis',text:packageAnswerParts[0],observationIds:[],sourceIds:[],evidenceIds:['package-fact:statement:0'],supportingSpans:[]},
        {mode:'synthesis',text:packageAnswerParts[1],observationIds:[],sourceIds:[],evidenceIds:['package-fact:ingredient:0'],supportingSpans:[]},
        {mode:'synthesis',text:packageAnswerParts[2],observationIds:[],sourceIds:[],evidenceIds:['ROW_1','CALC_1','package-fact:serving'],supportingSpans:[{kind:'observation',id:'label-line',quote:observation.text}]},
      ],limitations:[],inspectImage:null,
    })).output,new Map([['ROW_1','carbohydrates-per-serving'],['CALC_1','carbohydrate-serving']]));
    const compactResult=validateClaims(compactParsed,reconstructedData);
    expect(compactParsed.claims).toHaveLength(3);
    expect(compactResult.claims.map(claim=>claim.text)).toEqual([
      ...packageAnswerParts,
    ]);
    expect(compactResult.answer).toBe(evidenceLinkedAnswer);
    expect(compactResult.answer).toContain('89.98%');
    expect(compactResult.answer).toContain('9.28 g');

    vi.stubEnv('ENABLE_GEMINI','true');vi.stubEnv('GEMINI_PROVIDER','free');vi.stubEnv('GEMINI_MODEL','gemini-3.8-flash');vi.stubEnv('FREE_GEMINI_API_KEY','offline-test-key');
    const fetcher=vi.fn().mockResolvedValue(new Response(modelResponse([{text:evidenceLinkedAnswer}]),{status:200,headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetcher);
    const livePath=await assist(reconstructedData);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(livePath).toMatchObject({status:'ok',answer:evidenceLinkedAnswer,agentDiagnostics:{answerStatus:'answer-ready',acceptedSentences:3}});
  });
  it('links natural serving-basis wording to exact rows and preserves the answer over an unrelated table fallback',()=>{
    const who=getNutritionGuidance({query:'naturally occurring dietary fibre carbohydrate quality WHO',jurisdiction:'India',maxResults:8}).find(item=>item.id==='who-carbohydrate-2023')!;
    expect(who).toBeDefined();
    const observations=[
      {id:'serving-line',field:'label-note',text:'Serving size 35 g',side:'back' as const,confidence:94,origin:'ocr' as const},
      {id:'carbohydrate-line',field:'label-note',text:'Carbohydrate 23.1 g',side:'back' as const,confidence:92,origin:'ocr' as const},
      {id:'fibre-line',field:'label-note',text:'Dietary Fibre 1.5 g',side:'back' as const,confidence:93,origin:'ocr' as const},
      {id:'protein-line',field:'label-note',text:'Protein 14.2 g 5.0 g',side:'back' as const,confidence:91,origin:'ocr' as const},
    ];
    const reconstruction={
      identity:{brand:null,name:'Unidentified food package',variant:null,status:'unreadable' as const,evidence:{observationIds:[],imageRegions:[]}},
      serving:{printedText:'Serving size 35 g',quantity:35,unit:'g' as const,pieceCount:null,pieceDescription:null,status:'provisional' as const,evidence:{observationIds:['serving-line'],imageRegions:[]}},
      nutritionRows:[
        {rowId:'carbohydrate-35g',nutrient:'carbohydrate',printedLabel:'Carbohydrate',printedValue:'23.1 g',value:23.1,unit:'g',columnLabel:'Per 35 g serving',basisText:'Per 35 g serving',basisAmount:35,basisUnit:'g' as const,qualifier:null,status:'provisional' as const,evidence:{observationIds:['carbohydrate-line'],imageRegions:[]}},
        {rowId:'fibre-35g',nutrient:'dietary_fibre',printedLabel:'Dietary Fibre',printedValue:'1.5 g',value:1.5,unit:'g',columnLabel:'Per 35 g serving',basisText:'Per 35 g serving',basisAmount:35,basisUnit:'g' as const,qualifier:null,status:'provisional' as const,evidence:{observationIds:['fibre-line'],imageRegions:[]}},
        {rowId:'protein-35g',nutrient:'protein',printedLabel:'Protein',printedValue:'5.7 g',value:5.7,unit:'g',columnLabel:'Per 35 g serving',basisText:'Per 35 g serving',basisAmount:35,basisUnit:'g' as const,qualifier:null,status:'provisional' as const,evidence:{observationIds:['protein-line'],imageRegions:[]}},
      ],
      ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Provisional package reconstruction.',revision:1,updatedAt:new Date().toISOString(),model:'fixture',current:true,
    } satisfies PackageReconstructionContent&{revision:number;updatedAt:string;model:string;current:boolean};
    const data=assistInput.parse({consent:true,question:'What does the 35 g serving provide for carbohydrate and dietary fibre, and what does WHO say about dietary fibre?',evidence:[who],package:{id:'serving-wording-adapter',name:'Unidentified food package',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],reconstruction,observations,rawText:observations.map(item=>item.text).join('\n'),warnings:[],synthetic:false,createdAt:new Date().toISOString()}});
    const labelFinding='For the 35 g serving, the label appears to provide 23.1 g of carbohydrate and 1.5 g of dietary fibre.';
    const guidanceFinding='WHO guidance provides reference intake information for dietary fibre.';
    const answer=`${labelFinding} ${guidanceFinding}`;
    const parsed=parseAgentProviderOutput(JSON.stringify({
      answer,
      answerParts:[{text:labelFinding,claimIndexes:[0]},{text:guidanceFinding,claimIndexes:[1]}],
      claims:[
        {mode:'synthesis',text:labelFinding,observationIds:['serving-line','carbohydrate-line','fibre-line'],sourceIds:[],interpretationRowIds:['carbohydrate-35g','fibre-35g'],supportingSpans:[
          {kind:'observation',id:'serving-line',quote:'Serving size 35 g'},
          {kind:'observation',id:'carbohydrate-line',quote:'Carbohydrate 23.1 g'},
          {kind:'observation',id:'fibre-line',quote:'Dietary Fibre 1.5 g'},
        ]},
        {mode:'synthesis',text:guidanceFinding,observationIds:[],sourceIds:[who.id],supportingSpans:[{kind:'source',id:who.id,quote:who.summary.slice(0,120)}]},
      ],limitations:[],inspectImage:null,
    }));
    const decisions:Array<{stage:string;decision:string;reason?:string}>=[];
    const result=validateClaims(parsed.output,data,event=>decisions.push(event));
    expect(result.answer).toBe(answer);
    expect(result.claims.map(claim=>claim.text)).toEqual(parsed.output.claims.map(claim=>claim.text));
    expect(result.claims.find(claim=>claim.text.includes('23.1 g'))?.interpretationRowIds).toContain('carbohydrate-35g');
    expect(result.claims.find(claim=>claim.text.includes('1.5 g'))?.interpretationRowIds).toContain('fibre-35g');
    expect(result.claims.find(claim=>claim.text.includes('WHO'))?.sourceIds).toContain(who.id);
    expect(result.answer).not.toContain('Protein 5.7 g');
    expect(decisions).not.toContainEqual(expect.objectContaining({stage:'structured-answer',decision:'accepted'}));
  });
  it('classifies a Gemini rejection without retaining provider error text', () => {
    const error = Object.assign(new Error('got status: INVALID_ARGUMENT. {"error":{"code":400,"status":"INVALID_ARGUMENT","message":"Invalid value at \'generationConfig.responseJsonSchema.properties.secret\': PRIVATE PACKAGE TEXT"}}'), { status: 400 });
    const safe = safeProviderFailure(error);
    expect(safe).toMatchObject({ status: 400, failureClass: 'request-rejected', providerStatus: 'INVALID_ARGUMENT', providerReasonClass: 'response-schema', providerFieldPath: 'generationConfig.responseJsonSchema.properties.secret' });
    expect(JSON.stringify(safe)).not.toContain('PRIVATE PACKAGE TEXT');
  });
  it('keeps supported natural prose and withholds only the unsupported numeric sentence', async () => {
    vi.stubEnv('ENABLE_GEMINI', 'true'); vi.stubEnv('GEMINI_PROVIDER', 'free'); vi.stubEnv('GEMINI_MODEL', 'gemini-3.8-flash'); vi.stubEnv('FREE_GEMINI_API_KEY', 'offline-test-key');
    const answer='The package lists 3 g of protein per 100 g. Sodium is 900 mg per 100 g.';
    const reconstruction={identity:{brand:null,name:'Example food',variant:null,status:'provisional' as const,evidence:{observationIds:['protein-observation'],imageRegions:[]}},serving:null,nutritionRows:[{rowId:'protein-100g',nutrient:'protein',printedLabel:'Protein',printedValue:'3 g',value:3,unit:'g',columnLabel:'Per 100 g',basisText:'per 100 g',basisAmount:100,basisUnit:'g' as const,qualifier:null,status:'provisional' as const,evidence:{observationIds:['protein-observation'],imageRegions:[]}}],ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Saved image-linked reading.',revision:1,updatedAt:new Date().toISOString(),model:'fixture',current:true};
    const fetcher = vi.fn().mockResolvedValue(new Response(modelResponse([{text:answer}]), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    const data = assistInput.parse({ consent: true, question: 'What does this package show?', package: { id: 'package-1', name: 'Example food', ingredients: [], additives: [], allergens: [], claims: [], nutrients: [], reconstruction, observations: [{ id: 'protein-observation', field: 'protein', text: 'Protein 3 g per 100 g', side: 'text', confidence: 100, origin: 'ocr' }], rawText: 'Protein 3 g per 100 g', warnings: [], synthetic: true, createdAt: new Date().toISOString() } });

    const result = await assist(data);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({status:'ok',answerStatus:'answer-with-quantity-withheld',agentDiagnostics:{acceptedSentences:1,withheldQuantitySentences:1}});
    expect(result.answer).toContain('3 g of protein per 100 g');
    expect(result.answer).not.toContain('900 mg');
  });
  it('keeps paid application and free synthetic-smoke calls single-attempt', async () => {
    vi.stubEnv('ENABLE_GEMINI', 'true'); vi.stubEnv('GEMINI_PROVIDER', 'paid'); vi.stubEnv('GEMINI_MODEL', 'gemini-3.8-flash'); vi.stubEnv('GEMINI_API_KEY', 'offline-paid-test-key'); vi.stubEnv('ENABLE_PAID_GEMINI', 'true'); vi.stubEnv('GEMINI_FREE_PROJECT_ID', 'free-project'); vi.stubEnv('GEMINI_PAID_PROJECT_ID', 'paid-project');
    vi.stubEnv('GEMINI_PAID_BUDGET_USD', '1'); vi.stubEnv('GEMINI_PAID_MAX_CALLS', '1'); vi.stubEnv('GEMINI_PAID_MAX_INPUT_TOKENS', '1000'); vi.stubEnv('GEMINI_PAID_MAX_OUTPUT_TOKENS', '100'); vi.stubEnv('GEMINI_PAID_INPUT_USD_PER_MILLION', '1'); vi.stubEnv('GEMINI_PAID_OUTPUT_USD_PER_MILLION', '1');
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 503, message: 'temporarily unavailable', status: 'UNAVAILABLE' } }), { status: 503, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    const paid = applicationGeminiContext();
    await expect(paid.client.models.generateContent({ model: paid.model, contents: 'offline paid-policy probe' })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);

    vi.stubEnv('FREE_GEMINI_API_KEY', 'offline-test-key');
    const smoke = freeTierSyntheticSmokeContext('gemini-3.8-flash');
    await expect(smoke.client.models.generateContent({ model: smoke.model, contents: 'offline smoke-policy probe' })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('withholds forged claims and unknown browser image handles without fabricating an answer from claim records', () => {
    const data = assistInput.parse({ consent: true, question: 'What is visible?', package: { id: 'test', name: 'Test', userDescription: 'User says it is a cereal snack.', ingredients: [], additives: [], allergens: [], claims: [], nutrients: [], observations: [{ id: 'o1', field: 'sugar', text: 'sugar 3g', side: 'text', confidence: null, origin: 'user' }, { id: 'o2', field: 'user-description', text: 'User says it is a cereal snack.', side: 'text', confidence: null, origin: 'user' }], rawText: '', warnings: [], synthetic: true, createdAt: new Date().toISOString() } });
    expect(data.package.userDescription).toBe('User says it is a cereal snack.');
    const valid = { answer: 'Unsupported extra medical assertion', answerParts:[], claims: [{ mode:'direct-quote',text: 'sugar 3g', observationIds: ['o1'], sourceIds: [], supportingSpans: [{ kind: 'observation', id: 'o1', quote: 'sugar 3g' }] }], limitations: [], inspectImage: null };
    expect(validateClaims(valid, data).claims).toHaveLength(1);
    expect(validateClaims(valid, data).answer).toContain('could not safely assemble it into a clear answer');
    expect(validateClaims(valid, data).answer).not.toContain('medical assertion');
    expect(validateClaims(valid, data).answer).not.toContain('diabetes');
    expect(validateClaims(valid, data).limitations).toEqual([]);
    const forgedOnly = validateClaims({ ...valid, claims: [{ mode:'direct-quote',text: 'Claim', observationIds: ['missing'], sourceIds: [], supportingSpans: [{ kind: 'observation', id: 'missing', quote: 'Claim' }] }] }, data);
    expect(forgedOnly.claims).toEqual([]);
    expect(forgedOnly.answer).toContain('can’t establish a reliable answer');
    expect(validateClaims({ ...valid, inspectImage: { handle: 'not-owned', reason: 'Read label' } }, data).inspectImage).toBeNull();
    const visualClaim = { answer: '', claims: [{ mode: 'synthesis', text: 'The image may show sugar 3 g.', observationIds: [], sourceIds: [], supportingSpans: [], visualEvidence: [{ imageId: 'package-photo', visibleText: 'Sugar 3g', region: null }] }], limitations: [], inspectImage: null };
    const imageMetadataOnly = assistInput.parse({ ...data, images: [{ handle: 'package-photo', side: 'back', width: 100, height: 100 }] });
    expect(validateClaims(visualClaim, imageMetadataOnly).claims).toEqual([]);
    const imageAttached = assistInput.parse({ ...data, images: [{ handle: 'package-photo', side: 'back', width: 100, height: 100 }], visualImages: [{ imageId: 'package-photo', mimeType: 'image/jpeg', base64: 'YWJjZGVmZ2hpamtsbW5vcA==', side: 'back', sourceImage: { width: 100, height: 100 }, preprocessing: { rotation: 0, contrast: false, invert: false, crop: null } }] });
    const withheldNumericVisualClaim = validateClaims(visualClaim, imageAttached);
    expect(withheldNumericVisualClaim.claims).toEqual([]);
    expect(withheldNumericVisualClaim.answer).not.toContain('3 g');
    const nonnumericVisualClaim = { ...visualClaim, claims: [{ ...visualClaim.claims[0], text: 'The image may show a nutrition panel.', visualEvidence: [{ imageId: 'package-photo', visibleText: 'NUTRITIONAL INFORMATION', region: null }] }] };
    expect(validateClaims(nonnumericVisualClaim, imageAttached).claims).toHaveLength(1);
  });
  it('withholds an unsupported numeric value even when a related package field is cited', () => {
    const data = assistInput.parse({ consent: true, question: 'Is this safe for diabetes?', package: { id: 'test', name: 'Test', ingredients: [], additives: [], allergens: [], claims: [], nutrients: [], observations: [{ id: 'sugar-observation', field: 'sugar', text: 'sugar 3g', side: 'text', confidence: null, origin: 'ocr' }], rawText: '', warnings: [], synthetic: false, createdAt: new Date().toISOString() } });
    const answer='This package lists 30 g of sugar.';
    const output = { answer, answerParts:[{text:answer,claimIndexes:[0]}], claims: [{ mode:'synthesis',text: answer, observationIds: ['sugar-observation'], sourceIds: [], supportingSpans: [{ kind: 'observation', id: 'sugar-observation', quote: 'sugar 3g' }] }], limitations: [], inspectImage: null };
    const result = validateClaims(output, data);
    expect(result.claims).toEqual([]);
    expect(result.answer).not.toContain('30 g');
    expect(result.answer).toContain('can’t establish a reliable answer');
  });
  it('withholds a claim when its quoted span does not occur in the cited item', () => {
    const data = assistInput.parse({ consent: true, question: 'What does it say?', package: { id: 'test', name: 'Test', ingredients: [], additives: [], allergens: [], claims: [], nutrients: [], observations: [{ id: 'o1', field: 'sugar', text: 'sugar 3g', side: 'text', confidence: null, origin: 'ocr' }], rawText: '', warnings: [], synthetic: false, createdAt: new Date().toISOString() } });
    const output = { answer: 'Added sugar is 0g.', claims: [{ mode:'direct-quote',text: 'added sugar 0g', observationIds: ['o1'], sourceIds: [], supportingSpans: [{ kind: 'observation', id: 'o1', quote: 'added sugar 0g' }] }], limitations: [], inspectImage: null };
    const result = validateClaims(output, data);
    expect(result.claims).toEqual([]);
    expect(result.answer).not.toContain('added sugar 0g');
  });
  it('rejects spoofed MIME and malformed image bytes before transmitting', async () => {
    const provenance={imageId:'package-photo-1',sourceImage:{width:1,height:1},preprocessing:{rotation:0 as const,contrast:false,invert:false,crop:null}};
    await expect(validateImage({ ...provenance,mimeType: 'image/png', base64: Buffer.from('not an image bytes').toString('base64'), side: 'back' })).rejects.toMatchObject({ code: 'invalid_image' });
    await expect(validateImage({ ...provenance,mimeType: 'image/jpeg', base64: Buffer.from([255, 216, 255, 1, 2, 3]).toString('base64'), side: 'front' })).rejects.toMatchObject({ code: 'invalid_image' });
  });
  it('upscales only focused crops for visual inspection while preserving full-photo dimensions',async()=>{
    const png=await sharp({create:{width:320,height:180,channels:3,background:'#c54'}}).png().toBuffer();
    const base={imageId:'small-region',mimeType:'image/png' as const,base64:png.toString('base64'),side:'back' as const,sourceImage:{width:900,height:363},preprocessing:{rotation:0 as const,contrast:false,invert:false,crop:null as null|{x:number;y:number;width:number;height:number}}};
    const full=Buffer.from(await validateImage(base),'base64');
    const fullMetadata=await sharp(full).metadata();
    expect(fullMetadata.width).toBe(320);
    expect(fullMetadata.height).toBe(180);
    const crop=Buffer.from(await validateImage({...base,preprocessing:{...base.preprocessing,crop:{x:0.1,y:0.1,width:0.5,height:0.5}}}),'base64');
    const cropMetadata=await sharp(crop).metadata();
    expect(cropMetadata.width).toBe(640);
    expect(cropMetadata.height).toBe(360);
  });
});
