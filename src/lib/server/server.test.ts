import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, fixedFetch, input, localGate, readBounded, route } from './http';
import { lookupProducts, normalizeProduct, productInput } from './products';
import { assistInput, assistOutput, linkVisionResponseToCapture, providerStatus, validateClaims, validateImage, vision, visionInput } from './gemini';
import { research, researchInput, researchRecalls } from './research';
import { z } from 'zod';

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

describe('public source normalization', () => {
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
  it('exposes required quote spans in the structured provider response schema', () => {
    const providerSchema = z.toJSONSchema(assistOutput);
    expect(JSON.stringify(providerSchema)).toContain('supportingSpans');
    expect(JSON.stringify(providerSchema)).toContain('quote');
    expect(JSON.stringify(providerSchema)).toContain('mode');
    expect(assistOutput.safeParse({answer:'',claims:[{text:'A paraphrase',observationIds:[],sourceIds:[],supportingSpans:[]}],limitations:[],inspectImage:null}).success).toBe(false);
  });
  it('cannot enable the provider using just a key or search flag', () => {
    vi.stubEnv('ENABLE_GEMINI', 'false'); vi.stubEnv('ENABLE_GEMINI_SEARCH', 'true'); vi.stubEnv('GEMINI_API_KEY', 'test-only-placeholder'); vi.stubEnv('GEMINI_MODEL', 'gemini-test');
    expect(providerStatus()).toMatchObject({ configured: true, enabled: false, searchEnabled: false }); expect(JSON.stringify(providerStatus())).not.toContain('test-only-placeholder');
  });
  it('rejects forged citations and unknown browser image handles', () => {
    const data = assistInput.parse({ consent: true, question: 'What is visible?', package: { id: 'test', name: 'Test', userDescription: 'User says it is a cereal snack.', ingredients: [], additives: [], allergens: [], claims: [], nutrients: [], observations: [{ id: 'o1', field: 'sugar', text: 'sugar 3g', side: 'text', confidence: null, origin: 'user' }, { id: 'o2', field: 'user-description', text: 'User says it is a cereal snack.', side: 'text', confidence: null, origin: 'user' }], rawText: '', warnings: [], synthetic: true, createdAt: new Date().toISOString() } });
    expect(data.package.userDescription).toBe('User says it is a cereal snack.');
    const valid = { answer: 'Unsupported extra medical assertion', claims: [{ mode:'direct-quote',text: 'sugar 3g', observationIds: ['o1'], sourceIds: [], supportingSpans: [{ kind: 'observation', id: 'o1', quote: 'sugar 3g' }] }], limitations: ['Take this amount to manage diabetes.'], inspectImage: null };
    expect(validateClaims(valid, data).claims).toHaveLength(1);
    expect(validateClaims(valid, data).answer).toBe('Package observation: “sugar 3g” [observation:o1]');
    expect(validateClaims(valid, data).answer).not.toContain('medical assertion');
    expect(validateClaims(valid, data).answer).not.toContain('diabetes');
    expect(validateClaims(valid, data).limitations.join(' ')).not.toContain('manage diabetes');
    expect(validateClaims(valid, data).limitations).toEqual(['Generated explanations are not independently verified; exact cited evidence spans are provided for inspection. Tentative structured candidates never alter confirmed package observations. No diagnosis, medication advice, or safety assessment is provided.']);
    expect(() => validateClaims({ ...valid, claims: [{ mode:'direct-quote',text: 'Claim', observationIds: ['missing'], sourceIds: [], supportingSpans: [{ kind: 'observation', id: 'missing', quote: 'Claim' }] }] }, data)).toThrow('unknown evidence');
    expect(() => validateClaims({ ...valid, inspectImage: { handle: 'not-owned', reason: 'Read label' } }, data)).toThrow('unknown browser image');
  });
  it('withholds unsupported diabetes safety advice even when it cites a real sugar observation', () => {
    const data = assistInput.parse({ consent: true, question: 'Is this safe for diabetes?', package: { id: 'test', name: 'Test', ingredients: [], additives: [], allergens: [], claims: [], nutrients: [], observations: [{ id: 'sugar-observation', field: 'sugar', text: 'sugar 3g', side: 'text', confidence: null, origin: 'ocr' }], rawText: '', warnings: [], synthetic: false, createdAt: new Date().toISOString() } });
    const output = { answer: 'It is suitable for diabetes.', claims: [{ mode:'synthesis',text: 'Sugar 3g is safe for diabetes.', observationIds: ['sugar-observation'], sourceIds: [], supportingSpans: [{ kind: 'observation', id: 'sugar-observation', quote: 'sugar 3g' }] }], limitations: [], inspectImage: null };
    const result = validateClaims(output, data);
    expect(result.claims).toEqual([]);
    expect(result.answer).not.toMatch(/safe for diabetes|suitable for diabetes/i);
    expect(result.answer).toContain('No supported factual conclusion');
    expect(result.answer).toContain('does not establish personal health effects or product safety');
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
});
