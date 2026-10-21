import fs from 'node:fs/promises';
import sharp from 'sharp';
import { pipeline, RawImage } from '@huggingface/transformers';

const imagePath = 'docs/evidence/private/saffola-veggie-oats-nutrition-off-8901088068758.jpg';
const imageBytes = await fs.readFile(imagePath);
const metadata = await sharp(imageBytes).metadata();
if (!metadata.width || !metadata.height) throw new Error('Missing image dimensions.');

// TrOCR is a line recognizer. Test both the full nutrition panel and selected
// table-row strips locally; never print or persist recognized text.
const width = metadata.width;
const height = metadata.height;
const panel = await sharp(imageBytes).rotate().extract({
  left: Math.floor(width * 0.12), top: Math.floor(height * 0.05),
  width: Math.floor(width * 0.78), height: Math.floor(height * 0.94),
}).resize({ width: 1200 }).jpeg({ quality: 95 }).toBuffer();
const panelMeta = await sharp(panel).metadata();
const recognizer = await pipeline('image-to-text', 'Xenova/trocr-small-printed', { dtype: 'q8' });
const panelHeight = panelMeta.height ?? 1;
const panelWidth = panelMeta.width ?? 1;
const rowCenters = [.14, .20, .26, .32, .38, .46, .52, .59, .65, .71, .78, .84, .92];
const expectedRows = [
  ['energy', '376'], ['protein', '8.8'], ['carbohyd', '69.2'], ['total sugar', '5.1'],
  ['added sugar', '3.6'], ['dietary fibre', '12.4'], ['soluble', '5.0'],
  ['insoluble', '7.4'], ['total fat', '9.9'], ['saturated fat', '3.4'],
  ['trans fat', '0.1'], ['cholesterol', '0'], ['sodium', '2283'],
];
const labelRecognized: boolean[] = [];
const valueRecognized: boolean[] = [];
const textCharacters: number[] = [];
const started = Date.now();
for (const [index, center] of rowCenters.entries()) {
  const rowHeight = Math.max(1, Math.floor(panelHeight * 0.06));
  const top = Math.min(panelHeight - rowHeight, Math.max(0, Math.floor(panelHeight * center - rowHeight / 2)));
  const labelBytes = await sharp(panel).extract({ left: 0, top, width: Math.floor(panelWidth * 0.61), height: rowHeight }).resize({ width: 900 }).jpeg({ quality: 95 }).toBuffer();
  const valueBytes = await sharp(panel).extract({ left: Math.floor(panelWidth * 0.80), top, width: Math.floor(panelWidth * 0.20), height: rowHeight }).resize({ width: 480 }).jpeg({ quality: 95 }).toBuffer();
  const labelRaw = await RawImage.fromBlob(new Blob([labelBytes]));
  const valueRaw = await RawImage.fromBlob(new Blob([valueBytes]));
  const [labelResult, valueResult] = await Promise.all([
    recognizer(labelRaw, { max_new_tokens: 48 }),
    recognizer(valueRaw, { max_new_tokens: 24 }),
  ]);
  const labelText = (Array.isArray(labelResult) ? labelResult[0]?.generated_text ?? '' : '').toLowerCase().replace(/\s+/g, ' ');
  const valueText = (Array.isArray(valueResult) ? valueResult[0]?.generated_text ?? '' : '').toLowerCase().replace(/\s+/g, ' ');
  const [label, value] = expectedRows[index];
  labelRecognized.push(labelText.includes(label));
  const numericToken = new RegExp(`(^|\\D)${value.replace('.', '\\.')}($|\\D)`);
  valueRecognized.push(numericToken.test(valueText));
  textCharacters.push(labelText.length + valueText.length);
}
await recognizer.dispose?.();
const completeRows = labelRecognized.filter((matched, index) => matched && valueRecognized[index]).length;
console.log(JSON.stringify({ model: 'Xenova/trocr-small-printed', dtype: 'q8', inputKind: 'separate label/value cell crops from 13 manually bounded rows', rows: rowCenters.length, labelsRecognized: labelRecognized.filter(Boolean).length, valuesRecognized: valueRecognized.filter(Boolean).length, completeLabelAndValueRows: completeRows, emittedCharacters: textCharacters.reduce((sum, count) => sum + count, 0), elapsedMs: Date.now() - started, ocrTextPersisted: false, limitation: 'One English photograph with manually selected row bounds; no automatic detection or package-level parsing.' }));
