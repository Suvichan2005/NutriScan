import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, fixedFetch, input, localGate, readBounded, route } from './http';
import { lookupProducts, normalizeProduct, productInput } from './products';
import { assist, assistInput, assistOutput, assistPromptPayload, canAcceptPackageAnswerSynthesis, geminiResponseJsonSchema, linkVisionResponseToCapture, needsPackageAnswerSynthesis, packageAnswerCoverage, packageAnswerSynthesisImprovesCoverage, parseAgentProviderOutput, providerAssistOutput, providerStatus, replaceReferenceIds, sanitizePackageReconstruction, shouldRetrieveContextualNutritionGuidance, validateClaims, validateImage, vision, visionInput } from './gemini';
import { applicationGeminiContext, committedPaidSpendUsd, countGoogleSearchQueries, freeTierSyntheticSmokeContext, resetGeminiUsageLedgerForTests, safeProviderFailure } from './gemini-provider';
import { research, researchInput, researchRecalls } from './research';
import { getNutritionGuidance } from './nutrition-guidance';
import { packageSchema, type PackageReconstructionContent } from '../contracts';
import { packageForAssist } from '../../modules/inference';
import sharp from 'sharp';
import { z } from 'zod';

beforeEach(() => { resetGeminiUsageLedgerForTests(); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const request = (body: unknown, origin = 'http://127.0.0.1:3400') => new Request('http://127.0.0.1:3400/api/test', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const visionTestImage={imageId:'package-photo-1',mimeType:'image/png' as const,base64:'a'.repeat(20),side:'back' as const,sourceImage:{width:1600,height:2400},preprocessing:{rotation:90 as const,contrast:true,invert:false,crop:{x:0.1,y:0.15,width:0.8,height:0.7}}};

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
    expect(providerAssistOutput.safeParse({ answer: '', claims: [], limitations: [], inspectImage: null }).success).toBe(true);
    expect((schema as { required?: string[] }).required).toContain('answer');
    expect((schema as { properties?: Record<string, unknown> }).properties).toHaveProperty('tentativeCandidates');
  });
  it('keeps complete OCR text and compact normalized geometry without replaying parser diagnostics',()=>{
    const data=assistInput.parse({consent:true,question:'Reconstruct this label',package:{id:'compact-label',name:'Unidentified package',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],observations:[{id:'line-1',field:'ocr-line',text:'CARBOHYDRATES 6329g 928g',side:'back',confidence:91,origin:'ocr',imageId:'back-1',readingOrder:{runId:'ocr-run',blockIndex:0,paragraphIndex:0,lineIndex:1},bbox:{x0:10,y0:20,x1:300,y1:60},ocrWords:[{wordIndex:0,text:'CARBOHYDRATES',confidence:94,bbox:{x0:10,y0:22,x1:120,y1:58}},{wordIndex:1,text:'6329g',confidence:68,bbox:{x0:180,y0:20,x1:220,y1:60}}]}],ocrCaptures:[{runId:'ocr-run',imageId:'back-1',side:'back',sourceImage:{width:900,height:363},preparedImage:{width:900,height:363},bboxCoordinateSpace:'prepared-image-pixels',engine:{name:'Tesseract',version:'7.0',language:'eng',confidenceScale:'0-100',segmentationMode:'auto'},processing:{rotation:0,contrast:false,invert:false,cropPercent:null}}],parserDiagnostics:[{field:'carbohydrate',decision:'conflict',reasonCodes:['cross-reading-conflict'],sourceObservationIds:['line-1'],numericCandidates:[],basisCandidates:[]}],rawText:'CARBOHYDRATES 6329g 928g',warnings:['A parser warning that belongs in local diagnostics.'],synthetic:false,createdAt:new Date().toISOString()}});
    const prompt=assistPromptPayload(data) as {package:Record<string,unknown>;visualImages?:unknown};
    const encoded=JSON.stringify(prompt);
    expect(prompt.package).not.toHaveProperty('parserDiagnostics');
    expect(prompt.package).not.toHaveProperty('rawText');
    expect(encoded).toContain('CARBOHYDRATES 6329g 928g');
    expect(encoded).toContain('[0.011,0.055,0.333,0.165]');
    expect(encoded).toContain('[1,"6329g",68,[0.2,0.055,0.244,0.165]]');
    expect(JSON.stringify(data).length).toBeGreaterThan(encoded.length*2);
    expect(prompt.visualImages).toBeUndefined();
  });
  it('compacts a saved-package follow-up while preserving the full stored object and an ingredient-list path',()=>{
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
    expect(compactPackage.reconstruction.nutritionRows.length).toBeLessThan(rows.length);
    expect(compactPackage.reconstruction.ingredients).toHaveLength(3);
    expect(compactPackage.reconstruction.regions).toEqual([]);
    expect(compactPackage.observations).toEqual([]);
    expect(prompt.packageFacts.map(fact=>fact.id)).toContain('package-fact:serving');
    expect(prompt.packageFacts.map(fact=>fact.id)).toContain('package-fact:ingredient:0');
    expect(prompt.packageFacts.map(fact=>fact.id)).not.toContain('package-fact:additive:0');
    expect(serialized.length).toBeLessThan(JSON.stringify(followup).length*0.5);
    // Compaction affects only provider context: the exact saved object still
    // retains every ingredient, additive, OCR observation, and image region.
    expect(followup.package.reconstruction?.ingredients).toHaveLength(13);
    expect(followup.package.reconstruction?.additives).toHaveLength(9);
    expect(followup.package.observations).toHaveLength(18);
    const ingredientQuestion=assistInput.parse({...followup,question:'Please list all ingredients and additives.'});
    const ingredientPrompt=assistPromptPayload(ingredientQuestion) as {package:Record<string,unknown>;packageFacts:{id:string}[]};
    expect((ingredientPrompt.package.reconstruction as {ingredients:unknown[]}).ingredients).toHaveLength(13);
    expect(ingredientPrompt.packageFacts.map(fact=>fact.id)).toContain('package-fact:ingredient:12');
    expect(ingredientPrompt.packageFacts.map(fact=>fact.id)).toContain('package-fact:additive:8');
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
  it('sends Gemini structured output through the supported generateContent config and validates the returned answer', async () => {
    vi.stubEnv('ENABLE_GEMINI', 'true'); vi.stubEnv('GEMINI_PROVIDER', 'free'); vi.stubEnv('GEMINI_MODEL', 'gemini-3.8-flash'); vi.stubEnv('FREE_GEMINI_API_KEY', 'offline-test-key');
    const resultText = JSON.stringify({ answer: 'BISK FARM CREAM CRACKER', answerParts: [{ text: 'BISK FARM CREAM CRACKER', claimIndexes: [0] }], claims: [{ mode: 'direct-quote', text: 'BISK FARM CREAM CRACKER', observationIds: ['input-1'], sourceIds: [], supportingSpans: [{ kind: 'observation', id: 'input-1', quote: 'BISK FARM CREAM CRACKER' }] }], packageReconstruction:{identity:{brand:'BISK FARM',name:'Cream Cracker',variant:null,status:'provisional',evidence:{observationIds:['input-1'],imageRegions:[]}},serving:null,nutritionRows:[],ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'An initial package reconstruction from supplied label evidence.'},limitations:[],inspectImage:null });
    const payload = JSON.stringify({ candidates: [{ content: { parts: [{ text: resultText }], role: 'model' }, finishReason: 'STOP', index: 0 }], modelVersion: 'gemini-3.8-flash-test', usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 20, totalTokenCount: 32 } });
    const fetcher = vi.fn().mockImplementation(() => new Response(payload, { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    const data = assistInput.parse({ consent: true, question: 'What product is this?', package: { id: 'package-1', name: 'Unidentified package', ingredients: [], additives: [], allergens: [], claims: [], nutrients: [], observations: [{ id: 'input-1', field: 'user-description', text: 'BISK FARM CREAM CRACKER', side: 'text', confidence: null, origin: 'user' }], rawText: 'BISK FARM CREAM CRACKER', warnings: [], synthetic: false, createdAt: new Date().toISOString() } });

    await expect(assist(data)).resolves.toMatchObject({ status: 'ok', answer: 'BISK FARM CREAM CRACKER' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const investigationRequest = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(investigationRequest.generationConfig).toMatchObject({ responseMimeType: 'application/json' });
    expect(investigationRequest.generationConfig).not.toHaveProperty('responseJsonSchema');
    expect(investigationRequest.generationConfig).not.toHaveProperty('responseFormat');
    expect(JSON.stringify(investigationRequest)).toContain('each printed numeric cell as its own nutritionRows entry');
    expect(JSON.stringify(investigationRequest)).toContain('never combine labels such as “per 100 g and per serving” into one row');
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
    const output={answer:ingredient,answerParts:[{text:ingredient,claimIndexes:[0]}],claims:[{mode:'synthesis',text:ingredient,observationIds:[],sourceIds:[],interpretationRowIds:['carbohydrate-per-100g'],packageFactIds:['package-fact:ingredient:0']}],packageReconstruction,limitations:[],inspectImage:null};
    const payload=JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(output)}],role:'model'},finishReason:'STOP',index:0}],modelVersion:'gemini-3.8-flash-test',usageMetadata:{promptTokenCount:40,candidatesTokenCount:90,totalTokenCount:130}});
    const fetcher=vi.fn().mockResolvedValue(new Response(payload,{status:200,headers:{'content-type':'application/json'}}));vi.stubGlobal('fetch',fetcher);
    const data=assistInput.parse({consent:true,question:'What does this packet show?',package:{id:'reconstruction-contract-test',name:'Unidentified package',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],observations:[],rawText:'',warnings:[],synthetic:false,createdAt:new Date().toISOString()},images:[{handle:imageId,side:'back',width:8,height:8,role:'unknown'}],visualImages:[{imageId,mimeType:'image/png',base64:image.toString('base64'),side:'back',sourceImage:{width:8,height:8},preprocessing:{rotation:0,contrast:false,invert:false,crop:null}}]});

    const result=await assist(data);
    expect(result.answer).toBe(ingredient);
    expect(result.claims).toMatchObject([{packageFactIds:['package-fact:ingredient:0'],interpretationRowIds:['carbohydrate-per-100g']}]);
    expect((result as unknown as {packageReconstruction:unknown}).packageReconstruction).toMatchObject({ingredients:[{name:'Refined wheat flour',status:'provisional',evidence:{imageRegions:[{imageId,region:null}]}}],nutritionRows:[{rowId:'carbohydrate-per-100g',status:'provisional',evidence:{imageRegions:[{imageId,region:null}]}}]});
  });
  it('returns cited local guidance evidence to the conversation UI', async () => {
    vi.stubEnv('ENABLE_GEMINI', 'true'); vi.stubEnv('GEMINI_PROVIDER', 'free'); vi.stubEnv('GEMINI_MODEL', 'gemini-3.8-flash'); vi.stubEnv('FREE_GEMINI_API_KEY', 'offline-test-key');
    const question = 'Is this good to have for diabetic patients daily for snacking?';
    const source = getNutritionGuidance({ query: question, jurisdiction: 'India', maxResults: 3 }).find(item => item.id === 'idf-healthy-nutrition-diabetes-2024');
    expect(source).toBeDefined();
    const answer = 'IDF patient education says refined carbohydrates can raise blood glucose more quickly than high-fibre choices, and that snack choices should be individualized.';
    const reconstruction = { identity: { brand: null, name: 'Unidentified package', variant: null, status: 'unreadable', evidence: { observationIds: [], imageRegions: [] } }, serving: null, nutritionRows: [], ingredients: [], additives: [], statements: [], regions: [], unresolved: [], interpretationNote: '' };
    const output = { answer, answerParts: [{ text: answer, claimIndexes: [0] }], claims: [{ mode: 'synthesis', text: answer, observationIds: [], sourceIds: [source!.id], calculationIds: [], interpretationRowIds: [], profileFieldIds: [], supportingSpans: [{ kind: 'source', id: source!.id, quote: source!.summary.slice(0, 90) }], visualEvidence: [] }], uiComponents: [{ type: 'source-reference-cards', observationIds: [], sourceIds: [source!.id], calculationIds: [] }], limitations: [], inspectImage: null, packageReconstruction: reconstruction };
    const payload = JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(output) }], role: 'model' }, finishReason: 'STOP', index: 0 }], modelVersion: 'gemini-3.8-flash-test', usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 90, totalTokenCount: 130 } });
    const fetcher = vi.fn().mockResolvedValue(new Response(payload, { status: 200, headers: { 'content-type': 'application/json' } })); vi.stubGlobal('fetch', fetcher);
    const data = assistInput.parse({ consent: true, question, package: { id: 'guidance-ui-test', name: 'Unidentified food package', ingredients: [], additives: [], allergens: [], claims: [], nutrients: [], observations: [], rawText: '', warnings: [], synthetic: false, createdAt: new Date().toISOString() } });

    const result = await assist(data);
    expect(String(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).contents[0].parts[0].text)).toContain(source!.title);
    expect(result.agentEvidence).toMatchObject([{ id: source!.id, publisher: 'International Diabetes Federation', jurisdiction: 'Global' }]);
    expect(result.uiComponents).toContainEqual({ type: 'source-reference-cards', observationIds: [], sourceIds: [source!.id], calculationIds: [] });
  });
  it('uses a declared profile and structured package context for local guidance without inferring it from an unrelated query', async () => {
    vi.stubEnv('ENABLE_GEMINI', 'true'); vi.stubEnv('GEMINI_PROVIDER', 'free'); vi.stubEnv('GEMINI_MODEL', 'gemini-3.8-flash'); vi.stubEnv('FREE_GEMINI_API_KEY', 'offline-test-key');
    const question = 'Would this fit my goals as a regular snack?';
    const profile = { dietaryPattern:'', avoidedIngredients:'', allergies:'', intolerances:'', healthConsiderations:'Type 2 diabetes', goals:'Manage blood glucose with my care team', portionPreferences:'', ageGroup:'', sexOrReferenceGroup:'', country:'India', locality:'' };
    const packageData = { id:'profile-context-rag', name:'Unidentified package', ingredients:['Refined wheat flour (maida)'], additives:[], allergens:[], claims:['Sugar free'], nutrients:[], observations:[], rawText:'', warnings:[], synthetic:false, createdAt:new Date().toISOString() };
    expect(shouldRetrieveContextualNutritionGuidance(question,'India','Type 2 diabetes Refined wheat flour')).toBe(true);
    expect(shouldRetrieveContextualNutritionGuidance('How much protein is printed per 100 g?','India','Type 2 diabetes')).toBe(false);
    const searchText = `${question} ${profile.healthConsiderations} ${profile.goals} ${packageData.ingredients.join(' ')}`;
    const source = getNutritionGuidance({ query:searchText, jurisdiction:'India', maxResults:3 }).find(item => item.id === 'idf-healthy-nutrition-diabetes-2024');
    expect(source).toBeDefined();
    const answer = 'IDF patient education says refined carbohydrate choices can raise blood glucose more quickly than high-fibre choices, and that snack choices should be individualized.';
    const output = {
      answer,
      answerParts:[{text:answer,claimIndexes:[0]}],
      claims:[{mode:'synthesis',text:answer,observationIds:[],sourceIds:[source!.id],calculationIds:[],interpretationRowIds:[],profileFieldIds:[],supportingSpans:[{kind:'source',id:source!.id,quote:source!.summary.slice(0,100)}],visualEvidence:[]}],
      uiComponents:[{type:'source-reference-cards',observationIds:[],sourceIds:[source!.id],calculationIds:[]}],
      limitations:[],inspectImage:null,
      packageReconstruction:{identity:{brand:null,name:'Unidentified package',variant:null,status:'unreadable',evidence:{observationIds:[],imageRegions:[]}},serving:null,nutritionRows:[],ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:''},
    };
    const payload=JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(output)}],role:'model'},finishReason:'STOP',index:0}],modelVersion:'gemini-3.8-flash-test',usageMetadata:{promptTokenCount:50,candidatesTokenCount:100,totalTokenCount:150}});
    const fetcher=vi.fn().mockResolvedValue(new Response(payload,{status:200,headers:{'content-type':'application/json'}})); vi.stubGlobal('fetch',fetcher);
    const result=await assist(assistInput.parse({consent:true,question,profile,package:packageData}));
    const requestBody=JSON.stringify(JSON.parse(String(fetcher.mock.calls[0][1]?.body)));
    expect(requestBody).toContain(source!.title);
    expect(result.agentEvidence).toMatchObject([{id:source!.id,publisher:'International Diabetes Federation',jurisdiction:'Global'}]);
    expect(result.uiComponents).toContainEqual({type:'source-reference-cards',observationIds:[],sourceIds:[source!.id],calculationIds:[]});
  });
  it('repairs incomplete photo-free package synthesis once to cover available nutrition and serving details',async()=>{
    vi.stubEnv('ENABLE_GEMINI','true');vi.stubEnv('GEMINI_PROVIDER','free');vi.stubEnv('GEMINI_MODEL','gemini-3.8-flash');vi.stubEnv('FREE_GEMINI_API_KEY','offline-test-key');
    const question='Is this good to have for diabetic patients daily for snacking?';
    const source=getNutritionGuidance({query:question,condition:'diabetes',jurisdiction:'India',maxResults:3}).find(item=>item.id==='idf-healthy-nutrition-diabetes-2024')!;
    const observations=[
      {id:'serving-line',field:'label-note',text:'SERVING SIZE: 2 BISCUITS (APPROX. 13.4 g)',side:'back',confidence:80,origin:'user'},
      {id:'carb-line',field:'label-note',text:'CARBOHYDRATES 69.29 g per 100 g; 9.28 g per serving',side:'back',confidence:74,origin:'user'},
      {id:'ingredient-line',field:'label-note',text:'INGREDIENTS: REFINED WHEAT FLOUR (MAIDA) (89.98%)',side:'back',confidence:86,origin:'user'},
    ];
    const packageReconstruction:PackageReconstructionContent={
      identity:{brand:'Bisk Farm',name:'Cream Cracker',variant:'Sugar Free',status:'provisional',evidence:{observationIds:['ingredient-line'],imageRegions:[]}},
      serving:{printedText:'2 biscuits, approximately 13.4 g',quantity:13.4,unit:'g',pieceCount:2,pieceDescription:'biscuits',status:'provisional',evidence:{observationIds:['serving-line'],imageRegions:[]}},
      nutritionRows:[
        {rowId:'carbohydrates-per-100g',nutrient:'Carbohydrates',printedLabel:'Carbohydrates',printedValue:'69.29 g',value:69.29,unit:'g',columnLabel:'Per 100 g',basisText:'per 100 g',basisAmount:100,basisUnit:'g',qualifier:null,status:'provisional',evidence:{observationIds:['carb-line'],imageRegions:[]}},
        {rowId:'carbohydrates-per-serving',nutrient:'Carbohydrates',printedLabel:'Carbohydrates',printedValue:'9.28 g',value:9.28,unit:'g',columnLabel:'Per serving',basisText:'per serving',basisAmount:13.4,basisUnit:'g',qualifier:null,status:'provisional',evidence:{observationIds:['carb-line'],imageRegions:[]}},
      ],
      ingredients:[{position:0,name:'Refined wheat flour',printedText:'REFINED WHEAT FLOUR (MAIDA) (89.98%)',printedPercentage:89.98,normalizedName:'refined wheat flour',status:'provisional',evidence:{observationIds:['ingredient-line'],imageRegions:[]}}],
      additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Provisional reconstruction from the supplied package photos.',
    };
    const partiallyCovered=[
      {mode:'synthesis' as const,text:'Refined wheat flour is listed first.',observationIds:[],sourceIds:[],packageFactIds:['package-fact:ingredient:0']},
      {mode:'synthesis' as const,text:'The provisional table reads 69.29 g carbohydrates per 100 g.',observationIds:[],sourceIds:[],interpretationRowIds:['carbohydrates-per-100g']},
      {mode:'synthesis' as const,text:'IDF guidance says snack choices should be individualized.',observationIds:[],sourceIds:[source!.id]},
    ] as z.infer<typeof assistOutput>['claims'];
    expect(needsPackageAnswerSynthesis(question,packageReconstruction,partiallyCovered,[source!])).toBe(true);
    const initialText='The package lists refined wheat flour first.';
    const initialNutritionClaim='The provisional table reads 69.29 g carbohydrates per 100 g and 9.28 g per serving.';
    const initialOutput={answer:initialText,answerParts:[{text:initialText,claimIndexes:[0]}],claims:[
      {mode:'synthesis',text:initialText,observationIds:[],sourceIds:[],packageFactIds:['package-fact:ingredient:0']},
      {mode:'synthesis',text:initialNutritionClaim,observationIds:['carb-line'],sourceIds:[],interpretationRowIds:['carbohydrates-per-100g','carbohydrates-per-serving'],packageFactIds:['package-fact:serving']},
    ],packageReconstruction,limitations:[],inspectImage:null};
    const ingredientClaim='Refined wheat flour is listed first at 89.98% of the ingredients.';
    const nutritionClaim='The provisional table reads 69.29 g carbohydrates per 100 g and 9.28 g for a 2-biscuit (13.4 g) serving.';
    const guidanceClaim='IDF patient education says carbohydrate portions affect blood glucose, refined carbohydrates can raise it more quickly than high-fibre choices, and snack choices should be individualized.';
    const judgmentClaim='I would not treat this as an obvious default daily snack for someone managing diabetes: refined wheat flour leads the ingredient list and the carbohydrate amount depends on portion; snack choices should be individualized.';
    const answer='I would not treat this as an obvious default daily snack for someone managing diabetes: refined wheat flour leads the ingredient list and the carbohydrate amount depends on portion. The package appears to define 2 biscuits (about 13.4 g) as one serving; the provisional table reads 69.29 g carbohydrates per 100 g and 9.28 g for that serving. The exact values should be checked against the photo. IDF patient education says snack choices should be individualized; it does not establish this product as safe or unsafe.';
    const synthesisOutput={
      answer,answerParts:[
        {text:'I would not treat this as an obvious default daily snack for someone managing diabetes: refined wheat flour leads the ingredient list and the carbohydrate amount depends on portion; snack choices should be individualized.',claimIndexes:[3]},
        {text:'The package appears to define 2 biscuits (about 13.4 g) as one serving; the provisional table reads 69.29 g carbohydrates per 100 g and 9.28 g for that serving. The exact values should be checked against the photo.',claimIndexes:[0,1]},
        {text:'IDF patient education says snack choices should be individualized; it does not establish this product as safe or unsafe.',claimIndexes:[2]},
      ],
      claims:[
        {mode:'synthesis',text:ingredientClaim,observationIds:[],sourceIds:[],packageFactIds:['package-fact:ingredient:0']},
        {mode:'synthesis',text:nutritionClaim,observationIds:[],sourceIds:[],interpretationRowIds:['carbohydrates-per-100g','carbohydrates-per-serving'],packageFactIds:['package-fact:serving']},
        {mode:'synthesis',text:guidanceClaim,observationIds:[],sourceIds:[source.id]},
        {mode:'synthesis',text:judgmentClaim,observationIds:[],sourceIds:[source.id],packageFactIds:['package-fact:ingredient:0','package-fact:serving'],interpretationRowIds:['carbohydrates-per-serving']},
      ],
      uiComponents:[{type:'source-reference-cards',observationIds:[],sourceIds:[source.id],calculationIds:[]}],limitations:[],inspectImage:null,
    };
    const partialSynthesisOutput={
      answer:'The package lists refined wheat flour first.',
      answerParts:[{text:'The package lists refined wheat flour first.',claimIndexes:[0]}],
      claims:[{mode:'synthesis',text:'The package lists refined wheat flour first.',observationIds:[],sourceIds:[],packageFactIds:['package-fact:ingredient:0']}],
      packageReconstruction,limitations:[],inspectImage:null,
    };
    const makeResponse=(output:unknown)=>JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(output)}],role:'model'},finishReason:'STOP',index:0}],modelVersion:'gemini-3.8-flash-test',usageMetadata:{promptTokenCount:500,candidatesTokenCount:250,totalTokenCount:750}});
    const image=await sharp({create:{width:8,height:8,channels:3,background:'#f2f1eb'}}).png().toBuffer();
    const fetcher=vi.fn()
      .mockResolvedValueOnce(new Response(makeResponse(initialOutput),{status:200,headers:{'content-type':'application/json'}}))
      .mockResolvedValueOnce(new Response(makeResponse(partialSynthesisOutput),{status:200,headers:{'content-type':'application/json'}}))
      .mockResolvedValueOnce(new Response(makeResponse(synthesisOutput),{status:200,headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetcher);
    const imageHandle={handle:'bisk-back',side:'back',width:8,height:8,role:'nutrition'};
    const data=assistInput.parse({consent:true,question,package:{id:'bisk-answer-synthesis',name:'Unidentified package',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],observations,rawText:observations.map(item=>item.text).join('\n'),warnings:[],synthetic:false,createdAt:new Date().toISOString()},images:[imageHandle],visualImages:[{imageId:'bisk-back',mimeType:'image/png',base64:image.toString('base64'),side:'back',sourceImage:{width:8,height:8},preprocessing:{rotation:0,contrast:false,invert:false,crop:null}}]});

    const result=await assist(data);
    expect(fetcher).toHaveBeenCalledTimes(3);
    const initialRequest=JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    const synthesisRequest=JSON.parse(String(fetcher.mock.calls[1][1]?.body));
    const repairRequest=JSON.parse(String(fetcher.mock.calls[2][1]?.body));
    expect(initialRequest.contents[0].parts.some((part:{inlineData?:unknown})=>part.inlineData)).toBe(true);
    expect(synthesisRequest.contents[0].parts.some((part:{inlineData?:unknown})=>part.inlineData)).toBe(false);
    expect(repairRequest.contents[0].parts.some((part:{inlineData?:unknown})=>part.inlineData)).toBe(false);
    expect(JSON.stringify(synthesisRequest.systemInstruction)).toContain('text-only answer-synthesis');
    const synthesisSchema=JSON.stringify(synthesisRequest.generationConfig.responseJsonSchema);
    expect(synthesisSchema).not.toContain('answerParts');
    expect(synthesisSchema).not.toContain('tentativeCandidates');
    expect(synthesisSchema).not.toContain('visualEvidence');
    expect(synthesisSchema).not.toContain('supportingSpans');
    expect(String(synthesisRequest.contents[0].parts[0].text)).toContain('69.29');
    expect(String(synthesisRequest.contents[0].parts[0].text)).toContain(source.id);
    expect(JSON.parse(String(synthesisRequest.contents[0].parts[0].text)).priorAnswer.acceptedClaims).toHaveLength(2);
    expect(JSON.parse(String(synthesisRequest.contents[0].parts[0].text)).calculations).toEqual(expect.arrayContaining([
      expect.objectContaining({portion:13.4,portionUnit:'g',result:expect.closeTo(69.29*13.4/100,6),interpretationIds:['carbohydrates-per-100g']}),
    ]));
    const repairPrompt=JSON.parse(String(repairRequest.contents[0].parts[0].text));
    expect(repairPrompt.validationRepair.coverageGaps).toEqual(expect.arrayContaining(['nutrition','serving']));
    expect(result.answer).toContain('default daily snack');
    expect(result.answer).toContain('9.28 g');
    expect(result.claims).toHaveLength(4);
    expect((result as unknown as {packageReconstruction?:{identity:unknown;nutritionRows:unknown[]}}).packageReconstruction).toMatchObject({identity:{brand:'Bisk Farm',name:'Cream Cracker'}});
    expect((result as unknown as {packageReconstruction:{nutritionRows:unknown[]}}).packageReconstruction.nutritionRows).toEqual(expect.arrayContaining([expect.objectContaining({rowId:'carbohydrates-per-100g'})]));
    expect(result.agentEvidence).toMatchObject([{id:source.id,publisher:'International Diabetes Federation'}]);
    expect(result.agentTrace.some(step=>step.name==='package_answer_synthesis'&&step.status==='ok')).toBe(true);
  });
  it('repairs a claimless package answer once and keeps a validated partial answer instead of withholding the turn',async()=>{
    vi.stubEnv('ENABLE_GEMINI','true');vi.stubEnv('GEMINI_PROVIDER','free');vi.stubEnv('GEMINI_MODEL','gemini-3.8-flash');vi.stubEnv('FREE_GEMINI_API_KEY','offline-test-key');
    const observations=[
      {id:'serving-line',field:'label-note',text:'SERVING SIZE: 2 BISCUITS (APPROX. 13.4 g)',side:'back' as const,confidence:80,origin:'ocr' as const},
      {id:'ingredient-line',field:'label-note',text:'INGREDIENTS: REFINED WHEAT FLOUR (MAIDA) (89.98%)',side:'back' as const,confidence:86,origin:'ocr' as const},
      {id:'protein-line',field:'label-note',text:'PROTEIN 5 g per 100 g',side:'back' as const,confidence:70,origin:'ocr' as const},
    ];
    const reconstruction:PackageReconstructionContent={
      identity:{brand:'Bisk Farm',name:'Cream Cracker',variant:'Sugar Free',status:'provisional',evidence:{observationIds:['ingredient-line'],imageRegions:[]}},
      serving:{printedText:'2 biscuits, approximately 13.4 g',quantity:13.4,unit:'g',pieceCount:2,pieceDescription:'biscuits',status:'provisional',evidence:{observationIds:['serving-line'],imageRegions:[]}},
      nutritionRows:[{rowId:'protein-per-100g',nutrient:'Protein',printedLabel:'Protein',printedValue:'5 g',value:5,unit:'g',columnLabel:'Per 100 g',basisText:'per 100 g',basisAmount:100,basisUnit:'g',qualifier:null,status:'provisional',evidence:{observationIds:['protein-line'],imageRegions:[]}}],
      ingredients:[{position:0,name:'Refined wheat flour',printedText:'REFINED WHEAT FLOUR (MAIDA) (89.98%)',printedPercentage:89.98,normalizedName:'refined wheat flour',status:'provisional',evidence:{observationIds:['ingredient-line'],imageRegions:[]}}],
      additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Provisional reconstruction from package evidence.',
    };
    const noAnswer={answer:'',claims:[],packageReconstruction:reconstruction,limitations:[],inspectImage:null};
    const ungroundedSynthesis={answer:'I could not establish enough evidence for this question.',claims:[],limitations:[],inspectImage:null};
    const answer='The label appears to list refined wheat flour first. It defines two biscuits (about 13.4 g) as a serving, but the available reconstruction does not establish the carbohydrate amount, so I cannot make a confident daily-snacking judgment from this reading.';
    const repaired={answer,claims:[
      {mode:'synthesis',text:'The reconstructed ingredient list places refined wheat flour first.',observationIds:[],sourceIds:[],packageFactIds:['package-fact:ingredient:0']},
      {mode:'synthesis',text:'The serving declaration appears to define two biscuits, approximately 13.4 g.',observationIds:[],sourceIds:[],packageFactIds:['package-fact:serving']},
    ],limitations:[],inspectImage:null};
    const payload=(value:unknown)=>JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(value)}],role:'model'},finishReason:'STOP',index:0}],modelVersion:'gemini-3.8-flash-test',usageMetadata:{promptTokenCount:100,candidatesTokenCount:90,totalTokenCount:190}});
    const fetcher=vi.fn()
      .mockResolvedValueOnce(new Response(payload(noAnswer),{status:200,headers:{'content-type':'application/json'}}))
      .mockResolvedValueOnce(new Response(payload(ungroundedSynthesis),{status:200,headers:{'content-type':'application/json'}}))
      .mockResolvedValueOnce(new Response(payload(repaired),{status:200,headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetcher);
    const data=assistInput.parse({consent:true,question:'Is this a good daily snack?',package:{id:'partial-answer-repair',name:'Unidentified food package',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],observations,rawText:observations.map(item=>item.text).join('\n'),warnings:[],synthetic:false,createdAt:new Date().toISOString()}});

    const result=await assist(data);
    expect(fetcher).toHaveBeenCalledTimes(3);
    const repairRequest=JSON.parse(String(fetcher.mock.calls[2][1]?.body));
    const repairPrompt=JSON.parse(String(repairRequest.contents[0].parts[0].text));
    expect(repairPrompt.validationRepair.rejectionCategoriesByStage).toHaveProperty('natural-answer.no-validated-claims',1);
    expect(repairRequest.contents[0].parts.some((part:{inlineData?:unknown})=>part.inlineData)).toBe(false);
    expect(result.answer).toBe(answer);
    expect(result.claims).toHaveLength(2);
    expect((result as unknown as {packageReconstruction?:unknown}).packageReconstruction).toMatchObject({identity:{brand:'Bisk Farm',name:'Cream Cracker'},serving:{quantity:13.4,unit:'g'}});
    const coverage=packageAnswerCoverage(data.question,reconstruction,result.claims,[],result.answer);
    expect(coverage.covered).toBe(2);
    expect(coverage.missing).toContain('nutrition');
    expect(canAcceptPackageAnswerSynthesis(coverage,coverage,true,result.claims)).toBe(true);
    expect(canAcceptPackageAnswerSynthesis(coverage,{...coverage,missing:[...coverage.missing,'ingredients'],covered:coverage.covered-1},true,result.claims)).toBe(false);
  });
  it('uses one bounded formatting repair when Gemini ends with non-JSON text',async()=>{
    vi.stubEnv('ENABLE_GEMINI','true');vi.stubEnv('GEMINI_PROVIDER','free');vi.stubEnv('GEMINI_MODEL','gemini-3.8-flash');vi.stubEnv('FREE_GEMINI_API_KEY','offline-test-key');
    const observation={id:'ingredient-line',field:'ingredients',text:'INGREDIENTS: REFINED WHEAT FLOUR (MAIDA)',side:'back' as const,confidence:82,origin:'user' as const};
    const reconstruction={
      identity:{brand:null,name:null,variant:null,status:'unreadable' as const,evidence:{observationIds:[],imageRegions:[]}},
      serving:null,nutritionRows:[],
      ingredients:[{position:0,name:'Refined wheat flour',printedText:'REFINED WHEAT FLOUR (MAIDA)',printedPercentage:null,normalizedName:'refined wheat flour',status:'provisional' as const,evidence:{observationIds:['ingredient-line'],imageRegions:[]}}],
      additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'A provisional interpretation linked to the package text.',
    };
    const answer='The package text lists refined wheat flour (maida) as an ingredient.';
    const output={answer,answerParts:[{text:answer,claimIndexes:[0]}],claims:[{mode:'synthesis',text:answer,observationIds:[],sourceIds:[],packageFactIds:['package-fact:ingredient:0']}],packageReconstruction:reconstruction,limitations:[],inspectImage:null};
    const makeResponse=(text:string)=>JSON.stringify({candidates:[{content:{parts:[{text}],role:'model'},finishReason:'STOP',index:0}],modelVersion:'gemini-3.8-flash-test',usageMetadata:{promptTokenCount:80,candidatesTokenCount:70,totalTokenCount:150}});
    const fetcher=vi.fn()
      .mockResolvedValueOnce(new Response(makeResponse('The package appears to list flour, but this is not a JSON object.'),{status:200,headers:{'content-type':'application/json'}}))
      .mockResolvedValueOnce(new Response(makeResponse(JSON.stringify(output)),{status:200,headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetcher);
    const data=assistInput.parse({consent:true,question:'What ingredients are listed?',package:{id:'invalid-json-repair',name:'Unidentified package',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],observations:[observation],rawText:observation.text,warnings:[],synthetic:false,createdAt:new Date().toISOString()}});

    const result=await assist(data);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const repairRequest=JSON.parse(String(fetcher.mock.calls[1][1]?.body));
    expect(JSON.stringify(repairRequest.contents)).toContain('invalid-json');
    expect(result.answer).toBe(answer);
    expect(result.agentTrace.some(step=>step.name==='package-structure-repair'&&step.status==='ok')).toBe(true);
  });
  it('returns only deterministic calculations referenced by validated claims or generative UI', async () => {
    vi.stubEnv('ENABLE_GEMINI', 'true'); vi.stubEnv('GEMINI_PROVIDER', 'free'); vi.stubEnv('GEMINI_MODEL', 'gemini-3.8-flash'); vi.stubEnv('FREE_GEMINI_API_KEY', 'offline-test-key');
    const calculation = { id: 'calc-carbohydrate-30g', label: 'Carbohydrate in 30 g', nutrient: 'carbohydrate', input: 60, inputUnit: 'g', basisAmount: 100, portion: 30, portionUnit: 'g', result: 18, unit: 'g', formula: '60 g × 30 g ÷ 100 g', observationIds: ['input-1'], assumptions: ['Provisional package reading.'] } as const;
    const reconstruction = { identity: { brand: null, name: 'Unidentified package', variant: null, status: 'provisional', evidence: { observationIds: ['input-1'], imageRegions: [] } }, serving: null, nutritionRows: [], ingredients: [], additives: [], statements: [], regions: [], unresolved: [], interpretationNote: 'Saved interpretation.' };
    const answer = 'The label-based calculation is 18 g carbohydrate in 30 g.';
    const output = { answer, answerParts: [{ text: answer, claimIndexes: [0] }], claims: [{ mode: 'synthesis', text: answer, observationIds: ['input-1'], sourceIds: [], calculationIds: [calculation.id], profileFieldIds: [], supportingSpans: [], visualEvidence: [] }], uiComponents: [{ type: 'portion-calculator', observationIds: [], sourceIds: [], calculationIds: [calculation.id] }], limitations: [], inspectImage: null, packageReconstruction: reconstruction };
    const payload = JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(output) }], role: 'model' }, finishReason: 'STOP', index: 0 }], modelVersion: 'gemini-3.8-flash-test', usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 20, totalTokenCount: 32 } });
    const fetcher = vi.fn().mockResolvedValue(new Response(payload, { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    const data = assistInput.parse({ consent: true, question: 'How much carbohydrate in 30 g?', calculations: [calculation], package: { id: 'package-calculation-ui', name: 'Unidentified package', ingredients: [], additives: [], allergens: [], claims: [], nutrients: [], observations: [{ id: 'input-1', field: 'label-note', text: 'Carbohydrate 60 g per 100 g', side: 'text', confidence: null, origin: 'user' }], rawText: 'Carbohydrate 60 g per 100 g', warnings: [], synthetic: false, createdAt: new Date().toISOString(), reconstruction: { ...reconstruction, revision: 1, updatedAt: new Date().toISOString(), model: 'Gemini', current: true } } });

    const result = await assist(data);
    expect(result.calculations).toEqual([calculation]);
    expect(result.uiComponents).toContainEqual({ type: 'portion-calculator', observationIds: [], sourceIds: [], calculationIds: [calculation.id] });
  });
  it('retries an invalid initial package object with the original OCR and attached photo', async () => {
    vi.stubEnv('ENABLE_GEMINI','true');vi.stubEnv('GEMINI_PROVIDER','free');vi.stubEnv('GEMINI_MODEL','gemini-3.8-flash');vi.stubEnv('FREE_GEMINI_API_KEY','offline-test-key');
    const packageReconstruction={identity:{brand:'BISK FARM',name:'Cream Cracker',variant:null,status:'provisional',evidence:{observationIds:['input-1'],imageRegions:[]}},serving:null,nutritionRows:[],ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'A provisional reconstruction from linked package text.'};
    const validOutput={answer:'The label identifies a Bisk Farm Cream Cracker.',answerParts:[{text:'The label identifies a Bisk Farm Cream Cracker.',claimIndexes:[0]}],claims:[{mode:'direct-quote',text:'BISK FARM CREAM CRACKER',observationIds:['input-1'],sourceIds:[],calculationIds:[],profileFieldIds:[],supportingSpans:[{kind:'observation',id:'input-1',quote:'BISK FARM CREAM CRACKER'}],visualEvidence:[]}],limitations:[],inspectImage:null,packageReconstruction};
    const invalidOutput={...validOutput};delete (invalidOutput as Record<string,unknown>).packageReconstruction;
    const makeResponse=(output:unknown)=>JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(output)}],role:'model'},finishReason:'STOP',index:0}],modelVersion:'gemini-3.8-flash-test',usageMetadata:{promptTokenCount:24,candidatesTokenCount:80,totalTokenCount:104}});
    const fetcher=vi.fn()
      .mockResolvedValueOnce(new Response(makeResponse(invalidOutput),{status:200,headers:{'content-type':'application/json'}}))
      .mockResolvedValueOnce(new Response(makeResponse(validOutput),{status:200,headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetcher);
    const image=await sharp({create:{width:8,height:8,channels:3,background:'#f2f1eb'}}).png().toBuffer();
    const data=assistInput.parse({consent:true,question:'What package is this?',package:{id:'package-repair-test',name:'Unidentified package',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],observations:[{id:'input-1',field:'product-name',text:'BISK FARM CREAM CRACKER',side:'text',confidence:100,origin:'ocr'}],rawText:'BISK FARM CREAM CRACKER',warnings:[],synthetic:true,createdAt:new Date().toISOString()},images:[{handle:'back-image',side:'back',width:8,height:8,role:'nutrition'}],visualImages:[{imageId:'back-image',mimeType:'image/png',base64:image.toString('base64'),side:'back',sourceImage:{width:8,height:8},preprocessing:{rotation:0,contrast:false,invert:false,crop:null}}]});

    const result=await assist(data);
    expect((result as unknown as {packageReconstruction:unknown}).packageReconstruction).toMatchObject({identity:{brand:'BISK FARM',name:'Cream Cracker'},nutritionRows:[]});
    expect(result.agentTrace.some(step=>step.name==='package-structure-repair'&&step.status==='ok')).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const initialRequest=JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    const repairRequest=JSON.parse(String(fetcher.mock.calls[1][1]?.body));
    expect(initialRequest.generationConfig).not.toHaveProperty('responseJsonSchema');
    expect(repairRequest.generationConfig).not.toHaveProperty('tools');
    expect(repairRequest.generationConfig.responseJsonSchema).toBeDefined();
    expect(repairRequest.contents[0].parts.some((part:{inlineData?:unknown})=>part.inlineData)).toBe(false);
    expect(JSON.stringify(repairRequest.contents)).toContain('validationIssuePaths');
    expect(String(repairRequest.contents[0].parts[0].text)).toContain('BISK FARM CREAM CRACKER');
  });
  it('keeps valid reconstruction when only supplemental answer links are malformed',async()=>{
    vi.stubEnv('ENABLE_GEMINI','true');vi.stubEnv('GEMINI_PROVIDER','free');vi.stubEnv('GEMINI_MODEL','gemini-3.8-flash');vi.stubEnv('FREE_GEMINI_API_KEY','offline-test-key');
    const initialOutput={
      answer:'The package lists refined wheat flour and carbohydrates.',
      answerParts:[{heading:'Package findings'}],
      claims:[{mode:'synthesis',text:'The ingredient list names refined wheat flour.',observation_ids:['OBS_3'],source_ids:[]}],
      package_reconstruction:{
        product_identity:{brand_name:'Bisk Farm',product_name:'Cream Cracker',source_evidence:{observation_ids:['OBS_1']}},
        serving_size:{text:'2 biscuits, approximately 13.4 g',amount:'13.4',unit:'g',count:2,observation_ids:['OBS_2']},
        nutrition_table:[{name:'Carbohydrates',printed_value:'69.29',value:'69.29',unit:'g',column:'Per 100 g',basis_amount:'100',basis_unit:'g',observation_ids:['OBS_2']}],
        ingredients:[{name:'Refined wheat flour',printed_text:'REFINED WHEAT FLOUR (MAIDA) (89.98%)',printed_percentage:'89.98',observation_ids:['OBS_3']}],
        additives:[],statements:[],regions:[],unresolved:[],note:'Provisional reconstruction from the attached package evidence.',
      },
      limitations:[],inspectImage:null,
    };
    const repairOutput={
      answer:'The label lists refined wheat flour.',
      answerParts:[{text:'The label lists refined wheat flour.',claimIndexes:[0]}],
      claims:[{mode:'synthesis',text:'The ingredient list names refined wheat flour.',observationIds:['OBS_3'],sourceIds:[]}],
      packageReconstruction:{
        identity:{brand:'Bisk Farm',name:'Cream Cracker',variant:null,status:'provisional',evidence:{observationIds:['OBS_1'],imageRegions:[]}},
        serving:{printedText:'2 biscuits, approximately 13.4 g',quantity:13.4,unit:'g',pieceCount:2,pieceDescription:'biscuits',status:'provisional',evidence:{observationIds:['OBS_2'],imageRegions:[]}},
        nutritionRows:[{rowId:'carbohydrate-per-100g',nutrient:'Carbohydrates',printedLabel:'Carbohydrates',printedValue:'69.29 g',value:69.29,unit:'g',columnLabel:'Per 100 g',basisText:'per 100 g',basisAmount:100,basisUnit:'g',qualifier:null,status:'provisional',evidence:{observationIds:['OBS_2'],imageRegions:[]}}],
        ingredients:[{position:0,name:'Refined wheat flour',printedText:'REFINED WHEAT FLOUR (MAIDA)',printedPercentage:89.98,normalizedName:'refined wheat flour',status:'provisional',evidence:{observationIds:['OBS_3'],imageRegions:[]}}],
        additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Provisional reconstruction from original package evidence.',
      },
      limitations:[],inspectImage:null,
    };
    const makeResponse=(output:unknown)=>JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(output)}],role:'model'},finishReason:'STOP',index:0}],modelVersion:'gemini-3.8-flash-test',usageMetadata:{promptTokenCount:24,candidatesTokenCount:80,totalTokenCount:104}});
    const fetcher=vi.fn()
      .mockResolvedValueOnce(new Response(makeResponse(initialOutput),{status:200,headers:{'content-type':'application/json'}}))
      .mockResolvedValueOnce(new Response(makeResponse(repairOutput),{status:200,headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetcher);
    const data=assistInput.parse({consent:true,question:'What does this package contain?',package:{id:'package-preserve-reconstruction',name:'Unidentified package',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],observations:[
      {id:'input-1',field:'label-note',text:'BISK FARM CREAM CRACKER',side:'text',confidence:null,origin:'user'},
      {id:'input-2',field:'label-note',text:'2 biscuits approximately 13.4 g; carbohydrates 69.29 g per 100 g',side:'text',confidence:null,origin:'user'},
      {id:'input-3',field:'label-note',text:'REFINED WHEAT FLOUR (MAIDA) (89.98%)',side:'text',confidence:null,origin:'user'},
    ],rawText:'Package evidence',warnings:[],synthetic:true,createdAt:new Date().toISOString()}});

    const result=await assist(data);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.agentTrace.some(step=>step.name==='package-structure-repair')).toBe(false);
    expect((result as unknown as {packageReconstruction:unknown}).packageReconstruction).toMatchObject({
      identity:{brand:'Bisk Farm',name:'Cream Cracker'},
      serving:{quantity:13.4,pieceCount:2},
      nutritionRows:[{nutrient:'Carbohydrates',value:69.29,unit:'g',basisAmount:100,basisUnit:'g',evidence:{observationIds:['input-2']}}],
      ingredients:[{position:0,name:'Refined wheat flour',printedPercentage:89.98,evidence:{observationIds:['input-3']}}],
    });
  });
  it('grounds a claimless follow-up sentence against the compact saved reconstruction without replaying photos or tools', async () => {
    vi.stubEnv('ENABLE_GEMINI','true');vi.stubEnv('GEMINI_PROVIDER','free');vi.stubEnv('GEMINI_MODEL','gemini-3.8-flash');vi.stubEnv('FREE_GEMINI_API_KEY','offline-test-key');
    const reconstruction={identity:{brand:'BISK FARM',name:'Cream Cracker Sugar Free',variant:null,status:'clear',evidence:{observationIds:['input-1'],imageRegions:[]}},serving:{printedText:'2 biscuits, approximately 13.4 g',quantity:13.4,unit:'g',pieceCount:2,pieceDescription:'biscuits',status:'clear',evidence:{observationIds:['input-2'],imageRegions:[]}},nutritionRows:[],ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'A saved, provisional interpretation from the package photos.'};
    const currentReconstruction={...reconstruction,revision:1,updatedAt:new Date().toISOString(),model:'gemini-3.6-flash',current:true};
    const invalidOutput={answer:'Two biscuits are one serving.',answerParts:[{heading:'Serving',content:'Two biscuits are the serving.'}],uiComponents:[],packageReconstruction:{identity:{brand:null,name:null,variant:null,status:'unreadable',evidence:{observationIds:[],imageRegions:[]}},serving:null,nutritionRows:[],ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:''}};
    const validOutput={answer:'Two biscuits are the package serving, listed at approximately 13.4 g.',answerParts:[{text:'Two biscuits are the package serving, listed at approximately 13.4 g.',claimIndexes:[0]}],claims:[{mode:'direct-quote',text:'2 biscuits, approximately 13.4 g',observationIds:['input-2'],sourceIds:[],calculationIds:[],interpretationRowIds:[],profileFieldIds:[],supportingSpans:[{kind:'observation',id:'input-2',quote:'2 biscuits, approximately 13.4 g'}],visualEvidence:[]}],limitations:[],inspectImage:null};
    const makeResponse=(output:unknown)=>JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(output)}],role:'model'},finishReason:'STOP',index:0}],modelVersion:'gemini-3.8-flash-test',usageMetadata:{promptTokenCount:24,candidatesTokenCount:80,totalTokenCount:104}});
    const fetcher=vi.fn().mockResolvedValueOnce(new Response(makeResponse(invalidOutput),{status:200,headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetcher);
    const data=assistInput.parse({consent:true,question:'What about just two biscuits?',package:{id:'package-followup-repair',name:'Cream Cracker Sugar Free',brand:'BISK FARM',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],reconstruction:currentReconstruction,observations:[{id:'input-1',field:'product-name',text:'BISK FARM CREAM CRACKER',side:'text',confidence:100,origin:'ocr'},{id:'input-2',field:'serving-size',text:'2 biscuits, approximately 13.4 g',side:'text',confidence:null,origin:'vision'}],rawText:'BISK FARM CREAM CRACKER\n2 biscuits, approximately 13.4 g',warnings:[],synthetic:false,createdAt:new Date().toISOString()}});

    const result=await assist(data);
    expect(result).toMatchObject({status:'ok',answer:invalidOutput.answer});
    expect(result).not.toHaveProperty('packageReconstruction');
    expect(result.agentTrace.some(step=>step.name==='package_answer_synthesis')).toBe(false);
    expect(result.agentTrace.some(step=>step.name==='structured_output_repair')).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const initialRequest=JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(initialRequest.contents[0].parts.some((part:{inlineData?:unknown})=>part.inlineData)).toBe(false);
    expect(initialRequest.contents[0].parts[0].text).toContain('Cream Cracker Sugar Free');
    expect(initialRequest.contents[0].parts[0].text).not.toContain('BISK FARM CREAM CRACKER');
    expect(JSON.stringify(initialRequest.systemInstruction)).toContain('immediately preceding user intent');
    expect(JSON.stringify(initialRequest.systemInstruction)).toContain('assess the specified portion against that same question');
  });
  it('normalizes package-native reconstruction fields and ignores malformed supplemental answer links', () => {
    const providerOutput={
      answer:'The package appears to list a two-biscuit serving and a nutrition table.',
      answerParts:[{heading:'An optional provider-only panel'}],
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
    expect(parsed.schemaMode).toBe('provider-schema');
    expect(parsed.output.answerParts).toEqual([{text:providerOutput.answer,claimIndexes:[0]}]);
    expect(parsed.output.claims).toMatchObject([{text:providerOutput.answer,observationIds:[],sourceIds:[]}]);
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
      answerParts:[],
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
    expect(parsed.modelOutputStatus).toBe('unlinked-answer-candidate');
    expect(parsed.discardedRegionCount).toBe(1);
    expect(parsed.output.packageReconstruction).toMatchObject({
      identity:{brand:'Example Foods',name:'Oat Biscuits'},
      serving:{quantity:35,unit:'g'},
      nutritionRows:[{rowId:'ROW_1',nutrient:'carbohydrate',value:23.1,unit:'g',basisAmount:35,basisUnit:'g',status:'provisional',evidence:{observationIds:['OBS_1'],imageRegions:[{imageId:'IMG_1',region:null}]}}],
    });
    expect(parsed.output.answer).toBe(providerOutput.answer);
  });
  it('uses one provider request when the initial package response uses package.reconstruction', async()=>{
    vi.stubEnv('ENABLE_GEMINI','true');vi.stubEnv('GEMINI_PROVIDER','free');vi.stubEnv('GEMINI_MODEL','gemini-3.8-flash');vi.stubEnv('FREE_GEMINI_API_KEY','offline-test-key');
    const providerOutput={
      answer:'The photographed panel appears to list 8 g of carbohydrates per 100 g.',
      answerParts:[],uiComponents:[],
      package:{reconstruction:{
        current:true,
        identity:{brand:null,name:null,variant:null,status:'unreadable',evidence:{observationIds:[],imageRegions:[]}},
        serving:null,
        nutritionRows:[{rowId:'ROW_1',nutrient:'carbohydrate',printedLabel:'Carbohydrates',printedValue:'8',value:8,unit:'g',columnLabel:'Per 100 g',basisText:'per 100 g',basisAmount:100,basisUnit:'g',status:'provisional',evidence:{observationIds:['OBS_1'],imageRegions:[]}}],
        ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Provisional label reading.',
      }},
    };
    const payload=JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(providerOutput)}],role:'model'},finishReason:'STOP',index:0}],modelVersion:'gemini-3.8-flash-test',usageMetadata:{promptTokenCount:24,candidatesTokenCount:80,totalTokenCount:104}});
    const fetcher=vi.fn().mockResolvedValue(new Response(payload,{status:200,headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetcher);
    const observation={id:'ocr-carbohydrate',field:'ocr-line',text:'CARBOHYDRATES 8 g per 100 g',side:'back' as const,confidence:86,origin:'ocr' as const,imageId:'back-photo',readingOrder:{runId:'ocr-run',blockIndex:0,paragraphIndex:0,lineIndex:0}};
    const data=assistInput.parse({consent:true,question:'What carbohydrate amount is printed per 100 g?',package:{id:'nested-package-envelope',name:'Unidentified package',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],observations:[observation],ocrCaptures:[{runId:'ocr-run',imageId:'back-photo',side:'back',sourceImage:{width:100,height:100},preparedImage:{width:100,height:100},bboxCoordinateSpace:'prepared-image-pixels',engine:{name:'fixture-reader',version:'1',language:'en',confidenceScale:'0-100',segmentationMode:'auto'},processing:{rotation:0,contrast:false,invert:false,cropPercent:null}}],rawText:observation.text,warnings:[],synthetic:true,createdAt:new Date().toISOString()}});

    const result=await assist(data);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('ok');
    expect(result.answer).toContain('8 g');
    expect((result as unknown as {packageReconstruction:{nutritionRows:Array<{value:number|null;evidence:{observationIds:string[]}} >}}).packageReconstruction.nutritionRows).toMatchObject([{value:8,evidence:{observationIds:['ocr-carbohydrate']}}]);
    expect(result.agentTrace.some(step=>step.name==='package-structure-repair'||step.name==='structured_output_repair')).toBe(false);
  });
  it('turns claimless but schema-valid package prose into untrusted candidates that exact evidence can link',()=>{
    const observation={id:'flour-observation',field:'label-note',text:'REFINED WHEAT FLOUR (MAIDA) (89.98%)',side:'back' as const,confidence:86,origin:'user' as const};
    const reconstruction={identity:{brand:null,name:'Example biscuits',variant:null,status:'provisional' as const,evidence:{observationIds:[],imageRegions:[]}},serving:null,nutritionRows:[],ingredients:[{position:0,name:'Refined wheat flour',printedText:'REFINED WHEAT FLOUR (MAIDA)',printedPercentage:89.98,normalizedName:'refined wheat flour',status:'provisional' as const,evidence:{observationIds:['flour-observation'],imageRegions:[]}}],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'A provisional saved package interpretation.',revision:1,updatedAt:new Date().toISOString(),model:'fixture',current:true};
    const data=assistInput.parse({consent:true,question:'What is the main ingredient?',package:{id:'claimless-package-answer',name:'Example biscuits',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],reconstruction,observations:[observation],rawText:observation.text,warnings:[],synthetic:false,createdAt:new Date().toISOString()}});
    const answer='The label lists refined wheat flour (maida) at 89.98%.';
    const parsed=parseAgentProviderOutput(JSON.stringify({answer,answerParts:[],claims:[],limitations:[],inspectImage:null}));
    expect(parsed.schemaMode).toBe('provider-schema');
    expect(parsed.output.claims).toMatchObject([{text:answer,observationIds:[],packageFactIds:[]}]);
    expect(parsed.output.answerParts).toEqual([{text:answer,claimIndexes:[0]}]);
    const result=validateClaims(parsed.output,data);
    expect(result.claims).toMatchObject([{text:answer,packageFactIds:['package-fact:ingredient:0']}]);
    expect(result.answer).toBe(answer);
  });
  it('recovers unlinked answer parts from a provider package alias only through matching reconstructed evidence',()=>{
    const observations=[
      {id:'nutrition-line',field:'label-note',text:'CARBOHYDRATES 8 g per 100 g',side:'back' as const,confidence:86,origin:'ocr' as const},
      {id:'ingredient-line',field:'label-note',text:'INGREDIENTS: WHOLE WHEAT FLOUR',side:'back' as const,confidence:86,origin:'ocr' as const},
      {id:'claim-line',field:'label-note',text:'NO ADDED SUGARS',side:'front' as const,confidence:86,origin:'ocr' as const},
    ];
    const data=assistInput.parse({consent:true,question:'Summarize the package.',package:{id:'unlinked-provider-output',name:'Unidentified package',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],observations,rawText:observations.map(item=>item.text).join('\n'),warnings:[],synthetic:false,createdAt:new Date().toISOString()}});
    const answer='The ingredient list starts with whole wheat flour. The table lists 8 g of carbohydrates per 100 g. The pack says no added sugars.';
    const rawProviderOutput={
      answer,
      answerParts:[
        {text:'The ingredient list starts with whole wheat flour.'},
        {text:'The table lists 8 g of carbohydrates per 100 g.'},
        {text:'The pack says no added sugars.'},
      ],
      uiComponents:[],
      package:{current:true,identity:{brand:'Example',productName:'Whole Wheat Crackers',variant:null},serving:null,
        nutritionRows:[{rowId:'carbohydrates-100g',nutrient:'Carbohydrates',printedValue:'8 g',value:8,unit:'g',columnLabel:'Per 100 g',basisText:'per 100 g',basisAmount:100,basisUnit:'g',status:'provisional',observationIds:['nutrition-line']}],
        ingredients:[{ingredientId:'ingredient-1',printedLabel:'Whole wheat flour',normalizedName:'whole wheat flour',percentage:null,observationIds:['ingredient-line']}],
        claims:[{claimId:'claim-1',type:'claim',printedText:'NO ADDED SUGARS',observationIds:['claim-line']}],additives:[],allergens:[],warnings:[],certifications:[],packageFacts:[]},
    };
    const parsed=parseAgentProviderOutput(JSON.stringify(rawProviderOutput),true);
    expect(parsed.schemaMode).toBe('provider-schema');
    expect(parsed.modelOutputStatus).toBe('unlinked-answer-candidate');
    expect(parsed.output.claims).toHaveLength(3);
    const sanitized=sanitizePackageReconstruction(parsed.output.packageReconstruction,data);
    expect(sanitized).not.toBeNull();
    const result=validateClaims({...parsed.output,packageReconstruction:sanitized!.content},data);
    expect(result.claims.map(claim=>claim.text)).toEqual([
      'The ingredient list starts with whole wheat flour.',
      'The table lists 8 g of carbohydrates per 100 g.',
      'The pack says no added sugars.',
    ]);
    expect(result.claims[0].packageFactIds).toContain('package-fact:ingredient:0');
    expect(result.claims[1].interpretationRowIds).toContain('carbohydrates-100g');
    expect(result.claims[2].packageFactIds).toContain('package-fact:statement:0');
    expect(result.answer).toBe(answer);
  });
  it('maps compact provider evidenceIds into typed references, avoids a duplicate synthesis, and still rejects changed values', async() => {
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
    const parse=(text:string)=>parseAgentProviderOutput(JSON.stringify({answer:text,evidenceIds,limitations:[],inspectImage:null})).output;
    const aliases=new Map([['ROW_1','carbohydrates-per-serving'],['CALC_1','carbohydrate-serving']]);
    const output=replaceReferenceIds(parse(answer),aliases);
    expect(output.claims).toMatchObject([{text:answer,interpretationRowIds:[],calculationIds:[],packageFactIds:[]}]);
    expect(output.answerParts).toEqual([{text:answer,claimIndexes:[0]}]);
    const accepted=validateClaims(output,data);
    expect(accepted.claims).toHaveLength(1);
    expect(accepted.claims[0]).toMatchObject({interpretationRowIds:['carbohydrates-per-serving'],calculationIds:['carbohydrate-serving'],packageFactIds:['package-fact:serving']});
    expect(accepted.answer).toContain('9.28 g');

    const wrongOutput=replaceReferenceIds(parse(answer.replace('9.28 g','19.28 g')),aliases);
    const decisions:Array<{stage:string;decision:string;reason?:string}>=[];
    const rejected=validateClaims(wrongOutput,data,event=>decisions.push(event));
    expect(rejected.claims).toEqual([]);
    expect(rejected.answer).not.toContain('19.28 g');
    expect(decisions).toContainEqual(expect.objectContaining({stage:'claim',decision:'rejected',reason:'unsupported-numeric-value'}));

    const mixedAnswer='The label appears to list 9.28 g of carbohydrates per serving [ROW_1, CALC_1]. Official diabetes guidance from the International Diabetes Federation (IDF) emphasizes whole grains and limited refined carbohydrates.';
    const segmented=replaceReferenceIds(parseAgentProviderOutput(JSON.stringify({
      answer:mixedAnswer,evidenceIds:['package-fact:serving','ROW_1','CALC_1'],limitations:[],inspectImage:null,
    })).output,aliases);
    expect(segmented.claims).toHaveLength(1);
    expect(segmented.claims[0]).toMatchObject({text:'The label appears to list 9.28 g of carbohydrates per serving.',interpretationRowIds:['carbohydrates-per-serving'],calculationIds:['carbohydrate-serving'],packageFactIds:[]});
    expect(segmented.answerParts).toEqual([{text:'The label appears to list 9.28 g of carbohydrates per serving.',claimIndexes:[0]}]);
    const segmentedResult=validateClaims(segmented,data);
    expect(segmentedResult.answer).toBe('The label appears to list 9.28 g of carbohydrates per serving.');
    expect(segmentedResult.answer).not.toContain('International Diabetes Federation');

    const evidenceLinkedAnswer='Official diabetes guidance from the International Diabetes Federation (IDF) says to limit refined carbohydrates. The package displays Sugar Free [package-fact:statement:0]. The primary ingredient is refined wheat flour at nearly 90% [package-fact:ingredient:0]. The nutrition table lists 9.28 g of carbohydrates per 13.4 g serving [ROW_1, CALC_1].';
    const packageWithFlour={...reconstruction,ingredients:[{position:0,name:'Refined wheat flour',printedText:'REFINED WHEAT FLOUR (MAIDA)',printedPercentage:89.98,normalizedName:'refined wheat flour',status:'provisional' as const,evidence:{observationIds:['label-line'],imageRegions:[]}}],statements:[{kind:'claim' as const,label:'Sugar Free',text:'SUGAR FREE - FREE OF SUGAR, FULL OF TASTE',status:'provisional' as const,evidence:{observationIds:['label-line'],imageRegions:[]}}]};
    const reconstructedData=assistInput.parse({...data,package:{...data.package,reconstruction:packageWithFlour as PackageReconstructionContent&{revision:number;updatedAt:string;model:string;current:boolean}}});
    const compactParsed=replaceReferenceIds(parseAgentProviderOutput(JSON.stringify({answer:evidenceLinkedAnswer,evidenceIds:['SRC_1','package-fact:statement:0','package-fact:ingredient:0','ROW_1','CALC_1'],limitations:[],inspectImage:null})).output,new Map([['ROW_1','carbohydrates-per-serving'],['CALC_1','carbohydrate-serving'],['SRC_1','who-healthy-diet-guidance']]));
    const compactResult=validateClaims(compactParsed,reconstructedData);
    expect(compactParsed.claims).toHaveLength(3);
    expect(compactResult.claims.map(claim=>claim.text)).toEqual([
      'The package displays Sugar Free.',
      'The primary ingredient is refined wheat flour at nearly 90%.',
      'The nutrition table lists 9.28 g of carbohydrates per 13.4 g serving.',
    ]);
    expect(compactResult.answer).not.toContain('International Diabetes Federation');
    expect(compactResult.answer).toContain('nearly 90%');
    expect(compactResult.answer).toContain('9.28 g');

    vi.stubEnv('ENABLE_GEMINI','true');vi.stubEnv('GEMINI_PROVIDER','free');vi.stubEnv('GEMINI_MODEL','gemini-3.8-flash');vi.stubEnv('FREE_GEMINI_API_KEY','offline-test-key');
    const providerPayload=JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({answer,evidenceIds,limitations:[],inspectImage:null})}],role:'model'},finishReason:'STOP',index:0}],modelVersion:'gemini-3.8-flash-test',usageMetadata:{promptTokenCount:120,candidatesTokenCount:90,totalTokenCount:210}});
    const fetcher=vi.fn().mockResolvedValue(new Response(providerPayload,{status:200,headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetcher);
    const livePath=await assist(data);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(livePath).toMatchObject({status:'ok',answer,agentDiagnostics:{acceptedClaims:1,answerStatus:'model-answer'}});
  });
  it('avoids a second answer generation when a valid synthesis adds useful package coverage', async()=>{
    vi.stubEnv('ENABLE_GEMINI','true');vi.stubEnv('GEMINI_PROVIDER','free');vi.stubEnv('GEMINI_MODEL','gemini-3.8-flash');vi.stubEnv('FREE_GEMINI_API_KEY','offline-test-key');
    const observations=[
      {id:'serving-line',field:'label-note',text:'SERVING SIZE 2 biscuits approximately 13.4 g',side:'back' as const,confidence:80,origin:'ocr' as const},
      {id:'carbs-line',field:'label-note',text:'CARBOHYDRATES 9.28 g per serving',side:'back' as const,confidence:82,origin:'ocr' as const},
      {id:'ingredient-line',field:'label-note',text:'INGREDIENTS: REFINED WHEAT FLOUR (MAIDA)',side:'back' as const,confidence:84,origin:'ocr' as const},
      {id:'claim-line',field:'label-note',text:'NO ADDED SUGARS',side:'front' as const,confidence:88,origin:'ocr' as const},
    ];
    const reconstruction:PackageReconstructionContent={
      identity:{brand:'Example Foods',name:'Biscuits',variant:null,status:'provisional',evidence:{observationIds:['ingredient-line'],imageRegions:[]}},
      serving:{printedText:'2 biscuits approximately 13.4 g',quantity:13.4,unit:'g',pieceCount:2,pieceDescription:'biscuits',status:'provisional',evidence:{observationIds:['serving-line'],imageRegions:[]}},
      nutritionRows:[{rowId:'carbohydrates-per-serving',nutrient:'Carbohydrates',printedLabel:'Carbohydrates',printedValue:'9.28 g',value:9.28,unit:'g',columnLabel:'Per serving',basisText:'per serving',basisAmount:13.4,basisUnit:'g',qualifier:null,status:'provisional',evidence:{observationIds:['carbs-line'],imageRegions:[]}}],
      ingredients:[{position:0,name:'Refined wheat flour',printedText:'REFINED WHEAT FLOUR (MAIDA)',printedPercentage:null,normalizedName:'refined wheat flour',status:'provisional',evidence:{observationIds:['ingredient-line'],imageRegions:[]}}],
      additives:[],statements:[{kind:'claim',label:'No added sugars',text:'NO ADDED SUGARS',status:'provisional',evidence:{observationIds:['claim-line'],imageRegions:[]}}],regions:[],unresolved:[],interpretationNote:'Provisional package interpretation.',
    };
    const initial={answer:'',claims:[],packageReconstruction:reconstruction,limitations:[],inspectImage:null};
    const answer='This is not a strong everyday snack default: the ingredient list starts with refined wheat flour, and the label lists 9.28 g of carbohydrates for one serving of two biscuits (about 13.4 g). The label also states that no sugars are added.';
    const synthesis={answer,claims:[
      {mode:'synthesis',text:'The ingredient list starts with refined wheat flour.',observationIds:[],sourceIds:[],packageFactIds:['package-fact:ingredient:0']},
      {mode:'synthesis',text:'The serving is two biscuits (about 13.4 g) and the table lists 9.28 g carbohydrates.',observationIds:[],sourceIds:[],interpretationRowIds:['carbohydrates-per-serving'],packageFactIds:['package-fact:serving']},
      {mode:'synthesis',text:'The packet states that no sugars are added.',observationIds:[],sourceIds:[],packageFactIds:['package-fact:statement:0']},
    ],limitations:[],inspectImage:null};
    const payload=(value:unknown)=>JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(value)}],role:'model'},finishReason:'STOP',index:0}],modelVersion:'gemini-3.8-flash-test',usageMetadata:{promptTokenCount:120,candidatesTokenCount:90,totalTokenCount:210}});
    const fetcher=vi.fn()
      .mockResolvedValueOnce(new Response(payload(initial),{status:200,headers:{'content-type':'application/json'}}))
      .mockResolvedValueOnce(new Response(payload(synthesis),{status:200,headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetcher);
    const data=assistInput.parse({consent:true,question:'Is this a good daily snack?',package:{id:'coverage-improvement',name:'Biscuits',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],reconstruction:{...reconstruction,revision:1,updatedAt:new Date().toISOString(),model:'fixture',current:true},observations,rawText:observations.map(item=>item.text).join('\n'),warnings:[],synthetic:false,createdAt:new Date().toISOString()}});

    const result=await assist(data);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.answer).toBe(answer);
    const coverage=packageAnswerCoverage(data.question,reconstruction,result.claims,[],result.answer);
    expect(coverage.covered).toBe(4);
    expect(coverage.missing).toEqual([]);
  });
  it('recognizes a concise paraphrase of a linked package claim without requiring an OCR quotation',()=>{
    const reconstruction:PackageReconstructionContent={
      identity:{brand:null,name:null,variant:null,status:'unreadable',evidence:{observationIds:[],imageRegions:[]}},
      serving:null,nutritionRows:[],ingredients:[],additives:[],
      statements:[{kind:'claim',label:'No Added Sugars',text:'NO ADDED SUGARS',status:'provisional',evidence:{observationIds:['claim-line'],imageRegions:[]}}],
      regions:[],unresolved:[],interpretationNote:'A provisional package claim.',
    };
    const claims=[{mode:'synthesis' as const,text:'The packet carries a no added sugars claim.',observationIds:[],sourceIds:[],packageFactIds:['package-fact:statement:0']}];
    const covered=packageAnswerCoverage('Is this suitable as a regular snack?',reconstruction,claims,[],"It is labeled as having no added sugar.");
    const omitted=packageAnswerCoverage('Is this suitable as a regular snack?',reconstruction,claims,[],"The snack may fit your preferences.");
    expect(covered).toMatchObject({available:1,covered:1,availableFacets:['nutrition-claim'],missing:[]});
    expect(omitted).toMatchObject({available:1,covered:0,missing:['nutrition-claim']});
  });
  it('classifies a Gemini rejection without retaining provider error text', () => {
    const error = Object.assign(new Error('got status: INVALID_ARGUMENT. {"error":{"code":400,"status":"INVALID_ARGUMENT","message":"Invalid value at \'generationConfig.responseJsonSchema.properties.secret\': PRIVATE PACKAGE TEXT"}}'), { status: 400 });
    const safe = safeProviderFailure(error);
    expect(safe).toMatchObject({ status: 400, failureClass: 'request-rejected', providerStatus: 'INVALID_ARGUMENT', providerReasonClass: 'response-schema', providerFieldPath: 'generationConfig.responseJsonSchema.properties.secret' });
    expect(JSON.stringify(safe)).not.toContain('PRIVATE PACKAGE TEXT');
  });
  it('keeps a supported answer and withholds sibling claims with unknown citations', async () => {
    vi.stubEnv('ENABLE_GEMINI', 'true'); vi.stubEnv('GEMINI_PROVIDER', 'free'); vi.stubEnv('GEMINI_MODEL', 'gemini-3.8-flash'); vi.stubEnv('FREE_GEMINI_API_KEY', 'offline-test-key');
    const invalid = JSON.stringify({ answer: 'Protein 3 g', answerParts: [{ text: 'Protein 3 g', claimIndexes: [0] }], packageReconstruction:{identity:{brand:null,name:null,variant:null,status:'unreadable',evidence:{observationIds:['protein-observation'],imageRegions:[]}},serving:null,nutritionRows:[],ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'The product identity and table remain unresolved.'},claims: [
      { mode: 'direct-quote', text: 'Protein 3 g', observationIds: ['protein-observation'], sourceIds: [], supportingSpans: [{ kind: 'observation', id: 'protein-observation', quote: 'Protein 3 g' }] },
      { mode: 'direct-quote', text: 'invented citation', observationIds: ['unknown-observation'], sourceIds: [], supportingSpans: [{ kind: 'observation', id: 'unknown-observation', quote: 'invented citation' }] },
      { mode: 'synthesis', text: 'An unsupported uncited claim.', observationIds: [], sourceIds: [], supportingSpans: [] },
    ], limitations: [], inspectImage: null });
    const payload = JSON.stringify({ candidates: [{ content: { parts: [{ text: invalid }], role: 'model' }, finishReason: 'STOP', index: 0 }], modelVersion: 'gemini-3.8-flash-test', usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 20, totalTokenCount: 32 } });
    const fetcher = vi.fn().mockImplementation(() => new Response(payload, { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    const data = assistInput.parse({ consent: true, question: 'What does this package show?', package: { id: 'package-1', name: 'Unidentified package', ingredients: [], additives: [], allergens: [], claims: [], nutrients: [], observations: [{ id: 'protein-observation', field: 'protein', text: 'Protein 3 g', side: 'text', confidence: 100, origin: 'ocr' }], rawText: 'Protein 3 g', warnings: [], synthetic: true, createdAt: new Date().toISOString() } });

    const result = await assist(data);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'ok', answer: 'Protein 3 g', agentDiagnostics: { acceptedClaims: 1, rejectedClaims: 2, answerStatus: 'model-answer' } });
    expect(result.claims.map(claim => claim.text)).toEqual(['Protein 3 g']);
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
    const valid = { answer: 'Unsupported extra medical assertion', claims: [{ mode:'direct-quote',text: 'sugar 3g', observationIds: ['o1'], sourceIds: [], supportingSpans: [{ kind: 'observation', id: 'o1', quote: 'sugar 3g' }] }], limitations: ['Take this amount to manage diabetes.'], inspectImage: null };
    expect(validateClaims(valid, data).claims).toHaveLength(1);
    expect(validateClaims(valid, data).answer).toContain('could not safely assemble it into a clear answer');
    expect(validateClaims(valid, data).answer).not.toContain('medical assertion');
    expect(validateClaims(valid, data).answer).not.toContain('diabetes');
    expect(validateClaims(valid, data).limitations.join(' ')).not.toContain('manage diabetes');
    expect(validateClaims(valid, data).limitations).toEqual(['Generated explanations are not independently verified. Tentative candidates never alter original package observations. The application may use a complete OCR-linked candidate only for explicitly labeled arithmetic after checking its evidence and layout; that reading remains unverified. Image-only text and region references stay outside calculations. No diagnosis, medication advice, or safety assessment is provided.']);
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
  it('withholds unsupported diabetes safety advice even when it cites a real sugar observation', () => {
    const data = assistInput.parse({ consent: true, question: 'Is this safe for diabetes?', package: { id: 'test', name: 'Test', ingredients: [], additives: [], allergens: [], claims: [], nutrients: [], observations: [{ id: 'sugar-observation', field: 'sugar', text: 'sugar 3g', side: 'text', confidence: null, origin: 'ocr' }], rawText: '', warnings: [], synthetic: false, createdAt: new Date().toISOString() } });
    const output = { answer: 'It is suitable for diabetes.', claims: [{ mode:'synthesis',text: 'Sugar 3g is safe for diabetes.', observationIds: ['sugar-observation'], sourceIds: [], supportingSpans: [{ kind: 'observation', id: 'sugar-observation', quote: 'sugar 3g' }] }], limitations: [], inspectImage: null };
    const result = validateClaims(output, data);
    expect(result.claims).toEqual([]);
    expect(result.answer).not.toMatch(/safe for diabetes|suitable for diabetes/i);
    expect(result.answer).toContain('can’t establish a reliable answer');
    expect(result.answer).not.toMatch(/personal health effects or product safety/);
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
