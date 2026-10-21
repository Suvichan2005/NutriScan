import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = process.env.NUTRISCAN_BASE_URL ?? 'http://127.0.0.1:3415';
const manifest = JSON.parse(await readFile('data/semantic-photo-manifest.json', 'utf8')) as { records: { file: string; hash: string }[] };
const photos = ['saffola-veggie-oats-nutrition-off-8901088068758.jpg', 'bagrrys-white-oats-nutrition-off-8902710100150.jpg'];
for (const filename of photos) {
  const record = manifest.records.find((item) => item.file === filename);
  if (!record) throw new Error(`Missing manifest record: ${filename}`);
  const bytes = await readFile(path.join('docs/evidence/private', filename));
  if (createHash('sha256').update(bytes).digest('hex') !== record.hash.toLowerCase()) throw new Error(`Photo hash mismatch: ${filename}`);
}
const origin = new URL(baseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) throw new Error('Intake evaluation only accepts a loopback origin.');
const response = await fetch(baseUrl, { signal: AbortSignal.timeout(5000) });
if (!response.ok) throw new Error(`NutriScan is unavailable: HTTP ${response.status}.`);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const outcomes = [];
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const page = await browser.newPage({ viewport });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.getByLabel('What would you like to find out?').fill('What can you read from this package?');
    await page.getByLabel('Add one or more product photos').setInputFiles(path.join('docs/evidence/private', photos[0]));
    await page.getByRole('button', { name: /Read these photos/ }).click();
    await page.locator('.results-section').waitFor({ state: 'visible', timeout: 120_000 });
    const initialOcrObservationCount = await page.locator('.observations-list p').count();
    const initialParsedNutrientCount = await page.locator('.details-block table tbody tr').count();
    const initialCalculatedNutrientCount = await page.locator('.nutrient strong').evaluateAll((nodes) => nodes.filter((node) => (node.textContent ?? '').trim() !== '—').length);
    await page.getByLabel('Ask about this package').fill('What is still uncertain?');
    await page.getByRole('button', { name: 'Send follow-up' }).click();
    await page.locator('.conversation .user-message').filter({ hasText: 'What is still uncertain?' }).waitFor({ state: 'visible', timeout: 20_000 });
    await page.locator('#portion').fill('50');
    await page.getByLabel('Add one or more product photos').setInputFiles(path.join('docs/evidence/private', photos[1]));
    await page.getByRole('button', { name: /Read 1 new or updated photo/ }).click();
    await page.getByText(/Added evidence from 1 photo/).waitFor({ state: 'visible', timeout: 120_000 });
    const userMessages = await page.locator('.conversation .user-message').allTextContents();
    const totalOcrObservationCount = await page.locator('.observations-list p').count();
    const outcome = {
      viewport: `${viewport.width}x${viewport.height}`,
      photosAdded: 2,
      initialOcrObservationCount,
      initialParsedNutrientCount,
      initialCalculatedNutrientCount,
      totalOcrObservationCount,
      genuineImageOcrRan: initialOcrObservationCount > 0,
      portionRetained: await page.locator('#portion').inputValue() === '50',
      initialQuestionRetained: userMessages.filter((message) => message === 'What can you read from this package?').length === 1,
      followupRetained: userMessages.filter((message) => message === 'What is still uncertain?').length === 1,
      addedPhotoNotice: /Added evidence from 1 photo/.test(await page.locator('main').innerText()),
      pageErrors,
    };
    console.log(JSON.stringify(outcome));
    if (!outcome.genuineImageOcrRan || !outcome.portionRetained || !outcome.initialQuestionRetained || !outcome.followupRetained || !outcome.addedPhotoNotice || pageErrors.length) process.exitCode = 1;
    await page.close();
    outcomes.push(outcome);
  }
  const allViewportsPassed = outcomes.length === 2 && outcomes.every((item) => item.genuineImageOcrRan && item.portionRetained && item.initialQuestionRetained && item.followupRetained && item.addedPhotoNotice && item.pageErrors.length === 0);
  const receipt = { schemaVersion: 1, kind: 'incremental-genuine-photo-intake-browser-acceptance', generatedAt: new Date().toISOString(), origin: 'local loopback', photos: ['saffola-veggie-oats-nutrition-off-8901088068758.jpg', 'bagrrys-white-oats-nutrition-off-8902710100150.jpg'], outcomes, allViewportsPassed };
  await writeFile('docs/evidence/incremental-intake-browser.json', `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ output: 'docs/evidence/incremental-intake-browser.json', allViewportsPassed }));
  if (!allViewportsPassed) process.exitCode = 1;
} finally {
  await browser.close();
}
