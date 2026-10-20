import { z } from 'zod';
import type { NutrientKey, ProductRecord } from '../contracts';
import { ApiError, fixedFetch, plain } from './http';

export const productInput = z.object({ query: z.string().trim().min(2).max(100).optional(), barcode: z.string().regex(/^\d{8,14}$/).optional(), alternatives: z.boolean().optional(), country:z.string().trim().min(2).max(80).optional(), excludeBarcode:z.string().regex(/^\d{8,14}$/).optional() }).strict().refine(v => Boolean(v.query || v.barcode), 'A query or barcode is required.');
const fields = 'code,product_name,brands,quantity,countries_tags,nutriments,ingredients_text,allergens_tags,last_modified_t,nutrition_data_per,nutrition_data_prepared_per,product_quantity_unit';
const recordSchema = z.object({ code: z.union([z.string(), z.number()]).optional(), product_name: z.string().optional(), brands: z.union([z.string(), z.array(z.string())]).optional(), quantity: z.string().optional(), countries_tags: z.array(z.string()).optional(), nutriments: z.record(z.string(), z.unknown()).optional(), ingredients_text: z.string().optional(), allergens_tags: z.array(z.string()).optional(), last_modified_t: z.number().optional(), nutrition_data_per: z.string().optional(), product_quantity_unit: z.string().optional() }).passthrough();
const map: [string, NutrientKey, string, number][] = [['energy-kcal', 'energy', 'kcal', 1], ['carbohydrates', 'carbohydrate', 'g', 1], ['sugars', 'sugars', 'g', 1], ['added-sugars', 'addedSugars', 'g', 1], ['proteins', 'protein', 'g', 1], ['fat', 'fat', 'g', 1], ['saturated-fat', 'saturatedFat', 'g', 1], ['fiber', 'fiber', 'g', 1], ['sodium', 'sodium', 'mg', 1000], ['salt', 'salt', 'g', 1]];

export function normalizeProduct(raw: unknown, exact?: string): ProductRecord | null {
  const parsed = recordSchema.safeParse(raw); if (!parsed.success) return null;
  const p = parsed.data; const code = String(p.code ?? '');
  if (!/^\d{8,14}$/.test(code) || !p.product_name) return null;
  const unit = p.nutrition_data_per === '100ml' ? 'ml' : p.nutrition_data_per === '100g' ? 'g' : null;
  const nutrients: ProductRecord['nutrients'] = [];
  for (const [field, key, outputUnit, factor] of map) {
    const value = p.nutriments?.[`${field}_100g`];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value * factor <= 100000) nutrients.push({ key, value: value * factor, unit: outputUnit, basis: unit ? { amount: 100, unit } : null });
  }
  const modified = p.last_modified_t ? new Date(p.last_modified_t * 1000) : null;
  return { id: `off-${code}`, name: plain(p.product_name, 200), brand: plain(Array.isArray(p.brands) ? p.brands.join(', ') : p.brands, 120), barcode: code, quantity: plain(p.quantity, 100), countries: (p.countries_tags ?? []).slice(0, 30).map(c => plain(c, 100)), url: `https://world.openfoodfacts.org/product/${code}`, retrievedAt: new Date().toISOString(), lastModified: modified && !Number.isNaN(modified.getTime()) ? modified.toISOString() : null, nutrients, ingredients: plain(p.ingredients_text, 5000), allergens: (p.allergens_tags ?? []).slice(0, 30).map(a => plain(a, 100)), match: code === exact ? 'barcode' : 'candidate', availability: 'local stock unverified', confidence: 'Community record; verify against your package', warnings: ['Crowdsourced product data can be incomplete, stale or refer to another regional formulation.', ...(unit ? [] : ['The nutrition mass/volume basis could not be established. Do not compare these values with a package yet.'])] };
}

export async function lookupProducts(data: z.infer<typeof productInput>) {
  let url: URL; let searchBody: object | undefined;
  const countrySlug=data.country?.trim().toLowerCase().replace(/\s+/g,'-');
  if(data.alternatives&&countrySlug&&!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(countrySlug))throw new ApiError(400,'invalid_country','Enter a country name in English to filter candidate listings.');
  if (data.barcode && !data.alternatives) { url = new URL(`https://world.openfoodfacts.org/api/v2/product/${data.barcode}.json`); url.searchParams.set('fields', fields); }
  else {
    // Official Search-a-licious POST supports full text. Free-text terms never
    // supply filter syntax; the optional country tag is normalized separately.
    url = new URL('https://search.openfoodfacts.org/search');
    const terms = (data.query ?? data.barcode!).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(t => t && !['and', 'or', 'not', 'to'].includes(t));
    if (!terms.length) throw new ApiError(400, 'invalid_input', 'Enter a product name or valid barcode.');
    searchBody = { q: `${terms.join(' ')}${data.alternatives && countrySlug ? ` countries_tags:"en:${countrySlug}"` : ''}`, page_size: 4, fields: fields.split(','), langs: ['en'] };
  }
  const raw = await fixedFetch(url, 'json', 900_000, searchBody) as { product?: unknown; products?: unknown[]; hits?: unknown[]; status?: number };
  const countryTag=countrySlug?`en:${countrySlug}`:undefined;
  let products = (Array.isArray(raw.hits) ? raw.hits : Array.isArray(raw.products) ? raw.products : raw.product ? [raw.product] : []).map(p => normalizeProduct(p, data.barcode)).filter((p): p is ProductRecord => Boolean(p)).filter(p => !data.alternatives || !countryTag || p.countries.includes(countryTag)).filter(p=>!data.alternatives||!data.excludeBarcode||p.barcode!==data.excludeBarcode).slice(0, 4);
  if (searchBody) {
    // The search index may omit the basis and modification timestamp. Retrieve
    // only the four selected records through the canonical product endpoint.
    // Failed enrichment leaves the original candidate explicitly incomplete.
    const detailed = await Promise.allSettled(products.map(async product => {
      const exactUrl = new URL(`https://world.openfoodfacts.org/api/v2/product/${product.barcode}.json`); exactUrl.searchParams.set('fields', fields);
      const detail = await fixedFetch(exactUrl) as { product?: unknown };
      const enriched = normalizeProduct(detail.product, data.barcode);
      return enriched && (!data.alternatives || !countryTag || enriched.countries.includes(countryTag)) ? enriched : product;
    }));
    products = detailed.map((result, index) => result.status === 'fulfilled' ? result.value : products[index]);
  }
  return { status: products.length ? 'ok' : 'empty', products, message: data.alternatives ? countryTag ? `Candidate products tagged for ${data.country}. This does not establish local stock, suitability, or a better formulation. Compare labels on the same basis.` : 'Possible community-catalog candidates. Country tags may be missing or stale, and current stock is unverified. Compare exact product labels on the same basis; no better formulation is implied.' : products.some(p => p.match === 'barcode') ? 'Exact barcode database match. Verify regional formulation and label date; this is not manufacturer verification.' : 'Text matches are candidates only. Match barcode, region and formulation against your package.' };
}
