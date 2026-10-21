import { createWorker, PSM } from 'tesseract.js';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseLabel } from '../src/lib/parser';
import type { NutrientKey } from '../src/lib/contracts';

type Expected = { key: NutrientKey; value: number; unit: string };
type PhotoRecord = {
  file: string;
  hash: string;
  manualAnnotation?: { basis: { amount: number; unit: 'g'|'ml' }|null; nutrients: Expected[] };
};
type CropPercent = { left: number; top: number; width: number; height: number };
const targets = [
  {
    file: 'saffola-veggie-oats-nutrition-off-8901088068758.jpg',
    crops: [{ name: 'panel-interior', percent: { left: 3, top: 0, width: 93, height: 99 } }],
  },
  {
    file: 'bagrrys-white-oats-nutrition-off-8902710100150.jpg',
    crops: [{ name: 'first-nutrition-column', percent: { left: 2, top: 2, width: 74, height: 96 } }],
  },
] as const;
const manifest = JSON.parse(await fs.readFile('data/semantic-photo-manifest.json', 'utf8')) as { records: PhotoRecord[] };
const photos = targets.map(target => {
  const photo = manifest.records.find(record => record.file === target.file);
  if (!photo?.manualAnnotation?.basis || !photo.manualAnnotation.nutrients.length) throw new Error(`Missing annotated photo in manifest: ${target.file}`);
  return { ...target, photo };
});
const worker = await createWorker('eng', 1, { langPath: path.resolve('public/ocr') });

function normalize(key: NutrientKey, value: number, unit: string) {
  if (key === 'energy') return unit === 'kJ' ? value / 4.184 : value;
  if (key === 'sodium') return unit === 'g' ? value * 1000 : value;
  return unit === 'mg' ? value / 1000 : value;
}

async function prepare(source: Buffer, crop?: CropPercent) {
  const oriented = await sharp(source).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = oriented.info;
  const extract = crop ? {
    left: Math.max(0, Math.round(width * crop.left / 100)),
    top: Math.max(0, Math.round(height * crop.top / 100)),
    width: Math.min(width, Math.round(width * crop.width / 100)),
    height: Math.min(height, Math.round(height * crop.height / 100)),
  } : undefined;
  const left = extract?.left ?? 0, top = extract?.top ?? 0;
  const safeExtract = extract ? { ...extract, width: Math.min(extract.width, width - left), height: Math.min(extract.height, height - top) } : undefined;
  const pipeline = safeExtract ? sharp(oriented.data, { raw: oriented.info }).extract(safeExtract) : sharp(source).rotate();
  return pipeline.resize({ width: 3000, height: 3000, fit: 'inside', withoutEnlargement: false }).jpeg({ quality: 98 }).toBuffer();
}

async function score(bytes: Buffer, expected: Expected[], basis: { amount: number; unit: 'g'|'ml' }) {
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: '1' });
  const result = await worker.recognize(bytes);
  const packageData = parseLabel(result.data.text, { origin: 'ocr', confidence: result.data.confidence, side: 'extra' });
  const fields = expected.map(field => {
    const atBasis = packageData.nutrients.filter(nutrient => nutrient.key === field.key && nutrient.basis?.amount === basis.amount && nutrient.basis.unit === basis.unit);
    const outcome = atBasis.some(nutrient => nutrient.status === 'conflict') ? 'withheld'
      : atBasis.length === 0 ? (packageData.nutrients.some(nutrient => nutrient.key === field.key) ? 'withheld' : 'omitted')
        : atBasis.some(nutrient => Math.abs(normalize(field.key, nutrient.value, nutrient.unit) - normalize(field.key, field.value, field.unit)) <= Math.max(0.015, Math.abs(normalize(field.key, field.value, field.unit)) * 0.005)) ? 'correct' : 'incorrect';
    return { key: field.key, result: outcome };
  });
  return {
    confidence: Number(result.data.confidence.toFixed(2)),
    parsedNutrientRows: packageData.nutrients.length,
    correct: fields.filter(field => field.result === 'correct').length,
    incorrect: fields.filter(field => field.result === 'incorrect').length,
    omitted: fields.filter(field => field.result === 'omitted').length,
    withheld: fields.filter(field => field.result === 'withheld').length,
    fields,
  };
}

const runs: Record<string, unknown>[] = [];
try {
  for (const { file, photo, crops } of photos) {
    const source = await fs.readFile(path.join('docs/evidence/private', file));
    if (crypto.createHash('sha256').update(source).digest('hex') !== photo.hash) throw new Error(`Source photo hash mismatch: ${file}`);
    const annotation = photo.manualAnnotation!;
    runs.push({ file, mode: 'full-frame', ...(await score(await prepare(source), annotation.nutrients, annotation.basis!)) });
    for (const crop of crops) {
      runs.push({ file, mode: crop.name, cropPercent: crop.percent, ...(await score(await prepare(source, crop.percent), annotation.nutrients, annotation.basis!)) });
    }
  }
} finally { await worker.terminate(); }

const output = {
  schemaVersion: 1,
  kind: 'real-photo-guided-crop-probe',
  generatedAt: new Date().toISOString(),
  method: 'Hash-verified source images, English Tesseract.js, PSM_SINGLE_BLOCK, JPEG quality 98, 3000 px fit-inside proxy; one documented crop variant per image.',
  runs,
  limitations: [
    'Two selected public Open Food Facts images; not a representative or held-out benchmark.',
    'Node diagnostic only; does not exercise browser Canvas, app role hints, browser OCR workers, or rendered user flow.',
    'Human annotations are compared only at their explicitly annotated basis; no raw OCR text or source image bytes are written.',
    'A crop can remove serving, unit, or product-identity context; this probe does not justify automatic cropping or a default OCR policy change.',
  ],
};
await fs.writeFile('docs/evidence/real-ocr-guided-crop-probe.json', JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({
  output: 'docs/evidence/real-ocr-guided-crop-probe.json',
  runs: runs.map(({ file, mode, correct, incorrect, omitted, withheld }) => ({ file, mode, correct, incorrect, omitted, withheld })),
}, null, 2));
