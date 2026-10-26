import {nutrientMassConflict} from '../nutrient-mass';
import { packageWithRowCorrections } from '../reconstruction-correction';
import { Type, type FunctionDeclaration } from '@google/genai';
import { z } from 'zod';
import {
  calculationEvidenceText,
  calculationSchema,
  calculableNutrientUnits,
  nutrientKeys,
  normalizedCropSchema,
  profileSchema,
  sourceSchema,
  type Calculation,
  type NutrientKey,
  type EvidenceSource,
  type PackageData,
  type TentativeStructuredCandidate,
} from '../contracts';
import { matchesPackageRows, reconcileInterpretedNutrition } from '../interpreted-nutrients';
import { calculationsFromReconstruction } from '../portion';
import { calculationRespectsCorrections } from '../correction';
import { isGuidanceEvidenceInScope, isLocalEvidenceTopicallyRelevant } from '../followup-evidence';
import { evidenceSources, findIngredientEvidence, ingredientFamilySources, lookupIngredientFamilies, indianStapleIdentitySources, lookupAdditive, lookupExplicitAdditiveMention, lookupIndianStapleIngredientIdentity, resolveTentativeAdditiveIdentity, jecfaAssessmentTerminology } from '../../modules/knowledge';
import { searchOpenFoodTox, semanticRetrieve } from '../semantic';
import { searchFoodComposition, type FoodCompositionFood } from './food-composition';
import { readFoodCompositionSource, fdcRecordInput } from './food-composition-records';
import { readFoodOnConcept, foodOnConceptInput, readOpenFoodToxRecords, openFoodToxDetailInput, searchFoodOn, type FoodOnHit, type FoodOnSearch, type OpenFoodToxHit, type OpenFoodToxSearch } from '../../modules/knowledge/server';
import { isValidGtin, findOcrGtinCandidate } from '../barcode';
import { productInput, lookupProducts } from './products';
import {readProductRecord,productRecordInput} from './product-records';
import {readCodexCategories,codexCategoryInput} from './codex-categories';
import {readResearchRecord,researchRecordInput,abstractChunks} from './research-records';
import {searchJecfa,readJecfaRecord,jecfaSearchInput,jecfaRecordInput} from './jecfa-records';
import {searchGuidelines,readGuidelinePages,guidelineSearchInput,guidelinePageInput,guidelineCatalog} from './guideline-documents';
import { researchInput, research } from './research';
import { fixedFetch } from './http';
import { getNutritionGuidance, getNutritionGuidanceCoverageFacts } from './nutrition-guidance';

const imageIdSchema = z.string().min(1).max(160);
const querySchema = z.string().trim().min(2).max(180);
function matchesAuthorizedContext(contextText: string, candidate: string): boolean {
  const normalizedContext = ' ' + contextText.normalize('NFKC').toLocaleLowerCase('en-IN').replace(/[^\p{L}\p{N}]+/gu, ' ').trim() + ' ';
  const normalizedCandidate = candidate.normalize('NFKC').toLocaleLowerCase('en-IN').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return normalizedCandidate.length > 0 && normalizedContext.includes(' ' + normalizedCandidate + ' ');
}
function matchesAuthorizedJurisdiction(contextText: string, candidate: string): boolean {
  const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase('en-IN').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const normalizedCandidate = normalize(candidate);
  const aliases: Record<string, readonly string[]> = {
    india: ['India', 'Indian'],
    'united states': ['United States', 'US', 'USA'],
    'united kingdom': ['United Kingdom', 'UK', 'Britain'],
    'european union': ['European Union', 'EU'],
    global: ['global', 'international'],
  };
  const matchingGroup = Object.entries(aliases).find(([canonical, values]) =>
    normalize(canonical) === normalizedCandidate || values.some(value => normalize(value) === normalizedCandidate));
  return (matchingGroup?.[1] ?? [candidate]).some(alias => matchesAuthorizedContext(contextText, alias));
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
  search_food_composition: z.object({ release:z.enum(['fdc-foundation-2026-04','fdc-fndds-2021-2023']).optional(), query: z.string().trim().min(2).max(180), nutrients: z.array(z.string().trim().min(2).max(80)).max(8).optional() }).strict(),
  resolve_ingredient: z.object({ query: querySchema }).strict(),
  lookup_chemical_identity: z.object({ query: querySchema }).strict(),
  get_substance_assessments: z.object({ query: querySchema }).strict(),
  get_assessment_records: openFoodToxDetailInput,
  get_ingredient_concept:foodOnConceptInput,
  get_food_composition_record:fdcRecordInput,
  search_guideline_documents:guidelineSearchInput,
  get_guideline_pages:guidelinePageInput,
  search_jecfa:jecfaSearchInput,
  get_jecfa_record:jecfaRecordInput,
  get_research_record:researchRecordInput,
  get_codex_category: codexCategoryInput,
  get_product_record:productRecordInput,
  calculate_nutrition: z.object({ nutrient: z.preprocess(value=>value===null?undefined:value,z.enum(nutrientKeys).optional()), amount: z.number().finite().positive().max(10000), unit: z.enum(['g', 'ml', 'pieces', 'servings', 'package']), candidateId:z.preprocess(value=>value===null?undefined:value,z.string().min(1).max(120).optional()) }).strict().refine(value=>!!value.nutrient||!!value.candidateId,{message:'Select a standard nutrient or an exact saved nutrition row.'}),
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
 {name:'search_guideline_documents',description:'Search complete pinned WHO guideline text locally: carbohydrate quality (2023), saturated/trans-fat quality and replacement (2023), lower-sodium salt substitutes (2025). No query lists the catalog. Default recommendations scope includes primary recommendations and remarks; all scope includes the full document. Navigation previews are incomplete: use get_guideline_pages for complete population, strength, exceptions and numeric context. This is general guidance, not individualized treatment.',parameters:{type:Type.OBJECT,properties:{query:{type:Type.STRING},documentId:{type:Type.STRING,enum:guidelineCatalog.map(d=>d.id),description:'Exact catalog machine ID, not the document title.'},scope:{type:Type.STRING,enum:['recommendations','all']},limit:{type:Type.INTEGER}}}},
 {name:'get_guideline_pages',description:'Read 1–3 complete PDF text-layer pages from a selected local WHO guideline. Retains source hash, publication, rights, PDF page and full passage attribution. Read adjoining scope/remarks before applying a number. Differentiate adult/child targets, strong/conditional advice, naturally occurring fibre versus extracts, discretionary salt versus manufactured-food salt, and excluded populations. No automatic personal target.',parameters:{type:Type.OBJECT,properties:{documentId:{type:Type.STRING,enum:guidelineCatalog.map(d=>d.id),description:'Exact catalog machine ID, not the document title.'},pages:{type:Type.ARRAY,minItems:'1',maxItems:'3',items:{type:Type.INTEGER},description:'One to three PDF page numbers returned by search/catalog, not printed page labels.'}},required:['documentId','pages']}},
 {name:'search_jecfa',description:'Search WHO JECFA by a substance name or CAS number. Returns identity candidates and record IDs, not personal safety or Indian authorization. Resolve similar salts/mixtures carefully.',parameters:{type:Type.OBJECT,properties:{query:{type:Type.STRING},offset:{type:Type.INTEGER},limit:{type:Type.INTEGER}},required:['query']}},
 {name:'get_jecfa_record',description:'Read one WHO JECFA chemical ID and its latest or explicitly selected evaluation year. Preserves original ADI/TDI text, comments, intake, meeting, report/monograph links, history years and qualifiers. Page fields when nextOffset exists. Never convert a body-weight exposure reference into a package allowance without measured additive amounts.',parameters:{type:Type.OBJECT,properties:{id:{type:Type.INTEGER},year:{type:Type.INTEGER},offset:{type:Type.INTEGER},limit:{type:Type.INTEGER}},required:['id']}},
 {name:'get_research_record',description:'Inspect one exact Europe PMC publication source/id returned by research discovery or explicitly supplied. Returns original publication-type/retraction/correction metadata where supplied and complete bounded abstract passages with pagination. Use these to inspect populations, exposures, outcomes and limitations before scientific synthesis. Not full-text appraisal or clinical guidance; missing status/abstract is unknown.',parameters:{type:Type.OBJECT,properties:{source:{type:Type.STRING,enum:['MED','PMC','PPR','AGR','CBA','PAT'],description:'Publication database source, normally MED for a PubMed identifier.'},id:{type:Type.STRING,description:'Identifier only, without source prefix; for MED 12345678 use id 12345678.'},offset:{type:Type.INTEGER},limit:{type:Type.INTEGER}},required:['id']}},
 { name: 'get_codex_category', description: 'Search the locally pinned complete English Codex food-category hierarchy or inspect one exact code, its ancestors and paged direct children. This is international taxonomy, not a food classification decision, additive permission, maximum dose or Indian law. Category-specific provisions/notes must be investigated separately.', parameters: {type:Type.OBJECT,properties:{code:{type:Type.STRING},query:{type:Type.STRING},offset:{type:Type.INTEGER},limit:{type:Type.INTEGER}}} },
 {name:'get_product_record',description:'Inspect the original Open Food Facts record for an exact GTIN already in the question/package or returned by lookup_product. Start with section identity, ingredients, nutrition, claims or quality to list present/missing fields; request one field and optional exact entryKey for a nutrient/source object. Bounded original fields preserve ingredient tree/percentages, allergen versus precautionary traces, serving basis, as-sold versus prepared nutrients, qualifiers and source quality. This is external community data, never confirmed package facts or local stock.',parameters:{type:Type.OBJECT,properties:{barcode:{type:Type.STRING},section:{type:Type.STRING,enum:['identity','ingredients','nutrition','claims','quality']},field:{type:Type.STRING},entryKey:{type:Type.STRING},offset:{type:Type.INTEGER},limit:{type:Type.INTEGER}},required:['barcode']}},
  {name:'get_food_composition_record',description:'Inspect an exact local USDA food returned by search_food_composition. Start with release and fdcId to list available source fields, then request a field such as foodNutrients, foodPortions, inputFoods or nutrientConversionFactors with offset/limit. For a specific nutrient, select field foodNutrients and nutrientId from the search result to retrieve its complete original object. Preserves original measurement, derivation and recipe/sample context. These are generic references, never photographed package truth. Missing source amounts are not zero; do not invent conversions.',parameters:{type:Type.OBJECT,properties:{release:{type:Type.STRING,enum:['fdc-foundation-2026-04','fdc-fndds-2021-2023']},fdcId:{type:Type.INTEGER},nutrientId:{type:Type.INTEGER,description:'Exact FDC nutrient ID (for example 1003 for protein), only with field foodNutrients.'},field:{type:Type.STRING},offset:{type:Type.INTEGER},limit:{type:Type.INTEGER,description:'One to ten complete source items.'}},required:['release','fdcId']}},
  {name:'get_ingredient_concept',description:'Inspect one exact FoodOn ingredient concept returned by resolve_ingredient. Read English synonyms, parents/children/ancestor paths, or relation source for original definitions, properties and reified annotation context. Source fields preserve nested restrictions without computing OWL entailments or clinical effects; deprecation and missing declarations are explicit. These are ontology classifications, not evidence of allergens, nutrient composition, health effects, package presence or legal permission. Do not infer those relationships from taxonomy.',parameters:{type:Type.OBJECT,properties:{id:{type:Type.STRING,description:'Exact FOODON_ plus eight-digit identifier.'},relation:{type:Type.STRING,enum:['parents','children','ancestors','source']},offset:{type:Type.INTEGER},limit:{type:Type.INTEGER,description:'One to twenty related concepts per page.'}},required:['id']}},
  {name:'get_assessment_records',description:'Read detailed EFSA OpenFoodTox source records after get_substance_assessments returns an exact substanceId. Human-health and animal-health are assessment domains, not study-subject declarations; inspect species/population. Select a section, then an exact recordId for richer fields or source-declared literature/dossier/registry links. Preserves endpoints, dose and units, species/populations, methods, uncertainty and citations when present. Flattened rows can belong to one document. Animal, occupational and environmental endpoints are not human dietary limits; lack of an ADI is not proof of danger. Records do not establish package exposure, Indian authorization or personal safety.',parameters:{type:Type.OBJECT,properties:{substanceId:{type:Type.STRING,description:'Exact substance UUID from the identity/assessment lookup.'},section:{type:Type.STRING,enum:['overview','reference-values','human-health','animal-health','environment','properties','summaries','composition','metabolites']},recordId:{type:Type.STRING,description:'Exact recordId returned by this tool or its source-declared links.'},fields:{type:Type.ARRAY,items:{type:Type.STRING},description:'Up to six exact available field names; requires recordId.'},offset:{type:Type.INTEGER,description:'Zero-based page offset.'},limit:{type:Type.INTEGER,description:'One to five source rows per page.'}},required:['substanceId']}},
  { name: 'inspect_package_image', description: 'Inspect an attached original package photo or a focused crop using your visual understanding. Use when OCR merges adjacent label regions or a small/dense nutrition table is not fully readable at full-photo scale; for a table, inspect one crop that keeps the complete panel, row labels and column headings together. Select bounds from the attached image geometry, not remembered product coordinates. Do not crop isolated digits, and treat a crop as the same image evidence rather than independent corroboration. The photo must already be attached to this request.', parameters: { type: Type.OBJECT, properties: { imageId: { type: Type.STRING, description: 'Exact imageId from the attached package images.' }, crop: cropParameters }, required: ['imageId'] } },
  { name: 'search_knowledge', description: 'Search NutriScan’s local, attributed food and ingredient evidence index. This does not make a network request.', parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: 'A focused food, nutrient, ingredient, or guidance query.' } }, required: ['query'] } },
  { name: 'get_nutrition_guidance', description: 'Retrieve a small local set of source-linked nutrition guidance for an explicitly relevant condition or goal. Uses only NutriScan-authored summaries of official sources and sends no query, profile, or image to an external service. Prefer the user’s stated jurisdiction when known. Keep population guidance separate from personal targets and package facts; do not infer diagnoses or prescribe a nutrient allowance.', parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: 'A focused condition/goal and nutrient/behavior query. Omit unrelated package details so relevant guidance is not filtered out.' }, condition: { type: Type.STRING, description: 'Only a condition explicitly stated by the user or included in authorized profile context.' }, goal: { type: Type.STRING, description: 'Only a nutrition goal stated by the user or included in authorized profile context.' }, jurisdiction: { type: Type.STRING, description: 'A jurisdiction stated by the user or available in authorized context, such as India.' }, maxResults: { type: Type.NUMBER, description: 'Optional result limit from 1 to 5.' } }, required: ['query'] } },
  { name: 'search_food_composition', description: 'Search local USDA FoodData Central Foundation Foods and FNDDS structured snapshots for generic food-composition reference values. FNDDS includes U.S. survey records for some Indian-style dishes, not authoritative Indian recipes. Use when the user asks how a basic food compares or requests composition context; request relevant nutrient families. Values are source-reported per 100 g edible portion, not facts about a branded Indian product, its package, portion or an individual. Survey portion examples are not package servings. Missing nutrient rows are unavailable, not zero. Includes release, source citation, license and limitations. No external query is sent.', parameters: { type: Type.OBJECT, properties: { release:{type:Type.STRING,enum:['fdc-foundation-2026-04','fdc-fndds-2021-2023'],description:'Select a release when analytical Foundation or survey FNDDS provenance matters. An absent match is not permission to substitute the other release.'}, query: { type: Type.STRING, description: 'A specific generic food name or phrase, such as dry chickpeas, idli, chapatti or roti.' }, nutrients: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Up to eight requested nutrient families, such as protein, carbohydrate, fiber, sodium, potassium, energy, or saturated fat. Omit to return common macronutrient and sodium fields.' } }, required: ['query'] } },
  { name: 'resolve_ingredient', description: 'Look up one observed ingredient or additive. Returns exact source-attributed Indian terminology, FoodOn identity candidates, reviewed ingredient-source/allergen name relationships, and linked outcome evidence when available. Explicit INS codes may query Codex and exact EFSA records. Relationships retain provenance and limitations: identity is not package presence, dose, personal safety or Indian authorization. No photos/profile are sent to external identity services.', parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: 'One observed ingredient name or additive identifier, not the entire ingredient list.' } }, required: ['query'] } },
  { name: 'lookup_chemical_identity', description: 'Read-only PubChem PUG REST lookup of a chemical name already present in the user question/package text or returned by exact local ingredient or assessment lookup. Returns registry identity candidates only, not food-use authorization, dose, hazard assessment or personal safety. Sends only the name; never photos or profile data.', parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: 'A specific chemical name from the question, printed package text or an exact local identity result, not a numeric value or general food question.' } }, required: ['query'] } },
  { name: 'get_substance_assessments', description: 'Find an EFSA OpenFoodTox substance by name, synonym, CAS or PubChem identifier. Returns identity, a limited reference-value overview and available detailed sections. It does not return full study methods, results or population context. For those questions use get_assessment_records with the returned substanceId and relevant section/record. Follow source-declared literature links or search_research when the original opinion is needed. These records do not establish package exposure, Indian authorization or personal safety. No network request is made.', parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: 'A substance name, synonym, CAS number or PubChem CID from the question, package text or a locally resolved ingredient identity.' } }, required: ['query'] } },
  { name: 'calculate_nutrition', description: 'Use deterministic results already supplied with the package when they cover the requested nutrient and exact portion; do not repeat those calculations. Call this tool for missing portion results, including comparisons between piece counts, servings, or a whole/partial package. To calculate any other printed nutrient (including micronutrients and separately printed subcomponents), provide its exact saved nutrition rowId as candidateId and omit nutrient. Do not assign an unrelated standard nutrient key. Never perform package arithmetic in answer text. Pieces and servings use the saved evidence-linked printed serving definition; package amounts use only one current, evidence-linked printed net-content declaration and a compatible nutrient basis. Do not derive net contents from an item count or serving size. Calculate from an unconflicted user-confirmed package nutrient, a currently attached evidence-linked interpretation, or an exact rowId from the saved package reconstruction. Interpretation-based arithmetic remains provisional and never confirms or changes the package. Missing or conflicting definitions withhold the calculation.', parameters: { type: Type.OBJECT, properties: { nutrient: { type: Type.STRING, enum: [...nutrientKeys] }, amount: { type: Type.NUMBER, description: 'Requested amount in the selected unit. For package, this is the number of packages (for example 1 for one package or 0.5 for half a package); otherwise grams, millilitres, pieces or declared servings.' }, unit: { type: Type.STRING, enum: ['g', 'ml', 'pieces', 'servings', 'package'] }, candidateId:{type:Type.STRING,description:'Exact candidateId or saved rowId. Required when nutrient is omitted; selects any complete printed nutrient row without guessing a standard identity.'} }, required: ['amount', 'unit'] } },
  { name: 'lookup_product', description: 'Read-only Open Food Facts search by an exact barcode or product text explicitly present in the user question or package observations. Sends only that query to the public catalog; never sends images or profile data. Results are community candidates, not confirmed package facts.', parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: 'A product name or brand present in the question or visible package OCR.' }, barcode: { type: Type.STRING, description: 'An exact 8–14 digit barcode present in the question or package OCR.' } } } },
  { name: 'search_research', description: 'Read-only search of Europe PMC or NutriScan’s fixed official India regulation sources. External query terms must be present in the user question/package OCR or a successful exact local identity lookup. If withheld, retry using only the already-authorized terms listed in the tool result; do not add synonyms, doses, jurisdictions, dates or inferred topics. If a local registry supplies only publication links and the user asks for the assessment finding, search the linked entity/topic rather than inferring the finding from metadata. Search results are candidates, not an evidence synthesis.', parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: 'Focused terms drawn from the explicit question, package OCR or successful exact local identity results.' }, topic: { type: Type.STRING, enum: ['science', 'regulation', 'claims'] } }, required: ['query', 'topic'] } },
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
    const response = await searchFoodComposition(args.query, 3, args.release);
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
      return { source, score, detailAccess:{tool:"get_food_composition_record",release:dataset.id,fdcId:food.fdcId}, fdcId: food.fdcId, description: food.description, category: food.category, dataType: food.dataType, publicationDate: food.publicationDate, portionBasis: { amount: 100, unit: 'g', description: 'edible portion' }, surveyPortionExamples: food.dataType === 'Survey (FNDDS)' ? food.portions.slice(0, 8).map(portion => ({ description: portion.description, gramWeight: portion.gramWeight, note: 'FNDDS reference portion; not this package’s declared serving.' })) : [], nutrients: nutrients.map(item => ({ nutrientId: item.nutrientId, name: item.name, amount: item.amount, unit: item.unit, loq: item.loq, reportedValue: fdcAmountText(item), dataPoints: item.dataPoints, min: item.min, max: item.max, median: item.median, derivation: item.derivation })), sourceId };
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
function externalQueryTerms(query: string, context: GeminiToolContext) {
  const allowed = new Set(tokens([
    context.question,
    context.package.name,
    context.package.brand ?? '',
    context.package.barcode ?? '',
    context.package.userDescription ?? '',
    ...context.package.observations.filter(item => item.origin === 'ocr').map(item => item.text),
    ...context.searchTerms,
  ].join(' ')));
  const requested = tokens(query).filter(token => token.length > 2);
  return {
    unsupported: requested.filter(token => !allowed.has(token)),
    authorized: [...new Set(requested.filter(token => allowed.has(token)))],
  };
}
function externalQueryIsSupported(query: string, context: GeminiToolContext) {
  return externalQueryTerms(query, context).unsupported.length === 0;
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
  const jurisdiction = args.jurisdiction && matchesAuthorizedJurisdiction(authorizedContext, args.jurisdiction)
    ? args.jurisdiction
    : context.profile?.country.trim() || undefined;
  const evidence = getNutritionGuidance({
    // Once its condition is explicitly authorized, honor the agent's focused
    // retrieval query rather than ranking every condition in the conversation.
    // Unrecognized/invented condition arguments still cannot create context.
    query: condition ? args.query : authorizedContext,
    ...(condition ? { condition } : {}),
    ...(goal ? { goal } : {}),
    ...(jurisdiction ? { jurisdiction } : {}),
    ...(args.maxResults ? { maxResults: args.maxResults } : {}),
  });
  const guidanceCoverageFacts = getNutritionGuidanceCoverageFacts(args.query, evidence.map(source => source.id));
  return {
    status: evidence.length ? 'ok' : 'empty',
    resultCount: evidence.length,
    evidence,
    output: {
      status: evidence.length ? 'ok' : 'empty',
      results: evidence,
      ...(guidanceCoverageFacts.length ? { guidanceCoverageFacts } : {}),
      message: evidence.length
        ? 'Local source-linked summaries only. Treat population guidance as context, not an individualized target or a verdict about one package.'
        : 'No sufficiently relevant local guidance summary matched. Do not invent a target; use an explicitly authorized current research lookup if the user needs a current source.',
      fullGuidelineAccess:{tool:'search_guideline_documents',catalog:guidelineCatalog,installation:'Optional local store; tool reports availability. Inspect complete pages and scope.'},
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
  const identityCandidates = identityHits.slice(0, candidateEvidence.length).map(hit => ({ conceptId:hit.term.id, detailTool:'get_ingredient_concept', sourceId: `foodon-${hit.term.id.toLowerCase()}`, title: `${hit.term.label} (${hit.term.id})`, matchedBy: hit.matchedBy, matchedText: hit.matchedText, parents: hit.parents }));
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

async function getAssessmentRecords(args:z.input<typeof openFoodToxDetailInput>):Promise<GeminiToolResult>{
  const detail=await readOpenFoodToxRecords(args);
  if(detail.status==='unavailable')return{status:'unavailable',resultCount:0,output:detail};
  const evidence=detail.results.map(record=>asEvidenceSource({
    id:`openfoodtox-record-${record.recordId.replace(/[^a-z0-9-]/gi,'-')}`,
    title:`EFSA source record: ${record.endpoint??record.section}`.slice(0,300),publisher:'European Food Safety Authority (EFSA)',url:'https://doi.org/10.5281/zenodo.19388272',category:'assessment',
    jurisdiction:'EFSA source assessment; European Union. Not Indian food-use authorization or package exposure.',publishedAt:detail.source.releaseDate,effectiveAt:null,retrievedAt:new Date().toISOString(),
    summary:`Source record ${record.recordId}; substance ${args.substanceId}; ${JSON.stringify(record.fields)}`.slice(0,1600),
    limitations:'A source record is not a personal target or safety verdict. Preserve species, endpoint, route, dose, qualifiers and assessment context. Flattened rows may belong to one document. Citation preview is bounded; full fields travel in the native tool record. Oversized fields are omitted explicitly; retrieve exact fields or the original EFSA output.',license:'EFSA OpenFoodTox 3.0, CC BY-ND 4.0. Local extracted store is not redistributed.',
  })).filter((item):item is EvidenceSource=>!!item);
  const searchTerms=detail.results.flatMap(record=>['GeneralInfo.Name','GeneralInfo.Author','GeneralInfo.Source','DossierSubject.DossierSubmissionRemark'].flatMap(field=>{
    const value=record.fields[field];return typeof value==='string'&&!record.truncatedFields.includes(field)?[value]:[];
  }));
  return{status:detail.status==='ok'?'ok':'empty',resultCount:detail.results.length,evidence,searchTerms,output:detail};
}

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
    const details=await Promise.all(response.results.map(hit=>readOpenFoodToxRecords({substanceId:hit.substance.substanceId}).catch(()=>({status:'unavailable' as const,reason:'invalid-substance-id',results:[]}))));
    const searchTerms = response.results.filter(hit => hit.matchedBy !== 'name-token-overlap').flatMap(hit => [hit.substance.name, ...hit.substance.aliases, ...Object.values(hit.substance.identifiers).map(String)]);
    return {
      status: evidence.length ? 'ok' : 'empty', resultCount: evidence.length, evidence, searchTerms,
      output: {
        status: evidence.length ? 'ok' : 'no_assessment_values',
        dataset: { ...response.source, statistics: response.statistics },
        results: response.results.map((hit,index) => ({
          detailAccess:{tool:'get_assessment_records',...details[index]},
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

/** Scale one exact reconstructed row without assigning it an inferred nutrient identity. */
function calculateReconstructedRow(row:NonNullable<PackageData['reconstruction']>['nutritionRows'][number],nutrient:NutrientKey|null,args:{amount:number;unit:'g'|'ml'},context:GeminiToolContext):GeminiToolResult{
  const withheld=(message:string):GeminiToolResult=>({status:'withheld',resultCount:0,output:{status:'withheld',message}});
  const imageIds=[...new Set(row.evidence.imageRegions.map(item=>item.imageId))];
  if(!context.package.reconstruction?.current||!['clear','provisional'].includes(row.status)||row.qualifier||row.value===null||!row.unit||!row.basisAmount||!row.basisUnit||row.basisUnit!==args.unit||(!row.evidence.observationIds.length&&!imageIds.length))return withheld('The saved row needs an exact, current, evidence-linked value, unqualified unit and matching mass or volume basis.');
  if(!calculableNutrientUnits.some(unit=>unit===row.unit))return withheld('The saved row does not use a supported absolute nutrient unit. Percentages and reference-intake percentages are not nutrient quantities.');
  const massConflict=nutrientMassConflict({...row,nutrientKey:row.nutrientKey??nutrient});
  if(massConflict)return withheld(massConflict);
  const corrected=context.package.reconstructionCorrections?.some(item=>item.rowId===row.rowId&&row.evidence.observationIds.includes(item.observationId));
  const result=row.value*args.amount/row.basisAmount;
  if(!Number.isFinite(result)||result>100000)return withheld('The requested calculation exceeds validated numeric limits.');
  const calculation=calculationSchema.parse({
    inputOrigin:corrected?'user-correction':'model-interpretation',
    id:`reconcalc-r${context.package.reconstruction.revision}-${row.rowId.replace(/[^a-z0-9_-]/gi,'').slice(0,42)}-${args.amount}-${args.unit}`,
    label:`${row.nutrient} in ${args.amount} ${args.unit} (${corrected?'your correction':'provisional package reading'})`,nutrient,...(nutrient===null?{nutrientLabel:row.nutrient}:{}),
    input:row.value,inputUnit:row.unit,basisAmount:row.basisAmount,portion:args.amount,portionUnit:args.unit,result,unit:row.unit,
    formula:`${row.value} ${row.unit} × ${args.amount} ${args.unit} ÷ ${row.basisAmount} ${row.basisUnit}`,
    observationIds:row.evidence.observationIds,...(imageIds.length?{imageIds}:{}),interpretationIds:[row.rowId],
    assumptions:[corrected?'Deterministic arithmetic from the current user correction. This is not an independently verified label reading.':'Deterministic arithmetic from the saved Gemini package interpretation. The printed value and basis remain provisional and are not independently verified.'],
  });
  if(!calculationRespectsCorrections(context.package,calculation))return withheld('A user correction supersedes the evidence for this saved row. Recheck the current reading before calculating.');
  const linked={...calculation,evidenceText:calculationEvidenceText(calculation)};
  return{status:'ok',resultCount:1,calculations:[linked],output:{status:'ok',calculation:linked,note:'Calculated from the exact saved nutrition row. This estimate remains provisional; it does not confirm or overwrite the package reading.'}};
}

function calculateNutrition(args: z.infer<typeof toolArgs.calculate_nutrition>, context: GeminiToolContext): GeminiToolResult {
  context={...context,package:packageWithRowCorrections(context.package)};
  if(args.unit==='package'){
    const reconstruction=context.package.reconstruction;
    const declarations=reconstruction?.current?(reconstruction.quantityDeclarations??[]).filter(item=>item.kind==='net-content'):[];
    const withheld=(message:string):GeminiToolResult=>({status:'withheld',resultCount:0,output:{status:'withheld',message}});
    if(!reconstruction?.current)return withheld('A current package reconstruction is required before calculating a whole-package amount.');
    if(declarations.length!==1)return withheld('Whole-package calculation requires exactly one current printed net-content declaration. Physical unit counts and servings-per-package are not substitutes.');
    const declaration=declarations[0];
    const knownImageIds=new Set([
      ...context.package.observations.flatMap(item=>item.imageId?[item.imageId]:[]),
      ...(context.package.ocrCaptures??[]).map(item=>item.imageId),
      ...(context.package.visionCaptures??[]).map(item=>item.imageId),
      ...context.visualImages.map(item=>item.imageId),
    ]);
    const hasQuantityEvidence=declaration.evidence.observationIds.some(id=>context.package.observations.some(item=>item.id===id))
      ||declaration.evidence.imageRegions.some(item=>knownImageIds.has(item.imageId));
    if(!['clear','provisional'].includes(declaration.status)||declaration.quantity===null||!declaration.unit||!hasQuantityEvidence)return withheld('The printed net contents are unresolved or lack retained package evidence.');
    const portion=declaration.quantity*args.amount;
    if(!Number.isFinite(portion)||portion<=0||portion>10000)return withheld('The requested package amount exceeds validated calculation limits.');
    const result=calculateNutrition({...args,amount:portion,unit:declaration.unit},context);
    if(result.status!=='ok')return result;
    const quantityObservationIds=declaration.evidence.observationIds.filter(id=>context.package.observations.some(item=>item.id===id));
    const quantityImageIds=[...new Set(declaration.evidence.imageRegions.map(item=>item.imageId).filter(id=>knownImageIds.has(id)))];
    const calculations=(result.calculations??[]).map(calculation=>{
      const updated=calculationSchema.parse({...calculation,
        label:`${calculation.label}; ${args.amount} package${args.amount===1?'':'s'}`,
        packagePortion:{packageCount:args.amount,netContentPerPackage:declaration.quantity!,unit:declaration.unit!,printedText:declaration.printedText},
        observationIds:[...new Set([...calculation.observationIds,...quantityObservationIds])],
        imageIds:[...new Set([...(calculation.imageIds??[]),...quantityImageIds])],
        formula:`${args.amount} package${args.amount===1?'':'s'} × ${declaration.quantity} ${declaration.unit} net contents per package = ${portion} ${declaration.unit}; ${calculation.formula}`,
        assumptions:[...calculation.assumptions,'Uses the explicit evidence-linked printed net contents; no package amount was derived from a serving or inner-unit count.'],
      });
      return{...updated,evidenceText:calculationEvidenceText(updated)};
    });
    return{...result,calculations,output:{...result.output,calculation:calculations[0],packageConversion:{requestedPackages:args.amount,netContentPerPackage:declaration.quantity,unit:declaration.unit,printedText:declaration.printedText,revision:reconstruction.revision}}};
  }
  if(args.unit==='pieces'||args.unit==='servings'){
    const reconstruction=context.package.reconstruction;
    const serving=reconstruction?.serving;
    const withheld=(message:string):GeminiToolResult=>({status:'withheld',resultCount:0,output:{status:'withheld',message}});
    if(!reconstruction?.current||!serving||!['clear','provisional'].includes(serving.status)||!serving.quantity||!serving.unit||(!serving.evidence.observationIds.length&&!serving.evidence.imageRegions.length))return withheld('A current evidence-linked printed serving mass or volume is required; no typical serving weight is assumed.');
    if(context.package.serving&&(context.package.serving.unit!==serving.unit||Math.abs(context.package.serving.value-serving.quantity)>1e-8))return withheld('The saved serving definition conflicts with the current package serving. Resolve it before converting a count.');
    if(args.unit==='pieces'&&(!serving.pieceCount||!serving.pieceDescription||['g','gram','grams','ml','millilitre','millilitres','milliliter','milliliters'].includes(serving.pieceDescription.trim().toLowerCase())))return withheld('The printed serving does not establish a food-piece count. No piece weight was inferred.');
    const servings=args.unit==='pieces'?args.amount/serving.pieceCount!:args.amount;
    const amount=servings*serving.quantity;
    if(!Number.isFinite(amount)||amount<=0||amount>10000)return withheld('The converted portion exceeds validated numeric limits.');
    const result=calculateNutrition({...args,amount,unit:serving.unit},context);
    if(result.status!=='ok')return result;
    const calculations=(result.calculations??[]).map(calculation=>{
      const updated=calculationSchema.parse({...calculation,label:`${calculation.label}; ${args.amount} ${args.unit}`,
        countedPortion:{amount:args.amount,unit:args.unit,servingQuantity:serving.quantity,servingUnit:serving.unit,...(args.unit==='pieces'?{piecesPerServing:serving.pieceCount!}:{})},
        observationIds:[...new Set([...calculation.observationIds,...serving.evidence.observationIds])],
        imageIds:[...new Set([...(calculation.imageIds??[]),...serving.evidence.imageRegions.map(region=>region.imageId)])],
        formula:`${args.amount} ${args.unit} × ${serving.quantity} ${serving.unit}${args.unit==='pieces'?` ÷ ${serving.pieceCount} pieces`:''} = ${amount} ${serving.unit}; ${calculation.formula}`,
        assumptions:[...calculation.assumptions,'Count conversion uses the saved printed serving interpretation; the serving and nutrient readings remain unverified.']});
      return{...updated,evidenceText:calculationEvidenceText(updated)};
    });
    return{...result,calculations,output:{...result.output,calculation:calculations[0],portionConversion:{requestedAmount:args.amount,requestedUnit:args.unit,normalizedAmount:amount,normalizedUnit:serving.unit,printedServing:serving.printedText,revision:reconstruction.revision}}};
  }
  if(!args.nutrient){
    const row=context.package.reconstruction?.current?context.package.reconstruction.nutritionRows.find(row=>row.rowId===args.candidateId):undefined;
    if(!row)return{status:'withheld',resultCount:0,output:{status:'withheld',message:'Select an exact rowId from the current saved package reconstruction.'}};
    if(row.nutrientKey)return calculateNutrition({...args,nutrient:row.nutrientKey},context);
    return calculateReconstructedRow(row,null,{amount:args.amount,unit:args.unit},context);
  }
  if (args.candidateId && context.package.nutrients.some(row => row.key === args.nutrient && row.status === 'corrected')) {
    // The row identifier may come from the model's saved reconstruction, but
    // an explicit user correction is now the application's current input.
    const { candidateId: _supersededRow, ...correctedArgs } = args;
    const result = calculateNutrition(correctedArgs, context);
    return { ...result, output: { ...result.output, ...(result.status === 'ok' ? { note: 'Calculated from the current user correction, which supersedes the earlier model reading. This does not independently verify the correction.' } : {}) } };
  }
  if (args.candidateId) {
    const candidate = context.interpretedCandidates?.find(item => item.candidateId === args.candidateId && item.kind === 'nutrient' && item.field === args.nutrient);
    if (!candidate) {
      const reconstructed=context.package.reconstruction?.nutritionRows.find(row=>row.rowId===args.candidateId&&(row.nutrientKey===undefined?reconstructionRowMatches(row.nutrient,args.nutrient!):row.nutrientKey===args.nutrient));
      if(!reconstructed)return { status: 'withheld', resultCount: 0, output: { status: 'withheld', message: 'The requested interpretation is not among the supplied candidates or saved package rows.' } };
      return calculateReconstructedRow(reconstructed,args.nutrient,{amount:args.amount,unit:args.unit},context);
    }
    const rows = context.package.nutrients.filter(item => item.key === args.nutrient);
    if (rows.some(row => row.status === 'corrected')) return { status: 'withheld', resultCount: 0, output: { status: 'withheld', message: 'A user correction takes precedence over the model candidate.' } };
    const reconciliation = reconcileInterpretedNutrition(context.package, [candidate], context.visualImages.map(image => image.imageId));
    const reading = reconciliation.readings.find(item => item.key === args.nutrient && item.candidateIds.includes(candidate.candidateId));
    if (!reading || !matchesPackageRows(reading, rows) || reading.basis.unit !== args.unit) return { status: 'withheld', resultCount: 0, output: { status: 'withheld', message: reconciliation.withheld.find(item => item.candidateId === candidate.candidateId)?.reason ?? 'The interpretation does not have complete, attached evidence and a matching portion unit.' } };
    const massConflict=nutrientMassConflict({nutrientKey:args.nutrient,value:reading.value,unit:reading.unit,basisAmount:reading.basis.amount,basisUnit:reading.basis.unit});
    if(massConflict)return {status:'withheld',resultCount:0,output:{status:'withheld',message:massConflict}};
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
  if (context.package.reconstruction?.current && !context.package.nutrients.some(row => row.key === args.nutrient && row.status === 'corrected')) {
    const matches=calculationsFromReconstruction(context.package,args.amount,args.unit).filter(row=>row.nutrient===args.nutrient);
    if(matches.length!==1)return{status:'withheld',resultCount:0,output:{status:'withheld',message:'Choose a complete, unconflicted reconstructed row with the requested basis; legacy parser values are not a substitute for the current package interpretation.'}};
    const calculation={...matches[0],evidenceText:calculationEvidenceText(matches[0])};
    return{status:'ok',resultCount:1,calculations:[calculation],output:{status:'ok',calculation,note:'Calculated from the current reconstructed package row; its interpretation remains unverified.'}};
  }
  const matches = context.package.nutrients.filter(item => item.key === args.nutrient);
  if (matches.length !== 1) return { status: 'withheld', resultCount: 0, output: { status: 'withheld', message: matches.length ? 'Conflicting or duplicate package values prevent a single calculation.' : 'No usable package value exists for this nutrient.' } };
  const reading = matches[0];
  if (reading.status === 'conflict' || !reading.basis || reading.basis.unit !== args.unit || !reading.observationIds.length) {
    return { status: 'withheld', resultCount: 0, output: { status: 'withheld', message: 'A confirmed, unconflicted reading with a matching known basis is required; no mass-volume conversion is assumed.' } };
  }
  const massConflict=nutrientMassConflict({nutrientKey:args.nutrient,value:reading.value,unit:reading.unit,basisAmount:reading.basis.amount,basisUnit:reading.basis.unit});
  if(massConflict)return {status:'withheld',resultCount:0,output:{status:'withheld',message:massConflict}};
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
  packageData=packageWithRowCorrections(packageData);
  const reconstruction=packageData.reconstruction;
  const serving=reconstruction?.serving;
  if(!reconstruction?.current||!serving||!['clear','provisional'].includes(serving.status)||!serving.quantity||!serving.unit||(!serving.evidence.observationIds.length&&!serving.evidence.imageRegions.length))return [];
  const context:GeminiToolContext={question:'',package:packageData,visualImages:[],searchTerms:new Set(),prepareImage:async image=>image.base64};
  const calculations:Calculation[]=[];
  const correctedNutrients=new Set(packageData.nutrients.filter(row=>row.status==='corrected').map(row=>row.key));
  for(const nutrient of correctedNutrients){
    const result=calculateNutrition({nutrient,amount:serving.quantity,unit:serving.unit},context);
    if(result.status==='ok')calculations.push(...(result.calculations??[]).map(calculation=>({
      ...calculation,label:`${nutrient} per serving (${serving.printedText})`,
      assumptions:[...calculation.assumptions,'Uses a user correction and the saved serving interpretation; neither is independently verified.'],
    })));
  }
  for(const row of reconstruction.nutritionRows){
    // A qualifier such as "<" or "trace" changes the arithmetic semantics;
    // keep it available for interpretation instead of treating its boundary as an exact value.
    if(row.qualifier||row.value===null||!row.unit||!row.basisAmount||!row.basisUnit||row.basisUnit!==serving.unit||row.basisAmount===serving.quantity)continue;
    // New reconstructions carry a semantic key from Gemini. Do not guess it
    // from the printed label; legacy revisions without the field remain viewable
    // but are not used to create new automatic calculations.
    const nutrient=row.nutrientKey;
    if(!nutrient||correctedNutrients.has(nutrient))continue;
    const result=calculateNutrition({nutrient,amount:serving.quantity,unit:serving.unit,candidateId:row.rowId},context);
    if(result.status==='ok')calculations.push(...(result.calculations??[]).map(calculation=>{
      // Preserve that this amount is a derived declared-serving calculation.
      // The label is both user-facing and the validator's typed evidence for
      // the natural phrase "per serving" when the source table only has a
      // per-100-g row.
      const displayNutrient=row.nutrient.trim().replace(/[_-]+/g,' ').replace(/^\p{L}/u,letter=>letter.toLocaleUpperCase('en-IN'))||row.printedLabel;
      const withServingLabel={...calculation,label:`${displayNutrient} per serving (${serving.printedText})`};
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
    return { status: evidence.length ? 'ok' : 'empty', resultCount: evidence.length, evidence, searchTerms:products.map(product=>product.barcode), output: { status: result.status, message: result.message, candidates: products.map(product => ({ name: product.name, brand: product.brand, barcode: product.barcode, detailAccess:{tool:'get_product_record',barcode:product.barcode}, quantity: product.quantity, countries: product.countries.slice(0, 8), match: product.match, nutrients: product.nutrients.slice(0, 12), ingredients: product.ingredients.slice(0, 1000), allergens: product.allergens.slice(0, 12), url: product.url, lastModified: product.lastModified, warnings: product.warnings?.slice(0, 4) })) } };
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
  const queryTerms=externalQueryTerms(args.query,context);
  if (queryTerms.unsupported.length) return { status: 'withheld', resultCount: 0, output: { status: 'withheld', message: 'External research search was not run because some terms were not in the explicit question or package evidence. Retry using only these already-authorized terms, and omit additions: ' + queryTerms.authorized.join(' ') + '.' } };
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
    return { status: evidence.length ? 'ok' : result.status === 'unavailable' ? 'unavailable' : 'empty', resultCount: evidence.length, evidence, output: { status: result.status, message: result.message, results: evidence.map(item => ({ ...item, ...(item.id.startsWith('epmc-')?{detailAccess:{tool:'get_research_record',source:item.id.split('-')[1],id:item.id.split('-').slice(2).join('-')}}:{}) })) } };
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
    case 'get_food_composition_record': {
      const parsed=toolArgs.get_food_composition_record.safeParse(args);
      if(!parsed.success)return{status:'error',resultCount:0,output:{status:'invalid_arguments'}};
      const detail=await readFoodCompositionSource(parsed.data);
      if(detail.status==='unavailable')return{status:'unavailable',resultCount:0,output:detail};
      if(detail.status!=='ok')return{status:'empty',resultCount:0,output:detail};
      const evidence=asEvidenceSource({id:`fdc-source-${parsed.data.fdcId}`,title:`USDA: ${detail.description}`,publisher:'USDA Agricultural Research Service',url:`https://fdc.nal.usda.gov/food-details/${parsed.data.fdcId}/nutrients`,category:'food-composition',jurisdiction:'United States generic food reference; not Indian branded product composition',publishedAt:null,effectiveAt:null,retrievedAt:new Date().toISOString(),summary:JSON.stringify({food:detail.description,field:parsed.data.field,results:"results" in detail?detail.results:undefined,identity:"identity" in detail?detail.identity:undefined}).slice(0,1600),limitations:detail.limitations,license:detail.source.license});
      return{status:'ok',resultCount:1,output:detail,evidence:evidence?[evidence]:[],searchTerms:typeof detail.description==='string'?[detail.description]:[]};
    }
    case 'get_ingredient_concept': {
      const parsed=toolArgs.get_ingredient_concept.safeParse(args);
      if(!parsed.success)return{status:'error',resultCount:0,output:{status:'invalid_arguments'}};
      const detail=await readFoodOnConcept(parsed.data);
      if(detail.status!=='ok')return{status:detail.status==='no_match'?'empty':'unavailable',resultCount:0,output:detail};
      if('sourceFields' in detail){
        const sources=detail.sourceFields.flatMap(field=>abstractChunks(JSON.stringify(field.value)).chunks.flatMap((chunk,j)=>{const source=asEvidenceSource({id:`foodon-source-${detail.concept.id.toLowerCase()}-${field.ordinal}-${j}`,title:`FoodOn: ${detail.concept.label} source property ${field.ordinal}`.slice(0,300),publisher:'FoodOn Food Ontology',url:detail.source.ontologyUrl,category:'registry',jurisdiction:'Ontology source representation; no legal jurisdiction',publishedAt:detail.source.version,effectiveAt:null,retrievedAt:new Date().toISOString(),summary:chunk,limitations:detail.limitations,license:'CC BY 4.0; FoodOn attribution and pinned release retained.'});return source?[source]:[];}));
        return{status:'ok',resultCount:detail.sourceFields.length,output:detail,evidence:sources,searchTerms:[detail.concept.label]};
      }
      const evidence=asEvidenceSource({id:`foodon-${detail.concept.id.toLowerCase()}`,title:`FoodOn: ${detail.concept.label}`,publisher:'FoodOn Food Ontology',url:detail.source.ontologyUrl,category:'registry',jurisdiction:'Ontology terminology; no legal jurisdiction',publishedAt:detail.source.version,effectiveAt:null,retrievedAt:new Date().toISOString(),summary:JSON.stringify({concept:detail.concept.label,relation:detail.relation,related:detail.results}).slice(0,1600),limitations:detail.limitations,license:'CC BY 4.0; FoodOn attribution and pinned release retained.'});
      return{status:'ok',resultCount:1,output:detail,evidence:evidence?[evidence]:[],searchTerms:[detail.concept.label]};
    }
    case 'resolve_ingredient': {
      const parsed = toolArgs.resolve_ingredient.safeParse(args);
      if (!parsed.success) return { status: 'error', resultCount: 0, output: { status: 'invalid_arguments', message: 'The ingredient query was invalid.' } };
      const resolution = await resolveIngredient(parsed.data, context);
      const relationships = externalQueryIsSupported(parsed.data.query, context) ? lookupIngredientFamilies(parsed.data.query) : [];
      if (!relationships.length) return resolution;
      const sources = [...new Map([...(resolution.evidence ?? []), ...ingredientFamilySources(relationships)].map(source => [source.id, source])).values()];
      return {
        ...resolution, status: 'ok', resultCount: sources.length, evidence: sources,
        output: {
          ...resolution.output,
          status: resolution.status === 'ok' ? resolution.output.status : 'ingredient_source_relationships',
          identityResolutionStatus: resolution.status,
          ingredientSourceRelationships: relationships,
          caveat: 'These exact source-listed name relationships are reference evidence, not an automatic allergen declaration or an individual safety decision. Check origin, current package and precautionary statements; an unmatched ingredient does not establish absence.',
        },
      };
    }
    case 'lookup_chemical_identity': {
      const parsed = toolArgs.lookup_chemical_identity.safeParse(args);
      return parsed.success ? lookupChemicalIdentity(parsed.data, context) : { status: 'error', resultCount: 0, output: { status: 'invalid_arguments', message: 'The chemical identity query was invalid.' } };
    }
    case 'get_substance_assessments': {
      const parsed = toolArgs.get_substance_assessments.safeParse(args);
      return parsed.success ? getSubstanceAssessments(parsed.data) : { status: 'error', resultCount: 0, output: { status: 'invalid_arguments', message: 'The substance assessment query was invalid.' } };
    }
    case 'get_assessment_records': {
      const parsed=toolArgs.get_assessment_records.safeParse(args);
      return parsed.success?getAssessmentRecords(parsed.data):{status:'error',resultCount:0,output:{status:'invalid_arguments',message:'Select an exact EFSA substance ID, section and bounded source-record page.'}};
    }
    case 'calculate_nutrition': {
      const parsed = toolArgs.calculate_nutrition.safeParse(args);
      return parsed.success ? calculateNutrition(parsed.data, context) : { status: 'error', resultCount: 0, output: { status: 'invalid_arguments', message: 'The nutrition calculation arguments were invalid.' } };
    }
    case 'search_guideline_documents': {
      const parsed=toolArgs.search_guideline_documents.safeParse(args);if(!parsed.success)return{status:'error',resultCount:0,output:{status:'invalid_arguments',issues:parsed.error.issues.slice(0,4).map(issue=>({field:issue.path.join('.'),message:issue.message})),availableDocuments:guidelineCatalog,message:'Use an exact catalog documentId (not title), or omit the search documentId; request at most three distinct PDF pages.'}};const result=await searchGuidelines(parsed.data);return{status:result.status==='ok'?'ok':result.status==='empty'?'empty':'unavailable',resultCount:result.results.length,output:result};
    }
    case 'get_guideline_pages': {
      const parsed=toolArgs.get_guideline_pages.safeParse(args);if(!parsed.success)return{status:'error',resultCount:0,output:{status:'invalid_arguments',issues:parsed.error.issues.slice(0,4).map(issue=>({field:issue.path.join('.'),message:issue.message})),availableDocuments:guidelineCatalog,message:'Use an exact catalog documentId (not title), or omit the search documentId; request at most three distinct PDF pages.'}};const result=await readGuidelinePages(parsed.data);if(result.status!=='ok')return{status:result.status==='no_document'?'empty':'unavailable',resultCount:0,output:result};
      const evidence=result.pages.flatMap(page=>abstractChunks(page.text).chunks.flatMap((chunk,i)=>{const source=asEvidenceSource({id:`guideline-${result.source.id}-p${page.page}-${i}`,title:`${result.source.title} — PDF page ${page.page}`.slice(0,300),publisher:'World Health Organization',url:`${result.source.downloadUrl}#page=${page.page}`,category:'guideline',jurisdiction:'Global population guidance; applicability and individual clinical context require interpretation',publishedAt:result.source.publishedAt,effectiveAt:null,retrievedAt:result.source.retrievedAt,summary:chunk,limitations:result.limitations,license:result.source.license});return source?[source]:[];}));
      return{status:result.pages.length?'ok':'empty',resultCount:result.pages.length,output:result,evidence};
    }
    case 'search_jecfa': {
      const parsed=toolArgs.search_jecfa.safeParse(args);if(!parsed.success)return{status:'error',resultCount:0,output:{status:'invalid_arguments'}};
      if(!externalQueryIsSupported(parsed.data.query,context))return{status:'withheld',resultCount:0,output:{status:'unsupported_query',message:'Use an observed substance or an explicitly requested substance name/CAS.'}};
      const result=await searchJecfa(parsed.data);return{status:result.status==='ok'?'ok':result.status==='empty'?'empty':'unavailable',resultCount:'results'in result?(result.results?.length??0):0,output:result,searchTerms:'results'in result?result.results?.map(item=>item.name):[]};
    }
    case 'get_jecfa_record': {
      const parsed=toolArgs.get_jecfa_record.safeParse(args);if(!parsed.success)return{status:'error',resultCount:0,output:{status:'invalid_arguments'}};
      const record=await readJecfaRecord(parsed.data);if(record.status!=='ok')return{status:record.status==='no_year'?'empty':'unavailable',resultCount:0,output:record};
      const parts=[{key:'identity',text:JSON.stringify({name:record.name,overview:record.overview,availableYears:record.availableYears}).slice(0,1500)},...record.fields.flatMap((field,i)=>abstractChunks(field.text).chunks.map((chunk,j)=>({key:`${record.selectedYear}-field-${parsed.data.offset+i}-${j}`,text:`${record.name.slice(0,100)}. Evaluation year ${record.selectedYear}. ${field.label.slice(0,50)}: ${chunk}`})))];
      for(const entry of record.evaluationHistory.entries)for(const field of entry.fields)for(const [j,chunk]of abstractChunks(field.text).chunks.entries())parts.push({key:`${entry.year}-field-${field.offset}-${j}`,text:`${record.name.slice(0,100)}. Evaluation year ${entry.year}. ${field.label.slice(0,50)}: ${chunk}`});
      const evidence=[...new Map(parts.map(part=>[part.key,part])).values()].filter(p=>p.text.length<=1600).flatMap(part=>{const source=asEvidenceSource({id:`jecfa-${record.id}-${part.key}`,title:`${record.name} — JECFA ${record.selectedYear??'identity'}`.slice(0,300),publisher:'WHO / Joint FAO/WHO Expert Committee on Food Additives',url:record.url,category:'registry',jurisdiction:'International scientific assessment; not Indian authorization or individual dietary advice',publishedAt:record.selectedYear?String(record.selectedYear):null,effectiveAt:null,retrievedAt:record.retrievedAt,summary:part.text,limitations:record.limitations,license:record.rights});return source?[source]:[];});
      const terminology=jecfaAssessmentTerminology([...record.fields,...record.evaluationHistory.entries.flatMap(entry=>entry.fields)]);
      const {evidence:termEvidence,...termReference}=terminology??{evidence:[]};
      return{status:'ok',resultCount:1,output:{...record,...(terminology?{referenceTerminology:termReference}:{})},evidence:[...evidence,...termEvidence],searchTerms:[record.name,...record.overview.filter(item=>['CAS number','Synonyms','Chemical Names'].includes(item.label)).map(item=>item.text)]};
    }
    case 'get_research_record': {
      const parsed=toolArgs.get_research_record.safeParse(args);if(!parsed.success)return{status:'error',resultCount:0,output:{status:'invalid_arguments',issues:parsed.error.issues.slice(0,4).map(issue=>({field:issue.path.join('.'),message:issue.message})),message:'Use a database source such as MED and its bare identifier; do not combine source and identifier in the id field.'}};
      const record=await readResearchRecord(parsed.data);if(record.status!=='ok')return{status:record.status==='empty'?'empty':'unavailable',resultCount:0,output:record};
      const texts=[{key:'metadata',text:JSON.stringify({title:record.title,metadata:record.metadata}).slice(0,1500)},...record.abstractChunks.map(chunk=>({key:`abstract-${chunk.index}`,text:chunk.text}))];
      const evidence=texts.flatMap(part=>{const source=asEvidenceSource({id:`epmc-${record.source}-${record.id}-${part.key}`,title:record.title.slice(0,300),publisher:'Europe PMC indexed publication',url:record.url,category:'literature',jurisdiction:'Publication-specific population and setting; applicability requires appraisal',publishedAt:typeof record.metadata.firstPublicationDate==='string'?record.metadata.firstPublicationDate:null,effectiveAt:null,retrievedAt:record.retrievedAt,summary:part.text,limitations:record.limitations,license:'Abstract and publication rights remain with source rights holder; on-demand internal research, no bulk republication.'});return source?[source]:[];});
      return{status:'ok',resultCount:1,output:record,evidence};
    }
    case 'get_codex_category': {
      const parsed=toolArgs.get_codex_category.safeParse(args);if(!parsed.success)return{status:'error',resultCount:0,output:{status:'invalid_arguments'}};
      const result=await readCodexCategories(parsed.data);if(result.status==='unavailable'||result.status==='invalid_source')return{status:'unavailable',resultCount:0,output:result};
      if(result.status==='empty')return{status:'empty',resultCount:0,output:result};
      // Every returned row retains its own complete compact attribution; a
      // clipped overview must not erase child/ancestor evidence after the tool.
      const rows='record'in result?[result.record,...result.ancestors,...result.children]:result.results;
      const evidence=rows.flatMap(row=>{const source=asEvidenceSource({id:`codex-category-${row.code}`,title:`Codex GSFA category ${row.code}: ${row.label}`.slice(0,300),publisher:'Codex Alimentarius Commission (FAO/WHO)',url:row.sourceUrl,category:'registry',jurisdiction:'International Codex taxonomy; not Indian authorization or final food-category applicability',publishedAt:null,effectiveAt:null,retrievedAt:result.retrievedAt,summary:JSON.stringify({code:row.code,label:row.label,parentCode:row.parentCode}),limitations:result.limitations.join(' '),license:result.rights.status});return source?[source]:[];});
      return{status:'ok',resultCount:'record'in result?1:result.results.length,output:result,evidence};
    }
    case 'get_product_record': {
      const parsed=toolArgs.get_product_record.safeParse(args);
      if(!parsed.success)return{status:'error',resultCount:0,output:{status:'invalid_arguments'}};
      const code=parsed.data.barcode;
      const known=code===context.package.barcode||context.searchTerms.has(code)||new RegExp(`(?<!\\d)${code}(?!\\d)`).test(context.question);
      if(!isValidGtin(code)||!known)return{status:'withheld',resultCount:0,output:{status:'unsupported_barcode',message:'Use a checksum-valid GTIN in this question/package or a returned lookup_product candidate.'}};
      const record=await readProductRecord(parsed.data);
      if(record.status==='unavailable')return{status:'unavailable',resultCount:0,output:record};
      if(record.status!=='ok')return{status:'empty',resultCount:0,output:record};
      const source=asEvidenceSource({id:`off-record-${code}-${parsed.data.section}`,title:`Open Food Facts: ${typeof record.sourceName==='string'?record.sourceName:code} — ${parsed.data.section}`.slice(0,300),publisher:'Open Food Facts',url:record.sourceUrl,category:'product',jurisdiction:'Community product record; countries and formulation require inspection',publishedAt:null,effectiveAt:null,retrievedAt:record.retrievedAt,summary:JSON.stringify({context:'context' in record?record.context:undefined,field:parsed.data.field,results:'results' in record?record.results:undefined}).slice(0,1600),limitations:record.limitations,license:record.license});
      return{status:'ok',resultCount:1,output:record,evidence:source?[source]:[],searchTerms:[code]};
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
