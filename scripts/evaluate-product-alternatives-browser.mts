import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = process.env.NUTRISCAN_BASE_URL ?? 'http://127.0.0.1:3400';
const fixtureBarcode = '3017620422003';
const origin = new URL(baseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) throw new Error('Product acceptance accepts loopback origins only.');
const response = await fetch(baseUrl, { signal: AbortSignal.timeout(5000) });
if (!response.ok) throw new Error(`NutriScan is unavailable: HTTP ${response.status}.`);

const screenshotDirectory = path.resolve('docs/evidence/private/product-alternatives');
await mkdir(screenshotDirectory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const outcomes: Array<Record<string, unknown>> = [];
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    const requestShapes: Array<Record<string, unknown>> = [];
    const routeStatuses: number[] = [];
    const nonLoopbackRequests: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('request', (request) => {
      const requestUrl = new URL(request.url());
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(requestUrl.hostname)) nonLoopbackRequests.push(requestUrl.origin);
      if (requestUrl.pathname === '/api/products' && request.method() === 'POST') {
        const body = request.postDataJSON() as Record<string, unknown>;
        requestShapes.push({ query: body.query, barcode: body.barcode, alternatives: body.alternatives, excludeBarcode: body.excludeBarcode, country: body.country });
      }
    });
    page.on('response', (routeResponse) => {
      if (new URL(routeResponse.url()).pathname === '/api/products') routeStatuses.push(routeResponse.status());
    });

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    await page.getByRole('button', { name: 'Paste label text' }).click();
    await page.getByRole('textbox', { name: 'Label text' }).fill([
      'Nutella',
      `Barcode: ${fixtureBarcode}`,
      'Ingredients: sugar, palm oil, hazelnuts, cocoa, skimmed milk powder, whey powder, lecithin, vanillin.',
      'Nutrition information per 25 g',
      'Energy 135 kcal',
      'Carbohydrate 14.4 g',
      'Total sugars 14.1 g',
      'Added sugars 13 g',
      'Protein 1.6 g',
      'Total fat 7.7 g',
      'Saturated fat 2.7 g',
      'Dietary fibre 0 g',
      'Sodium 10.7 mg',
    ].join('\n'));
    await page.getByRole('button', { name: 'Read label text' }).click();
    await page.locator('.results-section').waitFor({ state: 'visible' });
    const initialBarcode = await page.getByLabel('Public search terms').inputValue();

    await page.getByRole('button', { name: 'Find product' }).click();
    const exactResult = page.locator('.product-result').filter({ hasText: 'Nutella' }).first();
    await exactResult.waitFor({ state: 'visible', timeout: 30_000 });
    const exactRecordText = await exactResult.innerText();
    const exactLookupNotice = await page.locator('.remote-status').innerText();
    await exactResult.getByRole('button', { name: 'Compare with this label' }).click();
    const comparison = page.locator('section.comparison');
    await comparison.waitFor({ state: 'visible' });
    const comparisonText = await comparison.innerText();
    const nutrientRows = await comparison.locator('tbody tr').evaluateAll((rows) => rows.map((row) => (row.textContent ?? '').replace(/\s+/g, ' ').trim()));
    const comparableRows = nutrientRows.filter((row) => !/Not comparable:/.test(row));
    const missingRows = nutrientRows.filter((row) => /Not comparable:/.test(row));

    await page.getByRole('button', { name: 'Search product candidates' }).click();
    await page.locator('.product-result').first().waitFor({ state: 'visible', timeout: 30_000 });
    const candidateCards = page.locator('.product-result');
    const candidateCount = await candidateCards.count();
    const candidateTexts = await candidateCards.evaluateAll((cards) => cards.map((card) => (card.textContent ?? '').replace(/\s+/g, ' ').trim()));
    const candidate = candidateCards.first();
    await candidate.getByRole('button', { name: 'Compare with this label' }).click();
    await comparison.waitFor({ state: 'visible' });
    const candidateComparison = await comparison.innerText();
    const axe = await new AxeBuilder({ page }).analyze();
    const prefix = viewport.width === 390 ? 'mobile' : 'desktop';
    await page.screenshot({ path: path.join(screenshotDirectory, `${prefix}.png`), fullPage: true });

    const outcome = {
      viewport: `${viewport.width}x${viewport.height}`,
      initialLookupIsPackageBarcode: initialBarcode === fixtureBarcode,
      liveBarcodeRecordVisible: /Nutella/.test(exactRecordText) && requestShapes.some((request) => request.barcode === fixtureBarcode),
      packageRecordRegionalLimitVisible: /Verify regional formulation and label date/.test(exactLookupNotice),
      comparisonBasisNormalizationVisible: /100 g/.test(comparisonText) && comparableRows.length >= 8,
      comparableNutrientRows: comparableRows.length,
      explicitlyNotComparableRows: missingRows.length,
      exactLookupIdentityCaveatVisible: /recorded package barcode agrees with this record; confirm regional formulation, variant, and label date/i.test(comparisonText),
      candidateSearchExcludesCurrentBarcode: requestShapes.some((request) => request.alternatives === true && request.query === 'Nutella' && request.excludeBarcode === fixtureBarcode),
      candidateCount,
      candidateStockAndIdentityCaveatsVisible: candidateTexts.length > 0 && candidateTexts.every((text) => /local stock unverified/.test(text) && /POSSIBLE MATCH/.test(text)),
      noHealthRankingClaim: candidateTexts.every((text) => !/healthier|best alternative|health score/i.test(text)),
      alternativeComparisonKeepsCommunityDisclosure: /Community data, not manufacturer verification/.test(candidateComparison) && /Local stock remains unverified/.test(candidateComparison),
      productRouteStatuses: routeStatuses,
      noNonLoopbackBrowserRequests: nonLoopbackRequests.length === 0,
      axeViolationIds: axe.violations.map((violation) => violation.id).sort(),
      pageErrors,
      screenshot: `docs/evidence/private/product-alternatives/${prefix}.png`,
    };
    outcomes.push(outcome);
    await context.close();
  }
} finally {
  await browser.close();
}

const receipt = {
  schemaVersion: 1,
  kind: 'product-alternatives-browser-acceptance',
  generatedAt: new Date().toISOString(),
  browser: 'Chrome via Playwright, headless',
  origin: 'loopback; product records fetched server-side from Open Food Facts',
  fixture: 'Synthetic Nutella label text and barcode; nutrient readings are rounded values derived from the live community record for deterministic basis-normalization testing.',
  excludedBarcode: fixtureBarcode,
  limitations: [
    'The typed fixture does not establish a real Nutella package, barcode scan, printed label, or regional formulation.',
    'Open Food Facts is a community catalog; search candidates do not establish stock, suitability, or a better formulation.',
    'This is a comparison workflow check, not validation of catalog accuracy or an alternative-product recommendation.',
  ],
  outcomes,
};
await writeFile('docs/evidence/product-alternatives-browser.json', `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ receipt: 'docs/evidence/product-alternatives-browser.json', outcomes }, null, 2));
if (outcomes.length !== 2 || outcomes.some((outcome) => !outcome.initialLookupIsPackageBarcode || !outcome.liveBarcodeRecordVisible || !outcome.packageRecordRegionalLimitVisible || !outcome.comparisonBasisNormalizationVisible || outcome.explicitlyNotComparableRows < 1 || !outcome.exactLookupIdentityCaveatVisible || !outcome.candidateSearchExcludesCurrentBarcode || outcome.candidateCount < 1 || !outcome.candidateStockAndIdentityCaveatsVisible || !outcome.noHealthRankingClaim || !outcome.alternativeComparisonKeepsCommunityDisclosure || outcome.productRouteStatuses.length < 2 || outcome.productRouteStatuses.some((status) => status !== 200) || !outcome.noNonLoopbackBrowserRequests || outcome.axeViolationIds.length || outcome.pageErrors.length)) process.exitCode = 1;
