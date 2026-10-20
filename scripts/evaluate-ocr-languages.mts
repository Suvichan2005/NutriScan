import { createWorker, PSM } from 'tesseract.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseLabel } from '../src/lib/parser';
import type { NutrientKey } from '../src/lib/contracts';

type Expected = { key: NutrientKey; value: number; unit: string };
type Probe = { file: string; language: 'fra' | 'spa'; basis: number; unit: 'g' | 'ml'; expected: Expected[] };
const probes: Probe[] = [
  { file: 'nutella-nutrition-nl-off-3017620422003.jpg', language: 'fra', basis: 100, unit: 'g', expected: [
    { key: 'energy', value: 539, unit: 'kcal' }, { key: 'carbohydrate', value: 57.5, unit: 'g' }, { key: 'sugars', value: 56.3, unit: 'g' }, { key: 'fat', value: 30.9, unit: 'g' }, { key: 'saturatedFat', value: 10.6, unit: 'g' }, { key: 'protein', value: 6.3, unit: 'g' }, { key: 'salt', value: 0.107, unit: 'g' },
  ] },
  { file: 'nutella-nutrition-es-off-3017620422003.jpg', language: 'spa', basis: 18, unit: 'g', expected: [
    { key: 'energy', value: 100, unit: 'kcal' }, { key: 'protein', value: 1, unit: 'g' }, { key: 'fat', value: 6, unit: 'g' }, { key: 'saturatedFat', value: 2, unit: 'g' }, { key: 'carbohydrate', value: 10, unit: 'g' }, { key: 'sugars', value: 10, unit: 'g' }, { key: 'sodium', value: 10, unit: 'mg' },
  ] },
];
const manifest = JSON.parse(await fs.readFile('data/semantic-photo-manifest.json', 'utf8')) as { records: { file: string; hash: string }[] };
const languageDir = path.resolve('docs/evidence/private/ocr-languages');
await fs.mkdir(languageDir, { recursive: true });
await fs.copyFile('public/ocr/eng.traineddata.gz', path.join(languageDir, 'eng.traineddata.gz'));
for (const language of ['fra', 'spa'] as const) {
  const source = path.join('node_modules', '@tesseract.js-data', language, '4.0.0_best_int', `${language}.traineddata.gz`);
  try { await fs.copyFile(source, path.join(languageDir, `${language}.traineddata.gz`)); }
  catch { throw new Error(`Install the optional OCR data first: npm install --no-save --package-lock=false --ignore-scripts '@tesseract.js-data/fra@1.0.0' '@tesseract.js-data/spa@1.0.0'`); }
}
function normalized(key: NutrientKey, value: number, unit: string) {
  if (key === 'energy') return unit === 'kJ' ? value / 4.184 : value;
  if (key === 'sodium') return unit === 'g' ? value * 1000 : value;
  return unit === 'mg' ? value / 1000 : value;
}
const rows: Record<string, unknown>[] = [];
for (const probe of probes) {
  const source = manifest.records.find(record => record.file === probe.file);
  if (!source) throw new Error(`Missing photo manifest entry: ${probe.file}`);
  const imagePath = path.join('docs/evidence/private', probe.file);
  const bytes = await fs.readFile(imagePath);
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  if (hash !== source.hash) throw new Error(`Source hash mismatch: ${probe.file}`);
  for (const language of [probe.language, `eng+${probe.language}`]) {
    for (const [mode, pageSegmentationMode] of [['auto', PSM.AUTO], ['single-block', PSM.SINGLE_BLOCK]] as const) {
      const worker = await createWorker(language, 1, { langPath: languageDir });
      try {
        await worker.setParameters({ tessedit_pageseg_mode: pageSegmentationMode, preserve_interword_spaces: '1' });
        const result = await worker.recognize(bytes);
        const parsed = parseLabel(result.data.text, { origin: 'ocr', confidence: result.data.confidence, side: 'extra' });
        const fields = probe.expected.map(expected => {
          const candidates = parsed.nutrients.filter(nutrient => nutrient.key === expected.key && nutrient.basis?.amount === probe.basis && nutrient.basis.unit === probe.unit);
          const resultType = candidates.some(nutrient => nutrient.status === 'conflict') ? 'withheld'
            : candidates.length === 0 ? (parsed.nutrients.some(nutrient => nutrient.key === expected.key) ? 'withheld' : 'omitted')
              : candidates.some(nutrient => Math.abs(normalized(expected.key, nutrient.value, nutrient.unit) - normalized(expected.key, expected.value, expected.unit)) <= Math.max(0.015, Math.abs(normalized(expected.key, expected.value, expected.unit)) * 0.005)) ? 'correct' : 'incorrect';
          return { key: expected.key, expected: expected.value, unit: expected.unit, result: resultType };
        });
        rows.push({ file: probe.file, language, mode, confidence: Number(result.data.confidence.toFixed(2)), characters: result.data.text.length, numericTokens: (result.data.text.match(/\d+(?:[.,]\d+)?/g) ?? []).length, basisSignal: /\bper\s*:?\s*\d+\s*g\b/i.test(result.data.text), parsedNutrientRows: parsed.nutrients.length, correct: fields.filter(field => field.result === 'correct').length, incorrect: fields.filter(field => field.result === 'incorrect').length, omitted: fields.filter(field => field.result === 'omitted').length, withheld: fields.filter(field => field.result === 'withheld').length, fields });
      } finally { await worker.terminate(); }
    }
  }
}
const output = { schemaVersion: 1, kind: 'optional-node-language-model-probe', generatedAt: new Date().toISOString(), photos: probes.length, annotatedFields: probes.reduce((sum, probe) => sum + probe.expected.length, 0), languageDataPackageVersion: '1.0.0', trainedData: '4.0.0_best_int', source: 'Hash-verified public photos in the Open Food Facts manifest; local bytes are ignored by Git.', runs: rows, limitations: ['Node diagnostic only; not a browser test.', 'Two selected labels, visually annotated and not independently blinded.', 'Language-specific and English-plus-language passes use source bytes without crop or photo correction.', 'Only annotated nutrient values at their explicit basis are scored; OCR text quality and ingredients are outside scope.', 'An exact match does not verify product variant, current formulation or label truth.'] };
await fs.writeFile('docs/evidence/real-ocr-language-probe.json', JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ output: 'docs/evidence/real-ocr-language-probe.json', photos: output.photos, annotatedFields: output.annotatedFields, runs: rows.map(({ file, language, mode, correct, incorrect, omitted, withheld, parsedNutrientRows }) => ({ file, language, mode, correct, incorrect, omitted, withheld, parsedNutrientRows })) }, null, 2));
