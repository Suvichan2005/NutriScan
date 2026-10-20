import { createWorker, PSM } from 'tesseract.js';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseLabel } from '../src/lib/parser';
import type { NutrientKey } from '../src/lib/contracts';

const file = 'saffola-veggie-oats-nutrition-off-8901088068758.jpg';
const record = (JSON.parse(await fs.readFile('data/semantic-photo-manifest.json', 'utf8')) as { records: { file: string; hash: string }[] }).records.find(item => item.file === file);
if (!record) throw new Error(`Missing photo manifest entry: ${file}`);
const source = await fs.readFile(path.join('docs/evidence/private', file));
if (crypto.createHash('sha256').update(source).digest('hex') !== record.hash) throw new Error('Source photo hash does not match the manifest.');
const expected: { key: NutrientKey; value: number }[] = [
  { key: 'energy', value: 376 }, { key: 'protein', value: 8.8 }, { key: 'carbohydrate', value: 69.2 }, { key: 'sugars', value: 5.1 }, { key: 'addedSugars', value: 3.6 }, { key: 'fiber', value: 12.4 }, { key: 'fat', value: 9.9 }, { key: 'saturatedFat', value: 3.4 }, { key: 'sodium', value: 2283 },
];
const variants = new Map<string, Buffer>([
  ['native', source],
  ['wide-upscale-3000', await sharp(source).rotate().resize({ width: 3000, withoutEnlargement: false }).jpeg({ quality: 98 }).toBuffer()],
  ['gray-normalize-3000', await sharp(source).rotate().resize({ width: 3000 }).grayscale().normalize().sharpen().jpeg({ quality: 98 }).toBuffer()],
  ['green-channel-3000', await sharp(source).rotate().resize({ width: 3000 }).extractChannel('green').normalize().sharpen().jpeg({ quality: 98 }).toBuffer()],
  ['blue-channel-3000', await sharp(source).rotate().resize({ width: 3000 }).extractChannel('blue').normalize().sharpen().jpeg({ quality: 98 }).toBuffer()],
  ['green-threshold-145', await sharp(source).rotate().resize({ width: 3000 }).extractChannel('green').normalize().threshold(145).jpeg({ quality: 98 }).toBuffer()],
]);
const worker = await createWorker('eng', 1, { langPath: path.resolve('public/ocr') });
const runs: Record<string, unknown>[] = [];
function normalized(key: NutrientKey, value: number, unit: string) {
  if (key === 'energy') return unit === 'kJ' ? value / 4.184 : value;
  if (key === 'sodium') return unit === 'g' ? value * 1000 : value;
  return unit === 'mg' ? value / 1000 : value;
}
try {
  for (const [variant, bytes] of variants) {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: '1' });
    const result = await worker.recognize(bytes);
    const parsed = parseLabel(result.data.text, { origin: 'ocr', confidence: result.data.confidence, side: 'extra' });
    const fields = expected.map(field => {
      const candidates = parsed.nutrients.filter(nutrient => nutrient.key === field.key && nutrient.basis?.amount === 100 && nutrient.basis.unit === 'g');
      const outcome = candidates.some(nutrient => nutrient.status === 'conflict') ? 'withheld'
        : candidates.length === 0 ? (parsed.nutrients.some(nutrient => nutrient.key === field.key) ? 'withheld' : 'omitted')
          : candidates.some(nutrient => Math.abs(normalized(field.key, nutrient.value, nutrient.unit) - normalized(field.key, field.value, field.key === 'energy' ? 'kcal' : field.key === 'sodium' ? 'mg' : 'g')) <= Math.max(0.015, Math.abs(normalized(field.key, field.value, field.key === 'energy' ? 'kcal' : field.key === 'sodium' ? 'mg' : 'g')) * 0.005)) ? 'correct' : 'incorrect';
      return { key: field.key, expected: field.value, result: outcome };
    });
    runs.push({ variant, confidence: Number(result.data.confidence.toFixed(2)), characters: result.data.text.length, numericTokens: (result.data.text.match(/\d+(?:[.,]\d+)?/g) ?? []).length, basisSignal: /\bper\s*:?\s*100\s*g\b/i.test(result.data.text), parsedNutrientRows: parsed.nutrients.length, correct: fields.filter(field => field.result === 'correct').length, incorrect: fields.filter(field => field.result === 'incorrect').length, omitted: fields.filter(field => field.result === 'omitted').length, withheld: fields.filter(field => field.result === 'withheld').length, fields });
  }
} finally { await worker.terminate(); }
const output = { schemaVersion: 1, kind: 'single-photo-node-preprocessing-probe', generatedAt: new Date().toISOString(), photo: file, annotatedFields: expected.length, source: 'Hash-verified public Open Food Facts photo; source bytes remain ignored by Git.', modes: runs, limitations: ['One selected image; not representative or independently blinded.', 'Node Tesseract only, single-block segmentation; not browser end-to-end evidence.', 'Only annotated values at the explicit 100 g basis are scored.', 'No raw OCR text or photograph bytes are written to this result.'] };
await fs.writeFile('docs/evidence/real-ocr-preprocessing-probe.json', JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ output: 'docs/evidence/real-ocr-preprocessing-probe.json', runs: runs.map(({ variant, correct, incorrect, omitted, withheld, parsedNutrientRows }) => ({ variant, correct, incorrect, omitted, withheld, parsedNutrientRows })) }, null, 2));
