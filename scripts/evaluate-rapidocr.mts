import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createWorker, PSM } from 'tesseract.js';
import { parseLabel } from '../src/lib/parser';
import type { NutrientKey, PackageData } from '../src/lib/contracts';

type Expected = { key: NutrientKey; value: number; unit: string };
type Photo = {
  file: string; hash: string; code: string; type: string;
  manualAnnotation: { basis: { amount: number; unit: 'g' | 'ml' }; nutrients: Expected[] };
};
type OcrTextBox = { text: string; x: number; y: number; height: number };
type OcrResult = { lines: OcrTextBox[]; elapsedMs: number; boxes: number };
type Outcome = 'correct' | 'incorrect' | 'omitted' | 'withheld';
const modelType = process.env.NUTRISCAN_RAPIDOCR_MODEL_TYPE ?? 'small';
if (!['tiny', 'small'].includes(modelType)) throw new Error('NUTRISCAN_RAPIDOCR_MODEL_TYPE must be tiny or small.');
const guidedCrops = [
  { file: 'saffola-veggie-oats-nutrition-off-8901088068758.jpg', crop: { left: 3, top: 0, width: 93, height: 99 } },
  { file: 'bagrrys-white-oats-nutrition-off-8902710100150.jpg', crop: { left: 2, top: 2, width: 74, height: 96 } },
];

const manifest = JSON.parse(await readFile('data/semantic-photo-manifest.json', 'utf8')) as { records: Photo[] };
const photos = manifest.records.filter((record) => record.manualAnnotation?.basis && record.manualAnnotation.nutrients.length > 0);
const python = process.env.NUTRISCAN_RAPIDOCR_PYTHON
  ?? path.resolve('docs/evidence/private/rapidocr-venv/Scripts/python.exe');
const rapidocrProgram = String.raw`
import contextlib, io, json, sys, time
from rapidocr import ModelType, RapidOCR
quiet = io.StringIO()
with contextlib.redirect_stdout(quiet), contextlib.redirect_stderr(quiet):
    model_type = sys.argv[1]
    preset = ModelType(model_type)
    engine = RapidOCR(params={"Det.model_type": preset, "Rec.model_type": preset})
    rows = []
    for filename in sys.argv[2:]:
        started = time.perf_counter()
        result = engine(filename)
        texts = []
        boxes = result.boxes if result.boxes is not None else []
        texts_out = result.txts if result.txts is not None else []
        for box, text in zip(boxes, texts_out):
            value = str(text).strip()
            if not value:
                continue
            points = box.tolist()
            xs = [point[0] for point in points]
            ys = [point[1] for point in points]
            texts.append({"text": value, "x": min(xs), "y": sum(ys)/len(ys), "height": max(ys)-min(ys)})
        rows.append({"lines": texts, "elapsedMs": round((time.perf_counter()-started)*1000), "boxes": len(texts)})
print(json.dumps(rows, ensure_ascii=False))
`;

function runRapidOcr(files: string[]): Promise<OcrResult[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-c', rapidocrProgram, modelType, ...files], { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) return reject(new Error(`RapidOCR process failed (${code}): ${Buffer.concat(stderr).toString('utf8').slice(-1800)}`));
      try { resolve(JSON.parse(Buffer.concat(stdout).toString('utf8')) as OcrResult[]); }
      catch { reject(new Error('RapidOCR did not return the expected JSON result.')); }
    });
  });
}

function normalized(key: NutrientKey, value: number, unit: string) {
  if (key === 'energy') return unit === 'kJ' ? value / 4.184 : value;
  if (key === 'sodium') return unit === 'g' ? value * 1000 : value;
  return unit === 'mg' ? value / 1000 : value;
}

function rapidOcrLines(boxes: OcrTextBox[]) {
  const groups: Array<{ y: number; height: number; fragments: OcrTextBox[] }> = [];
  for (const box of [...boxes].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const group = groups.find((candidate) => Math.abs(candidate.y - box.y) <= Math.max(8, Math.min(candidate.height, box.height) * .55));
    if (group) {
      group.fragments.push(box);
      group.y = group.fragments.reduce((sum, fragment) => sum + fragment.y, 0) / group.fragments.length;
      group.height = group.fragments.reduce((largest, fragment) => Math.max(largest, fragment.height), 0);
    } else groups.push({ y: box.y, height: box.height, fragments: [box] });
  }
  return groups.sort((a, b) => a.y - b.y).map((group) => group.fragments.sort((a, b) => a.x - b.x).map((fragment) => fragment.text).join(' ')).join('\n');
}

function score(pkg: PackageData, photo: Photo): Record<Outcome, number> {
  const counts: Record<Outcome, number> = { correct: 0, incorrect: 0, omitted: 0, withheld: 0 };
  for (const expected of photo.manualAnnotation.nutrients) {
    const rows = pkg.nutrients.filter((nutrient) => nutrient.key === expected.key
      && nutrient.basis?.amount === photo.manualAnnotation.basis.amount
      && nutrient.basis?.unit === photo.manualAnnotation.basis.unit);
    const usable = rows.filter((nutrient) => nutrient.status !== 'conflict');
    if (rows.some((nutrient) => nutrient.status === 'conflict')) counts.withheld++;
    else if (!usable.length) counts[pkg.nutrients.some((nutrient) => nutrient.key === expected.key) ? 'withheld' : 'omitted']++;
    else {
      const target = normalized(expected.key, expected.value, expected.unit);
      const correct = usable.some((nutrient) => Math.abs(normalized(expected.key, nutrient.value, nutrient.unit) - target)
        <= Math.max(.015, Math.abs(target) * .005));
      counts[correct ? 'correct' : 'incorrect']++;
    }
  }
  return counts;
}

function summarize(photosWithText: Array<{ photo: Photo; text: string; elapsedMs: number; boxes?: number }>) {
  const totals: Record<Outcome, number> = { correct: 0, incorrect: 0, omitted: 0, withheld: 0 };
  const rows = photosWithText.map(({ photo, text, elapsedMs, boxes }) => {
    const pkg = parseLabel(text, { origin: 'ocr', side: 'extra' });
    const counts = score(pkg, photo);
    for (const key of Object.keys(totals) as Outcome[]) totals[key] += counts[key];
    return {
      code: photo.code,
      file: photo.file,
      language: photo.type.match(/English|French|Spanish/i)?.[0] ?? 'unspecified',
      fields: photo.manualAnnotation.nutrients.length,
      ...counts,
      parsedNutrients: pkg.nutrients.length,
      explicitBasisNutrients: pkg.nutrients.filter((nutrient) => nutrient.basis).length,
      unconflictedBasisNutrients: pkg.nutrients.filter((nutrient) => nutrient.basis && nutrient.status !== 'conflict').length,
      ingredientLines: pkg.ingredients.length,
      textCharacters: text.length,
      ...(boxes === undefined ? {} : { textBoxes: boxes }),
      elapsedMs,
    };
  });
  return { ...totals, expectedFields: Object.values(totals).reduce((sum, count) => sum + count, 0), fieldAccuracy: totals.correct / Math.max(1, Object.values(totals).reduce((sum, count) => sum + count, 0)), photos: rows };
}

const sourceFiles: string[] = [];
for (const photo of photos) {
  const file = path.resolve('docs/evidence/private', photo.file);
  const bytes = await readFile(file);
  if (createHash('sha256').update(bytes).digest('hex') !== photo.hash.toLowerCase()) throw new Error(`Hash mismatch for ${photo.file}`);
  sourceFiles.push(file);
}

const cropDir = await mkdtemp(path.join(os.tmpdir(), 'nutriscan-rapidocr-'));
const cropPhotos: Photo[] = [];
const cropFiles: string[] = [];
for (const target of guidedCrops) {
  const photo = photos.find((candidate) => candidate.file === target.file);
  if (!photo) throw new Error(`Missing guided-crop photo ${target.file}`);
  const metadata = await sharp(path.resolve('docs/evidence/private', target.file)).rotate().metadata();
  if (!metadata.width || !metadata.height) throw new Error(`Missing source dimensions for ${target.file}`);
  const left = Math.round(metadata.width * target.crop.left / 100);
  const top = Math.round(metadata.height * target.crop.top / 100);
  const width = Math.min(Math.round(metadata.width * target.crop.width / 100), metadata.width - left);
  const height = Math.min(Math.round(metadata.height * target.crop.height / 100), metadata.height - top);
  const cropFile = path.join(cropDir, `${photo.code}.jpg`);
  const crop = await sharp(path.resolve('docs/evidence/private', target.file)).rotate().extract({ left, top, width, height })
    .resize({ width: 3000, height: 3000, fit: 'inside', withoutEnlargement: false }).jpeg({ quality: 98 }).toBuffer();
  await writeFile(cropFile, crop);
  cropPhotos.push(photo);
  cropFiles.push(cropFile);
}

const rapidStarted = Date.now();
const rapidResults = await runRapidOcr([...sourceFiles, ...cropFiles]);
const rapidSetupAndRunMs = Date.now() - rapidStarted;
await rm(cropDir, { recursive: true, force: true });
if (rapidResults.length !== photos.length + cropPhotos.length || rapidResults.some((result) => !result.lines.length)) throw new Error('RapidOCR returned incomplete text results.');

const worker = await createWorker('eng', 1, { langPath: path.resolve('public/ocr') });
const tessResults: OcrResult[] = [];
const tessPreparedResults: OcrResult[] = [];
try {
  for (const photo of photos) {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: '1' });
    const started = Date.now();
    const bytes = await readFile(path.resolve('docs/evidence/private', photo.file));
    const result = await worker.recognize(bytes);
    tessResults.push({ text: result.data.text, elapsedMs: Date.now() - started, boxes: result.data.words?.length ?? 0 });
    const preparedStarted = Date.now();
    const prepared = await sharp(bytes).rotate().resize({ width: 3000, height: 3000, fit: 'inside', withoutEnlargement: false }).jpeg({ quality: 98 }).toBuffer();
    const preparedResult = await worker.recognize(prepared);
    tessPreparedResults.push({ text: preparedResult.data.text, elapsedMs: Date.now() - preparedStarted, boxes: preparedResult.data.words?.length ?? 0 });
  }
} finally { await worker.terminate(); }

const output = {
  schemaVersion: 1,
  kind: 'same-photo-alternative-ocr-engine-evaluation',
  rapidOcrModelType: modelType,
  generatedAt: new Date().toISOString(),
  source: 'Hash-verified Open Food Facts package-photo manifest; photographs and OCR text are not written to this receipt.',
  methods: {
    tesseractJs: 'Tesseract.js 7 English best_int, PSM.SINGLE_BLOCK, source image bytes; parsed through the production label parser.',
    tesseractJsBrowserPrepared: 'Tesseract.js 7 English best_int, PSM.SINGLE_BLOCK, EXIF-rotated and resized to 3,000 px maximum edge, JPEG quality 98; matches the Node proxy used for browser-path preparation evaluation.',
    rapidOcr: `RapidOCR 3.10.0, PP-OCRv6 ${modelType} ONNX Runtime CPU detector/recognizer; detected boxes are grouped by vertical position and x-ordered into rows before parsing through the production label parser.`,
    rapidOcrGuidedCrops: 'The same RapidOCR path on two preselected nutrition-panel crops also used in the Tesseract guided-crop probe: Saffola 3/0/93/99 percent and Bagrry’s 2/2/74/96 percent. EXIF-rotated, resized to 3,000 px maximum edge and JPEG 98.',
  },
  photos: photos.length,
  annotatedFields: photos.reduce((sum, photo) => sum + photo.manualAnnotation.nutrients.length, 0),
  rapidOcrSetupAndRunMs: rapidSetupAndRunMs,
  results: {
    tesseractJs: summarize(photos.map((photo, index) => ({ photo, ...tessResults[index] }))),
    tesseractJsBrowserPrepared: summarize(photos.map((photo, index) => ({ photo, ...tessPreparedResults[index] }))),
    rapidOcr: summarize(photos.map((photo, index) => ({ photo, text: rapidOcrLines(rapidResults[index].lines), elapsedMs: rapidResults[index].elapsedMs, boxes: rapidResults[index].boxes }))),
    rapidOcrGuidedCrops: summarize(cropPhotos.map((photo, index) => ({ photo, text: rapidOcrLines(rapidResults[photos.length + index].lines), elapsedMs: rapidResults[photos.length + index].elapsedMs, boxes: rapidResults[photos.length + index].boxes }))),
  },
  limitations: [
    'Five selected public package photographs and human annotations plus two guided crops; not a held-out or population accuracy estimate.',
    'Only annotated nutrient fields at the declared basis are scored. Text-character accuracy and table-reading order are not ground-truthed.',
    'RapidOCR text boxes are grouped with a simple vertical-center tolerance; dense or multicolumn table structure and per-value column alignment are not ground-truthed.',
    'Both OCR readings are observations. A correct match does not verify package identity, label truth, formulation or clinical relevance.',
    'RapidOCR ran as a local Python CPU diagnostic, not inside Chrome and not as part of the shipped product.',
  ],
};
const outputPath = modelType === 'small' ? 'docs/evidence/rapidocr-evaluation.json' : `docs/evidence/rapidocr-${modelType}-evaluation.json`;
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({
  output: outputPath,
  photos: output.photos,
  annotatedFields: output.annotatedFields,
  rapidOcrSetupAndRunMs: rapidSetupAndRunMs,
  results: Object.fromEntries(Object.entries(output.results).map(([name, result]) => [name, {
    correct: result.correct, incorrect: result.incorrect, omitted: result.omitted, withheld: result.withheld,
    fieldAccuracy: Number(result.fieldAccuracy.toFixed(4)),
    meanImageMs: Math.round(result.photos.reduce((sum, photo) => sum + photo.elapsedMs, 0) / result.photos.length),
    parsedNutrients: result.photos.reduce((sum, photo) => sum + photo.parsedNutrients, 0),
    explicitBasisNutrients: result.photos.reduce((sum, photo) => sum + photo.explicitBasisNutrients, 0),
  }])),
}, null, 2));
