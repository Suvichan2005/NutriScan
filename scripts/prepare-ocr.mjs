import { mkdir, copyFile, readdir, access } from 'node:fs/promises';
const dest = 'public/ocr';
await mkdir(dest, {recursive:true});
await copyFile('node_modules/tesseract.js/dist/worker.min.js', `${dest}/worker.min.js`);
for (const name of await readdir('node_modules/tesseract.js-core')) {
 if (name.endsWith('.wasm') || name.endsWith('.wasm.js')) await copyFile(`node_modules/tesseract.js-core/${name}`, `${dest}/${name}`);
}
await copyFile('node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', `${dest}/eng.traineddata.gz`);
const paddleRuntimeCandidates = [
 'node_modules/@paddleocr/paddleocr-js/node_modules/onnxruntime-web/dist',
 'node_modules/onnxruntime-web/dist'
];
let paddleRuntime;
for (const candidate of paddleRuntimeCandidates) {
 try { await access(`${candidate}/ort-wasm-simd-threaded.jsep.wasm`); paddleRuntime = candidate; break; } catch {}
}
if (!paddleRuntime) throw new Error('Could not locate PaddleOCR.js ONNX Runtime Web assets.');
const paddleRuntimeDir = `${dest}/ort`;
await mkdir(paddleRuntimeDir, {recursive:true});
for (const name of [
 'ort-wasm-simd-threaded.jsep.mjs',
 'ort-wasm-simd-threaded.jsep.wasm',
 'ort-wasm-simd-threaded.mjs',
 'ort-wasm-simd-threaded.wasm'
]) await copyFile(`${paddleRuntime}/${name}`, `${paddleRuntimeDir}/${name}`);
console.log('Local Tesseract and Paddle ONNX runtime assets copied. PP-OCRv5 model weights are fetched on first fallback use; package images stay in the browser.');
