import { createWorker, PSM } from 'tesseract.js';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseLabel } from '../src/lib/parser';
import type { NutrientKey } from '../src/lib/contracts';

type ManifestRecord = { file: string; hash: string; manualAnnotation: { basis: { amount: number; unit: string } | null; nutrients: Array<{ key: NutrientKey; value: number; unit: string }> } };
const manifest = JSON.parse(await readFile('data/semantic-photo-manifest.json', 'utf8')) as { records: ManifestRecord[] };
const cases = [
  { id: 'saffola-panel', file: 'saffola-veggie-oats-nutrition-off-8901088068758.jpg', crop: { x: 3, y: 0, width: 93, height: 99 } },
  { id: 'bagrrys-panel', file: 'bagrrys-white-oats-nutrition-off-8902710100150.jpg', crop: { x: 2, y: 2, width: 74, height: 96 } },
] as const;
const modes: Array<{ name: string; psm: number }> = [
  { name: 'auto', psm: PSM.AUTO },
  { name: 'single-block', psm: PSM.SINGLE_BLOCK },
  { name: 'single-column', psm: PSM.SINGLE_COLUMN },
  { name: 'sparse-text', psm: PSM.SPARSE_TEXT },
];
const root = path.resolve('docs/evidence/private');
const tolerance = (value: number) => Math.max(0.015, Math.abs(value) * 0.005);
function canonical(key: NutrientKey, value: number, unit: string) {
  if (key === 'energy') return unit.toLowerCase() === 'kj' ? value / 4.184 : value;
  if (key === 'sodium') return unit.toLowerCase() === 'g' ? value * 1000 : value;
  return unit.toLowerCase() === 'mg' ? value / 1000 : value;
}
function score(parsed: ReturnType<typeof parseLabel>, record: ManifestRecord) {
  if (!record.manualAnnotation.basis) throw new Error(`No annotated basis: ${record.file}`);
  let correct = 0, incorrect = 0, omitted = 0, withheld = 0;
  for (const expected of record.manualAnnotation.nutrients) {
    const matches = parsed.nutrients.filter(item => item.key === expected.key);
    const compatible = matches.filter(item => item.basis?.amount === record.manualAnnotation.basis!.amount && item.basis.unit === record.manualAnnotation.basis!.unit);
    if (!compatible.length) { if (matches.length) withheld++; else omitted++; continue; }
    if (compatible.some(item => item.status === 'conflict')) { withheld++; continue; }
    if (compatible.some(item => Math.abs(canonical(expected.key, item.value, item.unit) - canonical(expected.key, expected.value, expected.unit)) <= tolerance(canonical(expected.key, expected.value, expected.unit)))) correct++;
    else incorrect++;
  }
  return { correct, incorrect, omitted, withheld };
}

const output: Array<Record<string, unknown>> = [];
for (const test of cases) {
  const record = manifest.records.find(item => item.file === test.file);
  if (!record || !record.manualAnnotation.basis) throw new Error(`Missing annotated photo: ${test.file}`);
  const original = await readFile(path.join(root, record.file));
  const hash = createHash('sha256').update(original).digest('hex');
  if (hash !== record.hash.toLowerCase()) throw new Error(`Photo hash mismatch: ${test.id}`);
  const metadata = await sharp(original).rotate().metadata();
  if (!metadata.width || !metadata.height) throw new Error(`Cannot read photo dimensions: ${test.id}`);
  const left = Math.round(metadata.width * test.crop.x / 100), top = Math.round(metadata.height * test.crop.y / 100);
  const width = Math.min(metadata.width - left, Math.round(metadata.width * test.crop.width / 100));
  const height = Math.min(metadata.height - top, Math.round(metadata.height * test.crop.height / 100));
  const panel = await sharp(original).rotate().extract({ left, top, width, height }).resize({ width: 3000, withoutEnlargement: true }).jpeg({ quality: 98 }).toBuffer();
  const worker = await createWorker('eng', 1, { langPath: path.resolve('public/ocr') });
  try {
    for (const mode of modes) {
      await worker.setParameters({ tessedit_pageseg_mode: mode.psm, preserve_interword_spaces: '1' });
      const started = performance.now();
      const recognized = await worker.recognize(panel, {}, { text: true, blocks: true });
      const parsed = parseLabel(recognized.data.text, { origin: 'ocr', confidence: recognized.data.confidence, side: 'back' });
      output.push({ photo: test.id, sha256: hash, mode: mode.name, ...score(parsed, record), parsedRows: parsed.nutrients.length, confidence: Number(recognized.data.confidence.toFixed(2)), elapsedMs: Math.round(performance.now() - started) });
    }
  } finally { await worker.terminate(); }
}
const receipt = {
  schemaVersion: 1,
  kind: 'tesseract-segmentation-mode-diagnostic',
  generatedAt: new Date().toISOString(),
  browser: 'Local Node Tesseract.js 7 diagnostic; not an end-user browser acceptance run.',
  inputs: cases.map(test => ({ id: test.id, file: test.file, basis: manifest.records.find(item => item.file === test.file)?.manualAnnotation.basis, expectedFields: manifest.records.find(item => item.file === test.file)?.manualAnnotation.nutrients.length })),
  method: 'Hash-verified public package photos, human-selected nutrition-panel crops, four Tesseract page segmentation modes, same production parser; only aggregate field outcomes persisted.',
  outcomes: output,
  limits: ['Two images and human-selected crops are not representative.', 'No OCR text or image bytes are persisted.', 'A better result here still requires repeatable real Chrome acceptance before changing the shipped reader.'],
};
await writeFile('docs/evidence/ocr-segmentation-modes.json', `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output: 'docs/evidence/ocr-segmentation-modes.json', outcomes: output.map(({ photo, mode, correct, incorrect, omitted, withheld, elapsedMs }) => ({ photo, mode, correct, incorrect, omitted, withheld, elapsedMs })) }, null, 2));
