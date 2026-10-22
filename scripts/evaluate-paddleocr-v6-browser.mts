import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { parseLabel } from '../src/lib/parser';
import type { NutrientKey, Observation, OcrCapture } from '../src/lib/contracts';

type Annotation = { key: NutrientKey; value: number; unit: string };
type RecordData = { file: string; hash: string; type: string; manualAnnotation: { basis: { amount: number; unit: 'g' | 'ml' } | null; nutrients: Annotation[] } };
type Box = { text: string; score: number; poly: number[][] };
const root = process.cwd();
const photoRoot = path.join(root, 'docs/evidence/private');
const outputPath = path.resolve(root, process.env.NUTRISCAN_OCR_EVAL_OUTPUT ?? 'docs/evidence/ocr-paddleocr-v6-browser.json');
const manifest = JSON.parse(await readFile(path.join(root, 'data/semantic-photo-manifest.json'), 'utf8')) as { records: RecordData[] };
const requestedFiles = process.env.NUTRISCAN_OCR_EVAL_FILES?.split(',').map(file => file.trim()).filter(Boolean);
const records = manifest.records.filter(record => record.manualAnnotation.basis && record.manualAnnotation.nutrients.length && (!requestedFiles?.length || requestedFiles.includes(record.file)));
if (!records.length || requestedFiles?.some(file => !records.some(record => record.file === file))) throw new Error('The requested evaluation photo set is empty or contains a file outside the hash-verified manifest.');
const expectedFields = records.reduce((sum, record) => sum + record.manualAnnotation.nutrients.length, 0);
if (!requestedFiles?.length && (records.length !== 5 || expectedFields !== 37)) throw new Error('The default shared OCR comparison requires the five annotated photos and 37 nutrient fields.');

const entry = `import { PaddleOCR } from '@paddleocr/paddleocr-js';
let engine;
globalThis.nutriPaddle = {
  async initialize(baseUrl, lang, ocrVersion) {
    await engine?.dispose();
    const started = performance.now();
    engine = await PaddleOCR.create({ lang, ocrVersion, ortOptions: { backend: 'wasm', wasmPaths: baseUrl + '/ort/', numThreads: 1, simd: true } });
    await engine.initialize();
    return { initializeMs: performance.now() - started, runtime: engine.getInitializationSummary?.() ?? null, lang, ocrVersion };
  },
  async predict(data) {
    const started = performance.now();
    const source = new Blob([Uint8Array.from(atob(data.base64), char => char.charCodeAt(0))], { type: data.type });
    const bitmap = await createImageBitmap(source);
    const sourceImage = { width: bitmap.width, height: bitmap.height };
    const scale = Math.min(3, 3000 / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale), height = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas image preparation failed.');
    context.fillStyle = '#fff'; context.fillRect(0, 0, width, height); context.drawImage(bitmap, 0, 0, width, height); bitmap.close();
    const image = await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('JPEG preparation failed.')), 'image/jpeg', 0.98));
    const [result] = await engine.predict(image);
    return { wallMs: performance.now() - started, metrics: result.metrics, runtime: result.runtime, image: result.image, sourceImage, boxes: result.items.map(item => ({ text: item.text, score: item.score, poly: item.poly })) };
  },
  async dispose() { await engine?.dispose(); engine = undefined; }
};`;
const bundled = await build({
  stdin: { contents: entry, resolveDir: root, sourcefile: 'paddleocr-probe.ts', loader: 'ts' },
  bundle: true, format: 'iife', platform: 'browser', target: 'es2022', external: ['fs', 'path'], write: false, minify: true,
});
const bundle = bundled.outputFiles[0]?.contents;
if (!bundle) throw new Error('PaddleOCR.js probe bundle was not produced.');
const ortRoot = path.join(root, 'node_modules/onnxruntime-web/dist');
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  if (pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end('<!doctype html><meta charset="utf-8"><title>Local PaddleOCR benchmark</title><script src="/probe.js"></script><main>Local OCR benchmark harness</main>');
  } else if (pathname === '/probe.js') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' }); response.end(bundle);
  } else if (pathname.startsWith('/ort/')) {
    const name = path.basename(pathname);
    if (!/^ort-wasm-simd-threaded(?:\.(?:asyncify|jspi|jsep))?\.(?:mjs|wasm)$/.test(name)) { response.writeHead(404).end(); return; }
    try { const bytes = await readFile(path.join(ortRoot, name)); response.writeHead(200, { 'content-type': name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=3600' }); response.end(bytes); }
    catch { response.writeHead(404).end(); }
  } else response.writeHead(404).end();
});
await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Could not open loopback benchmark server.');
const baseUrl = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Performance.enable');
const network = new Map<string, { url: string; method: string; bytes: number }>();
const externalRequests: Array<{ url: string; method: string }> = [];
cdp.on('Network.requestWillBeSent', event => {
  const url = String(event.request.url);
  if (!/^https?:\/\//i.test(url)) return;
  if (!new URL(url).hostname.match(/^(127\.0\.0\.1|localhost|\[::1\])$/)) {
    const method = String(event.request.method);
    externalRequests.push({ url: new URL(url).origin, method });
  }
  network.set(String(event.requestId), { url, method: String(event.request.method), bytes: 0 });
});
cdp.on('Network.loadingFinished', event => { const request = network.get(String(event.requestId)); if (request) request.bytes = Number(event.encodedDataLength); });
const pageErrors: string[] = [];
page.on('pageerror', error => pageErrors.push(error.message));
const results: Array<Record<string, unknown>> = [];
const tolerance = (value: number) => Math.max(0.015, Math.abs(value) * 0.005);
function normalize(key: NutrientKey, value: number, unit: string) {
  if (key === 'energy') return unit.toLowerCase() === 'kj' ? value / 4.184 : value;
  if (key === 'sodium') return unit.toLowerCase() === 'g' ? value * 1000 : value;
  return unit.toLowerCase() === 'mg' ? value / 1000 : value;
}
function center(box: Box) {
  const xs = box.poly.map(point => point[0]), ys = box.poly.map(point => point[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), cy: (Math.min(...ys) + Math.max(...ys)) / 2, height: Math.max(...ys) - Math.min(...ys) };
}
function reconstructObservations(boxes: Box[], width: number, height: number, runId: string, imageId: string): Observation[] {
  const placed = boxes.filter(box => box.text.trim() && Array.isArray(box.poly) && box.poly.length >= 4).map(box => {
    const bounds = center(box);
    bounds.x0 = Math.max(0, Math.min(width, bounds.x0)); bounds.x1 = Math.max(0, Math.min(width, bounds.x1));
    bounds.y0 = Math.max(0, Math.min(height, bounds.y0)); bounds.y1 = Math.max(0, Math.min(height, bounds.y1));
    bounds.cy = (bounds.y0 + bounds.y1) / 2; bounds.height = bounds.y1 - bounds.y0;
    return { box, bounds };
  }).sort((a, b) => a.bounds.cy - b.bounds.cy || a.bounds.x0 - b.bounds.x0);
  const typicalHeight = placed.length ? placed.map(item => item.bounds.height).sort((a, b) => a - b)[Math.floor(placed.length / 2)] : 0;
  const toleranceY = Math.max(6, typicalHeight * 0.62);
  const rows: Array<typeof placed> = [];
  for (const item of placed) {
    let row = rows.find(items => Math.abs(items.reduce((sum, current) => sum + current.bounds.cy, 0) / items.length - item.bounds.cy) <= toleranceY);
    if (!row) { row = []; rows.push(row); }
    row.push(item);
  }
  return rows.sort((a, b) => a.reduce((s, x) => s + x.bounds.cy, 0) / a.length - b.reduce((s, x) => s + x.bounds.cy, 0) / b.length)
    .map((row, lineIndex) => {
      const ordered = row.sort((a, b) => a.bounds.x0 - b.bounds.x0);
      const bbox = { x0: Math.min(...ordered.map(item => item.bounds.x0)), y0: Math.min(...ordered.map(item => item.bounds.y0)), x1: Math.max(...ordered.map(item => item.bounds.x1)), y1: Math.max(...ordered.map(item => item.bounds.y1)) };
      let wordIndex = 0;
      const ocrWords = ordered.flatMap(item => item.box.text.trim().split(/\s+/).filter(Boolean).map(text => ({ wordIndex: wordIndex++, text, confidence: Number.isFinite(item.box.score) ? Math.max(0, Math.min(100, item.box.score * 100)) : null, bbox: { x0: item.bounds.x0, y0: item.bounds.y0, x1: item.bounds.x1, y1: item.bounds.y1 } })));
      return { id: `${runId}-line-${lineIndex}`, field: 'ocr-line', text: ordered.map(item => item.box.text.trim()).join(' '), side: 'back', confidence: ordered.length ? ordered.reduce((sum, item) => sum + item.box.score * 100, 0) / ordered.length : null, bbox, ocrWords, origin: 'ocr', imageId, readingOrder: { runId, blockIndex: 0, paragraphIndex: 0, lineIndex } } satisfies Observation;
    });
}
const labels: Record<NutrientKey, string[]> = {
  energy: ['energy', 'énergie', 'valor energético', 'calories', 'calorías'], carbohydrate: ['carbohydrate', 'glucides', 'carbohidratos', 'hidratos de carbono'],
  sugars: ['sugars', 'sugar', 'sucres', 'azúcares', 'azucares'], fat: ['fat', 'lipides', 'grasas', 'matières grasses'],
  saturatedFat: ['saturated fat', 'saturates', 'saturés', 'saturadas', 'acides gras saturés'], fiber: ['fiber', 'fibre', 'fibra'],
  protein: ['protein', 'protéines', 'proteínas', 'proteinas'], sodium: ['sodium', 'sodio'], salt: ['salt', 'sel', 'sal'], addedSugars: ['added sugars', 'sucres ajoutés', 'azúcares añadidos'],
};
function fold(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function hasLabel(text: string, key: NutrientKey) { const normalized = fold(text); return labels[key].some(label => normalized.includes(fold(label))); }
function hasExpectedNumber(text: string, expected: Annotation) {
  const expectedBase = normalize(expected.key, expected.value, expected.unit);
  const alternatives = [expectedBase];
  if (expected.key === 'energy') alternatives.push(expectedBase * 4.184);
  if (expected.key === 'sodium') alternatives.push(expectedBase / 1000);
  const numbers = [...text.matchAll(/\d+(?:[.,]\d+)?/g)].map(match => Number(match[0].replace(',', '.')));
  return numbers.some(number => alternatives.some(value => Math.abs(number - value) <= Math.max(0.015, Math.abs(value) * 0.005)));
}
function score(parsed: ReturnType<typeof parseLabel>, record: RecordData, rows: string[]) {
  let correct = 0, incorrect = 0, omitted = 0, withheld = 0;
  const basis = record.manualAnnotation.basis;
  const allText = rows.join('\n');
  const basisObserved = basis ? new RegExp(`(?:per|pour|por)?\\s*(?:100|${basis.amount})\\s*(?:g|ml)\\b`, 'i').test(allText) : false;
  const fields = record.manualAnnotation.nutrients.map(expected => {
    const candidates = parsed.nutrients.filter(item => item.key === expected.key);
    const compatible = candidates.filter(item => record.manualAnnotation.basis && item.basis?.amount === record.manualAnnotation.basis.amount && item.basis.unit === record.manualAnnotation.basis.unit);
    const labelRecognized = rows.some(row => hasLabel(row, expected.key));
    const valueRecognized = rows.some(row => hasExpectedNumber(row, expected));
    const sameReconstructedRow = rows.some(row => hasLabel(row, expected.key) && hasExpectedNumber(row, expected));
    const unitTextRecognized = rows.some(row => hasLabel(row, expected.key) && hasExpectedNumber(row, expected) && new RegExp(`\\b${expected.unit}\\b`, 'i').test(row));
    let outcome: 'correct' | 'incorrect' | 'omitted' | 'withheld';
    if (!candidates.length) { omitted++; outcome = 'omitted'; }
    else if (!compatible.length || compatible.some(item => item.status === 'conflict')) { withheld++; outcome = 'withheld'; }
    else if (compatible.some(item => Math.abs(normalize(expected.key, item.value, item.unit) - normalize(expected.key, expected.value, expected.unit)) <= tolerance(normalize(expected.key, expected.value, expected.unit)))) { correct++; outcome = 'correct'; }
    else { incorrect++; outcome = 'incorrect'; }
    return { key: expected.key, outcome, stages: { labelRecognized, numericValueRecognized: valueRecognized, labelAndValueSameReconstructedRow: sameReconstructedRow, unitTextRecognized, declaredBasisObserved: basisObserved, parserCandidateEmitted: candidates.length > 0, parserCandidateOnDeclaredBasis: compatible.length > 0 }, unitExact: compatible.some(item => item.unit.toLowerCase() === expected.unit.toLowerCase()), basisExact: compatible.some(item => item.basis?.amount === basis?.amount && item.basis.unit === basis.unit) };
  });
  return { correct, incorrect, omitted, withheld, fields, basisTextObserved: basisObserved };
}

try {
  await page.goto(baseUrl);
  const runs = [
    { model: 'PP-OCRv5', lang: 'en', records },
    ...(['en', 'fr', 'es'] as const).map(lang => ({
      model: 'PP-OCRv6', lang,
      records: records.filter(record => {
        const type = record.type.toLowerCase();
        return lang === 'en' ? type.includes('english') : lang === 'fr' ? type.includes('french') : type.includes('spanish');
      }),
    })),
  ].filter(run => run.records.length > 0);
  const initializations: Array<Record<string, unknown>> = [];
  for (const run of runs) {
    const initialize = await page.evaluate(async input => (globalThis as typeof globalThis & { nutriPaddle: { initialize: (url: string, lang: string, version: string) => Promise<unknown> } }).nutriPaddle.initialize(input.origin, input.lang, input.version), { origin: baseUrl, lang: run.lang, version: run.model }) as { initializeMs?: number; runtime?: unknown };
    initializations.push({ model: run.model, language: run.lang, initializeMs: Math.round(initialize.initializeMs ?? 0), runtime: initialize.runtime });
    for (const record of run.records) {
      const bytes = await readFile(path.join(photoRoot, record.file));
      const hash = createHash('sha256').update(bytes).digest('hex');
      if (hash !== record.hash.toLowerCase()) throw new Error(`Hash mismatch: ${record.file}`);
      const mime = path.extname(record.file).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
      const before = await cdp.send('Performance.getMetrics').catch(() => ({ metrics: [] as Array<{ name: string; value: number }> }));
      const observed = await page.evaluate(async input => (globalThis as typeof globalThis & { nutriPaddle: { predict: (value: { base64: string; type: string }) => Promise<{ wallMs: number; metrics: unknown; runtime: unknown; image: { width: number; height: number }; sourceImage: { width: number; height: number }; boxes: Box[] }> } }).nutriPaddle.predict(input), { base64: bytes.toString('base64'), type: mime });
      const after = await cdp.send('Performance.getMetrics').catch(() => ({ metrics: [] as Array<{ name: string; value: number }> }));
      const runId = `${run.model}-${run.lang}-${record.code}`;
      const imageId = `photo-${record.code}`;
      const observations = reconstructObservations(observed.boxes, observed.image.width, observed.image.height, runId, imageId);
      const rows = observations.map(observation => observation.text);
      const text = rows.join('\n');
      const capture: OcrCapture = {
        runId, imageId, side: 'back', sourceImage: observed.sourceImage, preparedImage: observed.image,
        bboxCoordinateSpace: 'prepared-image-pixels',
        engine: { name: '@paddleocr/paddleocr-js', version: '0.4.2', language: run.lang, confidenceScale: '0-100', segmentationMode: 'auto' },
        processing: { rotation: 0, contrast: false, invert: false, cropPercent: null },
      };
      const parsed = parseLabel(text, { origin: 'ocr', side: 'back', observations, ocrCaptures: [capture] });
      const parserRows = [...rows,...parsed.observations.filter(observation=>observation.field==='nutrition-row-candidate').map(observation=>observation.text)];
      const counts = score(parsed, record, parserRows);
      const metrics = Object.fromEntries((observed.metrics && typeof observed.metrics === 'object' ? Object.entries(observed.metrics as Record<string, unknown>) : []));
      const heapMetric = (list: Array<{ name: string; value: number }>) => list.find(metric => metric.name === 'JSHeapUsedSize')?.value ?? null;
      results.push({
        photo: record.file, sha256: hash, language: run.lang, model: `${run.model} via official @paddleocr/paddleocr-js 0.4.2`,
        inputBasis: record.manualAnnotation.basis, expectedFields: record.manualAnnotation.nutrients.length,
        ...counts, parsedRows: parsed.nutrients.length,
        parserDiagnostics: parsed.parserDiagnostics.flatMap(item => item.reasonCodes),
        detectedBoxes: observed.boxes.length,
        recognizedNonEmptyBoxes: observed.boxes.filter(box => box.text.trim()).length,
        meanRecognizedBoxScore: observed.boxes.length ? Number((observed.boxes.reduce((sum, box) => sum + box.score, 0) / observed.boxes.length).toFixed(4)) : null,
        reconstructedRows: rows.length,
        layoutCandidateRows: parserRows.length-rows.length,
        sdkMetrics: metrics,
        wallMs: Math.round(observed.wallMs),
        jsHeapBeforeBytes: heapMetric(before.metrics),
        jsHeapAfterBytes: heapMetric(after.metrics),
        // Raw text and source bytes intentionally do not enter the tracked receipt.
      });
    }
    await page.evaluate(async () => (globalThis as typeof globalThis & { nutriPaddle: { dispose: () => Promise<void> } }).nutriPaddle.dispose());
  }
  const loadedAssets = [...network.values()].filter(item => item.bytes > 0 && /^https?:\/\//i.test(item.url)).map(item => ({ origin: new URL(item.url).origin, path: new URL(item.url).pathname, method: item.method, encodedBytes: item.bytes }));
  const modelBytes = loadedAssets.filter(item => item.origin.includes('paddle-model-ecology')).reduce((sum, item) => sum + item.encodedBytes, 0);
  const uniqueModelBytes = new Map(loadedAssets.filter(item => item.origin.includes('paddle-model-ecology')).map(item => [`${item.origin}${item.path}`, item.encodedBytes]));
  const wasmBytes = loadedAssets.filter(item => item.path.startsWith('/ort/')).reduce((sum, item) => sum + item.encodedBytes, 0);
  const bundleBytes = loadedAssets.filter(item => item.path === '/probe.js').reduce((sum, item) => sum + item.encodedBytes, 0);
  const receipt = {
    schemaVersion: 1, kind: 'official-paddleocr-js-pp-ocrv5-v6-structured-extraction-comparison', generatedAt: new Date().toISOString(),
    sdk: { package: '@paddleocr/paddleocr-js', version: '0.4.2', license: 'Apache-2.0', models: ['PP-OCRv5 English baseline', 'PP-OCRv6 English/French/Spanish language-matched candidate'], backend: 'ONNX Runtime Web WASM CPU; one thread', worker: false, initializations, modelNetworkBytes: modelBytes, uniqueModelArtifactBytes: [...uniqueModelBytes.values()].reduce((sum, bytes) => sum + bytes, 0), wasmTransferBytes: wasmBytes, browserBundleBytes: bundleBytes, loadedAssets },
    sample: { source: 'Hash-verified public Open Food Facts label photos already in the local development benchmark', records: records.map(record => ({ file: record.file, sha256: record.hash, basis: record.manualAnnotation.basis, expectedFields: record.manualAnnotation.nutrients.length })), totalExpectedFields: expectedFields, split: `${records.length} previously used development photos; this is not held-out or population-level evaluation.` },
    reconstruction: 'Each source photograph was prepared in browser Canvas using the production 3,000 px long-edge cap and JPEG quality 0.98. SDK polygons were grouped into production-shaped OCR observations with per-token text, confidence, bounding boxes, reading order, image IDs, and a capture record, then passed to the production parser. For a panel with one explicit multi-basis header, label-like rows to the left of the value columns, complete values in each column, and unambiguous geometry, the parser aligns the independent top-to-bottom row orders and emits tentative candidates only for supported nutrient labels. It retains raw OCR lines and links each candidate to its source boxes. Per-field stage flags include these candidates; region precision/recall and independent column annotations remain unavailable.',
    outcomes: results,
    aggregate: Object.fromEntries(['PP-OCRv5', 'PP-OCRv6'].map(model => {
      const selected = results.filter(item => String(item.model).startsWith(model));
      return [model, selected.reduce((total, item) => ({ correct: total.correct + Number(item.correct), incorrect: total.incorrect + Number(item.incorrect), omitted: total.omitted + Number(item.omitted), withheld: total.withheld + Number(item.withheld), expectedFields: total.expectedFields + Number(item.expectedFields), detectedBoxes: total.detectedBoxes + Number(item.detectedBoxes), wallMs: total.wallMs + Number(item.wallMs) }), { correct: 0, incorrect: 0, omitted: 0, withheld: 0, expectedFields: 0, detectedBoxes: 0, wallMs: 0 })];
    })),
    pageErrors, externalRequests, networkPolicy: 'Images were supplied from the local process to Chrome memory; only GET requests to Paddle model hosting were allowed. The harness records no image/text payloads and blocks no local research data outside the process.',
    limitations: [`Only ${records.length} convenience-sample photos (${expectedFields} fields); all were previously used during OCR exploration, so no held-out score is claimed.`, 'PP-OCRv5 is tested with its English model; PP-OCRv6 language is selected from existing human photo annotations only for this offline comparison. Production language detection and routing are not demonstrated.', 'OCR output strings are processed in memory for parsing and scoring but are not persisted.', 'Recognized box presence and confidence do not establish correct table row/column association; independent region and column annotations remain unavailable.', 'JavaScript heap metrics exclude WebAssembly linear memory, browser native allocations, and potential GPU memory.', 'No image bytes leave the local process; only GET requests to Paddle model hosting are made. This is a comparative development experiment, not held-out or population-level evidence.'],
  };
  if (externalRequests.some(request => request.method !== 'GET')) throw new Error('Unexpected external non-GET request during local OCR benchmark.');
  if (pageErrors.length) throw new Error(`Chrome page error: ${pageErrors[0]}`);
  await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ outputPath: path.relative(root, outputPath), sdk: receipt.sdk, aggregate: receipt.aggregate, outcomes: results.map(item => ({ model: item.model, language: item.language, photo: item.photo, correct: item.correct, incorrect: item.incorrect, omitted: item.omitted, withheld: item.withheld, detectedBoxes: item.detectedBoxes, wallMs: item.wallMs, parsedRows: item.parsedRows })), pageErrors, externalRequests: externalRequests.map(request => ({ origin: request.url, method: request.method })) }, null, 2));
} finally {
  await browser.close();
  server.close();
}
