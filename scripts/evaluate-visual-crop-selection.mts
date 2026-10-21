import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = process.env.NUTRISCAN_BASE_URL ?? 'http://127.0.0.1:3416';
const photoName = 'saffola-veggie-oats-nutrition-off-8901088068758.jpg';
const manifest = JSON.parse(await readFile('data/semantic-photo-manifest.json', 'utf8')) as { records: { file: string; hash: string }[] };
const record = manifest.records.find((item) => item.file === photoName);
if (!record) throw new Error(`Missing photo record: ${photoName}`);
const photoPath = path.join('docs/evidence/private', photoName);
if (createHash('sha256').update(await readFile(photoPath)).digest('hex') !== record.hash.toLowerCase()) throw new Error('Photo hash does not match its manifest entry.');
const origin = new URL(baseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) throw new Error('Crop evaluation only accepts a loopback origin.');
const health = await fetch(baseUrl, { signal: AbortSignal.timeout(5000) });
if (!health.ok) throw new Error(`NutriScan is unavailable: HTTP ${health.status}.`);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.getByLabel('Add one or more product photos').setInputFiles(photoPath);
    await page.getByText('Focus OCR on one photo region').click();
    await page.getByLabel('Use a crop on a selected photo').check();
    await page.getByLabel('Photo to crop').selectOption({ index: 1 });
    const selector = page.locator('.crop-preview');
    await selector.waitFor({ state: 'visible' });
    const bounds = await selector.boundingBox();
    if (!bounds) throw new Error(`Crop selector has no rendered bounds at ${viewport.width}px.`);
    await page.mouse.move(bounds.x + bounds.width * 0.2, bounds.y + bounds.height * 0.25);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.75, { steps: 8 });
    await page.mouse.up();
    const percentages = await page.locator('.crop-fields input').evaluateAll((inputs) => inputs.map((input) => Number((input as HTMLInputElement).value)));
    const selection = await selector.locator('span').evaluate((node) => ({ left: parseFloat((node as HTMLElement).style.left), top: parseFloat((node as HTMLElement).style.top), width: parseFloat((node as HTMLElement).style.width), height: parseFloat((node as HTMLElement).style.height) }));
    await page.getByLabel('x', { exact: true }).fill('22');
    await page.waitForFunction(() => parseFloat(document.querySelector('.crop-preview>span')?.getAttribute('style')?.match(/left:\s*([\d.]+)%/)?.[1] ?? '0') === 22);
    const keyboardAdjustedX = await selector.locator('span').evaluate((node) => parseFloat((node as HTMLElement).style.left));
    await page.getByLabel('x', { exact: true }).fill('20');
    await page.waitForFunction(() => parseFloat(document.querySelector('.crop-preview>span')?.getAttribute('style')?.match(/left:\s*([\d.]+)%/)?.[1] ?? '0') === 20);
    const axeViolationIds = (await new AxeBuilder({ page }).analyze()).violations.map((violation) => violation.id).sort();
    const screenshot = path.join('docs/evidence/private', `visual-crop-selector-${viewport.width}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    const result = {
      viewport: `${viewport.width}x${viewport.height}`,
      imageRendered: await selector.locator('img').evaluate((img) => (img as HTMLImageElement).naturalWidth > 0),
      percentageFields: percentages,
      selectionOverlay: selection,
      keyboardAdjustedX,
      axeViolationIds,
      screenshot,
      pageErrors: errors,
    };
    console.log(JSON.stringify(result));
    if (!result.imageRendered || errors.length || axeViolationIds.length || keyboardAdjustedX !== 22 || percentages.some((value, index) => Math.abs(value - [20, 25, 50, 50][index]) > 2)) process.exitCode = 1;
    await context.close();
  }
} finally {
  await browser.close();
}
