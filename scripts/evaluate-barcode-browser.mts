import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = process.env.NUTRISCAN_BASE_URL ?? 'http://127.0.0.1:3400';
const file = process.argv[2] ?? 'saffola-veggie-oats-nutrition-off-8901088068758.jpg';
const manifest = JSON.parse(await readFile('data/semantic-photo-manifest.json', 'utf8')) as { records: { file: string; code: string; hash: string }[] };
const record = manifest.records.find((item) => item.file === file);
if (!record) throw new Error(`No barcode evaluation record exists for ${file}.`);
const photoPath = path.join('docs/evidence/private', record.file);
const photo = await readFile(photoPath);
if (createHash('sha256').update(photo).digest('hex') !== record.hash.toLowerCase()) throw new Error('Photo hash does not match its manifest record.');
const origin = new URL(baseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) throw new Error('Barcode evaluation only accepts a loopback origin.');
const response = await fetch(baseUrl, { signal: AbortSignal.timeout(5000) });
if (!response.ok) throw new Error(`NutriScan is unavailable: HTTP ${response.status}.`);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  const nativeBarcodeDetector = await page.evaluate(() => typeof (window as Window & { BarcodeDetector?: unknown }).BarcodeDetector);
  const intakeHint = 'Up to 10 photos · JPG, PNG or WebP · 12 MB each · local barcode and text reading';
  const responsiveIntake = [];
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    responsiveIntake.push({ viewport: `${viewport.width}x${viewport.height}`, hintVisible: await page.getByText(intakeHint, { exact: true }).isVisible() });
  }
  await page.getByLabel('Add one or more product photos').setInputFiles(photoPath);
  await page.getByRole('button', { name: /Read these photos/ }).click();
  await page.locator('.results-section').waitFor({ state: 'visible', timeout: 120_000 });
  const lookup = await page.locator('.research-controls input').inputValue();
  const report = {
    nativeBarcodeDetector,
    sourceFile: record.file,
    manifestBarcode: record.code,
    decodedBarcodeUsedForLookup: lookup === record.code,
    status: lookup === record.code ? 'manifest barcode selected' : /^\d{8,14}$/.test(lookup) ? 'different barcode selected; investigate' : 'no barcode decoded; photo may not show one',
    intakeHintVisibleAt: responsiveIntake,
    lookupValue: lookup,
    heading: await page.locator('#result-heading').textContent(),
  };
  console.log(JSON.stringify(report, null, 2));
  if (!responsiveIntake.every((item) => item.hintVisible) || (/^\d{8,14}$/.test(lookup) && !report.decodedBarcodeUsedForLookup)) process.exitCode = 1;
} finally {
  await browser.close();
}
