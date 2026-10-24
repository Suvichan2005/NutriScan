import { Type, type FunctionDeclaration } from '@google/genai';
import { z } from 'zod';
import {
  calculationEvidenceText,
  calculationSchema,
  nutrientKeys,
  normalizedCropSchema,
  profileSchema,
  sourceSchema,
  type Calculation,
  type EvidenceSource,
  type PackageData,
  type TentativeStructuredCandidate,
} from '../contracts';
import { matchesPackageRows, reconcileInterpretedNutrition } from '../interpreted-nutrients';
import { isGuidanceEvidenceInScope, isLocalEvidenceTopicallyRelevant } from '../followup-evidence';
import { evidenceSources, findIngredientEvidence, indianStapleIdentitySources, lookupAdditive, lookupExplicitAdditiveMention, lookupIndianStapleIngredientIdentity, resolveTentativeAdditiveIdentity } from '../../modules/knowledge';
import { searchOpenFoodTox, semanticRetrieve } from '../semantic';
import { searchFoodComposition, type FoodCompositionFood } from './food-composition';
import { searchFoodOn, type FoodOnHit, type FoodOnSearch, type OpenFoodToxHit, type OpenFoodToxSearch } from '../../modules/knowledge/server';
import { isValidGtin, findOcrGtinCandidate } from '../barcode';
import { productInput, lookupProducts } from './products';
import { researchInput, research } from './research';
import { fixedFetch } from './http';
import { getNutritionGuidance, getNutritionGuidanceCoverageFacts, type NutritionGuidanceCoverageFact } from './nutrition-guidance';

const imageIdSchema = z.string().min(1).max(160);
const querySchema = z.string().trim().min(2).max(180);
function matchesAuthorizedContext(contextText: string, candidate: string): boolean {
  const normalizedContext = ' ' + contextText.normalize('NFKC').toLocaleLowerCase('en-IN').replace(/[^\p{L}\p{N}]+/gu, ' ').trim() + ' ';
  const normalizedCandidate = candidate.normalize('NFKC').toLocaleLowerCase('en-IN').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return normalizedCandidate.length > 0 && normalizedContext.includes(' ' + normalizedCandidate + ' ');
}
const toolArgs = {
  inspect_package_image: z.object({ imageId: imageIdSchema, crop: normalizedCropSchema.optional() }).strict(),
  search_knowledge: z.object({ query: querySchema }).strict(),
  get_nutrition_guidance: z.object({
    query: z.string().trim().min(2).max(300),
    condition: z.string().trim().min(2).max(100).optional(),
    goal: z.string().trim().min(2).max(120).optional(),
    jurisdiction: z.string().trim().min(2).max(80).optional(),
    maxResults: z.number().int().min(1).max(5).optional(),
  }).strict(),
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
  { name: 'inspect_package_image', description: 'Inspect an attached original package photo or a focused crop using your visual understanding. Use when OCR merges adjacent label regions or a small/dense nutrition table is not fully readable at full-photo scale; for a table, inspect one crop that keeps the complete panel, row labels and column headings together. Select bounds from the attached image geometry, not remembered product coordinates. Do not crop isolated digits, and treat a crop as the same image evidence rather than independent corroboration. The photo must already be attached to this request.', parameters: { type: Type.OBJECT, properties: { imageId: { type: Type.STRING, description: 'Exact imageId from the attached package images.' }, crop: cropParameters }, required: ['imageId'] } },
  { name: 'search_knowledge', description: 'Search NutriScan’s local, attributed food and ingredient evidence index. This does not make a network request.', parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: 'A focused food, nutrient, ingredient, or guidance query.' } }, required: ['query'] } },
  { name: 'get_nutrition_guidance', description: 'Retrieve a small local set of source-linked nutrition guidance for an explicitly relevant condition or goal. Uses only NutriScan-authored summaries of official sources and sends no query, profile, or image to an external service. Prefer the user’s stated jurisdiction when known. Keep population guidance separate from personal targets and package facts; do not infer diagnoses or prescribe a nutrient allowance.', parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: 'The nutrition question and relevant words from the user’s request.' }, condition: { type: Type.STRING, description: 'Only a condition explicitly stated by the user or included in authorized profile context.' }, goal: { type: Type.STRING, description: 'Only a nutrition goal stated by the user or included in authorized profile context.' }, jurisdiction: { type: Type.STRING, description: 'A jurisdiction stated by the user or available in authorized context, such as India.' }, maxResults: { type: Type.NUMBER, description: 'Optional result limit from 1 to 5.' } }, required: ['query'] } },
  { name: 'search_food_composition', description: 'Search local USDA FoodData Central Foundation Foods and FNDDS structured snapshots for generic food-composition reference values. FNDDS includes U.S. survey records for some Indian-style dishes, not authoritative Indian recipes. Use when the user asks how a basic food compares or requests composition context; request relevant nutrient families. Values are source-reported per 100 g edible portion, not facts about a branded Indian product, its package, portion or an individual. Survey portion examples are not package servings. Missing nutrient rows are unavailable, not zero. Includes release, source citation, license and limitations. No external query is sent.', parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: 'A specific generic food name or phrase, such as dry chickpeas, idli, chapatti or roti.' }, nutrients: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Up to eight requested nutrient families, such as protein, carbohydrate, fiber, sodium, potassium, energy, or saturated fat. Omit to return common macronutrient and sodium fields.' } }, required: ['query'] } },
  { name: 'resolve_ingredient', description: 'Resolve an observed additive locally, apply exact source-attributed Indian staple label aliases (including Atta/Maida/Suji/Rawa), and search the bundled FoodOn ontology for ordinary ingredients. When the question asks about a known outcome, it can also return linked ingredient-effect evidence and its population/exposure limitations. For an explicitly observed INS code not in the local registry, NutriScan sends only that code to the official Codex GSFA identity search and may link an exact EFSA substance record. No image, question, profile or conversation is sent to Codex. Identity matches are candidates only; Codex is international and does not establish Indian authorization, package presence, dose, effects, allergen relationships or personal safety.', parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: 'A short observed ingredient phrase or additive identifier.' } }, required: ['query'] } },
  { name: 'lookup_chemical_identity', description: 'Read-only PubChem PUG REST lookup of a chemical name already present in the user question/package text or returned by exact local ingredient or assessment lookup. Returns registry identity candidates only, not food-use authorization, dose, hazard assessment or personal safety. Sends only the name; never photos or profile data.', parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: 'A specific chemical name from the question, printed package text or an exact local identity result, not a numeric value or general food question.' } }, required: ['query'] } },
  { name: 'get_substance_assessments', description: 'Search the locally imported EFSA OpenFoodTox 3.0 assessment snapshot for a named substance or exact identifier. Returns attributed EFSA assessment records and toxicological reference values when available. The local snapshot may only link a scientific output without its conclusion; if the user asks what the linked assessment found, follow that title with search_research using the exact local identity returned. Use to distinguish hazard assessments from package exposure; this does not establish Indian authorization, package dose, product presence or personal safety. No network request is made.', parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: 'A substance name, synonym, CAS number or PubChem CID from the question, package text or a locally resolved ingredient identity.' } }, required: ['query'] } },
  { name: 'calculate_nutrition', description: 'Calculate a portion from an unconflicted user-confirmed package nutrient, a currently attached evidence-linked interpretation, or an exact rowId from the saved package reconstruction. Interpretation-based arithmetic is explicitly provisional and never confirms or changes the package record. A matching known mass or volume basis and linked package observations are required.', parameters: { type: Type.OBJECT, properties: { nutrient: { type: Type.STRING, enum: [...nutrientKeys] }, amount: { type: Type.NUMBER, description: 'Portion amount in grams or millilitres.' }, unit: { type: Type.STRING, enum: ['g', 'ml'] }, candidateId:{type:Type.STRING,description:'Optional exact candidateId from supplied interpretations or exact rowId from the saved package reconstruction.'} }, required: ['nutrient', 'amount', 'unit'] } },
  { name: 'lookup_product', description: 'Read-only Open Food Facts search by an exact barcode or product text explicitly present in the user question or package observations. Sends only that query to the public catalog; never sends images or profile data. Results are community candidates, not confirmed package facts.', parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: 'A product name or brand present in the question or visible package OCR.' }, barcode: { type: Type.STRING, description: 'An exact 8–14 digit barcode present in the question or package OCR.' } } } },
  { name: 'search_research', description: 'Read-only search of Europe PMC or NutriScan’s fixed official India regulation sources. External query terms must be present in the user question/package OCR or a successful exact local identity lookup. If a local registry supplies only publication links and the user asks for the assessment finding, search the linked entity/topic rather than inferring the finding from metadata. Search results are candidates, not an evidence synthesis.', parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: 'Focused terms drawn from the explicit question, package OCR or successful exact local identity results.' }, topic: { type: Type.STRING, enum: ['science', 'regulation', 'claims'] } }, required: ['query', 'topic'] } },
];

export type GeminiToolImage = {
  imageId: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  base64: string;
  side: 'front' | 'back' | 'extra';
  regionRole?: 'full-image'|'nutrition-table'|'ingredients'|'label-detail'|'other';
  sourceImage: { width: number; height: number };
  preprocessing: { rotation: 0 | 90 | 180 | 270; contrast: boolean; invert: boolean; crop: { x: number; y: number; width: number; height: number } | null };
};

export type GeminiToolResult = {
  output: Record<string, unknown>;
  evidence?: EvidenceSource[];
  calculations?: Calculation[];
  guidanceCoverageFacts?: NutritionGuidanceCoverageFact[];
  image?: { mimeType: 'image/jpeg'; base64: string };
  /** Canonical terms returned by a successful local identity lookup; only these may extend later research queries. */
  searchTerms?: string[];
  status: 'ok' | 'empty' | 'withheld' | 'unavailable' | 'error';
  resultCount: number;
};

export type GeminiToolContext = {
  question: string;
  package: PackageData;
  profile?: z.infer<typeof profileSchema>;
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
const productStopTerms = new Set(['and', 'the', 'with', 'for', 'of', 'free', 'full', 'taste', 'pack', 'size', 'ins']);
const researchStopTerms = new Set(['ins', 'e', 'no', 'number', 'additive', 'additives', 'food', 'foods', 'ingredient', 'ingredients', 'research', 'study', 'studies']);

function normalizedToken(value: string) {
  const token = value.normalize('NFKC').toLowerCase();
  return token.endsWith('ies') && token.length > 4 ? `${token.slice(0, -3)}y` : token.endsWith('s') && token.length > 4 ? token.slice(0, -1) : token;
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

const codexInsSearchUrl = 'https://codex.fao.org/codex-texts/codex-online-databases/gsfa/gsfa-database-search/SearchAdditivesByInsNumber/';
const codexInsSearchPage = 'https://codex.fao.org/codex-texts/codex-online-databases/gsfa/gsfa-database-search';
const codexInsResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(z.object({
    Id: z.string().max(80), Label: z.string().trim().min(1).max(180), InsNumber: z.string().trim().min(2).max(24),
    Language: z.string().max(12), MatchType: z.string().max(40), MatchedSynonym: z.string().max(180).nullable(),
  }).passthrough()).max(40),
  count: z.number().int().min(0).max(500),
}).passthrough();

function parseInsCode(value: string): { base: string; variant: string | null } | null {
  const match = /^\s*(\d{2,4})(?:\s*\(([ivxlcdm]+)\))?\s*$/i.exec(value);
  return match ? { base: match[1], variant: match[2]?.toLocaleLowerCase('en') ?? null } : null;
}

/** Only resolve a numeric code when the exact code is present in user/package evidence. */
function observedCodexInsCode(query: string, context: GeminiToolContext): string | null {
  const match = /^\s*(?:INS\s*)?(\d{2,4})(?:\s*\(([ivxlcdm]+)\))?\s*$/i.exec(query);
  if (!match) return null;
  const base = match[1];
  const variant = match[2]?.toLocaleLowerCase('en') ?? null;
  const contextText = [
    context.question,
    context.package.rawText,
    ...context.package.observations.filter(item => item.origin === 'ocr').map(item => item.text),
    ...context.searchTerms,
  ].join('\n');
  const exactBasePattern = new RegExp(`(?:\\bINS\\s*)?\\b${base}(?:\\s*\\([ivxlcdm]+\\))?(?=\\s*[\\])},;.:]|\\s|$)`, 'i');
  if (!exactBasePattern.test(contextText)) return null;
  if (variant && !new RegExp(`(?:\\bINS\\s*)?\\b${base}\\s*\\(${variant}\\)(?=\\s*[\\])},;.:]|\\s|$)`, 'i').test(contextText)) return null;
  if (!/^\s*INS\s*/i.test(query) && !variant) {
    const rolePattern = /\b(?:additives?|food\s+additive|ins|raising\s+agents?|acidity\s+regulators?|preservatives?|emulsifiers?|stabilizers?|thickeners?|anti[- ]caking\s+agents?)\b/i;
    const codeInLabel = context.package.observations.some(item => item.origin === 'ocr'
      && rolePattern.test(item.text)
      && new RegExp(`\\[\\s*[^\\]]*\\b${base}(?:\\s*\\([ivxlcdm]+\\))?\\s*\\]`, 'i').test(item.text));
    const explicitQuestion = /\bINS\b/i.test(context.question) && exactBasePattern.test(context.question);
    if (!codeInLabel && !explicitQuestion) return null;
  }
  return `${base}${variant ? `(${variant})` : ''}`;
}

function codexInsMatches(requestedCode: string, returnedCode: string): boolean {
  const requested = parseInsCode(requestedCode);
  const returned = parseInsCode(returnedCode);
  return Boolean(requested && returned && requested.base === returned.base
    && (!requested.variant || requested.variant === returned.variant));
}

function codexInsEvidence(hit: z.infer<typeof codexInsResponseSchema>['data'][number]): EvidenceSource | null {
  const retrievedAt = new Date().toISOString();
  const normalizedCode = parseInsCode(hit.InsNumber);
  const identity = `${hit.Label} (INS ${hit.InsNumber})`;
  return asEvidenceSource({
    id: `codex-gsfa-ins-${(normalizedCode ? `${normalizedCode.base}-${normalizedCode.variant ?? 'base'}` : hit.InsNumber).toLocaleLowerCase('en')}`,
    title: `${identity} — Codex GSFA`,
    publisher: 'Codex Alimentarius Commission (FAO/WHO)',
    url: codexInsSearchPage,
    category: 'registry',
    jurisdiction: 'International Codex identity reference; not an Indian authorization or product-category ruling.',
    publishedAt: null,
    effectiveAt: null,
    retrievedAt,
    summary: `The Codex General Standard for Food Additives search returned ${identity} as an INS identity. Match type: ${hit.MatchType}.${hit.MatchedSynonym ? ` Matched synonym: ${hit.MatchedSynonym}.` : ''}`,
    limitations: 'Identity lookup only. Codex provisions depend on food category, notes, conditions and version, and do not establish Indian authorization, product presence, amount, exposure, health effects or personal safety.',
    license: 'FAO website Terms and Conditions: reuse of content for non-commercial products requires attribution; commercial reuse and redistribution require separate rights review. This is a live lookup and NutriScan does not retain the Codex response.',
  });
}

async function searchCodexInsIdentity(code: string): Promise<{ status: 'ok'; hits: z.infer<typeof codexInsResponseSchema>['data']; source: EvidenceSource } | { status: 'empty' | 'unavailable'; hits: []; source?: EvidenceSource }> {
  try {
    const raw = await fixedFetch(new URL(codexInsSearchUrl), 'json', 24_000, { insNumber: code });
    const parsed = codexInsResponseSchema.safeParse(raw);
    if (!parsed.success || !parsed.data.success) return { status: 'unavailable', hits: [] };
    const hits = parsed.data.data.filter(hit => hit.Language.toLocaleLowerCase('en') === 'en' && codexInsMatches(code, hit.InsNumber)).slice(0, 8);
    const source = asEvidenceSource({
      id: 'codex-gsfa-ins-search', title: 'General Standard for Food Additives (GSFA) — INS search',
      publisher: 'Codex Alimentarius Commission (FAO/WHO)', url: codexInsSearchPage, category: 'registry',
      jurisdiction: 'International Codex identity and provisions; not an Indian authorization.', publishedAt: null, effectiveAt: null,
      retrievedAt: new Date().toISOString(),
      summary: `Live Codex GSFA search for INS ${code} returned ${hits.length} exact-number identity candidate${hits.length === 1 ? '' : 's'}.`,
      limitations: 'A search result establishes an identity candidate only. Codex provisions are food-category-specific and do not establish Indian authorization, package presence, amount, exposure or personal safety.',
      license: 'FAO website Terms and Conditions: reuse of content for non-commercial products requires attribution; commercial reuse and redistribution require separate rights review. NutriScan does not retain the live response.',
    });
    if (!source) return { status: 'unavailable', hits: [] };
    return hits.length ? { status: 'ok', hits, source } : { status: 'empty', hits: [], source };
  } catch {
    return { status: 'unavailable', hits: [] };
  }
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
  // Model-reported regions are normalized against the original package photo.
  // Prefer its uncropped view when a same-handle OCR-guided crop is also attached.
  const image = context.visualImages.find(item => item.imageId === args.imageId && item.preprocessing.crop === null)
    ?? context.visualImages.find(item => item.imageId === args.imageId);
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

async function searchKnowledge(args: z.infer<typeof toolArgs.search_knowledge>, context: GeminiToolContext): Promise<GeminiToolResult> {
  try {
    // Rank a wider local candidate window before scope checks. Inapplicable or
    // topically weak hits must not crowd a useful source out of the three
    // records returned to the model.
    const response = await semanticRetrieve(args.query, 5);
    const hits = response.results
      .filter(item => isLocalEvidenceTopicallyRelevant(item.source, args.query, item.exactIdentity))
      .filter(item => isGuidanceEvidenceInScope(item.source, context.question, context.profile?.country ?? ''))
      .slice(0, 3)
      .map(item => ({ source: item.source, score: item.score, exactIdentity: item.exactIdentity }));
    const evidence = hits.map(hit => asEvidenceSource(hit.source)).filter((item): item is EvidenceSource => item !== null);
    return { status: evidence.length ? 'ok' : 'empty', resultCount: evidence.length, evidence, output: { status: evidence.length ? 'ok' : 'empty', mode: response.mode, corpusVersion: response.corpusVersion, results: hits.filter(hit => evidence.some(item => item.id === hit.source.id)), limitations: response.limitations.slice(0, 4), message: evidence.length ? response.message ?? 'Relevant local source candidates are available.' : 'No candidate passed the topical relevance and applicability checks. This does not establish that no relevant evidence exists.' } };
  } catch {
    return { status: 'unavailable', resultCount: 0, output: { status: 'unavailable', message: 'The local knowledge index could not be queried. Do not infer that no relevant evidence exists.' } };
  }
}

function retrieveNutritionGuidance(args: z.infer<typeof toolArgs.get_nutrition_guidance>, context: GeminiToolContext): GeminiToolResult {
  const authorizedContext = [
    context.question,
    context.profile?.dietaryPattern,
    context.profile?.healthConsiderations,
    context.profile?.goals,
    context.profile?.country,
  ].filter(Boolean).join(' ');
  const condition = args.condition && matchesAuthorizedContext(authorizedContext, args.condition) ? args.condition : undefined;
  const goal = args.goal && matchesAuthorizedContext(authorizedContext, args.goal) ? args.goal : undefined;
  const jurisdiction = args.jurisdiction && matchesAuthorizedContext(authorizedContext, args.jurisdiction)
    ? args.jurisdiction
    : context.profile?.country.trim() || undefined;
  const evidence = getNutritionGuidance({
    query: authorizedContext,
    ...(condition ? { condition } : {}),
    ...(goal ? { goal } : {}),
    ...(jurisdiction ? { jurisdiction } : {}),
    ...(args.maxResults ? { maxResults: args.maxResults } : {}),
  });
  const guidanceCoverageFacts = getNutritionGuidanceCoverageFacts(context.question, evidence.map(source => source.id));
  return {
    status: evidence.length ? 'ok' : 'empty',
    resultCount: evidence.length,
    evidence,
    guidanceCoverageFacts,
    output: {
      status: evidence.length ? 'ok' : 'empty',
      results: evidence,
      message: evidence.length
        ? 'Local source-linked summaries only. Treat population guidance as context, not an individualized target or a verdict about one package.'
        : 'No sufficiently relevant local guidance summary matched. Do not invent a target; use an explicitly authorized current research lookup if the user needs a current source.',
      externalRequestMade: false,
    },
  };
}

function foodOnEvidence(hit: FoodOnHit, source: Extract<FoodOnSearch, { status: 'ok' }>['source']): EvidenceSource | null {
  const { term, matchedBy, matchedText, parents } = hit;
  const synonyms = term.aliases.slice(0, 8).map(alias => `${alias.text} (${alias.kind})`);
  return asEvidenceSource({
    id: `foodon-${term.id.toLowerCase()}`,
    title: `${term.label} (${term.id})`,
    publisher: 'FoodOn Food Ontology',
    url: `https://purl.obolibrary.org/obo/${term.id}`,
    category: 'registry',
    jurisdiction: 'Food ontology identity; not jurisdiction-specific food-use authorization',
    publishedAt: null,
    effectiveAt: null,
    retrievedAt: new Date().toISOString(),
    summary: [
      `FoodOn release ${source.version}; term label: ${term.label}.`,
      `Matched by ${matchedBy}: ${matchedText}.`,
      synonyms.length ? `Ontology synonyms: ${synonyms.join('; ')}.` : '',
      parents.length ? `FoodOn parent terms: ${parents.map(parent => `${parent.label} (${parent.id})`).join('; ')}.` : '',
    ].filter(Boolean).join(' ').slice(0, 1600),
    limitations: 'Ontology identity candidate only. FoodOn taxonomy does not establish that the ingredient is present in this package, its quantity, nutrient composition, health effects, allergen relationship, legal status or individual safety.',
    license: `FoodOn ${source.version} ontology extract, licensed CC BY 4.0. Attributed to FoodOn; source release ${source.versionIri}; repository commit ${source.repositoryCommit}.`,
  });
}

async function resolveIngredient(args: z.infer<typeof toolArgs.resolve_ingredient>, context: GeminiToolContext): Promise<GeminiToolResult> {
  const exact = lookupAdditive(args.query);
  const tentative = exact ? undefined : resolveTentativeAdditiveIdentity(args.query);
  const sourceIds = exact?.sourceIds ?? tentative?.sourceIds ?? [];
  const evidence = sourceIds.map(id => evidenceSources.find(item => item.id === id)).filter((item): item is EvidenceSource => Boolean(item));
  if (exact) return { status: 'ok', resultCount: evidence.length, evidence, searchTerms: [exact.name, ...exact.aliases, exact.code, `INS ${exact.code}`], output: { status: 'identity_match', identity: exact, caveat: 'Identity and synonyms only. This does not establish package presence, dose, current national authorization or individual safety.' } };
  if (tentative) return { status: 'ok', resultCount: evidence.length, evidence, output: { status: 'tentative_identity_candidate', identity: tentative, caveat: 'Possible fuzzy identity only. It does not establish package presence or amount; compare the original observation.' } };
  if (!externalQueryIsSupported(args.query, context)) return { status: 'withheld', resultCount: 0, output: { status: 'query_not_in_evidence', message: 'FoodOn lookup was not run because the ingredient phrase was not present in the question or package observations.' } };
  const codexCode = observedCodexInsCode(args.query, context);
  if (codexCode) {
    const codex = await searchCodexInsIdentity(codexCode);
    if (codex.status === 'unavailable') return { status: 'unavailable', resultCount: 0, output: { status: 'codex_unavailable', message: 'The official Codex GSFA identity search is temporarily unavailable. No additive identity was inferred.' } };
    if (codex.status === 'empty') return { status: 'empty', resultCount: 0, output: { status: 'no_codex_identity_match', query: codexCode, message: 'The official Codex GSFA search returned no exact INS identity for this code. No additive identity was inferred.' } };
    const codexEvidence = codex.hits.map(codexInsEvidence).filter((item): item is EvidenceSource => Boolean(item));
    const exactIdentity = codex.hits.length === 1
      && parseInsCode(codex.hits[0].InsNumber)?.variant === parseInsCode(codexCode)?.variant
      && codex.hits[0].MatchType.toLocaleLowerCase('en').includes('exact');
    let assessmentHits: OpenFoodToxHit[] = [];
    let assessmentSource: Extract<OpenFoodToxSearch, { status: 'ok' }>['source'] | undefined;
    if (exactIdentity) {
      const assessmentSearch = await searchOpenFoodTox(codex.hits[0].Label, 3);
      if (assessmentSearch.status === 'ok') {
        assessmentSource = assessmentSearch.source;
        assessmentHits = assessmentSearch.results.filter(hit => hit.matchedBy === 'exact-name');
      }
    }
    const assessmentEvidence = assessmentSource
      ? assessmentHits.map(hit => openFoodToxEvidence(hit, assessmentSource!)).filter((item): item is EvidenceSource => Boolean(item))
      : [];
    const candidateSources = codexEvidence;
    const linkedAssessments = assessmentHits.map(hit => ({
      substanceId: hit.substance.substanceId,
      name: hit.substance.name,
      sourceId: `openfoodtox-v3-${hit.substance.substanceId}`,
      match: 'exact source-record name',
      assessmentCount: hit.substance.assessments.length,
    }));
    return {
      status: candidateSources.length ? 'ok' : 'empty',
      resultCount: candidateSources.length + assessmentEvidence.length,
      evidence: [...candidateSources, ...assessmentEvidence],
      searchTerms: [...new Set(codex.hits.flatMap(hit => [hit.Label, `INS ${hit.InsNumber}`]))],
      output: {
        status: exactIdentity ? 'codex_identity_match' : 'codex_identity_candidates',
        requestedCode: codexCode,
        candidates: codex.hits.map((hit, index) => ({
          name: hit.Label,
          insNumber: hit.InsNumber,
          matchType: hit.MatchType,
          sourceId: candidateSources[index]?.id ?? null,
        })),
        linkedExactEfsaRecords: linkedAssessments,
        caveat: 'The code identifies a Codex additive name only. A base code with multiple subtypes remains ambiguous. Codex is international, not Indian authorization; package presence, amount, exposure, effects and individual safety require separate evidence.',
      },
    };
  }
  const regionalIdentity = lookupIndianStapleIngredientIdentity(args.query);
  if (regionalIdentity) {
    const source = indianStapleIdentitySources.find(item => item.id === regionalIdentity.sourceId);
    if (source) return {
      status: 'ok', resultCount: 1, evidence: [source],
      searchTerms: [regionalIdentity.canonicalName, regionalIdentity.matchedAlias],
      output: {
        status: 'regional_label_identity_candidate',
        identity: regionalIdentity,
        sourceId: source.id,
        caveat: 'This source-backed terminology match can normalize a label name only; it does not establish package presence, amount, nutrition, health effects, current law or compliance.',
      },
    };
  }
  const relatedEvidence = findIngredientEvidence(args.query, context.question);
  const relatedSources = [...new Set(relatedEvidence.flatMap(relation => relation.sourceIds))]
    .map(id => evidenceSources.find(item => item.id === id))
    .filter((item): item is EvidenceSource => Boolean(item));
  const response = await searchFoodOn(args.query, 5);
  if (response.status === 'unavailable' && !relatedSources.length) return { status: 'unavailable', resultCount: 0, output: { status: 'unavailable', reason: response.reason, message: 'NutriScan could not read its local FoodOn index. No ingredient identity was inferred.' } };
  if (response.status === 'no_match' && !relatedSources.length) return { status: 'empty', resultCount: 0, output: { status: 'no_identity_match', query: args.query, message: 'The local FoodOn index has no sufficiently close label or synonym match. No ingredient identity was inferred.' } };
  const identityHits = response.status === 'ok'
    ? response.results.slice(0, relatedSources.length ? 3 : 5)
    : [];
  const candidateEvidence = response.status === 'ok'
    ? identityHits.map(hit => foodOnEvidence(hit, response.source)).filter((item): item is EvidenceSource => item !== null)
    : [];
  const allEvidence = [...candidateEvidence, ...relatedSources];
  const identityCandidates = identityHits.slice(0, candidateEvidence.length).map(hit => ({ sourceId: `foodon-${hit.term.id.toLowerCase()}`, title: `${hit.term.label} (${hit.term.id})`, matchedBy: hit.matchedBy, matchedText: hit.matchedText, parents: hit.parents }));
  return {
    status: allEvidence.length ? 'ok' : 'empty',
    resultCount: allEvidence.length,
    evidence: allEvidence,
    searchTerms: relatedEvidence.map(item => item.ingredient),
    output: {
      status: identityCandidates.length ? 'ontology_identity_candidates' : relatedEvidence.length ? 'ingredient_effect_evidence' : 'no_identity_match',
      query: args.query,
      ...(identityCandidates.length ? { candidates: identityCandidates } : {}),
      ...(response.status === 'ok' ? { sourceVersion: response.source.version } : { identityIndexStatus: response.status }),
      ...(relatedEvidence.length ? { relatedIngredientEvidence: relatedEvidence } : {}),
      caveat: 'Ontology matches are identity candidates, not confirmed package ingredients. Related studies or assessments describe evidence for a defined ingredient and outcome; they do not establish package composition, dose, exposure, individual effect, clinical advice or product suitability.',
      ...(!identityCandidates.length && !relatedEvidence.length ? { message: 'No linked ingredient identity or outcome evidence was found.' } : {}),
    },
  };
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
    if (!candidate) {
      const reconstructed=context.package.reconstruction?.nutritionRows.find(row=>row.rowId===args.candidateId&&reconstructionRowMatches(row.nutrient,args.nutrient));
      if(!reconstructed)return { status: 'withheld', resultCount: 0, output: { status: 'withheld', message: 'The requested interpretation is not among the supplied candidates or saved package rows.' } };
      if(context.package.nutrients.some(row=>row.key===args.nutrient&&row.status==='corrected'))return { status:'withheld',resultCount:0,output:{status:'withheld',message:'A user-confirmed correction takes precedence over the saved model interpretation.'} };
      const imageIds=[...new Set(reconstructed.evidence.imageRegions.map(item=>item.imageId))];
      if(!['clear','provisional'].includes(reconstructed.status)||reconstructed.value===null||!reconstructed.unit||!reconstructed.basisAmount||!reconstructed.basisUnit||reconstructed.basisUnit!==args.unit||(!reconstructed.evidence.observationIds.length&&!imageIds.length))return {status:'withheld',resultCount:0,output:{status:'withheld',message:'The saved package interpretation does not contain one complete, evidence-linked value and matching mass or volume basis.'}};
      if(!['g','mg','kcal','kJ'].includes(reconstructed.unit))return {status:'withheld',resultCount:0,output:{status:'withheld',message:'The saved package row uses a unit this calculator cannot safely normalize.'}};
      const resultValue=reconstructed.value*args.amount/reconstructed.basisAmount;
      if(!Number.isFinite(resultValue)||resultValue>100000)return {status:'withheld',resultCount:0,output:{status:'withheld',message:'The requested calculation exceeds validated numeric limits.'}};
      const calculation=calculationSchema.parse({
        id:`reconcalc-r${context.package.reconstruction?.revision??0}-${args.candidateId.replace(/[^a-z0-9_-]/gi,'').slice(0,42)}-${args.amount}-${args.unit}`,
        label:`${args.nutrient} in ${args.amount} ${args.unit} (provisional package reading)`,nutrient:args.nutrient,
        input:reconstructed.value,inputUnit:reconstructed.unit,basisAmount:reconstructed.basisAmount,portion:args.amount,portionUnit:args.unit,
        result:resultValue,unit:reconstructed.unit,formula:`${reconstructed.value} ${reconstructed.unit} × ${args.amount} ${args.unit} ÷ ${reconstructed.basisAmount} ${reconstructed.basisUnit}`,
        observationIds:reconstructed.evidence.observationIds,...(imageIds.length?{imageIds}:{}),interpretationIds:[reconstructed.rowId],
        assumptions:['Deterministic arithmetic from the saved Gemini package interpretation. The printed value and basis remain provisional and are not independently verified.'],
      });
      const provisionalCalculation={...calculation,evidenceText:calculationEvidenceText(calculation)};
      return {status:'ok',resultCount:1,calculations:[provisionalCalculation],output:{status:'ok',calculation:provisionalCalculation,note:'Deterministic arithmetic from the saved Gemini package interpretation. This estimate remains provisional; it does not confirm or overwrite the package reading.'}};
    }
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

function reconstructionRowMatches(nutrient:string,key:(typeof nutrientKeys)[number]):boolean{
  const label=nutrient.normalize('NFKC').toLocaleLowerCase('en').replace(/[^a-z]+/g,' ');
  const patterns:Record<(typeof nutrientKeys)[number],RegExp>={energy:/\b(?:energy|calorific value|calories)\b/,carbohydrate:/\b(?:carbohydrate|carbohydrates|carbs?)\b/,sugars:/\b(?:total sugars?|sugars?)\b/,addedSugars:/\badded sugars?\b/,protein:/\bprotein\b/,fat:/\b(?:total fat|fat)\b/,saturatedFat:/\b(?:saturated fat|saturates?)\b/,fiber:/\b(?:dietary fibre|dietary fiber|fibre|fiber)\b/,sodium:/\bsodium\b/,salt:/\bsalt\b/};
  if(key==='sugars'&&/added sugars?/.test(label))return false;
  if(key==='fat'&&/saturated fat/.test(label))return false;
  return patterns[key].test(label);
}

/** Deterministic, provisional calculations for a current package's declared serving. */
export function calculateSavedServing(packageData:PackageData):Calculation[]{
  const reconstruction=packageData.reconstruction;
  const serving=reconstruction?.serving;
  if(!reconstruction?.current||!serving||!['clear','provisional'].includes(serving.status)||!serving.quantity||!serving.unit||(!serving.evidence.observationIds.length&&!serving.evidence.imageRegions.length))return [];
  const context:GeminiToolContext={question:'',package:packageData,visualImages:[],searchTerms:new Set(),prepareImage:async image=>image.base64};
  const calculations:Calculation[]=[];
  for(const row of reconstruction.nutritionRows){
    // A qualifier such as "<" or "trace" changes the arithmetic semantics;
    // keep it available for interpretation instead of treating its boundary as an exact value.
    if(row.qualifier||row.value===null||!row.unit||!row.basisAmount||!row.basisUnit||row.basisUnit!==serving.unit||row.basisAmount===serving.quantity)continue;
    const nutrient=nutrientKeys.find(key=>reconstructionRowMatches(row.nutrient,key));
    if(!nutrient)continue;
    const result=calculateNutrition({nutrient,amount:serving.quantity,unit:serving.unit,candidateId:row.rowId},context);
    if(result.status==='ok')calculations.push(...(result.calculations??[]).map(calculation=>{
      // Preserve that this amount is a derived declared-serving calculation.
      // The label is both user-facing and the validator's typed evidence for
      // the natural phrase "per serving" when the source table only has a
      // per-100-g row.
      const withServingLabel={...calculation,label:`${calculation.nutrient} per serving (${serving.printedText})`};
      return{...withServingLabel,evidenceText:calculationEvidenceText(withServingLabel)};
    }));
  }
  return calculations;
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
      return parsed.success ? searchKnowledge(parsed.data, context) : { status: 'error', resultCount: 0, output: { status: 'invalid_arguments', message: 'The local knowledge query was invalid.' } };
    }
    case 'get_nutrition_guidance': {
      const parsed = toolArgs.get_nutrition_guidance.safeParse(args);
      return parsed.success ? retrieveNutritionGuidance(parsed.data, context) : { status: 'error', resultCount: 0, output: { status: 'invalid_arguments', message: 'The nutrition-guidance query was invalid.' } };
    }
    case 'search_food_composition': {
      const parsed = toolArgs.search_food_composition.safeParse(args);
      return parsed.success ? searchFoodCompositionTool(parsed.data) : { status: 'error', resultCount: 0, output: { status: 'invalid_arguments', message: 'The USDA food-composition query was invalid.' } };
    }
    case 'resolve_ingredient': {
      const parsed = toolArgs.resolve_ingredient.safeParse(args);
      return parsed.success ? resolveIngredient(parsed.data, context) : { status: 'error', resultCount: 0, output: { status: 'invalid_arguments', message: 'The ingredient query was invalid.' } };
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
