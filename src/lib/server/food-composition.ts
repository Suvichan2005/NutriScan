import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const nutrientSchema = z.object({
  nutrientId: z.number().int().positive(), nutrientNumber: z.string().nullable(), name: z.string().min(1),
  unit: z.string().min(1), amount: z.number().finite().nonnegative(), dataPoints: z.number().int().nonnegative().nullable(),
  min: z.number().finite().nullable(), max: z.number().finite().nullable(), median: z.number().finite().nullable(),
  loq: z.number().finite().nonnegative().nullable(), derivation: z.string().nullable(),
}).strict();

const portionSchema = z.object({ description: z.string().max(180), gramWeight: z.number().finite().positive(), amount: z.number().finite().positive(), measure: z.string().min(1) }).strict();
const dataTypeSchema = z.enum(['Foundation', 'Survey (FNDDS)']);
const foodSchema = z.object({
  fdcId: z.number().int().positive(), description: z.string().min(1), category: z.string().nullable(),
  publicationDate: z.string().min(1), dataType: dataTypeSchema, nutrients: z.array(nutrientSchema), portions: z.array(portionSchema),
}).strict();

const sourceSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), dataType: dataTypeSchema, releaseDate: z.string().min(1),
  sourceFile: z.string().min(1), sourceSha256: z.string().regex(/^[a-f0-9]{64}$/), sourceArchiveSha256: z.string().regex(/^[a-f0-9]{64}$/),
  sourceUrl: z.string().url(), documentationUrl: z.string().url(), license: z.string().min(1), licenseUrl: z.string().url(), attribution: z.string().min(1),
  recordsFile: z.string().min(1), recordsSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

const catalogFoodSchema = z.object({
  fdcId: z.number().int().positive(), description: z.string().min(1), category: z.string().nullable(), publicationDate: z.string().min(1),
  dataType: dataTypeSchema, offset: z.number().int().nonnegative(), byteLength: z.number().int().positive(),
}).strict();

const catalogSchema = z.object({
  schemaVersion: z.literal(1), dataset: sourceSchema,
  statistics: z.object({ sourceFoodSlots: z.number().int().nonnegative(), indexedFoods: z.number().int().nonnegative(),
    excludedNullFoodSlots: z.array(z.number().int().nonnegative()), excludedNutrientRows: z.array(z.unknown()),
    excludedPortionRows: z.number().int().nonnegative(), nutrientRowsIndexed: z.number().int().nonnegative(),
    foodsWithPortions: z.number().int().nonnegative() }).strict(),
  foods: z.array(catalogFoodSchema),
}).strict();

export type FoodCompositionNutrient = z.infer<typeof nutrientSchema>;
export type FoodCompositionFood = z.infer<typeof foodSchema>;
export type FoodCompositionSource = Omit<z.infer<typeof sourceSchema>, 'recordsFile' | 'recordsSha256'>;
type CatalogFood = z.infer<typeof catalogFoodSchema>;
type DatasetCatalog = z.infer<typeof catalogSchema>;
type LoadedDataset = { catalog: DatasetCatalog; recordsPath: string; recordsSize: number };
type IndexedFood = Pick<CatalogFood, 'fdcId' | 'description' | 'dataType'>;

function publicSource(source: z.infer<typeof sourceSchema>): FoodCompositionSource {
  const { recordsFile: _recordsFile, recordsSha256: _recordsSha256, ...publicMetadata } = source;
  return publicMetadata;
}

const dataDirectory = path.join(process.cwd(), '.data', 'food-composition');
const specifications = [
  { catalogFile: 'fdc-foundation-2026-04.catalog.json', recordsFile: 'fdc-foundation-2026-04.records.jsonl', id: 'fdc-foundation-2026-04', sourceSha256: '27d1fe3fd89edfbe528ed915da5619320e1d004d4594603a1b19bdb1511590cc', count: 363, dataType: 'Foundation' },
  { catalogFile: 'fdc-fndds-2021-2023.catalog.json', recordsFile: 'fdc-fndds-2021-2023.records.jsonl', id: 'fdc-fndds-2021-2023', sourceSha256: '2e7eb9fda92adf1d4d784dba5eaa3a7fd4418cd86ccff383c7c9294d79e9b808', count: 5432, dataType: 'Survey (FNDDS)' },
] as const;

let cachedDatasets: LoadedDataset[] | null = null;

async function sha256File(filePath: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function loadDataset(spec: typeof specifications[number]): Promise<LoadedDataset | null> {
  let bytes: Buffer;
  try { bytes = await readFile(path.join(dataDirectory, spec.catalogFile)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (bytes.byteLength > 8_000_000) throw new Error(`Food composition catalog exceeds size limit: ${spec.id}`);
  const parsed = catalogSchema.safeParse(JSON.parse(bytes.toString('utf8')) as unknown);
  if (!parsed.success) throw new Error(`Food composition catalog schema mismatch: ${spec.id}`);
  const catalog = parsed.data;
  const source = catalog.dataset;
  if (source.id !== spec.id || source.dataType !== spec.dataType || source.sourceSha256 !== spec.sourceSha256 || source.recordsFile !== spec.recordsFile || catalog.foods.length !== spec.count || catalog.statistics.indexedFoods !== spec.count) {
    throw new Error(`Food composition catalog metadata mismatch: ${spec.id}`);
  }
  const recordsPath = path.join(dataDirectory, spec.recordsFile);
  const recordsStat = await stat(recordsPath);
  let priorEnd = 0;
  const uniqueIds = new Set<number>();
  for (const item of catalog.foods) {
    if (item.dataType !== spec.dataType || uniqueIds.has(item.fdcId) || item.offset !== priorEnd || item.offset + item.byteLength >= recordsStat.size) throw new Error(`Food composition catalog entry mismatch: ${spec.id}`);
    uniqueIds.add(item.fdcId);
    priorEnd = item.offset + item.byteLength + 1;
  }
  if (priorEnd !== recordsStat.size || await sha256File(recordsPath) !== source.recordsSha256) throw new Error(`Food composition record file checksum mismatch: ${spec.id}`);
  return { catalog, recordsPath, recordsSize: recordsStat.size };
}

async function loadDatasets(): Promise<LoadedDataset[]> {
  if (cachedDatasets) return cachedDatasets;
  const loaded = (await Promise.all(specifications.map(loadDataset))).filter((item): item is LoadedDataset => item !== null);
  if (!loaded.length) return [];
  cachedDatasets = loaded;
  return loaded;
}

function normalizedTokens(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('en').match(/[\p{L}\p{N}]+/gu) ?? [];
}

function stem(value: string) {
  return value.endsWith('ies') && value.length > 4 ? `${value.slice(0, -3)}y` : value.endsWith('s') && value.length > 4 ? value.slice(0, -1) : value;
}

function matchesFoodWord(query: string, indexed: string) {
  if (query === indexed) return true;
  if (Math.abs(query.length - indexed.length) > 1 || Math.min(query.length, indexed.length) < 5) return false;
  let left = 0;
  let right = 0;
  let edits = 0;
  while (left < query.length && right < indexed.length) {
    if (query[left] === indexed[right]) { left += 1; right += 1; continue; }
    edits += 1;
    if (edits > 1) return false;
    if (query.length > indexed.length) left += 1;
    else if (query.length < indexed.length) right += 1;
    else { left += 1; right += 1; }
  }
  if (left < query.length || right < indexed.length) edits += 1;
  return edits <= 1;
}

const stopWords = new Set(['raw', 'food', 'foods', 'with', 'without', 'and', 'or', 'the', 'of', 'in', 'from', 'cooked', 'prepared', 'ready', 'to', 'eat', 'generic', 'usda']);

export function rankFoodCompositionFoods<T extends IndexedFood>(query: string, foods: T[], limit = 3) {
  const queryTokens = [...new Set(normalizedTokens(query).map(stem).filter(token => token.length > 1 && !stopWords.has(token)))];
  if (!queryTokens.length) return [];
  return foods.map(food => {
    const descriptionTokens = [...new Set(normalizedTokens(food.description).map(stem))];
    const matched = queryTokens.filter(token => descriptionTokens.some(candidate => matchesFoodWord(token, candidate)));
    const score = matched.length / queryTokens.length;
    return { food, score, allTermsMatched: score === 1 };
  }).filter(hit => hit.allTermsMatched)
    .sort((a, b) => b.score - a.score || a.food.description.length - b.food.description.length)
    .slice(0, Math.max(0, Math.min(limit, 8)))
    .map(({ food, score }) => ({ food, score }));
}

async function readFoodRecord(dataset: LoadedDataset, item: CatalogFood): Promise<FoodCompositionFood> {
  const handle = await open(dataset.recordsPath, 'r');
  try {
    const line = Buffer.alloc(item.byteLength);
    const { bytesRead } = await handle.read(line, 0, item.byteLength, item.offset);
    if (bytesRead !== item.byteLength) throw new Error('Food composition record was truncated.');
    const parsed = foodSchema.safeParse(JSON.parse(line.toString('utf8')) as unknown);
    if (!parsed.success || parsed.data.fdcId !== item.fdcId || parsed.data.description !== item.description || parsed.data.dataType !== item.dataType) throw new Error('Food composition record does not match its catalog entry.');
    return parsed.data;
  } finally { await handle.close(); }
}

export async function searchFoodComposition(query: string, limit = 3) {
  try {
    const datasets = await loadDatasets();
    if (!datasets.length) return { status: 'unavailable' as const, reason: 'not-imported' as const };
    const catalogFoods = datasets.flatMap(dataset => dataset.catalog.foods.map(food => ({ food, dataset })));
    const ranked = rankFoodCompositionFoods(query, catalogFoods.map(item => item.food), limit);
    const datasetByFood = new Map(catalogFoods.map(item => [`${item.food.dataType}:${item.food.fdcId}`, item.dataset]));
    const results = await Promise.all(ranked.map(async hit => {
      const dataset = datasetByFood.get(`${hit.food.dataType}:${hit.food.fdcId}`)!;
      return { food: await readFoodRecord(dataset, hit.food as CatalogFood), score: hit.score, source: publicSource(dataset.catalog.dataset) };
    }));
    return { status: results.length ? 'ok' as const : 'no_match' as const, results, sources: datasets.map(dataset => publicSource(dataset.catalog.dataset)) };
  } catch {
    return { status: 'unavailable' as const, reason: 'invalid-index' as const };
  }
}
