import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = process.env.NUTRISCAN_BASE_URL ?? 'http://127.0.0.1:3400';
const barcode = '5449000000996';
const origin = new URL(baseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) throw new Error('This acceptance run only permits a loopback app URL.');
if (!(await fetch(baseUrl, { signal: AbortSignal.timeout(5000) })).ok) throw new Error('NutriScan is not responding.');

const captureDir = path.resolve('docs/evidence/private/openfoodfacts-liquid-basis');
await mkdir(captureDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const outcomes: Array<Record<string, unknown>> = [];
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    const productRouteStatuses: number[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('response', response => { if (new URL(response.url()).pathname === '/api/products') productRouteStatuses.push(response.status()); });

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.getByLabel('What would you like to find out?').fill('Check the public catalog basis for this test.');
    await page.getByLabel('Product name or details (optional with photos)').fill('Catalog integration check only; no package values supplied.');
    await page.getByRole('button', { name: 'Ask about these details' }).click();
    await page.locator('.results-section').waitFor({ state: 'visible', timeout: 20_000 });
    const packageTitle = (await page.locator('.results-section h2').innerText()).trim();
    const catalogDidNotChangePackageTitle = !/Coca-Cola Original/i.test(packageTitle);

    await page.getByLabel('Public search terms').fill(barcode);
    await page.getByRole('button', { name: 'Find product' }).click();
    const result = page.locator('.product-result').filter({ hasText: 'Coca-Cola Original' });
    await result.waitFor({ state: 'visible', timeout: 30_000 });
    const warning = await result.locator('small.fine-print').allTextContents();
    const basisWarningVisible = warning.some(text => /basis was inferred from the volume unit and beverage category/i.test(text));
    await result.getByRole('button', { name: 'Compare with this label' }).click();
    const comparison = page.locator('.comparison');
    await comparison.waitFor({ state: 'visible' });
    const sugarsRow = comparison.locator('tbody tr').filter({ hasText: 'Total sugars' });
    const sugarsCells = await sugarsRow.locator('td').allTextContents();
    const sourcePer100ml = sugarsCells[1]?.includes('10.6 g / 100 ml') ?? false;
    const packageReadingRemainsMissing = sugarsCells[0]?.includes('No matching package reading') ?? false;
    const comparisonNotPromoted = sugarsCells[2]?.includes('No matching package value') ?? false;
    const axeViolationIds = (await new AxeBuilder({ page }).include('.research-section').analyze()).violations.map(item => item.id).sort();
    const screenshot = `docs/evidence/private/openfoodfacts-liquid-basis/${viewport.width === 390 ? 'mobile' : 'desktop'}.png`;
    await page.locator('.research-section').screenshot({ path: path.resolve(screenshot) });

    outcomes.push({
      viewport: `${viewport.width}x${viewport.height}`,
      catalogDidNotChangePackageTitle,
      queryWasPublicBarcodeOnly: true,
      productRouteStatuses,
      matchedCommunityRecord: true,
      basisWarningVisible,
      communitySugarValueShownPer100ml: sourcePer100ml,
      packageValueStillMissing: packageReadingRemainsMissing,
      differenceWithheldWithoutPackageValue: comparisonNotPromoted,
      axeViolationIds,
      pageErrors,
      screenshot,
    });
    await context.close();
  }

  const receipt = { schemaVersion: 1, kind: 'off-liquid-basis-browser-acceptance', generatedAt: new Date().toISOString(), captureTool: 'Playwright using installed Chrome', origin: 'loopback', publicBarcode: barcode, screenshots: 'docs/evidence/private/openfoodfacts-liquid-basis', outcomes, limitations: ['The app input contained no label values; the comparison deliberately withholds the difference.', 'This verifies the live catalog route and responsive disclosure, not package identity or regional formulation.', 'Product data is community reported; current stock is unverified.'] };
  await writeFile('docs/evidence/openfoodfacts-liquid-basis-browser.json', `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ receipt: 'docs/evidence/openfoodfacts-liquid-basis-browser.json', outcomes }, null, 2));
  if (outcomes.length !== 2 || outcomes.some(item => !item.catalogDidNotChangePackageTitle || !item.matchedCommunityRecord || !item.basisWarningVisible || !item.communitySugarValueShownPer100ml || !item.differenceWithheldWithoutPackageValue || (item.productRouteStatuses as number[]).at(-1) !== 200 || (item.axeViolationIds as string[]).length || (item.pageErrors as string[]).length)) process.exitCode = 1;
} finally {
  await browser.close();
}
