import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { parseLabel } from '../src/lib/parser';
import type { NutrientKey } from '../src/lib/contracts';

type Annotation = { key: NutrientKey; value: number; unit: string };
type RecordData = { file: string; hash: string; manualAnnotation: { basis: { amount: number; unit: 'g' | 'ml' } | null; nutrients: Annotation[] } };
type Box = { text: string; score: number; poly: number[][] };
const root = process.cwd();
const photoRoot = path.join(root, 'docs/evidence/private');
const outputPath = path.join(root, 'docs/evidence/ocr-paddleocr-v5-browser.json');
const manifest = JSON.parse(await readFile(path.join(root, 'data/semantic-photo-manifest.json'), 'utf8')) as { records: RecordData[] };
const records = manifest.records.filter(record => record.manualAnnotation.basis && record.manualAnnotation.nutrients.length);
if (records.length !== 5 || records.reduce((sum, record) => sum + record.manualAnnotation.nutrients.length, 0) !== 37) throw new Error('The shared OCR benchmark requires the five annotated photos and 37 nutrient fields.');

const entry = `import { PaddleOCR } from '@paddleocr/paddleocr-js';
let engine;
globalThis.nutriPaddle = {
  async initialize(baseUrl) {
    const started = performance.now();
    engine = await PaddleOCR.create({ lang: 'en', ocrVersion: 'PP-OCRv5', ortOptions: { backend: 'wasm', wasmPaths: baseUrl + '/ort/', numThreads: 1, simd: true } });
    await engine.initialize();
    return { initializeMs: performance.now() - started, runtime: engine.getInitializationSummary?.() ?? null };
  },
  async predict(data) {
    const started = performance.now();
    const image = new Blob([Uint8Array.from(atob(data.base64), char => char.charCodeAt(0))], { type: data.type });
    const [result] = await engine.predict(image);
    return { wallMs: performance.now() - started, metrics: result.metrics, runtime: result.runtime, image: result.image, boxes: result.items.map(item => ({ text: item.text, score: item.score, poly: item.poly })) };
  },
  dispose() { engine?.dispose(); engine = undefined; }
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
function reconstructRows(boxes: Box[]) {
  const placed = boxes.filter(box => box.text.trim() && Array.isArray(box.poly) && box.poly.length >= 4).map(box => ({ box, bounds: center(box) })).sort((a, b) => a.bounds.cy - b.bounds.cy || a.bounds.x0 - b.bounds.x0);
  const typicalHeight = placed.length ? placed.map(item => item.bounds.height).sort((a, b) => a - b)[Math.floor(placed.length / 2)] : 0;
  const toleranceY = Math.max(6, typicalHeight * 0.62);
  const rows: Array<typeof placed> = [];
  for (const item of placed) {
    let row = rows.find(items => Math.abs(items.reduce((sum, current) => sum + current.bounds.cy, 0) / items.length - item.bounds.cy) <= toleranceY);
    if (!row) { row = []; rows.push(row); }
    row.push(item);
  }
  return rows.sort((a, b) => a.reduce((s, x) => s + x.bounds.cy, 0) / a.length - b.reduce((s, x) => s + x.bounds.cy, 0) / b.length)
    .map(row => row.sort((a, b) => a.bounds.x0 - b.bounds.x0).map(item => item.box.text.trim()).join(' '));
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
  const initialize = await page.evaluate(async origin => (globalThis as typeof globalThis & { nutriPaddle: { initialize: (url: string) => Promise<unknown> } }).nutriPaddle.initialize(origin), baseUrl) as { initializeMs?: number; runtime?: unknown };
  for (const record of records) {
    const bytes = await readFile(path.join(photoRoot, record.file));
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (hash !== record.hash.toLowerCase()) throw new Error(`Hash mismatch: ${record.file}`);
    const mime = path.extname(record.file).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
    const before = await cdp.send('Performance.getMetrics').catch(() => ({ metrics: [] as Array<{ name: string; value: number }> }));
    const observed = await page.evaluate(async input => (globalThis as typeof globalThis & { nutriPaddle: { predict: (value: { base64: string; type: string }) => Promise<{ wallMs: number; metrics: unknown; runtime: unknown; image: unknown; boxes: Box[] }> } }).nutriPaddle.predict(input), { base64: bytes.toString('base64'), type: mime });
    const after = await cdp.send('Performance.getMetrics').catch(() => ({ metrics: [] as Array<{ name: string; value: number }> }));
    const rows = reconstructRows(observed.boxes);
    const text = rows.join('\n');
    const parsed = parseLabel(text, { origin: 'ocr', side: 'back' });
    const counts = score(parsed, record, rows);
    const metrics = Object.fromEntries((observed.metrics && typeof observed.metrics === 'object' ? Object.entries(observed.metrics as Record<string, unknown>) : []));
    const heapMetric = (list: Array<{ name: string; value: number }>) => list.find(metric => metric.name === 'JSHeapUsedSize')?.value ?? null;
    results.push({
      photo: record.file, sha256: hash, language: 'en', model: 'PP-OCRv5 via official @paddleocr/paddleocr-js 0.4.2',
      inputBasis: record.manualAnnotation.basis, expectedFields: record.manualAnnotation.nutrients.length,
      ...counts, parsedRows: parsed.nutrients.length,
      detectedBoxes: observed.boxes.length,
      recognizedNonEmptyBoxes: observed.boxes.filter(box => box.text.trim()).length,
      meanRecognizedBoxScore: observed.boxes.length ? Number((observed.boxes.reduce((sum, box) => sum + box.score, 0) / observed.boxes.length).toFixed(4)) : null,
      reconstructedRows: rows.length,
      sdkMetrics: metrics,
      wallMs: Math.round(observed.wallMs),
      jsHeapBeforeBytes: heapMetric(before.metrics),
      jsHeapAfterBytes: heapMetric(after.metrics),
      // Raw text and source bytes intentionally do not enter the tracked receipt.
    });
  }
  const loadedAssets = [...network.values()].filter(item => item.bytes > 0 && /^https?:\/\//i.test(item.url)).map(item => ({ origin: new URL(item.url).origin, path: new URL(item.url).pathname, method: item.method, encodedBytes: item.bytes }));
  const modelBytes = loadedAssets.filter(item => item.origin.includes('paddle-model-ecology')).reduce((sum, item) => sum + item.encodedBytes, 0);
  const uniqueModelBytes = new Map(loadedAssets.filter(item => item.origin.includes('paddle-model-ecology')).map(item => [`${item.origin}${item.path}`, item.encodedBytes]));
  const wasmBytes = loadedAssets.filter(item => item.path.startsWith('/ort/')).reduce((sum, item) => sum + item.encodedBytes, 0);
  const bundleBytes = loadedAssets.filter(item => item.path === '/probe.js').reduce((sum, item) => sum + item.encodedBytes, 0);
  const receipt = {
    schemaVersion: 1, kind: 'official-paddleocr-js-pp-ocrv5-browser-comparison', generatedAt: new Date().toISOString(),
    sdk: { package: '@paddleocr/paddleocr-js', version: '0.4.2', license: 'Apache-2.0', language: 'en', ocrVersion: 'PP-OCRv5', backend: 'ONNX Runtime Web WASM CPU; one thread', worker: false, initializeMs: Math.round(initialize.initializeMs ?? 0), modelNetworkBytes: modelBytes, uniqueModelArtifactBytes: [...uniqueModelBytes.values()].reduce((sum, bytes) => sum + bytes, 0), wasmTransferBytes: wasmBytes, browserBundleBytes: bundleBytes, loadedAssets },
    runtime: initialize.runtime,
    sample: { source: 'Five hash-verified public Open Food Facts label photos already in the local benchmark', records: records.map(record => ({ file: record.file, sha256: record.hash, basis: record.manualAnnotation.basis, expectedFields: record.manualAnnotation.nutrients.length })), totalExpectedFields: 37, split: 'All five photos were previously used in OCR exploration; this is a comparative development sample, not held-out evaluation.' },
    reconstruction: 'SDK-detected line polygons grouped by vertical center using a fixed 0.62× median text-box-height tolerance, x-sorted within rows, then passed to the production parser. Per-field stage flags check human-annotation label/value presence and parser outputs. Numeric presence is checked across all recognized rows and can be a coincidental duplicate; labelAndValueSameReconstructedRow is only a co-occurrence proxy, not verified column association. True region detection precision/recall and column association require independent region/column annotations and remain unmeasured.',
    outcomes: results,
    aggregate: results.reduce((total, item) => ({ correct: total.correct + Number(item.correct), incorrect: total.incorrect + Number(item.incorrect), omitted: total.omitted + Number(item.omitted), withheld: total.withheld + Number(item.withheld), detectedBoxes: total.detectedBoxes + Number(item.detectedBoxes), wallMs: total.wallMs + Number(item.wallMs) }), { correct: 0, incorrect: 0, omitted: 0, withheld: 0, detectedBoxes: 0, wallMs: 0 }),
    pageErrors, externalRequests, networkPolicy: 'Images were supplied from the local process to Chrome memory; only GET requests to Paddle model hosting were allowed. The harness records no image/text payloads and blocks no local research data outside the process.',
    limitations: ['Only five convenience-sample images (37 fields); all were previously used during OCR exploration, so no held-out score is claimed.', 'OCR output strings are processed in memory for parsing and scoring but are not persisted.', 'The simple row grouper can misalign adjacent columns; detection-box existence and confidence are reported separately from final parsed nutrient accuracy.', 'JavaScript heap metrics exclude WebAssembly linear memory, browser native allocations, and potential GPU memory.', 'The PP-OCRv5 SDK is a benchmark-only dev dependency and has not been integrated into the product reader.'],
  };
  if (externalRequests.some(request => request.method !== 'GET')) throw new Error('Unexpected external non-GET request during local OCR benchmark.');
  if (pageErrors.length) throw new Error(`Chrome page error: ${pageErrors[0]}`);
  await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ outputPath: path.relative(root, outputPath), sdk: receipt.sdk, aggregate: receipt.aggregate, outcomes: results.map(item => ({ photo: item.photo, correct: item.correct, incorrect: item.incorrect, omitted: item.omitted, withheld: item.withheld, detectedBoxes: item.detectedBoxes, wallMs: item.wallMs, parsedRows: item.parsedRows })), pageErrors, externalRequests: externalRequests.map(request => ({ origin: request.url, method: request.method })) }, null, 2));
} finally {
  await browser.close();
  server.close();
}
