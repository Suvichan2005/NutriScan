import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = process.env.NUTRISCAN_BASE_URL ?? 'http://127.0.0.1:3400';
const origin = new URL(baseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) throw new Error('Reference-amount acceptance accepts loopback origins only.');
const response = await fetch(baseUrl, { signal: AbortSignal.timeout(5000) });
if (!response.ok) throw new Error(`NutriScan is unavailable: HTTP ${response.status}.`);

const screenshots = path.resolve('docs/evidence/private/neutral-reference');
await mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const outcomes: Array<Record<string, unknown>> = [];
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    await page.getByRole('button', { name: 'Paste label text' }).click();
    await page.getByLabel('Label text').fill('Ingredients: oats, water.');
    await page.getByRole('button', { name: 'Read label text' }).click();
    await page.locator('.results-section').waitFor({ state: 'visible' });

    const amount = page.locator('#portion');
    const unit = page.getByLabel('Amount unit');
    const nutritionCard = page.locator('.nutrition-card');
    const nutritionText = await nutritionCard.innerText();
    const displayedNutrients = await page.locator('.nutrient strong').evaluateAll((nodes) => nodes.map((node) => (node.textContent ?? '').trim()));
    const calculationRows = await page.locator('.details-block table tbody tr').count();
    const axe = await new AxeBuilder({ page }).analyze();
    const prefix = viewport.width === 390 ? 'mobile' : 'desktop';
    await page.screenshot({ path: path.join(screenshots, `${prefix}.png`), fullPage: true });

    const outcome = {
      viewport: `${viewport.width}x${viewport.height}`,
      textOnlyInput: true,
      noNutrientValuesInvented: displayedNutrients.every((value) => !value || value === '—'),
      noCalculationRows: calculationRows === 0,
      referenceAmount: await amount.inputValue(),
      referenceUnit: await unit.inputValue(),
      referenceIsDisclosedAsNonPersonal: /comparison reference, not a personal serving suggestion/i.test(nutritionText),
      axeViolationIds: axe.violations.map((violation) => violation.id).sort(),
      pageErrors,
      screenshot: `docs/evidence/private/neutral-reference/${prefix}.png`,
    };
    outcomes.push(outcome);
    await context.close();
  }
} finally {
  await browser.close();
}

const receipt = {
  schemaVersion: 1,
  kind: 'neutral-reference-browser-acceptance',
  generatedAt: new Date().toISOString(),
  browser: 'Chrome via Playwright, headless',
  origin: 'loopback',
  input: 'Synthetic text-only ingredients with no nutrient values, basis or serving declaration.',
  limitations: ['Verifies the user-facing neutral fallback and missing-value behavior only.', 'Does not establish real-package OCR, a personalized serving recommendation, or nutrition accuracy.'],
  outcomes,
};
await writeFile('docs/evidence/neutral-reference-browser.json', `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ receipt: 'docs/evidence/neutral-reference-browser.json', outcomes }, null, 2));
if (outcomes.length !== 2 || outcomes.some((outcome) => !outcome.noNutrientValuesInvented || !outcome.noCalculationRows || outcome.referenceAmount !== '100' || outcome.referenceUnit !== 'g' || !outcome.referenceIsDisclosedAsNonPersonal || outcome.pageErrors.length || outcome.axeViolationIds.length)) process.exitCode = 1;
