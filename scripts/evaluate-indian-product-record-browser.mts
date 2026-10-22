import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const baseUrl = process.env.NUTRISCAN_BASE_URL ?? 'http://127.0.0.1:3400';
const origin = new URL(baseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) throw new Error('Product-record acceptance accepts loopback origins only.');
const health = await fetch(baseUrl, { signal: AbortSignal.timeout(5000) });
if (!health.ok) throw new Error(`NutriScan is unavailable: HTTP ${health.status}.`);

const barcode = '8901088068758';
const screenshotDirectory = '.data/indian-product-record-browser';
await mkdir(screenshotDirectory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const outcomes: Array<Record<string, unknown>> = [];
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    const externalBrowserRequests: string[] = [];
    const productRequestShapes: Array<Record<string, unknown>> = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('request', request => {
      const requestUrl = new URL(request.url());
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(requestUrl.hostname)) externalBrowserRequests.push(requestUrl.origin);
      if (requestUrl.pathname === '/api/products' && request.method() === 'POST') productRequestShapes.push(request.postDataJSON() as Record<string, unknown>);
    });

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    await page.getByRole('button', { name: 'Paste label text' }).click();
    await page.getByRole('textbox', { name: 'Label text' }).fill(`Barcode: ${barcode}`);
    await page.getByRole('button', { name: 'Read label text' }).click();
    await page.locator('.results-section').waitFor({ state: 'visible' });

    const lookup = page.getByLabel('Public search terms');
    const initialLookup = await lookup.inputValue();
    const productResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/products' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Find product' }).click();
    const productResponse = await productResponsePromise;
    const responseBody = await productResponse.json() as { products?: Array<Record<string, unknown>> };
    const product = responseBody.products?.find(item => item.barcode === barcode) as {
      name: string; brand: string; barcode: string; countries: string[]; ingredients: string;
      allergens: string[]; nutrients: unknown[]; lastModified: string | null; url: string;
    } | undefined;
    if (productResponse.status() !== 200 || !product) throw new Error(`Expected the live India barcode record; got HTTP ${productResponse.status()}.`);

    const card = page.locator('.product-result').filter({ hasText: product.name }).first();
    await card.waitFor({ state: 'visible' });
    const recordDetails = card.locator('details.product-record-evidence');
    const collapsedInitially = !(await recordDetails.evaluate(node => (node as HTMLDetailsElement).open));
    await recordDetails.locator('summary').click();
    const ingredientText = (await recordDetails.locator('.record-ingredients').innerText()).replace(/\s+/g, ' ').trim();
    const expectedIngredientText = product.ingredients.replace(/\s+/g, ' ').trim();
    const detailsText = (await recordDetails.innerText()).replace(/\s+/g, ' ').trim();
    const allergenTagsVisible = product.allergens.length > 0 && product.allergens.every(tag => {
      const expected = tag.replace(/^[a-z]{2}:/i, '').replace(/[-_]+/g, ' ').trim().toLocaleLowerCase('en-IN');
      return detailsText.toLocaleLowerCase('en-IN').includes(expected);
    });
    const sourceLinkVisible = await card.getByRole('link', { name: /Open product source/ }).getAttribute('href') === product.url;
    const recordCaveatVisible = /not text read from this photo/i.test(detailsText) && /may be incomplete, outdated/i.test(detailsText);
    const noPhotoOrProfileInLookup = productRequestShapes.length === 1 && JSON.stringify(productRequestShapes[0]) === JSON.stringify({ barcode });

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export evidence report' }).click();
    const stream = await (await downloadPromise).createReadStream();
    if (!stream) throw new Error('Could not read the evidence export in memory.');
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const exported = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { package: { barcode?: string; ingredients: string[]; allergens: string[]; nutrients: unknown[] } };
    const communityRecordNotPromotedToPackageFacts = exported.package.barcode === barcode && exported.package.ingredients.length === 0 && exported.package.allergens.length === 0 && exported.package.nutrients.length === 0;

    const axe = await new AxeBuilder({ page }).analyze();
    const noHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    const screenshot = `${screenshotDirectory}/${viewport.width === 390 ? 'mobile' : 'desktop'}.png`;
    await page.screenshot({ path: screenshot, fullPage: true });
    outcomes.push({
      viewport: `${viewport.width}x${viewport.height}`,
      typedBarcodeFixture: true,
      realPhotoOrOcrTest: false,
      exactIndiaRecordVisible: product.barcode === barcode && product.countries.includes('en:india'),
      sourceIngredientTextPresent: product.ingredients.length > 0,
      sourceAllergenTagsPresent: product.allergens.length > 0,
      initialSearchUsesOnlyBarcode: initialLookup === barcode && noPhotoOrProfileInLookup,
      communityDetailsCollapsedInitially: collapsedInitially,
      ingredientTextMatchesLiveCommunityRecord: ingredientText === expectedIngredientText,
      allergenTagsVisible,
      sourceAttributionLinkVisible: sourceLinkVisible,
      communityDataCaveatVisible: recordCaveatVisible,
      communityRecordNotPromotedToPackageFacts,
      sourceLastModified: product.lastModified,
      productRecordUrl: product.url,
      productResponseStatus: productResponse.status(),
      noExternalBrowserRequests: externalBrowserRequests.length === 0,
      axeViolationIds: axe.violations.map(violation => violation.id).sort(),
      noHorizontalOverflow,
      pageErrors,
      screenshot,
    });
    await context.close();
  }
} finally {
  await browser.close();
}

const receipt = {
  schemaVersion: 1,
  kind: 'india-product-record-browser-acceptance',
  generatedAt: new Date().toISOString(),
  browser: 'Installed Chrome via Playwright',
  application: 'Local loopback NutriScan; explicit product lookup action',
  buildMode: process.env.NUTRISCAN_BUILD_MODE ?? 'not specified by the acceptance runner',
  source: 'Open Food Facts current v3 product endpoint; community data with source link and variant caveat',
  sourceLicense: 'Database: ODbL; individual contents: Database Contents License. Product images were not used.',
  sample: { barcode, marketTag: 'en:india', sourceRecordOnly: true },
  fixture: 'Typed barcode only; no package photograph, OCR, personal profile, or copied ingredient text was used as input.',
  limitations: [
    'This verifies display and provenance behavior for a live community record, not the correctness of the record or package-photo identification.',
    'The returned ingredient text has not been independently checked against the physical package.',
    'Open Food Facts database records are community supplied; local stock and regional formulation remain unverified.',
  ],
  outcomes,
};
await writeFile('docs/evidence/indian-product-record-browser.json', `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ receipt: 'docs/evidence/indian-product-record-browser.json', outcomes }, null, 2));
if (outcomes.length !== 2 || outcomes.some(outcome => !outcome.exactIndiaRecordVisible || !outcome.sourceIngredientTextPresent || !outcome.sourceAllergenTagsPresent || !outcome.initialSearchUsesOnlyBarcode || !outcome.communityDetailsCollapsedInitially || !outcome.ingredientTextMatchesLiveCommunityRecord || !outcome.allergenTagsVisible || !outcome.sourceAttributionLinkVisible || !outcome.communityDataCaveatVisible || !outcome.communityRecordNotPromotedToPackageFacts || outcome.productResponseStatus !== 200 || !outcome.noExternalBrowserRequests || (outcome.axeViolationIds as string[]).length || !outcome.noHorizontalOverflow || (outcome.pageErrors as string[]).length)) process.exitCode = 1;
