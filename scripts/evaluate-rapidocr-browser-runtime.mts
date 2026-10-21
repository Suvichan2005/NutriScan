import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { parseLabel } from '../src/lib/parser';
import type { NutrientKey, PackageData } from '../src/lib/contracts';

const root = process.cwd();
const modelRoot = path.resolve('docs/evidence/private/rapidocr-venv/Lib/site-packages/rapidocr/models');
const python = process.env.NUTRISCAN_RAPIDOCR_PYTHON ?? path.resolve('docs/evidence/private/rapidocr-venv/Scripts/python.exe');
const modelType = process.env.NUTRISCAN_RAPIDOCR_MODEL_TYPE ?? 'tiny';
if (!['tiny', 'small'].includes(modelType)) throw new Error('NUTRISCAN_RAPIDOCR_MODEL_TYPE must be tiny or small.');
const scope = process.env.NUTRISCAN_RAPIDOCR_BROWSER_SCOPE ?? 'selected-crops';
if (!['selected-crops', 'full-photo', 'name-photos'].includes(scope)) throw new Error('NUTRISCAN_RAPIDOCR_BROWSER_SCOPE must be selected-crops, full-photo, or name-photos.');
const detector = path.join(modelRoot, `PP-OCRv6_det_${modelType}.onnx`);
const recognizer = path.join(modelRoot, `PP-OCRv6_rec_${modelType}.onnx`);
const manifest = JSON.parse(await readFile('data/semantic-photo-manifest.json', 'utf8')) as { records: Array<{ file: string; hash: string; code: string; manualAnnotation?: { basis: { amount: number; unit: 'g'|'ml' }; nutrients: Array<{ key: NutrientKey; value: number; unit: string }> } }> };
const selectedCropSpecs = [
  { file: 'saffola-veggie-oats-nutrition-off-8901088068758.jpg', crop: { left: 3, top: 0, width: 93, height: 99 }, targetRow: { left: 80, top: 112, width: 780, height: 52 } },
  { file: 'bagrrys-white-oats-nutrition-off-8902710100150.jpg', crop: { left: 2, top: 2, width: 74, height: 96 } },
];
const fullPhotoSpecs = manifest.records.filter((photo) => photo.manualAnnotation?.basis && photo.manualAnnotation.nutrients.length > 0).map((photo) => ({
  file: photo.file,
  crop: { left: 0, top: 0, width: 100, height: 100 },
  ...(photo.file === 'saffola-veggie-oats-nutrition-off-8901088068758.jpg' ? { targetRow: { left: 80, top: 112, width: 780, height: 52 } } : {}),
}));
const nameTokens: Record<string, string[]> = {
  'coca-cola-front-off-5449000000996.jpg': ['coca', 'cola'],
  'nutella-label-off-3017620422003.jpg': ['nutella'],
  'heinz-beans-front-off-5000157024671.jpg': ['heinz'],
  'saffola-veggie-oats-nutrition-off-8901088068758.jpg': ['saffola'],
  'bagrrys-white-oats-nutrition-off-8902710100150.jpg': ['bagrrys'],
};
const nameRoles: Record<string, 'front'|'nutrition'> = {
  'coca-cola-front-off-5449000000996.jpg': 'front',
  'nutella-label-off-3017620422003.jpg': 'front',
  'heinz-beans-front-off-5000157024671.jpg': 'front',
  'saffola-veggie-oats-nutrition-off-8901088068758.jpg': 'nutrition',
  'bagrrys-white-oats-nutrition-off-8902710100150.jpg': 'nutrition',
};
const namePhotoSpecs = Object.keys(nameTokens).map((file) => ({ file, role: nameRoles[file], crop: { left: 0, top: 0, width: 100, height: 100 } }));
const sampleSpecs = scope === 'full-photo' ? fullPhotoSpecs : scope === 'name-photos' ? namePhotoSpecs : selectedCropSpecs;
const samples: Array<{ photo: NonNullable<typeof manifest.records[number]>; panelPath: string; panelLabel: string; role?: 'front'|'nutrition'; targetRowPath?: string }> = [];
const sampleAssets: Array<[string, Buffer]> = [];
for (const spec of sampleSpecs) {
  const photo = manifest.records.find((record) => record.file === spec.file);
  if (!photo || (scope !== 'name-photos' && !photo.manualAnnotation)) throw new Error(`The benchmark image or annotation is missing from the manifest: ${spec.file}`);
  const source = await readFile(path.join('docs/evidence/private', photo.file));
  if (createHash('sha256').update(source).digest('hex') !== photo.hash.toLowerCase()) throw new Error(`The source image does not match its manifest hash: ${spec.file}`);
  const oriented = await sharp(source).rotate().toBuffer();
  const dimensions = await sharp(oriented).metadata();
  if (!dimensions.width || !dimensions.height) throw new Error(`Could not read dimensions for ${spec.file}.`);
  const crop = { left: Math.round(dimensions.width * spec.crop.left / 100), top: Math.round(dimensions.height * spec.crop.top / 100), width: Math.round(dimensions.width * spec.crop.width / 100), height: Math.round(dimensions.height * spec.crop.height / 100) };
  crop.width = Math.min(crop.width, dimensions.width - crop.left);
  crop.height = Math.min(crop.height, dimensions.height - crop.top);
  const panelPath = `/images/panel-${photo.code}.jpg`;
  sampleAssets.push([panelPath, await sharp(oriented).extract(crop).jpeg({ quality: 98 }).toBuffer()]);
  let targetRowPath: string | undefined;
  if (spec.targetRow) {
    targetRowPath = `/images/target-${photo.code}.jpg`;
    sampleAssets.push([targetRowPath, await sharp(oriented).extract(spec.targetRow).jpeg({ quality: 98 }).toBuffer()]);
  }
  const panelLabel = scope === 'name-photos' ? `full ${spec.role} photo` : scope === 'full-photo' ? 'full image' : photo.code === '8901088068758' ? '3/0/93/99 percent' : '2/2/74/96 percent';
  samples.push({ photo, panelPath, panelLabel, ...(spec.role ? { role: spec.role as 'front'|'nutrition' } : {}), ...(targetRowPath ? { targetRowPath } : {}) });
}
const ortDir = path.resolve('node_modules/onnxruntime-web/dist');
const runtimeSizes = {
  javascript: (await readFile(path.join(ortDir, 'ort.min.js'))).length,
  wasm: (await readFile(path.join(ortDir, 'ort-wasm-simd-threaded.wasm'))).length,
  wasmModule: (await readFile(path.join(ortDir, 'ort-wasm-simd-threaded.mjs'))).length,
};
const assets = new Map<string, { body: Buffer; type: string }>([
  ['/models/det.onnx', { body: await readFile(detector), type: 'application/octet-stream' }],
  ['/models/rec.onnx', { body: await readFile(recognizer), type: 'application/octet-stream' }],
  ...sampleAssets.map(([url, body]) => [url, { body, type: 'image/jpeg' }] as const),
  ['/wasm/ort-wasm-simd-threaded.wasm', { body: await readFile(path.join(ortDir, 'ort-wasm-simd-threaded.wasm')), type: 'application/wasm' }],
  ['/wasm/ort-wasm-simd-threaded.mjs', { body: await readFile(path.join(ortDir, 'ort-wasm-simd-threaded.mjs')), type: 'text/javascript' }],
]);

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end('<!doctype html><meta charset="utf-8"><title>Local OCR runtime probe</title><main>Local PP-OCRv6 browser runtime probe</main>');
    return;
  }
  const asset = assets.get(url.pathname);
  if (!asset) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { 'content-type': asset.type, 'cache-control': 'no-store', 'content-length': asset.body.length });
  response.end(asset.body);
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Could not open the local-only OCR test server.');
const origin = `http://127.0.0.1:${address.port}`;
const metadataResult = spawnSync(python, ['-X', 'utf8', '-c', 'import onnxruntime as o,sys; print(o.InferenceSession(sys.argv[1], providers=["CPUExecutionProvider"]).get_modelmeta().custom_metadata_map["character"], end="")', recognizer], { encoding: 'utf8' });
if (metadataResult.status !== 0) throw new Error(`Could not read the model character map: ${metadataResult.stderr.slice(-1200)}`);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(origin);
  await page.addScriptTag({ path: path.join(ortDir, 'ort.min.js') });
  const probeSource = String.raw`window.runNutriScanRapidOcrProbe = async function(characterLines, panelUrl, targetRowUrl, options = {}) {
    const ort = window.ort;
    if (!ort) throw new Error('ONNX Runtime Web did not initialize.');
    ort.env.wasm.wasmPaths = { wasm: '/wasm/ort-wasm-simd-threaded.wasm', mjs: '/wasm/ort-wasm-simd-threaded.mjs' };
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    const load = async (url) => new Uint8Array(await (await fetch(url)).arrayBuffer());
    if (!window.__nutriScanOcrModels) {
      const modelStart = performance.now();
      const [det, rec] = await Promise.all([
        ort.InferenceSession.create(await load('/models/det.onnx'), { executionProviders: ['wasm'] }),
        ort.InferenceSession.create(await load('/models/rec.onnx'), { executionProviders: ['wasm'] }),
      ]);
      window.__nutriScanOcrModels = { det, rec, modelLoadMs: Math.round(performance.now() - modelStart) };
    }
    const { det, rec, modelLoadMs } = window.__nutriScanOcrModels;

    const image = async (url) => createImageBitmap(await (await fetch(url)).blob());
    const panelBitmap = await image(panelUrl);
    const scale = 736 / Math.min(panelBitmap.width, panelBitmap.height);
    const height = Math.max(32, Math.round(panelBitmap.height * scale / 32) * 32);
    const width = Math.max(32, Math.round(panelBitmap.width * scale / 32) * 32);
    const detCanvas = document.createElement('canvas'); detCanvas.width = width; detCanvas.height = height;
    const detContext = detCanvas.getContext('2d', { willReadFrequently: true });
    if (!detContext) throw new Error('Canvas context unavailable for detector input.');
    detContext.drawImage(panelBitmap, 0, 0, width, height); panelBitmap.close();
    const pixels = detContext.getImageData(0, 0, width, height).data;
    const plane = width * height;
    const detData = new Float32Array(plane * 3);
      for (let i = 0; i < plane; i++) {
      detData[i] = pixels[i * 4] / 127.5 - 1;
      detData[plane + i] = pixels[i * 4 + 1] / 127.5 - 1;
      detData[plane * 2 + i] = pixels[i * 4 + 2] / 127.5 - 1;
    }
    const detInput = new ort.Tensor('float32', detData, [1, 3, height, width]);
    const detectorStart = performance.now();
    const detOutput = await det.run({ [det.inputNames[0]]: detInput });
    const detectorMs = Math.round(performance.now() - detectorStart);
    const detTensor = detOutput[det.outputNames[0]];
    const detValues = detTensor.data;
    let maxDetectorResponse = -Infinity, activeProbabilityPixels = 0;
    const detectorThreshold = Number(options.detectorThreshold ?? .3);
    const minimumRowPixels = Number(options.minimumRowPixels ?? 3);
    const bandGap = Number(options.bandGap ?? 3);
    const minimumBandHeight = Number(options.minimumBandHeight ?? 5);
    const minimumConfidence = Number(options.minimumConfidence ?? .4);
    for (const value of detValues) { if (value > maxDetectorResponse) maxDetectorResponse = value; if (value > detectorThreshold) activeProbabilityPixels++; }

    const classesFrom = characterLines.split(/\r?\n/);
    const labels = ['<blank>', ...classesFrom, ' '];
    const recognize = async (sourceCanvas, x, y, cropWidth, cropHeight) => {
      const lineWidth = Math.max(320, Math.ceil(48 * cropWidth / cropHeight));
      const resizedWidth = Math.min(lineWidth, Math.ceil(48 * cropWidth / cropHeight));
      const recCanvas = document.createElement('canvas'); recCanvas.width = lineWidth; recCanvas.height = 48;
      const recContext = recCanvas.getContext('2d', { willReadFrequently: true });
      if (!recContext) throw new Error('Canvas context unavailable for recognizer input.');
      recContext.fillStyle = '#808080'; recContext.fillRect(0, 0, lineWidth, 48);
      recContext.drawImage(sourceCanvas, x, y, cropWidth, cropHeight, 0, 0, resizedWidth, 48);
      const recPixels = recContext.getImageData(0, 0, lineWidth, 48).data;
      const recPlane = lineWidth * 48;
      const recData = new Float32Array(recPlane * 3);
      for (let i = 0; i < recPlane; i++) {
        recData[i] = recPixels[i * 4] / 127.5 - 1;
        recData[recPlane + i] = recPixels[i * 4 + 1] / 127.5 - 1;
        recData[recPlane * 2 + i] = recPixels[i * 4 + 2] / 127.5 - 1;
      }
      const input = new ort.Tensor('float32', recData, [1, 3, 48, lineWidth]);
      const start = performance.now();
      const outputs = await rec.run({ [rec.inputNames[0]]: input });
      const elapsed = Math.round(performance.now() - start);
      const tensor = outputs[rec.outputNames[0]];
      const values = tensor.data;
      const classes = Number(tensor.dims[2]);
      if (labels.length !== classes) throw new Error('Character map has ' + labels.length + ' labels for ' + classes + ' output classes.');
      let previous = 0, decoded = '', confidenceTotal = 0, emitted = 0;
      for (let t = 0; t < Number(tensor.dims[1]); t++) {
        let best = 0, probability = -Infinity;
        for (let c = 0; c < classes; c++) {
          const value = values[t * classes + c];
          if (value > probability) { probability = value; best = c; }
        }
        if (best !== 0 && best !== previous) { decoded += labels[best] ?? ''; confidenceTotal += probability; emitted++; }
        previous = best;
      }
      return { decoded: decoded.trim(), confidence: emitted ? confidenceTotal / emitted : 0, elapsedMs: elapsed, inputWidth: lineWidth };
    };
    const bands = [];
    const recognizedRows = [];
    if (options.extractionMode === 'components') {
      const size = height * width;
      const mask = new Uint8Array(size);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (detValues[y * width + x] > detectorThreshold) {
          for (let dy = 0; dy <= 1 && y + dy < height; dy++) for (let dx = 0; dx <= 1 && x + dx < width; dx++) mask[(y + dy) * width + x + dx] = 1;
        }
      }
      const seen = new Uint8Array(size);
      const queue = new Int32Array(size);
      const boxes = [];
      for (let seed = 0; seed < size; seed++) {
        if (!mask[seed] || seen[seed]) continue;
        let head = 0, tail = 0, left = width, right = 0, top = height, bottom = 0, score = 0;
        queue[tail++] = seed; seen[seed] = 1;
        while (head < tail) {
          const current = queue[head++], y = Math.floor(current / width), x = current - y * width;
          left = Math.min(left, x); right = Math.max(right, x + 1); top = Math.min(top, y); bottom = Math.max(bottom, y + 1); score += detValues[current];
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const ny = y + dy, nx = x + dx;
            if (ny < 0 || ny >= height || nx < 0 || nx >= width) continue;
            const next = ny * width + nx;
            if (mask[next] && !seen[next]) { seen[next] = 1; queue[tail++] = next; }
          }
        }
        const boxWidth = right - left, boxHeight = bottom - top;
        if (tail >= 5 && boxWidth >= 3 && boxHeight >= 3 && score / tail >= .35) boxes.push({ left, right, top, bottom, width: boxWidth, height: boxHeight });
      }
      const textRows = [];
      for (const box of boxes.sort((a, b) => a.top - b.top || a.left - b.left)) {
        const center = (box.top + box.bottom) / 2;
        let row = textRows.find((candidate) => Math.abs(candidate.center - center) <= Math.max(8, Math.min(candidate.height, box.height) * .65));
        if (!row) { row = { center, height: box.height, boxes: [] }; textRows.push(row); }
        row.boxes.push(box);
        row.center = row.boxes.reduce((sum, item) => sum + (item.top + item.bottom) / 2, 0) / row.boxes.length;
        row.height = Math.max(row.height, box.height);
      }
      bands.push(...textRows);
      for (const row of textRows) {
        const words = [];
        for (const box of row.boxes.sort((a, b) => a.left - b.left)) {
          const previous = words.at(-1);
          const verticalOverlap = previous ? Math.max(0, Math.min(previous.bottom, box.bottom) - Math.max(previous.top, box.top)) / Math.min(previous.bottom - previous.top, box.height) : 0;
          if (previous && box.left - previous.right <= Math.max(4, Math.min(previous.bottom - previous.top, box.height) * .75) && verticalOverlap >= .4) {
            previous.left = Math.min(previous.left, box.left); previous.right = Math.max(previous.right, box.right); previous.top = Math.min(previous.top, box.top); previous.bottom = Math.max(previous.bottom, box.bottom);
          } else words.push({ left: box.left, right: box.right, top: box.top, bottom: box.bottom });
        }
        const fragments = [];
        for (const word of words) {
          const padX = Math.max(4, Math.round((word.right - word.left) * .12)), padY = Math.max(2, Math.round((word.bottom - word.top) * .18));
          const x = Math.max(0, word.left - padX), y = Math.max(0, word.top - padY);
          const result = await recognize(detCanvas, x, y, Math.min(width, word.right + padX) - x, Math.min(height, word.bottom + padY) - y);
          if (result.decoded && result.confidence >= minimumConfidence) fragments.push({ text: result.decoded, confidence: result.confidence, left: word.left, elapsedMs: result.elapsedMs });
        }
        if (fragments.length) recognizedRows.push({ text: fragments.sort((a, b) => a.left - b.left).map((fragment) => fragment.text).join(' '), confidence: fragments.reduce((sum, fragment) => sum + fragment.confidence, 0) / fragments.length, top: row.center, left: Math.min(...fragments.map((fragment) => fragment.left)), elapsedMs: fragments.reduce((sum, fragment) => sum + fragment.elapsedMs, 0) });
      }
    } else {
      const rowCounts = new Uint16Array(height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (detValues[y * width + x] > detectorThreshold) rowCounts[y]++;
      let start = -1, last = -1;
      for (let y = 0; y <= height; y++) {
        const active = y < height && rowCounts[y] >= minimumRowPixels;
        if (active) { if (start < 0) start = y; last = y; }
        else if (start >= 0 && y - last > bandGap) {
          if (last - start >= minimumBandHeight) bands.push({ top: start, bottom: last + 1 });
          start = -1; last = -1;
        }
      }
      for (const band of bands) {
        const padY = Math.max(2, Math.round((band.bottom - band.top) * .18));
        const top = Math.max(0, band.top - padY), bottom = Math.min(height, band.bottom + padY);
        let left = width, right = 0;
        for (let y = band.top; y < band.bottom; y++) for (let x = 0; x < width; x++) if (detValues[y * width + x] > detectorThreshold) { left = Math.min(left, x); right = Math.max(right, x + 1); }
        if (right - left < 12) continue;
        const padX = Math.max(6, Math.round((right - left) * .02));
        const result = await recognize(detCanvas, Math.max(0, left - padX), top, Math.min(width, right + padX) - Math.max(0, left - padX), bottom - top);
        if (result.decoded && result.confidence >= minimumConfidence) recognizedRows.push({ text: result.decoded, confidence: result.confidence, top, left: Math.max(0, left - padX), elapsedMs: result.elapsedMs });
      }
    }
    let targetLine = null;
    if (targetRowUrl) {
      const lineBitmap = await image(targetRowUrl);
      const lineCanvas = document.createElement('canvas'); lineCanvas.width = lineBitmap.width; lineCanvas.height = lineBitmap.height;
      const lineContext = lineCanvas.getContext('2d');
      if (!lineContext) throw new Error('Canvas context unavailable for target row.');
      lineContext.drawImage(lineBitmap, 0, 0); lineBitmap.close();
      targetLine = await recognize(lineCanvas, 0, 0, lineCanvas.width, lineCanvas.height);
    }
    const rowRecognizerMs = recognizedRows.reduce((sum, row) => sum + row.elapsedMs, 0);
    return {
      backend: 'ONNX Runtime Web WASM, one thread', modelLoadMs,
      detector: { inputShape: [1, 3, height, width], outputShape: Array.from(detTensor.dims), inferenceMs: detectorMs, maxResponse: Number(maxDetectorResponse.toFixed(5)), activeProbabilityPixels, activated: maxDetectorResponse > detectorThreshold },
      recognizer: { targetRowFound: targetLine ? targetLine.decoded.toLowerCase().includes('energy') && targetLine.decoded.includes('376') : null, targetRowConfidence: targetLine ? Number(targetLine.confidence.toFixed(4)) : null, targetRowInferenceMs: targetLine?.elapsedMs ?? null },
      detectedTextRows: recognizedRows,
      endToEnd: { detectedBands: bands.length, recognizedRows: recognizedRows.length, rowRecognizerMs },
      pageErrors: [],
    };
  };`;
  const bundledProbe = await build({ stdin: { contents: probeSource, resolveDir: root, sourcefile: 'rapidocr-browser-probe.js' }, bundle: false, platform: 'browser', format: 'iife', target: 'es2022', write: false });
  await page.addScriptTag({ content: bundledProbe.outputFiles[0].text });
  await page.addScriptTag({ content: `window.__nutriScanRapidOcrCharacterMap = ${JSON.stringify(metadataResult.stdout)};` });
  const photoResults: Array<Record<string, unknown>> = [];
  const normalize = (key: NutrientKey, value: number, unit: string) => key === 'energy' ? unit === 'kJ' ? value / 4.184 : value : key === 'sodium' ? unit === 'g' ? value * 1000 : value : unit === 'mg' ? value / 1000 : value;
  const allConfigurations = [
    { name: 'baseline', detectorThreshold: .3, minimumRowPixels: 3, bandGap: 3, minimumBandHeight: 5, minimumConfidence: .4 },
    { name: 'lower-detector-threshold', detectorThreshold: .2, minimumRowPixels: 3, bandGap: 3, minimumBandHeight: 5, minimumConfidence: .4 },
    { name: 'higher-detector-threshold', detectorThreshold: .4, minimumRowPixels: 3, bandGap: 3, minimumBandHeight: 5, minimumConfidence: .4 },
    { name: 'wider-row-gap', detectorThreshold: .3, minimumRowPixels: 3, bandGap: 6, minimumBandHeight: 5, minimumConfidence: .4 },
    { name: 'tighter-row-gap', detectorThreshold: .3, minimumRowPixels: 3, bandGap: 1, minimumBandHeight: 5, minimumConfidence: .4 },
    { name: 'connected-components', extractionMode: 'components', detectorThreshold: .3, minimumRowPixels: 3, bandGap: 3, minimumBandHeight: 5, minimumConfidence: .4 },
  ];
  const configurations = scope === 'full-photo' || scope === 'name-photos' ? [allConfigurations[0], allConfigurations[5]] : allConfigurations;
  for (const config of configurations) for (const sample of samples) {
    const expression = `window.runNutriScanRapidOcrProbe(window.__nutriScanRapidOcrCharacterMap, ${JSON.stringify(sample.panelPath)}, ${JSON.stringify(sample.targetRowPath ?? null)}, ${JSON.stringify(config)})`;
    const result = await page.evaluate(expression) as { pageErrors: string[]; detector: { activated: boolean; inferenceMs: number }; recognizer: { targetRowFound: boolean | null; targetRowConfidence: number | null; targetRowInferenceMs: number | null }; detectedTextRows: Array<{ text: string; confidence: number; elapsedMs: number; top: number; left: number }>; endToEnd: { detectedBands: number; recognizedRows: number; rowRecognizerMs: number }; modelLoadMs: number; backend: string; [key: string]: any };
    result.pageErrors = [...pageErrors];
    const rawText = result.detectedTextRows.map((row) => row.text).join('\n');
    if (scope === 'name-photos') {
      const tokens = nameTokens[sample.photo.file];
      const normalizedLines = result.detectedTextRows.map((row) => row.text.toLocaleLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu, ''));
      const matchingRows = result.detectedTextRows.filter((row) => {
        const normalized = row.text.toLocaleLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu, '');
        return tokens.every((token) => normalized.includes(token));
      });
      photoResults.push({
        configuration: config.name,
        code: sample.photo.code,
        file: sample.photo.file,
        role: sample.role,
        expectedBrandObserved: tokens.every((token) => normalizedLines.join(' ').includes(token)),
        lineLevelExpectedBrandMatch: matchingRows.length > 0,
        matchingLineConfidence: matchingRows.length ? Number(Math.max(...matchingRows.map((row) => row.confidence)).toFixed(4)) : null,
        modelLoadMs: result.modelLoadMs,
        detectorMs: result.detector.inferenceMs,
        detectorActivated: result.detector.activated,
        detectedBands: result.endToEnd.detectedBands,
        recognizedRows: result.endToEnd.recognizedRows,
        rowRecognizerMs: result.endToEnd.rowRecognizerMs,
        pageErrors: result.pageErrors.length,
      });
      continue;
    }
    const packageData: PackageData = parseLabel(rawText, { origin: 'ocr', side: 'extra' });
    const outcomes = { correct: 0, incorrect: 0, omitted: 0, withheld: 0 };
    for (const expected of sample.photo.manualAnnotation!.nutrients) {
      const basis = sample.photo.manualAnnotation!.basis;
      const candidates = packageData.nutrients.filter((row) => row.key === expected.key && row.basis?.amount === basis.amount && row.basis?.unit === basis.unit);
      if (candidates.some((row) => row.status === 'conflict')) outcomes.withheld++;
      else if (!candidates.length) outcomes[packageData.nutrients.some((row) => row.key === expected.key) ? 'withheld' : 'omitted']++;
      else outcomes[candidates.some((row) => Math.abs(normalize(expected.key, row.value, row.unit) - normalize(expected.key, expected.value, expected.unit)) <= Math.max(.015, Math.abs(normalize(expected.key, expected.value, expected.unit)) * .005)) ? 'correct' : 'incorrect']++;
    }
    photoResults.push({
      configuration: config.name,
      code: sample.photo.code, file: sample.photo.file, fields: sample.photo.manualAnnotation!.nutrients.length, ...outcomes,
      parsedNutrients: packageData.nutrients.length, explicitBasisNutrients: packageData.nutrients.filter((row) => row.basis).length,
      modelLoadMs: result.modelLoadMs, detectorMs: result.detector.inferenceMs, detectorActivated: result.detector.activated,
      detectedBands: result.endToEnd.detectedBands, recognizedRows: result.endToEnd.recognizedRows, rowRecognizerMs: result.endToEnd.rowRecognizerMs,
      targetRowFound: result.recognizer.targetRowFound, targetRowConfidence: result.recognizer.targetRowConfidence, targetRowMs: result.recognizer.targetRowInferenceMs,
      pageErrors: result.pageErrors.length,
    });
  }
  const configurationResults = configurations.map((config) => {
    const selected = photoResults.filter((result) => result.configuration === config.name);
    if (scope === 'name-photos') return {
      configuration: config,
      expectedBrandsObserved: selected.filter((result) => result.expectedBrandObserved).length,
      lineLevelBrandMatches: selected.filter((result) => result.lineLevelExpectedBrandMatch).length,
      photos: selected,
    };
    const totals = { correct: 0, incorrect: 0, omitted: 0, withheld: 0 };
    for (const result of selected) for (const key of Object.keys(totals) as Array<keyof typeof totals>) totals[key] += Number(result[key]);
    return { configuration: config, ...totals, expectedFields: selected.reduce((sum, result) => sum + Number(result.fields), 0), photos: selected };
  });
  const output = {
    schemaVersion: 1,
    kind: scope === 'name-photos' ? 'browser-local-pp-ocrv6-name-retention-probe' : scope === 'full-photo' ? 'browser-local-pp-ocrv6-full-photo-evaluation' : 'browser-local-pp-ocrv6-row-extraction-sweep',
    generatedAt: new Date().toISOString(),
    source: `Chrome headless, local-loopback-only asset server, ${samples.length} public hash-verified benchmark ${scope === 'full-photo' ? 'full photos' : scope === 'name-photos' ? 'front and nutrition-panel photos' : 'selected crops'}; text is reduced to field-match totals and no OCR string is persisted.`,
    models: { type: modelType, detector: { file: `PP-OCRv6_det_${modelType}.onnx`, bytes: assets.get('/models/det.onnx')!.body.length }, recognizer: { file: `PP-OCRv6_rec_${modelType}.onnx`, bytes: assets.get('/models/rec.onnx')!.body.length } },
    runtimeAssets: runtimeSizes,
    crops: samples.map((sample) => ({ code: sample.photo.code, file: sample.photo.file, panel: sample.panelLabel, manuallySelectedRecognizerRow: Boolean(sample.targetRowPath) })),
    configurations: configurationResults,
    limitations: [
      'The browser diagnostic uses vertical-projection and threshold-connected-component approximations; neither is the full RapidOCR DB contour/box post-processor with polygon scoring and unclip.',
      scope === 'name-photos' ? 'Five selected public package photographs and brand-token matches are not a held-out identity benchmark.' : scope === 'full-photo' ? 'Five selected public package photographs are a small convenience sample, not a held-out or population accuracy estimate.' : 'Two manually selected nutrition-panel crops from English labels are not representative. The separately selected Saffola row validates the recognizer input path, not automatic panel selection.',
      'Model assets were served from local disk through an ephemeral loopback server. No image or OCR text left the machine.',
      'The probe is not general OCR validation or a production decision.',
    ],
  };
  const outputPath = scope === 'name-photos' ? `docs/evidence/rapidocr-browser-name-retention-${modelType}.json` : scope === 'full-photo' ? 'docs/evidence/rapidocr-browser-full-photo-evaluation.json' : modelType === 'tiny' ? 'docs/evidence/rapidocr-browser-runtime-sweep.json' : 'docs/evidence/rapidocr-browser-runtime-small-sweep.json';
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({ output: outputPath, modelBytes: output.models.detector.bytes + output.models.recognizer.bytes, configurations: configurationResults.map((entry) => ({ configuration: entry.configuration.name, ...(scope === 'name-photos' ? { expectedBrandsObserved: entry.expectedBrandsObserved, lineLevelBrandMatches: entry.lineLevelBrandMatches } : { correct: entry.correct, incorrect: entry.incorrect, omitted: entry.omitted, withheld: entry.withheld, expectedFields: entry.expectedFields, rows: entry.photos.map((photo) => photo.recognizedRows) }) })) }, null, 2));
  if (photoResults.some((result) => !result.detectorActivated || Number(result.pageErrors) > 0) || (scope !== 'name-photos' && !photoResults.some((result) => result.targetRowFound === true))) process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
