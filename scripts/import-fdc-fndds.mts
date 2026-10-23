import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const sourceFile = 'surveyDownload.json';
const sourceSha256 = '2e7eb9fda92adf1d4d784dba5eaa3a7fd4418cd86ccff383c7c9294d79e9b808';
const sourceArchiveSha256 = 'dfb06ae7ddc397ccd570b91c14b75438ab2ba39f64f22d321f61d4a52a77f3eb';
const defaultInput = path.join(process.cwd(), '.data', 'fdc-fndds-source-2024-10', sourceFile);
const catalogFile = path.join(process.cwd(), '.data', 'food-composition', 'fdc-fndds-2021-2023.catalog.json');
const recordsFile = path.join(process.cwd(), '.data', 'food-composition', 'fdc-fndds-2021-2023.records.jsonl');
const inputFile = process.argv[2] ? path.resolve(process.argv[2]) : defaultInput;

const bytes = await readFile(inputFile);
const rawSha256 = createHash('sha256').update(bytes).digest('hex');
if (rawSha256 !== sourceSha256) throw new Error(`Refusing unpinned FoodData Central source file (SHA-256 ${rawSha256}).`);
const parsed = JSON.parse(bytes.toString('utf8')) as { SurveyFoods?: unknown };
if (!Array.isArray(parsed.SurveyFoods) || parsed.SurveyFoods.length !== 5432) throw new Error('Expected the pinned FNDDS 2021-2023 source with 5,432 survey food records.');

type Nutrient = { nutrientId: number; nutrientNumber: string | null; name: string; unit: string; amount: number; dataPoints: number | null; min: number | null; max: number | null; median: number | null; loq: number | null; derivation: string | null };
type Portion = { description: string; gramWeight: number; amount: number; measure: string };
type Food = { fdcId: number; description: string; category: string | null; publicationDate: string; dataType: 'Survey (FNDDS)'; nutrients: Nutrient[]; portions: Portion[] };
const foods: Food[] = [];
const excludedFoodRecords: number[] = [];
const excludedNutrientRecords: { fdcId: number; nutrientId: number | null; name: string | null; reason: string }[] = [];
let excludedPortions = 0;
const fdcIds = new Set<number>();

for (const [sourceIndex, rawFood] of (parsed.SurveyFoods as unknown[]).entries()) {
  if (rawFood === null) { excludedFoodRecords.push(sourceIndex); continue; }
  if (typeof rawFood !== 'object' || Array.isArray(rawFood)) throw new Error(`Malformed FNDDS food record at source index ${sourceIndex}.`);
  const food = rawFood as Record<string, unknown>;
  if (!Number.isInteger(food.fdcId) || typeof food.description !== 'string' || !food.description.trim() || typeof food.publicationDate !== 'string' || food.dataType !== 'Survey (FNDDS)' || !Array.isArray(food.foodNutrients)) throw new Error(`Malformed FNDDS food at source index ${sourceIndex}.`);
  const fdcId = food.fdcId as number;
  if (fdcIds.has(fdcId)) throw new Error(`Duplicate FoodData Central survey identifier ${fdcId}.`);
  fdcIds.add(fdcId);
  const nutrients: Nutrient[] = [];
  for (const rawNutrient of food.foodNutrients) {
    if (typeof rawNutrient !== 'object' || rawNutrient === null || Array.isArray(rawNutrient)) throw new Error(`Malformed FNDDS nutrient entry for food ${fdcId}.`);
    const entry = rawNutrient as Record<string, unknown>;
    const nutrient = entry.nutrient as Record<string, unknown> | null | undefined;
    if (!nutrient || !Number.isInteger(nutrient.id) || typeof nutrient.name !== 'string' || typeof nutrient.unitName !== 'string') throw new Error(`Malformed FNDDS nutrient identity for food ${fdcId}.`);
    if (entry.amount === null || entry.amount === undefined) {
      excludedNutrientRecords.push({ fdcId, nutrientId: nutrient.id as number, name: nutrient.name, reason: 'source amount missing; preserved as unavailable, not zero' });
      continue;
    }
    if (typeof entry.amount !== 'number' || !Number.isFinite(entry.amount) || entry.amount < 0) {
      excludedNutrientRecords.push({ fdcId, nutrientId: nutrient.id as number, name: nutrient.name, reason: 'source amount is not a finite nonnegative number' });
      continue;
    }
    const optionalFinite = (key: string) => typeof entry[key] === 'number' && Number.isFinite(entry[key]) ? entry[key] as number : null;
    const derivation = entry.foodNutrientDerivation as Record<string, unknown> | null | undefined;
    nutrients.push({
      nutrientId: nutrient.id as number,
      nutrientNumber: typeof nutrient.number === 'string' ? nutrient.number : null,
      name: nutrient.name,
      unit: nutrient.unitName,
      amount: entry.amount,
      dataPoints: Number.isInteger(entry.dataPoints) && (entry.dataPoints as number) >= 0 ? entry.dataPoints as number : null,
      min: optionalFinite('min'), max: optionalFinite('max'), median: optionalFinite('median'), loq: optionalFinite('loq'),
      derivation: typeof derivation?.description === 'string' ? derivation.description : null,
    });
  }
  if (!Array.isArray(food.foodPortions ?? [])) throw new Error(`Malformed FNDDS portion list for food ${fdcId}.`);
  const portions: Portion[] = [];
  for (const rawPortion of (food.foodPortions ?? []) as unknown[]) {
    if (!rawPortion || typeof rawPortion !== 'object' || Array.isArray(rawPortion)) { excludedPortions += 1; continue; }
    const portion = rawPortion as Record<string, unknown>;
    const gramWeight = portion.gramWeight;
    if (typeof gramWeight !== 'number' || !Number.isFinite(gramWeight) || gramWeight <= 0) { excludedPortions += 1; continue; }
    const measureUnit = portion.measureUnit as Record<string, unknown> | null | undefined;
    const measure = typeof measureUnit?.name === 'string' ? measureUnit.name : 'portion';
    const description = typeof portion.portionDescription === 'string' ? portion.portionDescription : `${measure} portion`;
    portions.push({ description: description.slice(0, 180), gramWeight, amount: 1, measure });
  }
  foods.push({ fdcId, description: food.description.trim(), category: null, publicationDate: food.publicationDate, dataType: 'Survey (FNDDS)', nutrients, portions });
}

const indexedNutrientCount = foods.reduce((total, food) => total + food.nutrients.length, 0);
if (foods.length !== 5432 || excludedFoodRecords.length !== 0 || excludedNutrientRecords.length !== 0 || excludedPortions !== 1 || indexedNutrientCount !== 353015) throw new Error(`Pinned FNDDS source counts changed: foods=${foods.length}, nullFoods=${excludedFoodRecords.length}, excludedNutrients=${excludedNutrientRecords.length}, excludedPortions=${excludedPortions}, nutrients=${indexedNutrientCount}.`);
const lines = foods.map(food => JSON.stringify(food));
let recordOffset = 0;
const catalogFoods = foods.map((food, index) => {
  const byteLength = Buffer.byteLength(lines[index]);
  const entry = { fdcId: food.fdcId, description: food.description, category: food.category, publicationDate: food.publicationDate, dataType: food.dataType, offset: recordOffset, byteLength };
  recordOffset += byteLength + 1;
  return entry;
});
const recordBytes = Buffer.from(`${lines.join('\n')}\n`, 'utf8');
const snapshot = {
  schemaVersion: 1,
  dataset: {
    id: 'fdc-fndds-2021-2023',
    name: 'USDA FoodData Central Food and Nutrient Database for Dietary Studies 2021-2023',
    dataType: 'Survey (FNDDS)',
    releaseDate: '2024-10-31',
    sourceFile,
    sourceSha256: rawSha256,
    sourceArchiveSha256,
    sourceUrl: 'https://fdc.nal.usda.gov/download-datasets/',
    documentationUrl: 'https://www.ars.usda.gov/ARSUserFiles/80400530/pdf/fndds/2021_2023_FNDDS_Doc.pdf',
    license: 'CC0 1.0 Universal; USDA requests FoodData Central attribution',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    attribution: 'USDA FoodData Central; What We Eat in America / NHANES food records',
    recordsFile: path.basename(recordsFile),
    recordsSha256: createHash('sha256').update(recordBytes).digest('hex'),
  },
  statistics: {
    sourceFoodSlots: 5432,
    indexedFoods: foods.length,
    excludedNullFoodSlots: excludedFoodRecords,
    excludedNutrientRows: excludedNutrientRecords,
    excludedPortionRows: excludedPortions,
    nutrientRowsIndexed: indexedNutrientCount,
    foodsWithPortions: foods.filter(food => food.portions.length > 0).length,
  },
  foods: catalogFoods,
};
await mkdir(path.dirname(catalogFile), { recursive: true });
await writeFile(recordsFile, recordBytes);
await writeFile(catalogFile, `${JSON.stringify(snapshot)}\n`, 'utf8');
console.log(JSON.stringify({ catalogFile, recordsFile, releaseDate: snapshot.dataset.releaseDate, sourceSha256: rawSha256, recordsSha256: snapshot.dataset.recordsSha256, sourceFoodSlots: 5432, indexedFoods: foods.length, excludedPortions, nutrientRowsIndexed: indexedNutrientCount, foodsWithPortions: snapshot.statistics.foodsWithPortions }));
