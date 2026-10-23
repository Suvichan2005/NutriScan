import { Type, type FunctionDeclaration } from '@google/genai';
import { z } from 'zod';
import {
  calculationEvidenceText,
  calculationSchema,
  nutrientKeys,
  normalizedCropSchema,
  sourceSchema,
  type Calculation,
  type EvidenceSource,
  type PackageData,
  type TentativeStructuredCandidate,
} from '../contracts';
import { matchesPackageRows, reconcileInterpretedNutrition } from '../interpreted-nutrients';
import { evidenceSources, lookupAdditive, lookupExplicitAdditiveMention, resolveTentativeAdditiveIdentity } from '../../modules/knowledge';
import { searchOpenFoodTox, semanticRetrieve } from '../semantic';
import { searchFoodComposition, type FoodCompositionFood } from './food-composition';
import type { OpenFoodToxHit, OpenFoodToxSearch } from '../../modules/knowledge/server';
import { isValidGtin, findOcrGtinCandidate } from '../barcode';
import { productInput, lookupProducts } from './products';
import { researchInput, research } from './research';
import { fixedFetch } from './http';

const imageIdSchema = z.string().min(1).max(160);
const querySchema = z.string().trim().min(2).max(180);
const toolArgs = {
  inspect_package_image: z.object({ imageId: imageIdSchema, crop: normalizedCropSchema.optional() }).strict(),
  search_knowledge: z.object({ query: querySchema }).strict(),
  search_food_composition: z.object({ query: z.string().trim().min(2).max(180), nutrients: z.array(z.string().trim().min(2).max(80)).max(8).optional() }).strict(),
  resolve_ingredient: z.object({ query: querySchema }).strict(),
  lookup_chemical_identity: z.object({ query: querySchema }).strict(),
  get_substance_assessments: z.object({ query: querySchema }).strict(),
  calculate_nutrition: z.object({ nutrient: z.enum(nutrientKeys), amount: z.number().finite().positive().max(10000), unit: z.enum(['g', 'ml']), candidateId:z.string().min(1).max(120).optional() }).strict(),
  lookup_product: z.object({ query: z.string().trim().min(2).max(80).optional(), barcode: z.string().regex(/^\d{8,14}$/).optional() }).strict().refine(value => Number(Boolean(value.query)) + Number(Boolean(value.barcode)) === 1),
  search_research: z.object({ query: querySchema, topic: z.enum(['science', 'regulation', 'claims']) }).strict(),
};

const cropParameters = {
  type: Type.OBJECT,
  properties: {
    x: { type: Type.NUMBER, description: 'Left edge from 0 to 1, relative to the attached image.' },
    y: { type: Type.NUMBER, description: 'Top edge from 0 to 1, relative to the attached image.' },
    width: { type: Type.NUMBER, description: 'Crop width from 0 to 1.' },
    height: { type: Type.NUMBER, description: 'Crop height from 0 to 1.' },
  },
  required: ['x', 'y', 'width', 'height'] as string[],
};

export const geminiToolDeclarations: FunctionDeclaration[] = [
  { name: 'inspect_package_image', description: 'Inspect an attached original package photo or a focused crop using your visual understanding. Use only when OCR is unclear or visual confirmation adds evidence. The photo must already be attached to this request.', parameters: { type: Type.OBJECT, properties: { imageId: { type: Type.STRING, description: 'Exact imageId from the attached package images.' }, crop: cropParameters }, required: ['imageId'] } },
  { name: 'search_knowledge', description: 'Search NutriScan’s local, attributed food and ingredient evidence index. This does not make a network request.', parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: 'A focused food, nutrient, ingredient, or guidance query.' } }, required: ['query'] } },
  { name: 'search_food_composition', description: 'Search local USDA FoodData Central Foundation Foods and FNDDS structured snapshots for generic food-composition reference values. FNDDS includes U.S. survey records for some Indian-style dishes, not authoritative Indian recipes. Use when the user asks how a basic food compares or requests composition context; request relevant nutrient families. Values are source-reported per 100 g edible portion, not facts about a branded Indian product, its package, portion or an individual. Survey portion examples are not package servings. Missing nutrient rows are unavailable, not zero. Includes release, source citation, license and limitations. No external query is sent.', parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: 'A specific generic food name or phrase, such as dry chickpeas, idli, chapatti or roti.' }, nutrients: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Up to eight requested nutrient families, such as protein, carbohydrate, fiber, sodium, potassium, energy, or saturated fat. Omit to return common macronutrient and sodium fields.' } }, required: ['query'] } },
  { name: 'resolve_ingredient', description: 'Resolve an observed additive name or INS/E identifier against NutriScan’s local identity registry. Presence and amount still require package evidence.', parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: 'Observed ingredient phrase or additive identifier.' } }, required: ['query'] } },
  { name: 'lookup_chemical_identity', description: 'Read-only PubChem PUG REST lookup of a chemical name already present in the user question/package text or returned by exact local ingredient or assessment lookup. Returns registry identity candidates only, not food-use authorization, dose, hazard assessment or personal safety. Sends only the name; never photos or profile data.', parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: 'A specific chemical name from the question, printed package text or an exact local identity result, not a numeric value or general food question.' } }, required: ['query'] } },
  { name: 'get_substance_assessments', description: 'Search the locally imported EFSA OpenFoodTox 3.0 assessment snapshot for a named substance or exact identifier. Returns attributed EFSA assessment records and toxicological reference values when available. The local snapshot may only link a scientific output without its conclusion; if the user asks what the linked assessment found, follow that title with search_research using the exact local identity returned. Use to distinguish hazard assessments from package exposure; this does not establish Indian authorization, package dose, product presence or personal safety. No network request is made.', parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: 'A substance name, synonym, CAS number or PubChem CID from the question, package text or a locally resolved ingredient identity.' } }, required: ['query'] } },
  { name: 'calculate_nutrition', description: 'Calculate a portion from an unconflicted package nutrient or a complete, currently attached photo/OCR-linked Gemini candidate. Candidate-based arithmetic remains explicitly unverified and never changes the package record. A matching known mass or volume basis is required.', parameters: { type: Type.OBJECT, properties: { nutrient: { type: Type.STRING, enum: [...nutrientKeys] }, amount: { type: Type.NUMBER, description: 'Portion amount in grams or millilitres.' }, unit: { type: Type.STRING, enum: ['g', 'ml'] }, candidateId:{type:Type.STRING,description:'Optional exact candidateId from the supplied tentative interpretations; only use when that candidate has been reconciled to its evidence.'} }, required: ['nutrient', 'amount', 'unit'] } },
  { name: 'lookup_product', description: 'Read-only Open Food Facts search by an exact barcode or product text explicitly present in the user question or package observations. Sends only that query to the public catalog; never sends images or profile data. Results are community candidates, not confirmed package facts.', parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: 'A product name or brand present in the question or visible package OCR.' }, barcode: { type: Type.STRING, description: 'An exact 8–14 digit barcode present in the question or package OCR.' } } } },
  { name: 'search_research', description: 'Read-only search of Europe PMC or NutriScan’s fixed official India regulation sources. External query terms must be present in the user question/package OCR or a successful exact local identity lookup. If a local registry supplies only publication links and the user asks for the assessment finding, search the linked entity/topic rather than inferring the finding from metadata. Search results are candidates, not an evidence synthesis.', parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: 'Focused terms drawn from the explicit question, package OCR or successful exact local identity results.' }, topic: { type: Type.STRING, enum: ['science', 'regulation', 'claims'] } }, required: ['query', 'topic'] } },
];

export type GeminiToolImage = {
  imageId: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  base64: string;
  side: 'front' | 'back' | 'extra';
  sourceImage: { width: number; height: number };
  preprocessing: { rotation: 0 | 90 | 180 | 270; contrast: boolean; invert: boolean; crop: { x: number; y: number; width: number; height: number } | null };
};

export type GeminiToolResult = {
  output: Record<string, unknown>;
  evidence?: EvidenceSource[];
  calculations?: Calculation[];
  image?: { mimeType: 'image/jpeg'; base64: string };
  /** Canonical terms returned by a successful local identity lookup; only these may extend later research queries. */
  searchTerms?: string[];
  status: 'ok' | 'empty' | 'withheld' | 'unavailable' | 'error';
  resultCount: number;
};

export type GeminiToolContext = {
  question: string;
  package: PackageData;
  interpretedCandidates?: TentativeStructuredCandidate[];
  visualImages: GeminiToolImage[];
  searchTerms: Set<string>;
  prepareImage: (image: GeminiToolImage) => Promise<string>;
};

const defaultFdcNutrientIds = new Set([1003, 1004, 1005, 1079, 1092, 1093, 1258, 2000, 2033, 2047, 2048, 1008]);
function nutrientFamilyIds(query: string) {
  const value = query.normalize('NFKC').toLocaleLowerCase('en');
  if (/protein/.test(value)) return new Set([1003]);
  if (/carb|starch/.test(value)) return new Set([1005, 1050]);
  if (/sugar/.test(value)) return new Set([1063, 2000]);
  if (/fib(er|re)/.test(value)) return new Set([1079, 2033]);
  if (/sodium|salt/.test(value)) return new Set([1093]);
  if (/potassium/.test(value)) return new Set([1092]);
  if (/saturat/.test(value)) return new Set([1258]);
  if (/energy|calor|kcal/.test(value)) return new Set([1008, 1062, 2047, 2048]);
  if (/fat|lipid/.test(value)) return new Set([1004]);
  if (/calcium/.test(value)) return new Set([1087]);
  if (/iron/.test(value)) return new Set([1089]);
  if (/magnesium/.test(value)) return new Set([1090]);
  if (/cholesterol/.test(value)) return new Set([1253]);
  return null;
}
export function selectFdcNutrients(food: FoodCompositionFood, requested?: string[]) {
  const requestedIds = requested?.map(nutrientFamilyIds) ?? [];
  const exactNames = (requested ?? []).map(value => value.normalize('NFKC').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()).filter(Boolean);
  return food.nutrients.filter(item => {
    if (!requested?.length) return defaultFdcNutrientIds.has(item.nutrientId);
    if (requestedIds.some(ids => ids?.has(item.nutrientId))) return true;
    const name = item.name.normalize('NFKC').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    return exactNames.some(value => name === value || name.includes(value) || value.includes(name));
  }).slice(0, 18);
}
export function fdcAmountText(item: { amount: number; unit: string; loq: number | null }) {
  if (item.amount === 0 && item.loq !== null && item.loq > 0) return `<${item.loq} ${item.unit} (below source quantification limit)`;
  return `${item.amount} ${item.unit}`;
}

async function searchFoodCompositionTool(args: z.infer<typeof toolArgs.search_food_composition>): Promise<GeminiToolResult> {
  try {
    const response = await searchFoodComposition(args.query, 3);
    if (response.status === 'unavailable') return { status: 'unavailable', resultCount: 0, output: { status: 'unavailable', reason: response.reason, message: response.reason === 'not-imported' ? 'The pinned local USDA Foundation Foods and FNDDS snapshots have not been imported in this checkout.' : 'The USDA food-composition index failed validation.' } };
    if (response.status === 'no_match') return { status: 'empty', resultCount: 0, output: { status: 'no_match', query: args.query, message: 'No sufficiently specific generic-food match was found in the local USDA Foundation Foods or FNDDS snapshots. This does not establish that no suitable reference exists.' } };
    const retrievedAt = new Date().toISOString();
    const matches = response.results.map(({ food, score, source: dataset }) => {
      const limitations = food.dataType === 'Foundation'
        ? 'USDA Foundation Foods describes analyzed or derived generic foods in the U.S. food supply, not an Indian branded package or its formulation. The record may reflect small, unweighted samples and source-specific methods. Missing nutrient rows mean unavailable, not zero. These values do not establish a user’s intake or individualized dietary advice.'
        : 'USDA FNDDS describes foods reported in U.S. dietary surveys, including generic recipes and food forms; it is not an Indian branded package or a canonical Indian recipe. Survey portions are references only and never substitute for the package serving declaration. Missing nutrient rows mean unavailable, not zero. These values do not establish a user’s intake or individualized dietary advice.';
      const nutrients = selectFdcNutrients(food, args.nutrients);
      const nutrientText = nutrients.length
        ? nutrients.map(item => `${item.name} (nutrient ID ${item.nutrientId}): ${fdcAmountText(item)} per 100 g edible portion${item.dataPoints !== null ? `; ${item.dataPoints} source data points` : ''}${item.min !== null && item.max !== null && item.min !== item.max ? `; source range ${item.min}–${item.max} ${item.unit}` : ''}${item.derivation ? `; ${item.derivation}` : ''}`).join('; ')
        : `No source values were available for requested nutrients (${(args.nutrients ?? []).join(', ') || 'default nutrients'}); absence is not zero.`;
      const sourceId = `usda-${food.dataType === 'Foundation' ? 'fdc-foundation' : 'fdc-fndds'}-${food.fdcId}-${dataset.releaseDate}`;
      const source = sourceSchema.parse({
        id: sourceId,
        title: `${food.description} — ${dataset.name}`,
        publisher: dataset.attribution,
        url: `https://fdc.nal.usda.gov/food-details/${food.fdcId}/nutrients`,
        category: 'food-composition',
        jurisdiction: food.dataType === 'Foundation' ? 'United States; generic Foundation Foods reference record, not a local branded-product record.' : 'United States; FNDDS dietary survey food reference, not an Indian branded-product record or national Indian food-composition reference.',
        publishedAt: food.publicationDate,
        effectiveAt: null,
        retrievedAt,
        summary: `FoodData Central food ID ${food.fdcId}: ${food.description}${food.category ? ` (${food.category})` : ''}. Dataset ${dataset.dataType}, release ${dataset.releaseDate}; source food publication date ${food.publicationDate}. Values are per 100 g edible portion. ${nutrientText}`.slice(0, 1600),
        limitations,
        license: `${dataset.license}. Source attribution: ${dataset.attribution}. ${dataset.licenseUrl}`,
      });
      return { source, score, fdcId: food.fdcId, description: food.description, category: food.category, dataType: food.dataType, publicationDate: food.publicationDate, portionBasis: { amount: 100, unit: 'g', description: 'edible portion' }, surveyPortionExamples: food.dataType === 'Survey (FNDDS)' ? food.portions.slice(0, 8).map(portion => ({ description: portion.description, gramWeight: portion.gramWeight, note: 'FNDDS reference portion; not this package’s declared serving.' })) : [], nutrients: nutrients.map(item => ({ nutrientId: item.nutrientId, name: item.name, amount: item.amount, unit: item.unit, loq: item.loq, reportedValue: fdcAmountText(item), dataPoints: item.dataPoints, min: item.min, max: item.max, median: item.median, derivation: item.derivation })), sourceId };
    });
    const evidence = matches.map(item => item.source);
    return { status: 'ok', resultCount: matches.length, evidence, output: { status: 'ok', datasets: response.sources, requestedQuery: args.query, nutrientSelection: args.nutrients ?? 'common macronutrients and sodium', results: matches, note: 'Foundation Foods and FNDDS are U.S. generic-food references. They can contextualize a question about a basic food but cannot confirm a photographed package formulation, an Indian population value, or an individualized target.' } };
  } catch {
    return { status: 'unavailable', resultCount: 0, output: { status: 'unavailable', message: 'The local USDA food-composition snapshot could not be read or validated. Do not substitute a package value or infer that no reference data exists.' } };
  }
}

function tokens(value: string) {
  return value.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}
const genericKnowledgeTerms = new Set(['food', 'foods', 'product', 'products', 'package', 'packaged', 'label', 'labels', 'nutrition', 'nutritional', 'ingredient', 'ingredients', 'information', 'guidance', 'evidence', 'health']);
const productStopTerms = new Set(['and', 'the', 'with', 'for', 'of', 'free', 'full', 'taste', 'pack', 'size', 'ins']);
const researchStopTerms = new Set(['ins', 'e', 'no', 'number', 'additive', 'additives', 'food', 'foods', 'ingredient', 'ingredients', 'research', 'study', 'studies']);

function normalizedToken(value: string) {
  const token = value.normalize('NFKC').toLowerCase();
  return token.endsWith('ies') && token.length > 4 ? `${token.slice(0, -3)}y` : token.endsWith('s') && token.length > 4 ? token.slice(0, -1) : token;
}

function distinctiveKnowledgeTokens(value: string) {
  return tokens(value).map(normalizedToken).filter(token => token.length >= 3 && !genericKnowledgeTerms.has(token));
}

function productTextTokens(value: string) {
  return tokens(value).map(normalizedToken).filter(token => /\p{L}/u.test(token) && token.length >= 3 && !productStopTerms.has(token));
}

function researchTextTokens(value: string) {
  return tokens(value).map(normalizedToken).filter(token => /\p{L}/u.test(token) && token.length >= 3 && !researchStopTerms.has(token));
}

/** Public lookups may only send terms already present in the explicit question or package evidence. */
function externalQueryIsSupported(query: string, context: GeminiToolContext) {
  const allowed = new Set(tokens([
    context.question,
    context.package.name,
    context.package.brand ?? '',
    context.package.barcode ?? '',
    context.package.userDescription ?? '',
    ...context.package.observations.filter(item => item.origin === 'ocr').map(item => item.text),
    ...context.searchTerms,
  ].join(' ')));
  return tokens(query).filter(token => token.length > 2).every(token => allowed.has(token));
}

function asEvidenceSource(value: unknown): EvidenceSource | null {
  const result = sourceSchema.safeParse(value);
  return result.success ? result.data : null;
}

function productEvidence(product: Awaited<ReturnType<typeof lookupProducts>>['products'][number]): EvidenceSource {
  const nutrients = product.nutrients.map(item => `${item.key}: ${item.value} ${item.unit}${item.basis ? ` per ${item.basis.amount} ${item.basis.unit}` : ' (basis unknown)'}`).join('; ');
  const country = product.countries.length ? product.countries.join(', ') : 'not specified by the catalog';
  const summary = [
    `Community catalog candidate: ${product.name}${product.brand ? `; brand ${product.brand}` : ''}.`,
    `Barcode ${product.barcode}; reported pack quantity ${product.quantity || 'not provided'}; countries ${country}.`,
    nutrients ? `Reported nutrients: ${nutrients}.` : 'No usable nutrient values were returned.',
    product.ingredients ? `Catalog ingredient text: ${product.ingredients.slice(0, 1000)}.` : 'Ingredient text not provided.',
    product.allergens.length ? `Catalog allergen tags: ${product.allergens.slice(0, 12).join(', ')}.` : 'No allergen tags were returned; this does not establish absence.',
  ].join(' ');
  return {
    id: product.id,
    title: `${product.name}${product.brand ? ` (${product.brand})` : ''}`.slice(0, 300),
    publisher: 'Open Food Facts community database',
    url: product.url,
    category: 'product',
    jurisdiction: country.slice(0, 240),
    publishedAt: product.lastModified,
    effectiveAt: null,
    retrievedAt: product.retrievedAt,
    summary: summary.slice(0, 1600),
    limitations: 'Community-submitted candidate only; verify barcode, local formulation and label date. Product details and nutrition may be incomplete or stale. This record does not establish current stock, product identity, suitability or package truth.',
    license: 'Open Food Facts community database; attribution and applicable ODbL terms remain relevant to reuse.',
  };
}

async function inspectImage(args: z.infer<typeof toolArgs.inspect_package_image>, context: GeminiToolContext): Promise<GeminiToolResult> {
  const image = context.visualImages.find(item => item.imageId === args.imageId);
  if (!image) return { status: 'withheld', resultCount: 0, output: { status: 'image_not_attached', message: 'That image is not attached to this consented request.' } };
  const cleanBase64 = await context.prepareImage(image);
  const bytes = Buffer.from(cleanBase64, 'base64');
  let outputBytes: Buffer = bytes;
  if (args.crop) {
    const sharpModule = (await import('sharp')).default;
    const metadata = await sharpModule(bytes, { limitInputPixels: 24_000_000 }).metadata();
    if (!metadata.width || !metadata.height) return { status: 'error', resultCount: 0, output: { status: 'invalid_image', message: 'The selected image could not be inspected.' } };
    const left = Math.max(0, Math.floor(args.crop.x * metadata.width));
    const top = Math.max(0, Math.floor(args.crop.y * metadata.height));
    const width = Math.min(metadata.width - left, Math.floor(args.crop.width * metadata.width));
    const height = Math.min(metadata.height - top, Math.floor(args.crop.height * metadata.height));
    if (width < 32 || height < 32) return { status: 'withheld', resultCount: 0, output: { status: 'crop_too_small', message: 'The requested region is too small to inspect reliably.' } };
    outputBytes = await sharpModule(bytes, { limitInputPixels: 24_000_000 }).extract({ left, top, width, height }).jpeg({ quality: 88 }).toBuffer();
  }
  if (outputBytes.byteLength > 2_000_000) return { status: 'error', resultCount: 0, output: { status: 'image_too_large', message: 'The selected image region exceeded the inspection limit.' } };
  return {
    status: 'ok', resultCount: 1,
    output: { status: 'ok', imageId: image.imageId, side: image.side, crop: args.crop ?? null, note: 'The attached image or selected crop follows as multimodal evidence. Its visual transcription remains unverified.' },
    image: { mimeType: 'image/jpeg', base64: outputBytes.toString('base64') },
  };
}

async function searchKnowledge(args: z.infer<typeof toolArgs.search_knowledge>): Promise<GeminiToolResult> {
  try {
    const response = await semanticRetrieve(args.query, 3);
    const queryTerms = new Set(distinctiveKnowledgeTokens(args.query));
    const hits = response.results
      .filter(item => item.exactIdentity || distinctiveKnowledgeTokens(`${item.source.title} ${item.source.summary}`).some(term => queryTerms.has(term)))
      .map(item => ({ source: item.source, score: item.score, exactIdentity: item.exactIdentity }));
    const evidence = hits.map(hit => asEvidenceSource(hit.source)).filter((item): item is EvidenceSource => item !== null);
    return { status: evidence.length ? 'ok' : 'empty', resultCount: evidence.length, evidence, output: { status: response.status, mode: response.mode, corpusVersion: response.corpusVersion, results: hits.filter(hit => evidence.some(item => item.id === hit.source.id)), limitations: response.limitations.slice(0, 4), message: response.message ?? 'No sufficiently relevant local source was found.' } };
  } catch {
    return { status: 'unavailable', resultCount: 0, output: { status: 'unavailable', message: 'The local knowledge index could not be queried. Do not infer that no relevant evidence exists.' } };
  }
}

function resolveIngredient(args: z.infer<typeof toolArgs.resolve_ingredient>): GeminiToolResult {
  const exact = lookupAdditive(args.query);
  const tentative = exact ? undefined : resolveTentativeAdditiveIdentity(args.query);
  const sourceIds = exact?.sourceIds ?? tentative?.sourceIds ?? [];
  const evidence = sourceIds.map(id => evidenceSources.find(item => item.id === id)).filter((item): item is EvidenceSource => Boolean(item));
  if (exact) return { status: 'ok', resultCount: evidence.length, evidence, searchTerms: [exact.name, ...exact.aliases, exact.code, `INS ${exact.code}`], output: { status: 'identity_match', identity: exact, caveat: 'Identity and synonyms only. This does not establish package presence, dose, current national authorization or individual safety.' } };
  if (tentative) return { status: 'ok', resultCount: evidence.length, evidence, output: { status: 'tentative_identity_candidate', identity: tentative, caveat: 'Possible fuzzy identity only. It does not establish package presence or amount; compare the original observation.' } };
  return { status: 'empty', resultCount: 0, output: { status: 'no_identity_match', message: 'No supported identity match was found in the local additive registry.' } };
}

type OpenFoodToxSourceMetadata = Extract<OpenFoodToxSearch, { status: 'ok' }>['source'];

function openFoodToxEvidence(hit: OpenFoodToxHit, source: OpenFoodToxSourceMetadata): EvidenceSource | null {
  const retrievedAt = new Date().toISOString();
  const { substance, matchedBy } = hit;
  const referenceValues = substance.assessments.slice(0, 4).flatMap(assessment => [
    assessment.adi ? { type: 'ADI', values: assessment.adi } : null,
    assessment.acuteReferenceDose ? { type: 'acute reference dose', values: assessment.acuteReferenceDose } : null,
  ]).filter((item): item is { type: string; values: Record<string, string | number | boolean> } => Boolean(item));
  const formatReference = (value: { type: string; values: Record<string, string | number | boolean> }) => {
    const values = value.values;
    const amount = [values['Adi.lowerValue'] ?? values['Arfd.lowerValue'], values['Adi.upperValue'] ?? values['Arfd.upperValue']].filter(item => item !== undefined).join('–');
    const unit = values['Adi.Unit'] ?? values['Arfd.Unit'] ?? '';
    const qualifiers = [values['Adi.lowerQualifier'] ?? values['Arfd.lowerQualifier'], values['Adi.upperQualifier'] ?? values['Arfd.upperQualifier']].filter(item => typeof item === 'string').join(' / ');
    const body = values['AssessmentBody'] ?? values['AssessmentBody.Other'];
    const population = values['Population'] ?? values['Population.Remarks'];
    const uncertainty = values['OverallUncertainty'];
    return `${value.type}: ${amount || 'no numeric value recorded'} ${unit}${qualifiers ? ` (qualifier: ${qualifiers})` : ''}${population ? `; population: ${population}` : ''}${body ? `; assessment body: ${body}` : ''}${uncertainty ? `; uncertainty factor: ${uncertainty}` : ''}.`;
  };
  const references = substance.references.slice(0, 3);
  const topics = [...new Set(references.map(reference => reference.foodDomain).filter((value): value is string => Boolean(value)))];
  const bibliography = references.map(reference => `${reference.title ?? 'EFSA output'}${reference.date ? ` (${reference.date})` : ''}${reference.persistentId ? `; persistent identifier: ${reference.persistentId}` : ''}`).join(' | ');
  const identifiers = substance.identifiers;
  const summary = [
    `OpenFoodTox 3.0 source-record name: ${substance.name}.`,
    identifiers.casNumber ? `CAS: ${identifiers.casNumber}.` : '',
    identifiers.pubchemCid ? `PubChem CID: ${identifiers.pubchemCid}.` : '',
    topics.length ? `EFSA food-domain labels on linked dossiers: ${topics.join(', ')}.` : '',
    ...referenceValues.map(formatReference),
    bibliography ? `Linked EFSA output(s): ${bibliography}.` : '',
    `Identity match: ${matchedBy}.`,
  ].filter(Boolean).join(' ').slice(0, 1600);
  return asEvidenceSource({
    id: `openfoodtox-v3-${substance.substanceId}`,
    title: `${substance.name} — EFSA OpenFoodTox 3.0`,
    publisher: source.attribution,
    url: source.sourceUrl,
    category: 'assessment',
    jurisdiction: `European Union; EFSA hazard-assessment dataset${topics.length ? `; domains: ${topics.join(', ')}` : ''}. Not an Indian authorization or product-specific exposure record.`,
    publishedAt: references.find(reference => reference.date)?.date ?? source.releaseDate,
    effectiveAt: null,
    retrievedAt,
    summary,
    limitations: 'An EFSA assessment is a source-specific hazard/reference-value record, not proof of package presence, amount or exposure, food-use authorization in India, current legal status, or personal safety. Reference values are assessment-context dependent. Follow linked scientific outputs where consequential; the dataset itself says the original output takes precedence if records differ.',
    license: `EFSA OpenFoodTox 3.0, ${source.license}; attributed to EFSA. The local extraction is not redistributed. License: ${source.licenseUrl}`,
  });
}

async function getSubstanceAssessments(args: z.infer<typeof toolArgs.get_substance_assessments>): Promise<GeminiToolResult> {
  const canonicalQuery = lookupAdditive(args.query)?.name ?? args.query;
  try {
    const response = await searchOpenFoodTox(canonicalQuery, 3);
    if (response.status === 'unavailable') return {
      status: 'unavailable', resultCount: 0,
      output: { status: 'unavailable', reason: response.reason, message: response.reason === 'not-imported' ? 'The local EFSA OpenFoodTox 3.0 snapshot has not been imported in this checkout.' : 'The local EFSA OpenFoodTox snapshot failed validation. No assessment result is available.' },
    };
    if (response.status === 'no_match') return { status: 'empty', resultCount: 0, output: { status: 'no_match', dataset: response.source, message: 'No matching EFSA substance identity was found. This does not establish absence of an assessment or safety.' } };
    const evidence = response.results.map(hit => openFoodToxEvidence(hit, response.source)).filter((item): item is EvidenceSource => Boolean(item));
    const searchTerms = response.results.filter(hit => hit.matchedBy !== 'name-token-overlap').flatMap(hit => [hit.substance.name, ...hit.substance.aliases, ...Object.values(hit.substance.identifiers).map(String)]);
    return {
      status: evidence.length ? 'ok' : 'empty', resultCount: evidence.length, evidence, searchTerms,
      output: {
        status: evidence.length ? 'ok' : 'no_assessment_values',
        dataset: { ...response.source, statistics: response.statistics },
        results: response.results.map(hit => ({
          sourceId: `openfoodtox-v3-${hit.substance.substanceId}`,
          matchedBy: hit.matchedBy,
          score: hit.score,
          substance: {
            substanceId: hit.substance.substanceId,
            name: hit.substance.name,
            aliases: hit.substance.aliases.slice(0, 10),
            identifiers: hit.substance.identifiers,
            type: hit.substance.type.slice(0, 8),
            assessments: hit.substance.assessments.slice(0, 4),
            references: hit.substance.references.slice(0, 3),
          },
        })),
        caveat: 'These are EFSA source records, not Indian authorization, package exposure or a personal risk assessment.',
      },
    };
  } catch {
    return { status: 'unavailable', resultCount: 0, output: { status: 'unavailable', message: 'The local EFSA OpenFoodTox index could not be read. Do not infer that no relevant assessment exists.' } };
  }
}

const pubChemPropertiesSchema = z.object({
  PropertyTable: z.object({ Properties: z.array(z.object({
    CID: z.number().int().positive(), Title: z.string().max(300).optional(), IUPACName: z.string().max(500).optional(),
    MolecularFormula: z.string().max(120).optional(), InChIKey: z.string().max(80).optional(),
  }).passthrough()).max(12) }).strict(),
}).strict();

async function lookupChemicalIdentity(args: z.infer<typeof toolArgs.lookup_chemical_identity>, context: GeminiToolContext): Promise<GeminiToolResult> {
  const terms = researchTextTokens(args.query);
  if (!terms.length || !externalQueryIsSupported(args.query, context)) {
    return { status: 'withheld', resultCount: 0, output: { status: 'withheld', message: 'PubChem lookup was not run because a specific chemical name was not present in the question or OCR evidence.' } };
  }
  try {
    const url = new URL(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(args.query)}/property/Title,MolecularFormula,IUPACName,InChIKey/JSON`);
    const raw = await fixedFetch(url, 'json', 300_000);
    const parsed = pubChemPropertiesSchema.safeParse(raw);
    if (!parsed.success) return { status: 'unavailable', resultCount: 0, output: { status: 'unavailable', message: 'PubChem returned a different identity shape than NutriScan can safely interpret.' } };
    const properties = parsed.data.PropertyTable.Properties.slice(0, 3);
    const retrievedAt = new Date().toISOString();
    const evidence = properties.map(item => asEvidenceSource({
      id: `pubchem-cid-${item.CID}`,
      title: item.Title ? `${item.Title} (PubChem CID ${item.CID})` : `PubChem compound ${item.CID}`,
      publisher: 'National Center for Biotechnology Information, PubChem',
      url: `https://pubchem.ncbi.nlm.nih.gov/compound/${item.CID}`,
      category: 'registry',
      jurisdiction: 'Chemical identity reference; not food-use or safety authorization',
      publishedAt: null,
      effectiveAt: null,
      retrievedAt,
      summary: [item.Title ? `PubChem record title: ${item.Title}.` : '', item.MolecularFormula ? `Molecular formula: ${item.MolecularFormula}.` : '', item.IUPACName ? `IUPAC name: ${item.IUPACName}.` : '', item.InChIKey ? `InChIKey: ${item.InChIKey}.` : ''].filter(Boolean).join(' '),
      limitations: 'Chemical catalog candidate only. PubChem records aggregate depositor data; identity matching does not establish that a package contains this substance, its food-additive function, dose, hazard, exposure, permission or personal safety. Inspect source contributors and original records.',
      license: 'PubChem record with source-specific contributions; each contributor’s reuse terms vary and were not audited here. NutriScan returns limited chemical identity metadata with a link.',
    })).filter((item): item is EvidenceSource => item !== null);
    return {
      status: evidence.length ? 'ok' : 'empty', resultCount: evidence.length, evidence,
      output: { status: evidence.length ? 'identity_candidates' : 'no_record', query: args.query, candidates: properties.map(item => ({ cid: item.CID, title: item.Title ?? null, formula: item.MolecularFormula ?? null, iupacName: item.IUPACName ?? null, inchiKey: item.InChIKey ?? null, url: `https://pubchem.ncbi.nlm.nih.gov/compound/${item.CID}` })), message: evidence.length ? 'Registry identity candidates only; compare names and identifiers with the package evidence.' : 'PubChem returned no compound identity candidates.' },
    };
  } catch {
    return { status: 'unavailable', resultCount: 0, output: { status: 'unavailable', message: 'PubChem did not return a bounded usable identity response. This does not establish that no chemical record exists.' } };
  }
}

function calculateNutrition(args: z.infer<typeof toolArgs.calculate_nutrition>, context: GeminiToolContext): GeminiToolResult {
  if (args.candidateId) {
    const candidate = context.interpretedCandidates?.find(item => item.candidateId === args.candidateId && item.kind === 'nutrient' && item.field === args.nutrient);
    if (!candidate) return { status: 'withheld', resultCount: 0, output: { status: 'withheld', message: 'The requested interpretation is not among the supplied current candidates.' } };
    const rows = context.package.nutrients.filter(item => item.key === args.nutrient);
    if (rows.some(row => row.status === 'corrected')) return { status: 'withheld', resultCount: 0, output: { status: 'withheld', message: 'A user correction takes precedence over the model candidate.' } };
    const reconciliation = reconcileInterpretedNutrition(context.package, [candidate], context.visualImages.map(image => image.imageId));
    const reading = reconciliation.readings.find(item => item.key === args.nutrient && item.candidateIds.includes(candidate.candidateId));
    if (!reading || !matchesPackageRows(reading, rows) || reading.basis.unit !== args.unit) return { status: 'withheld', resultCount: 0, output: { status: 'withheld', message: reconciliation.withheld.find(item => item.candidateId === candidate.candidateId)?.reason ?? 'The interpretation does not have complete, attached evidence and a matching portion unit.' } };
    const resultValue = reading.value * args.amount / reading.basis.amount;
    if (!Number.isFinite(resultValue) || resultValue > 100000) return { status: 'withheld', resultCount: 0, output: { status: 'withheld', message: 'The requested calculation exceeds validated numeric limits.' } };
    const calculation = calculationSchema.parse({
      id: `modelcalc-${candidate.candidateId.slice(0, 64)}-${args.amount}-${args.unit}`,
      label: `${reading.key} in ${args.amount} ${args.unit}`,
      nutrient: reading.key,
      input: reading.value,
      inputUnit: reading.unit,
      basisAmount: reading.basis.amount,
      portion: args.amount,
      portionUnit: args.unit,
      result: resultValue,
      unit: reading.unit,
      formula: `${reading.value} ${reading.unit} × ${args.amount} ${args.unit} ÷ ${reading.basis.amount} ${reading.basis.unit}`,
      observationIds: [...new Set([...reading.observationIds, ...rows.flatMap(row => row.observationIds)])],
      ...(reading.imageIds.length ? { imageIds: reading.imageIds } : {}),
      interpretationIds: reading.candidateIds,
      assumptions: ['This deterministic arithmetic uses a tentative Gemini interpretation linked to the attached package evidence; the package reading remains unverified.'],
    });
    const unverifiedCalculation = { ...calculation, evidenceText: calculationEvidenceText(calculation) };
    return { status: 'ok', resultCount: 1, calculations: [unverifiedCalculation], output: { status: 'ok', calculation: unverifiedCalculation, note: 'Deterministic arithmetic from a tentative evidence-linked interpretation. It does not confirm or overwrite the package reading.' } };
  }
  const matches = context.package.nutrients.filter(item => item.key === args.nutrient);
  if (matches.length !== 1) return { status: 'withheld', resultCount: 0, output: { status: 'withheld', message: matches.length ? 'Conflicting or duplicate package values prevent a single calculation.' : 'No usable package value exists for this nutrient.' } };
  const reading = matches[0];
  if (reading.status === 'conflict' || !reading.basis || reading.basis.unit !== args.unit || !reading.observationIds.length) {
    return { status: 'withheld', resultCount: 0, output: { status: 'withheld', message: 'A confirmed, unconflicted reading with a matching known basis is required; no mass-volume conversion is assumed.' } };
  }
  const resultValue = reading.value * args.amount / reading.basis.amount;
  if (!Number.isFinite(resultValue) || resultValue > 100000) return { status: 'withheld', resultCount: 0, output: { status: 'withheld', message: 'The requested calculation exceeds validated numeric limits.' } };
  const calculation = calculationSchema.parse({
    id: `gemini-calc-${crypto.randomUUID()}`,
    label: `${reading.key} in ${args.amount} ${args.unit}`,
    nutrient: reading.key,
    input: reading.value,
    inputUnit: reading.unit,
    basisAmount: reading.basis.amount,
    portion: args.amount,
    portionUnit: args.unit,
    result: resultValue,
    unit: reading.unit,
    formula: `${reading.value} ${reading.unit} × ${args.amount} ${args.unit} ÷ ${reading.basis.amount} ${args.unit}`,
    observationIds: reading.observationIds,
    assumptions: [],
  });
  const verifiedCalculation = { ...calculation, evidenceText: calculationEvidenceText(calculation) };
  return { status: 'ok', resultCount: 1, calculations: [verifiedCalculation], output: { status: 'ok', calculation: verifiedCalculation, note: 'Deterministic calculation from a recorded package reading; no value was inferred.' } };
}

async function lookupProduct(args: z.infer<typeof toolArgs.lookup_product>, context: GeminiToolContext): Promise<GeminiToolResult> {
  const numericQuery = args.query && /^[\d\s().-]+$/.test(args.query) ? args.query.replace(/\D/g, '') : null;
  const requestedBarcode = args.barcode ?? numericQuery ?? undefined;
  if (requestedBarcode) {
    const ocrBarcode = findOcrGtinCandidate(context.package.observations);
    const explicitlyProvided = new RegExp(`(?<!\\d)${requestedBarcode}(?!\\d)`).test(context.question);
    const requestedImageLookup = context.visualImages.length > 0 && /\b(?:barcode|catalog|product record|open food facts|lookup|look up|matching product)\b/i.test(context.question);
    if (!isValidGtin(requestedBarcode) || !(requestedBarcode === context.package.barcode || requestedBarcode === ocrBarcode?.code || explicitlyProvided || requestedImageLookup)) {
      return { status: 'withheld', resultCount: 0, output: { status: 'withheld', message: 'Exact catalog lookup requires a checksum-valid GTIN explicitly present in the question or package evidence. An uncertain OCR digit sequence is not enough.' } };
    }
  } else {
    const productQuery = args.query ?? '';
    const queryTerms = [...new Set(productTextTokens(productQuery))];
    const evidenceTerms = new Set(productTextTokens([
      context.question,
      context.package.name,
      context.package.brand ?? '',
      context.package.userDescription ?? '',
      ...context.package.observations.filter(item => item.origin === 'ocr').map(item => item.text),
    ].join(' ')));
    if (!queryTerms.length || queryTerms.some(term => !evidenceTerms.has(term)) || !externalQueryIsSupported(productQuery, context)) {
      return { status: 'withheld', resultCount: 0, output: { status: 'withheld', message: 'Public catalog search was not run because the query is too fragmentary or includes product terms absent from the question and package evidence.' } };
    }
  }
  const parsed = productInput.safeParse({ ...(requestedBarcode ? { barcode: requestedBarcode } : args.query ? { query: args.query } : {}), alternatives: false });
  if (!parsed.success) return { status: 'error', resultCount: 0, output: { status: 'invalid_arguments', message: 'The catalog lookup arguments were invalid.' } };
  try {
    const result = await lookupProducts(parsed.data);
    const requestedTerms = !requestedBarcode && args.query ? [...new Set(productTextTokens(args.query))] : [];
    const products = result.products.filter(product => {
      if (requestedBarcode) return product.match === 'barcode' && product.barcode === requestedBarcode;
      const candidateTerms = new Set(productTextTokens(`${product.name} ${product.brand}`));
      const matched = requestedTerms.filter(term => candidateTerms.has(term)).length;
      return requestedTerms.length > 0 && matched >= Math.max(1, Math.ceil(requestedTerms.length / 2));
    }).slice(0, 2);
    const evidence = products.map(productEvidence);
    return { status: evidence.length ? 'ok' : 'empty', resultCount: evidence.length, evidence, output: { status: result.status, message: result.message, candidates: products.map(product => ({ name: product.name, brand: product.brand, barcode: product.barcode, quantity: product.quantity, countries: product.countries.slice(0, 8), match: product.match, nutrients: product.nutrients.slice(0, 12), ingredients: product.ingredients.slice(0, 1000), allergens: product.allergens.slice(0, 12), url: product.url, lastModified: product.lastModified, warnings: product.warnings?.slice(0, 4) })) } };
  } catch {
    return { status: 'unavailable', resultCount: 0, output: { status: 'unavailable', message: 'Open Food Facts did not return a usable candidate. This does not establish product identity.' } };
  }
}

function toResearchEvidence(item: Awaited<ReturnType<typeof research>>['items'][number], topic: 'science' | 'regulation' | 'claims') {
  const jurisdiction = topic === 'science' ? 'Study population and setting vary; inspect the original paper.' : 'India; verify exact provision, commencement and amendments for applicability.';
  return asEvidenceSource({ id: item.id, title: item.title, publisher: item.publisher, url: item.url, category: topic === 'science' ? 'literature' : 'regulation', jurisdiction, publishedAt: item.publishedAt, effectiveAt: item.effectiveAt ?? null, retrievedAt: item.retrievedAt, summary: item.summary.slice(0, 1600), limitations: item.limitations.slice(0, 600) });
}

function additiveIdentitiesMentioned(text: string) {
  const explicitCodes = [...text.matchAll(/\b(?:ins|e)\s*[-:]?\s*(\d{3,4}(?:[a-z]|\([ivx]+\))?)(?![a-z0-9])/gi)];
  const functionCodes = [...text.matchAll(/\b(?:antioxidant|preservative|emulsifier|stabilizer|thickener|acidity regulator|raising agent|colou?r)\s*\(\s*(\d{3,4}(?:[a-z]|\([ivx]+\))?)\s*\)/gi)];
  const identities = new Map<string, NonNullable<ReturnType<typeof lookupAdditive>>>();
  for (const match of [...explicitCodes, ...functionCodes]) {
    const identity = lookupAdditive(match[1]);
    if (identity) identities.set(identity.code, identity);
  }
  return [...identities.values()];
}

async function searchResearch(args: z.infer<typeof toolArgs.search_research>, context: GeminiToolContext): Promise<GeminiToolResult> {
  if (!externalQueryIsSupported(args.query, context)) return { status: 'withheld', resultCount: 0, output: { status: 'withheld', message: 'External research search was not run because its terms are absent from the explicit question and package evidence.' } };
  if (args.topic === 'science' && !researchTextTokens(args.query).length) return { status: 'withheld', resultCount: 0, output: { status: 'withheld', message: 'A numeric additive code alone cannot identify relevant research. Resolve the substance name first, then search the named substance and outcome.' } };
  let query = args.query;
  if (args.topic !== 'science' && /\b(?:india|indian|fssai)\b/i.test(context.question)) {
    const explicitIdentity = lookupExplicitAdditiveMention(context.question)
      ?? lookupExplicitAdditiveMention(args.query);
    const contextText = [context.question, args.query, context.package.rawText, ...context.package.observations.filter(item => item.origin === 'ocr').map(item => item.text)].join('\n');
    const candidates = explicitIdentity ? [explicitIdentity] : [
      ...additiveIdentitiesMentioned(contextText),
      ...[...context.searchTerms].map(term => lookupAdditive(term)).filter((identity): identity is NonNullable<typeof identity> => Boolean(identity)),
    ];
    const identities = new Map(candidates.filter((identity): identity is NonNullable<ReturnType<typeof lookupAdditive>> => Boolean(identity)).map(identity => [identity.code, identity] as const));
    if (identities.size === 1) {
      const [identity] = identities.values();
      // Search the fixed identifier form first. Model-authored queries may mix
      // nutrient limits (for example "100 mg/kg") with INS codes, which can
      // otherwise make a regex mistake the quantity for the requested code.
      query = `INS ${identity.code} food additive India`;
    }
  }
  const parsed = researchInput.safeParse({ query, topic: args.topic });
  if (!parsed.success) return { status: 'error', resultCount: 0, output: { status: 'invalid_arguments', message: 'The research query did not match a supported topic.' } };
  try {
    const result = await research(parsed.data);
    const evidence = result.items.slice(0, 3).map(item => toResearchEvidence(item, args.topic)).filter((item): item is EvidenceSource => item !== null);
    return { status: evidence.length ? 'ok' : result.status === 'unavailable' ? 'unavailable' : 'empty', resultCount: evidence.length, evidence, output: { status: result.status, message: result.message, results: evidence.map(item => ({ ...item })) } };
  } catch {
    return { status: 'unavailable', resultCount: 0, output: { status: 'unavailable', message: 'The bounded public research lookup failed. No source or current-law conclusion is available.' } };
  }
}

export async function executeGeminiTool(name: string, args: unknown, context: GeminiToolContext): Promise<GeminiToolResult> {
  switch (name) {
    case 'inspect_package_image': {
      const parsed = toolArgs.inspect_package_image.safeParse(args);
      return parsed.success ? inspectImage(parsed.data, context) : { status: 'error', resultCount: 0, output: { status: 'invalid_arguments', message: 'The image inspection arguments were invalid.' } };
    }
    case 'search_knowledge': {
      const parsed = toolArgs.search_knowledge.safeParse(args);
      return parsed.success ? searchKnowledge(parsed.data) : { status: 'error', resultCount: 0, output: { status: 'invalid_arguments', message: 'The local knowledge query was invalid.' } };
    }
    case 'search_food_composition': {
      const parsed = toolArgs.search_food_composition.safeParse(args);
      return parsed.success ? searchFoodCompositionTool(parsed.data) : { status: 'error', resultCount: 0, output: { status: 'invalid_arguments', message: 'The USDA food-composition query was invalid.' } };
    }
    case 'resolve_ingredient': {
      const parsed = toolArgs.resolve_ingredient.safeParse(args);
      return parsed.success ? resolveIngredient(parsed.data) : { status: 'error', resultCount: 0, output: { status: 'invalid_arguments', message: 'The ingredient query was invalid.' } };
    }
    case 'lookup_chemical_identity': {
      const parsed = toolArgs.lookup_chemical_identity.safeParse(args);
      return parsed.success ? lookupChemicalIdentity(parsed.data, context) : { status: 'error', resultCount: 0, output: { status: 'invalid_arguments', message: 'The chemical identity query was invalid.' } };
    }
    case 'get_substance_assessments': {
      const parsed = toolArgs.get_substance_assessments.safeParse(args);
      return parsed.success ? getSubstanceAssessments(parsed.data) : { status: 'error', resultCount: 0, output: { status: 'invalid_arguments', message: 'The substance assessment query was invalid.' } };
    }
    case 'calculate_nutrition': {
      const parsed = toolArgs.calculate_nutrition.safeParse(args);
      return parsed.success ? calculateNutrition(parsed.data, context) : { status: 'error', resultCount: 0, output: { status: 'invalid_arguments', message: 'The nutrition calculation arguments were invalid.' } };
    }
    case 'lookup_product': {
      const parsed = toolArgs.lookup_product.safeParse(args);
      return parsed.success ? lookupProduct(parsed.data, context) : { status: 'error', resultCount: 0, output: { status: 'invalid_arguments', message: 'Provide one product query or exact barcode.' } };
    }
    case 'search_research': {
      const parsed = toolArgs.search_research.safeParse(args);
      return parsed.success ? searchResearch(parsed.data, context) : { status: 'error', resultCount: 0, output: { status: 'invalid_arguments', message: 'The research search arguments were invalid.' } };
    }
    default:
      return { status: 'error', resultCount: 0, output: { status: 'unknown_tool', message: 'This tool is not enabled.' } };
  }
}
