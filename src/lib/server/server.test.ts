import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, fixedFetch, input, localGate, readBounded, route } from './http';
import { lookupProducts, normalizeProduct, productInput } from './products';
import { assistInput, providerStatus, validateClaims, validateImage, visionInput } from './gemini';
import { research, researchInput, researchRecalls } from './research';
import { z } from 'zod';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const request = (body: unknown, origin = 'http://127.0.0.1:3400') => new Request('http://127.0.0.1:3400/api/test', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });

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
    expect(visionInput.safeParse({ consent: false, image: { mimeType: 'image/png', base64: 'a'.repeat(20), side: 'back' } }).success).toBe(false);
  });
  it('rejects untrusted URL destinations without fetching', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(fixedFetch(new URL('https://www.ebi.ac.uk.evil.example/search'))).rejects.toMatchObject({ code: 'url_rejected' });
    await expect(fixedFetch(new URL('http://127.0.0.1/private'))).rejects.toMatchObject({ code: 'url_rejected' });
    expect(fetcher).not.toHaveBeenCalled();
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
  it('does not invent a mass/volume basis from package volume', () => {
    const product = normalizeProduct({ code: '8901234567890', product_name: 'Drink', product_quantity_unit: 'ml', nutriments: { sugars_100g: 8 } })!;
    expect(product.nutrients[0].basis).toBeNull(); expect(product.warnings?.join(' ')).toContain('could not be established');
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
    expect(result.items.every(item => /could not retrieve usable source text/i.test(item.summary))).toBe(true);
    expect(result.items.every(item => /navigation only/i.test(item.limitations))).toBe(true);
    expect(result.message).toMatch(/no source text.*current-law verdict/i);
  });
});

describe('provider validation, independent of provider invocation', () => {
  it('cannot enable the provider using just a key or search flag', () => {
    vi.stubEnv('ENABLE_GEMINI', 'false'); vi.stubEnv('ENABLE_GEMINI_SEARCH', 'true'); vi.stubEnv('GEMINI_API_KEY', 'test-only-placeholder'); vi.stubEnv('GEMINI_MODEL', 'gemini-test');
    expect(providerStatus()).toMatchObject({ configured: true, enabled: false, searchEnabled: false }); expect(JSON.stringify(providerStatus())).not.toContain('test-only-placeholder');
  });
  it('rejects forged citations and unknown browser image handles', () => {
    const data = assistInput.parse({ consent: true, question: 'What is visible?', package: { id: 'test', name: 'Test', userDescription: 'User says it is a cereal snack.', ingredients: [], additives: [], allergens: [], claims: [], nutrients: [], observations: [{ id: 'o1', field: 'sugar', text: 'sugar 3g', side: 'text', confidence: null, origin: 'user' }, { id: 'o2', field: 'user-description', text: 'User says it is a cereal snack.', side: 'text', confidence: null, origin: 'user' }], rawText: '', warnings: [], synthetic: true, createdAt: new Date().toISOString() } });
    expect(data.package.userDescription).toBe('User says it is a cereal snack.');
    const valid = { answer: 'Unsupported extra medical assertion', claims: [{ text: 'Sugar 3g', observationIds: ['o1'], sourceIds: [] }], limitations: [], inspectImage: null };
    expect(validateClaims(valid, data).claims).toHaveLength(1);
    expect(validateClaims(valid, data).answer).toBe('Sugar 3g [observation:o1]');
    expect(validateClaims(valid, data).answer).not.toContain('medical assertion');
    expect(() => validateClaims({ ...valid, claims: [{ text: 'Claim', observationIds: ['missing'], sourceIds: [] }] }, data)).toThrow('unknown evidence');
    expect(() => validateClaims({ ...valid, inspectImage: { handle: 'not-owned', reason: 'Read label' } }, data)).toThrow('unknown browser image');
  });
  it('rejects spoofed MIME and malformed image bytes before transmitting', async () => {
    await expect(validateImage({ mimeType: 'image/png', base64: Buffer.from('not an image bytes').toString('base64'), side: 'back' })).rejects.toMatchObject({ code: 'invalid_image' });
    await expect(validateImage({ mimeType: 'image/jpeg', base64: Buffer.from([255, 216, 255, 1, 2, 3]).toString('base64'), side: 'front' })).rejects.toMatchObject({ code: 'invalid_image' });
  });
});
