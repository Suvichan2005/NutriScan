import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const releaseDate = '2026-04-30';
const sourceSha256 = '27d1fe3fd89edfbe528ed915da5619320e1d004d4594603a1b19bdb1511590cc';
const sourceArchiveSha256 = '186e988ec542e913f51ef62b86a47758e8cdd0d1dc3889e7b055581f3c09c77a';
const sourceFile = 'FoodData_Central_foundation_food_json_2026-04-30.json';
const defaultInput = path.join(process.cwd(), '.data', 'fdc-foundation-source-2026-04', sourceFile);
const catalogFile = path.join(process.cwd(), '.data', 'food-composition', 'fdc-foundation-2026-04.catalog.json');
const recordsFile = path.join(process.cwd(), '.data', 'food-composition', 'fdc-foundation-2026-04.records.jsonl');
const inputFile = process.argv[2] ? path.resolve(process.argv[2]) : defaultInput;

const bytes = await readFile(inputFile);
const rawSha256 = createHash('sha256').update(bytes).digest('hex');
if (rawSha256 !== sourceSha256) throw new Error(`Refusing unpinned FoodData Central source file (SHA-256 ${rawSha256}).`);
const parsed = JSON.parse(bytes.toString('utf8')) as { FoundationFoods?: unknown };
if (!Array.isArray(parsed.FoundationFoods) || parsed.FoundationFoods.length !== 395) throw new Error('Expected the pinned April 2026 Foundation Foods source with 395 source slots.');

type Nutrient = { nutrientId: number; nutrientNumber: string | null; name: string; unit: string; amount: number; dataPoints: number | null; min: number | null; max: number | null; median: number | null; loq: number | null; derivation: string | null };
type Portion = { description: string; gramWeight: number; amount: number; measure: string };
type Food = { fdcId: number; description: string; category: string | null; publicationDate: string; dataType: 'Foundation'; nutrients: Nutrient[]; portions: Portion[] };
const foods: Food[] = [];
const excludedFoodRecords: number[] = [];
const excludedNutrientRecords: { fdcId: number; nutrientId: number | null; name: string | null; reason: string }[] = [];
let excludedPortions = 0;
const fdcIds = new Set<number>();

for (const [sourceIndex, rawFood] of (parsed.FoundationFoods as unknown[]).entries()) {
  if (rawFood === null) { excludedFoodRecords.push(sourceIndex); continue; }
  if (typeof rawFood !== 'object' || Array.isArray(rawFood)) throw new Error(`Malformed food record at source index ${sourceIndex}.`);
  const food = rawFood as Record<string, unknown>;
  if (!Number.isInteger(food.fdcId) || typeof food.description !== 'string' || !food.description.trim() || typeof food.publicationDate !== 'string' || food.dataType !== 'Foundation' || !Array.isArray(food.foodNutrients)) throw new Error(`Malformed Foundation food at source index ${sourceIndex}.`);
  const fdcId = food.fdcId as number;
  if (fdcIds.has(fdcId)) throw new Error(`Duplicate FoodData Central food identifier ${fdcId}.`);
  fdcIds.add(fdcId);
  const nutrients: Nutrient[] = [];
  for (const rawNutrient of food.foodNutrients) {
    if (typeof rawNutrient !== 'object' || rawNutrient === null || Array.isArray(rawNutrient)) throw new Error(`Malformed nutrient entry in FoodData Central food ${fdcId}.`);
    const entry = rawNutrient as Record<string, unknown>;
    const nutrient = entry.nutrient as Record<string, unknown> | null | undefined;
    if (!nutrient || !Number.isInteger(nutrient.id) || typeof nutrient.name !== 'string' || typeof nutrient.unitName !== 'string') throw new Error(`Malformed nutrient identity in FoodData Central food ${fdcId}.`);
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
  const portions: Portion[] = [];
  if (!Array.isArray(food.foodPortions ?? [])) throw new Error(`Malformed portion list in FoodData Central food ${fdcId}.`);
  for (const rawPortion of (food.foodPortions ?? []) as unknown[]) {
    if (!rawPortion || typeof rawPortion !== 'object' || Array.isArray(rawPortion)) { excludedPortions += 1; continue; }
    const portion = rawPortion as Record<string, unknown>;
    const gramWeight = portion.gramWeight;
    if (typeof gramWeight !== 'number' || !Number.isFinite(gramWeight) || gramWeight <= 0) { excludedPortions += 1; continue; }
    const measureUnit = portion.measureUnit as Record<string, unknown> | null | undefined;
    const measure = typeof measureUnit?.name === 'string' ? measureUnit.name : 'portion';
    portions.push({
      description: [portion.amount, measure, portion.modifier].filter(value => value !== null && value !== undefined && value !== '').join(' ').slice(0, 180),
      gramWeight,
      amount: typeof portion.amount === 'number' && Number.isFinite(portion.amount) && portion.amount > 0 ? portion.amount : 1,
      measure,
    });
  }
  const category = food.foodCategory as Record<string, unknown> | null | undefined;
  foods.push({ fdcId, description: food.description.trim(), category: typeof category?.description === 'string' ? category.description : null, publicationDate: food.publicationDate, dataType: 'Foundation', nutrients, portions });
}

if (foods.length !== 363 || excludedFoodRecords.length !== 32 || excludedNutrientRecords.length !== 37) throw new Error(`Pinned source counts changed: indexed=${foods.length}, nullFoods=${excludedFoodRecords.length}, excludedNutrients=${excludedNutrientRecords.length}.`);
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
    id: 'fdc-foundation-2026-04',
    name: 'USDA FoodData Central Foundation Foods',
    dataType: 'Foundation',
    releaseDate,
    sourceFile,
    sourceSha256: rawSha256,
    sourceArchiveSha256,
    sourceUrl: 'https://fdc.nal.usda.gov/download-datasets/',
    documentationUrl: 'https://fdc.nal.usda.gov/Foundation_Foods_Documentation/',
    license: 'CC0 1.0 Universal; USDA requests FoodData Central attribution',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    attribution: 'USDA FoodData Central',
    recordsFile: path.basename(recordsFile),
    recordsSha256: createHash('sha256').update(recordBytes).digest('hex'),
  },
  statistics: {
    sourceFoodSlots: 395,
    indexedFoods: foods.length,
    excludedNullFoodSlots: excludedFoodRecords,
    excludedNutrientRows: excludedNutrientRecords,
    excludedPortionRows: excludedPortions,
    nutrientRowsIndexed: foods.reduce((total, food) => total + food.nutrients.length, 0),
    foodsWithPortions: foods.filter(food => food.portions.length > 0).length,
  },
  foods: catalogFoods,
};
await mkdir(path.dirname(catalogFile), { recursive: true });
await writeFile(recordsFile, recordBytes);
await writeFile(catalogFile, `${JSON.stringify(snapshot)}\n`, 'utf8');
console.log(JSON.stringify({ catalogFile, recordsFile, releaseDate, sourceSha256: rawSha256, recordsSha256: snapshot.dataset.recordsSha256, sourceFoodSlots: 395, indexedFoods: foods.length, excludedNullFoodSlots: excludedFoodRecords.length, excludedNutrientRows: excludedNutrientRecords.length, nutrientRowsIndexed: snapshot.statistics.nutrientRowsIndexed, foodsWithPortions: snapshot.statistics.foodsWithPortions }));
