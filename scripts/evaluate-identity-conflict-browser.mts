import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = process.env.NUTRISCAN_BASE_URL ?? 'http://127.0.0.1:3400';
const publicBarcode = '5449000000996';
const origin = new URL(baseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) throw new Error('Identity-conflict acceptance accepts loopback origins only.');
const response = await fetch(baseUrl, { signal: AbortSignal.timeout(5000) });
if (!response.ok) throw new Error(`NutriScan is unavailable: HTTP ${response.status}.`);

const screenshotDirectory = path.resolve('docs/evidence/private/identity-conflict');
await mkdir(screenshotDirectory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const outcomes: Array<Record<string, unknown>> = [];
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    const routeStatuses: number[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('response', (routeResponse) => {
      if (new URL(routeResponse.url()).pathname === '/api/products') routeStatuses.push(routeResponse.status());
    });
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });

    await page.getByRole('button', { name: 'Paste label text' }).click();
    await page.getByRole('textbox', { name: 'Label text' }).fill('Brand: North Mill\nBarcode: 12345678\nNutrition per 100 g\nProtein 12 g');
    await page.getByRole('button', { name: 'Read label text' }).click();
    await page.locator('.results-section').waitFor({ state: 'visible' });
    const initialSearch = await page.getByLabel('Public search terms').inputValue();

    await page.getByRole('button', { name: 'Paste label text' }).click();
    await page.getByRole('textbox', { name: 'Label text' }).fill('Brand: South Mill\nBarcode: 87654321\nNutrition per 100 g\nProtein 9 g');
    await page.getByRole('button', { name: 'Read label text' }).click();
    const conflictNotice = page.getByText(/Package identity is disputed across the supplied evidence/);
    await conflictNotice.waitFor({ state: 'visible' });
    const conflictingSearch = await page.getByLabel('Public search terms').inputValue();

    await page.getByLabel('Public search terms').fill(publicBarcode);
    await page.getByRole('button', { name: 'Find product' }).click();
    await page.locator('.product-result').first().waitFor({ state: 'visible', timeout: 20_000 });
    const compareButton = page.getByRole('button', { name: 'Compare with this label' }).first();
    const comparisonDisabled = await compareButton.isDisabled();
    const axe = await new AxeBuilder({ page }).analyze();
    const prefix = viewport.width === 390 ? 'mobile' : 'desktop';
    await page.screenshot({ path: path.join(screenshotDirectory, `${prefix}.png`), fullPage: true });

    const outcome = {
      viewport: `${viewport.width}x${viewport.height}`,
      conflictingPastedEvidenceDetected: true,
      originalBarcodePrefilledBeforeConflict: initialSearch === '12345678',
      conflictingEvidenceClearedDefaultSearch: conflictingSearch === '',
      catalogRecordReturnedForExplicitManualSearch: await page.locator('.product-result').count() > 0,
      comparisonRemainsDisabled: comparisonDisabled,
      catalogRouteStatuses: routeStatuses,
      axeViolationIds: axe.violations.map((violation) => violation.id).sort(),
      pageErrors,
      screenshot: `docs/evidence/private/identity-conflict/${prefix}.png`,
    };
    outcomes.push(outcome);
    await context.close();
  }
} finally {
  await browser.close();
}

const receipt = {
  schemaVersion: 1,
  kind: 'package-identity-conflict-browser-acceptance',
  generatedAt: new Date().toISOString(),
  browser: 'Chrome via Playwright, headless',
  origin: 'loopback',
  syntheticInput: 'Two pasted label-text entries with conflicting brand and barcode values; neither is a real product claim.',
  manuallySearchedPublicBarcode: publicBarcode,
  limitations: ['Verifies conflict handling and disabled comparison in the browser, not OCR conflict recognition or real-package identity.', 'Manual public catalog search is explicit and does not clear the package conflict.'],
  outcomes,
};
await writeFile('docs/evidence/identity-conflict-browser.json', `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ receipt: 'docs/evidence/identity-conflict-browser.json', outcomes }, null, 2));
if (outcomes.length !== 2 || outcomes.some((outcome) => !outcome.conflictingPastedEvidenceDetected || !outcome.originalBarcodePrefilledBeforeConflict || !outcome.conflictingEvidenceClearedDefaultSearch || !outcome.catalogRecordReturnedForExplicitManualSearch || !outcome.comparisonRemainsDisabled || !outcome.catalogRouteStatuses.includes(200) || outcome.pageErrors.length || outcome.axeViolationIds.length)) process.exitCode = 1;
