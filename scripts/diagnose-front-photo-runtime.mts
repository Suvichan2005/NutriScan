import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = process.env.NUTRISCAN_BASE_URL ?? 'http://127.0.0.1:3400';
const file = 'coca-cola-front-off-5449000000996.jpg';
const manifest = JSON.parse(await readFile('data/semantic-photo-manifest.json', 'utf8')) as { records: Array<{ file: string; hash: string }> };
const record = manifest.records.find((item) => item.file === file);
if (!record) throw new Error('Front-photo manifest record is missing.');
const photoPath = path.join('docs/evidence/private', file);
const photo = await readFile(photoPath);
if (createHash('sha256').update(photo).digest('hex') !== record.hash) throw new Error('Front-photo hash mismatch.');
const origin = new URL(baseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) throw new Error('Runtime diagnosis accepts loopback only.');
if (!(await fetch(baseUrl, { signal: AbortSignal.timeout(5000) })).ok) throw new Error('Local app is unavailable.');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let pageErrors = 0;
  const assetResponses: Array<{ asset: string; status: number }> = [];
  const failedAssetRequests: string[] = [];
  page.on('pageerror', () => { pageErrors += 1; });
  page.on('response', (response) => {
    const requestUrl = new URL(response.url());
    if (requestUrl.pathname.startsWith('/ocr/')) assetResponses.push({ asset: requestUrl.pathname.split('/').at(-1) ?? 'unknown', status: response.status() });
  });
  page.on('requestfailed', (request) => {
    if (new URL(request.url()).pathname.startsWith('/ocr/')) failedAssetRequests.push(new URL(request.url()).pathname.split('/').at(-1) ?? 'unknown');
  });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByLabel('Add one or more product photos').setInputFiles(photoPath);
  await page.getByRole('button', { name: /Read these photos/ }).click();
  await page.locator('.scan-progress').waitFor({ state: 'visible', timeout: 5000 });
  const samples: Array<{ elapsedSeconds: number; stage: string; progress: number }> = [];
  for (const elapsedSeconds of [5, 15, 30]) {
    await page.waitForTimeout((elapsedSeconds - (samples.at(-1)?.elapsedSeconds ?? 0)) * 1000);
    const progress = page.locator('.scan-progress');
    const sample = await progress.isVisible().catch(() => false)
      ? await progress.evaluate((node) => ({ stage: node.querySelector('div span')?.textContent?.trim() ?? 'unknown', progress: Number((node.querySelector('progress') as HTMLProgressElement | null)?.value ?? 0) }))
      : { stage: 'not processing', progress: 0 };
    samples.push({ elapsedSeconds, ...sample });
    if (await page.locator('.results-section').isVisible().catch(() => false) || await page.locator('.notice.error').isVisible().catch(() => false)) break;
  }
  const resultsVisible = await page.locator('.results-section').isVisible().catch(() => false);
  const errorVisible = await page.locator('.notice.error').isVisible().catch(() => false);
  const errorMessage = errorVisible ? (await page.locator('.notice.error').innerText()).slice(0, 200) : null;
  await page.close();

  const detailsPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let detailsPageErrors = 0;
  detailsPage.on('pageerror', () => { detailsPageErrors += 1; });
  await detailsPage.goto(baseUrl, { waitUntil: 'networkidle' });
  const suppliedDetails = 'Heinz Baked Beans, details supplied by the user for this test.';
  await detailsPage.getByLabel('Product name or details').fill(suppliedDetails);
  await detailsPage.getByLabel('Add one or more product photos').setInputFiles(photoPath);
  await detailsPage.getByRole('button', { name: /Read these photos/ }).click();
  await detailsPage.locator('.results-section').waitFor({ state: 'visible', timeout: 30_000 });
  const userDetailsFinding = detailsPage.locator('.finding').filter({ hasText: 'User-provided product details' });
  const userDetailsJourney = {
    suppliedDetailsAccepted: await userDetailsFinding.isVisible(),
    detailsRemainExplicitlyUnverified: /not been verified/i.test(await userDetailsFinding.innerText().catch(() => '')),
    packageTitleStillUnidentified: (await detailsPage.locator('.results-section h2').innerText()).trim() === 'Unidentified package',
    photoStillAttached: await detailsPage.locator('.image-item img.package-photo').count() === 1,
    pageErrors: detailsPageErrors,
  };
  await writeFile('docs/evidence/front-photo-runtime-diagnostic.json', `${JSON.stringify({
    schemaVersion: 1,
    kind: 'front-photo-browser-runtime-diagnostic',
    generatedAt: new Date().toISOString(),
    captureTool: 'Chrome via Playwright',
    origin: 'loopback',
    sourceFile: file,
    hashVerified: true,
    samples,
    assetResponses,
    failedAssetRequests,
    resultsVisible,
    errorVisible,
    errorMessage,
    pageErrors,
    userDetailsJourney,
    limits: ['One public source photo and one browser session.', 'Stores stage labels and progress only; no OCR text, image bytes, or user data.'],
  }, null, 2)}\n`);
  console.log(JSON.stringify({ result: 'docs/evidence/front-photo-runtime-diagnostic.json', hashVerified: true, samples, assetResponses, failedAssetRequests, resultsVisible, errorVisible, errorMessage, pageErrors, userDetailsJourney }, null, 2));
  if ((!resultsVisible && !errorVisible) || !userDetailsJourney.suppliedDetailsAccepted || !userDetailsJourney.detailsRemainExplicitlyUnverified || !userDetailsJourney.packageTitleStillUnidentified || !userDetailsJourney.photoStillAttached || userDetailsJourney.pageErrors) process.exitCode = 2;
} finally {
  await browser.close();
}
