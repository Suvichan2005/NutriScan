import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import path from 'node:path';

const root = process.cwd();
const entry = `
import { detectRetailBarcodes } from ${JSON.stringify(path.join(root, 'src/lib/barcode.ts'))};
declare global { interface Window { runNutriScanBarcodeFallback: () => Promise<{ expected: string[]; detected: string[][]; nativeBarcodeDetector: string }> } }
window.runNutriScanBarcodeFallback = async () => {
  const expected = ['4006381333931', '96385074', '036000291452'];
  const left = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
  const odd = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
  const right = ['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100'];
  const parity = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'];
  const detected: string[][] = [];
  for (const code of expected) {
    let bits = '101';
    if (code.length === 13) {
      for (let i = 1; i <= 6; i++) bits += (parity[Number(code[0])][i - 1] === 'L' ? left : odd)[Number(code[i])];
      bits += '01010';
      for (let i = 7; i < 13; i++) bits += right[Number(code[i])];
    } else if (code.length === 12) {
      for (let i = 0; i < 6; i++) bits += left[Number(code[i])];
      bits += '01010';
      for (let i = 6; i < 12; i++) bits += right[Number(code[i])];
    } else {
      for (let i = 0; i < 4; i++) bits += left[Number(code[i])];
      bits += '01010';
      for (let i = 4; i < 8; i++) bits += right[Number(code[i])];
    }
    bits += '101';
    const canvas = document.createElement('canvas');
    const moduleWidth = 4, quiet = 12;
    canvas.width = (bits.length + quiet * 2) * moduleWidth; canvas.height = 220;
    const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas 2D context unavailable.');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#000';
    for (let x = 0; x < bits.length; x++) if (bits[x] === '1') context.fillRect((x + quiet) * moduleWidth, 0, moduleWidth, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not create barcode image.')), 'image/png'));
    detected.push(await detectRetailBarcodes(blob));
  }
  return { expected, detected, nativeBarcodeDetector: typeof (window as Window & { BarcodeDetector?: unknown }).BarcodeDetector };
};`;
const bundled = await build({
  stdin: { contents: entry, resolveDir: root, sourcefile: 'barcode-fallback-probe.ts', loader: 'ts' },
  bundle: true, platform: 'browser', format: 'iife', write: false, legalComments: 'none',
});
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.goto('about:blank');
  await page.addScriptTag({ content: bundled.outputFiles[0].text });
  const result = await page.evaluate(() => window.runNutriScanBarcodeFallback());
  console.log(JSON.stringify(result, null, 2));
  if (result.nativeBarcodeDetector !== 'undefined' || result.expected.some((code, index) => !result.detected[index]?.includes(code))) process.exitCode = 1;
} finally {
  await browser.close();
}
