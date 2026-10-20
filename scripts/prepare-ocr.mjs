import { mkdir, copyFile, readdir } from 'node:fs/promises';
const dest = 'public/ocr';
await mkdir(dest, {recursive:true});
await copyFile('node_modules/tesseract.js/dist/worker.min.js', `${dest}/worker.min.js`);
for (const name of await readdir('node_modules/tesseract.js-core')) {
 if (name.endsWith('.wasm') || name.endsWith('.wasm.js')) await copyFile(`node_modules/tesseract.js-core/${name}`, `${dest}/${name}`);
}
await copyFile('node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', `${dest}/eng.traineddata.gz`);
console.log('OCR worker, WASM and English language data copied locally. No external OCR downloads at runtime.');
