import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const baseUrl = process.env.NUTRISCAN_BASE_URL ?? 'http://127.0.0.1:3400';
const photoDirectory = path.join(root, 'docs/evidence/private');
const resultPath = path.join(root, 'docs/evidence/ocr-name-retention.json');
const expected = [
  { file: 'coca-cola-front-off-5449000000996.jpg', tokens: ['coca', 'cola'], hint: 'unknown' },
  { file: 'nutella-label-off-3017620422003.jpg', tokens: ['nutella'], hint: 'unknown' },
  { file: 'heinz-beans-front-off-5000157024671.jpg', tokens: ['heinz'], hint: 'unknown' },
  { file: 'saffola-veggie-oats-nutrition-off-8901088068758.jpg', tokens: ['saffola'], hint: 'nutrition' },
  { file: 'bagrrys-white-oats-nutrition-off-8902710100150.jpg', tokens: ['bagrrys'], hint: 'nutrition' },
];
const manifest = JSON.parse(await readFile(path.join(root, 'data/semantic-photo-manifest.json'), 'utf8')) as {
  records: Array<{ file: string; hash: string }>;
};
const url = new URL(baseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('OCR name evaluation accepts loopback origins only.');
if (!(await fetch(baseUrl, { signal: AbortSignal.timeout(5000) })).ok) throw new Error('Local application is unavailable.');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results: Array<{ file: string; hint: string; hashVerified: boolean; outcome: 'name-matched'|'name-mismatch'|'unidentified'|'low-text-guard'; expectedBrandObserved: boolean|null; nameConfidence: number | null; pageErrors: number }> = [];
try {
  for (const item of expected) {
    const record = manifest.records.find((candidate) => candidate.file === item.file);
    if (!record) throw new Error('A benchmark photo is missing from the manifest.');
    const photoPath = path.join(photoDirectory, record.file);
    const bytes = await readFile(photoPath);
    const hashVerified = createHash('sha256').update(bytes).digest('hex') === record.hash.toLowerCase();
    if (!hashVerified) throw new Error(`Source hash mismatch for ${record.file}.`);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    let pageErrors = 0;
    page.on('pageerror', () => { pageErrors += 1; });
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.getByLabel('Add one or more product photos').setInputFiles(photoPath);
    if (item.hint === 'nutrition') await page.getByLabel('Optional photo hint').selectOption('nutrition');
    await page.getByRole('button', { name: /Read these photos/ }).click();
    const completed = await Promise.race([
      page.locator('.results-section').waitFor({ state: 'visible', timeout: 120_000 }).then(() => 'results' as const),
      page.locator('.notice.error').waitFor({ state: 'visible', timeout: 120_000 }).then(() => 'guard' as const),
    ]);
    let outcome: 'name-matched'|'name-mismatch'|'unidentified'|'low-text-guard' = 'low-text-guard';
    let nameConfidence: number | null = null;
    const expectedBrandObserved = completed === 'results' ? await page.locator('.observations-list p').evaluateAll((nodes, tokens) => {
      return nodes.some((node) => tokens.some((token) => (node.textContent ?? '').toLocaleLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu, '').includes(token)));
    }, item.tokens) : null;
    if (completed === 'results') {
      const actualName = (await page.locator('.results-section h2').innerText()).trim();
      nameConfidence = await page.locator('.observations-list p').evaluateAll((nodes, title) => {
        const match = nodes.find((node) => node.textContent?.includes(title));
        const score = match?.querySelector('span')?.textContent?.match(/(\d+)%/)?.[1];
        return score ? Number(score) : null;
      }, actualName);
      const normalizedName = actualName.toLocaleLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu, '');
      outcome = actualName === 'Unidentified package' ? 'unidentified' : item.tokens.some((token) => normalizedName.includes(token)) ? 'name-matched' : 'name-mismatch';
    }
    results.push({ file: item.file, hint: item.hint, hashVerified, outcome, expectedBrandObserved, nameConfidence, pageErrors });
    await context.close();
  }
} finally {
  await browser.close();
}
const receipt = {
  schemaVersion: 1,
  kind: 'browser-ocr-name-retention-benchmark',
  generatedAt: new Date().toISOString(),
  captureTool: 'Chrome via Playwright',
  origin: 'loopback',
  photos: results.length,
  nameSelected: results.filter((item) => item.outcome === 'name-matched' || item.outcome === 'name-mismatch').length,
  namesMatchingExpectedProduct: results.filter((item) => item.outcome === 'name-matched').length,
  falseOrUnverifiedNames: results.filter((item) => item.outcome === 'name-mismatch').length,
  namesWithheld: results.filter((item) => item.outcome === 'unidentified').length,
  lowTextGuarded: results.filter((item) => item.outcome === 'low-text-guard').length,
  pageErrors: results.reduce((total, item) => total + item.pageErrors, 0),
  results,
  limitations: ['Small curated benchmark, not a population accuracy estimate.', 'Expected names are checked by brand token only across mixed front and nutrition-panel photos.', 'No OCR text, image bytes, or user data are stored in this receipt.'],
};
await writeFile(resultPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ result: path.relative(root, resultPath), photos: receipt.photos, nameSelected: receipt.nameSelected, namesMatchingExpectedProduct: receipt.namesMatchingExpectedProduct, falseOrUnverifiedNames: receipt.falseOrUnverifiedNames, namesWithheld: receipt.namesWithheld, lowTextGuarded: receipt.lowTextGuarded, pageErrors: receipt.pageErrors, results }, null, 2));
if (results.length !== expected.length || results.some((item) => !item.hashVerified || item.pageErrors)) process.exitCode = 1;
