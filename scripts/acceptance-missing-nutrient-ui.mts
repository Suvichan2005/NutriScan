import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium, type Page } from '@playwright/test';
import { defaultProfile, packageSchema } from '../src/lib/contracts';
import { buildAudit } from '../src/lib/engine';

const baseUrl = process.env.NUTRISCAN_BASE_URL ?? 'http://127.0.0.1:3400';
assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseUrl).hostname), 'Acceptance requires a loopback app.');
assert((await fetch(new URL('/api/status', baseUrl), { signal: AbortSignal.timeout(15_000) })).ok, 'NutriScan status is unavailable.');

const labelText = [
  'FICTIONAL DEVELOPMENT LABEL — NOT A REAL PRODUCT',
  'Example multigrain crackers',
  'Nutrition information per 100 g',
  'Carbohydrate 60 g',
  'Protein 8 g',
  'Ingredients: Wheat flour, edible vegetable oil, salt',
].join('\n');
const reconstruction = {
  identity: { brand: 'Example', name: 'Fictional development crackers', variant: null, status: 'provisional', evidence: { observationIds: [], imageRegions: [] } },
  serving: null,
  nutritionRows: [{ rowId: 'carb-row', nutrient: 'Carbohydrate', nutrientKey: 'carbohydrate', printedLabel: 'Carbohydrate', printedValue: '60 g', value: 60, unit: 'g', columnLabel: 'per 100 g', basisText: 'per 100 g', basisAmount: 100, basisUnit: 'g', qualifier: null, status: 'provisional', evidence: { observationIds: [], imageRegions: [] } }],
  ingredients: [], additives: [], statements: [], regions: [], unresolved: [], interpretationNote: 'Fictional provider-intercepted development response.',
};
const retrievedSource = {
  id: 'developer-fixture-source', title: 'Developer fixture source', publisher: 'Example Research Group',
  url: 'https://example.org/developer-fixture', category: 'literature', jurisdiction: 'Not established',
  publishedAt: null, effectiveAt: null, retrievedAt: '2026-10-27T05:00:00.000Z',
  summary: 'Synthetic retrieved-only source for UI provenance acceptance.',
  limitations: 'Fictional development fixture; it supports no scientific or package claim.',
};
const viewports = process.env.NUTRISCAN_ACCEPTANCE_VIEWPORT === 'desktop'
  ? [{ width: 1440, height: 900 }]
  : process.env.NUTRISCAN_ACCEPTANCE_VIEWPORT === 'mobile'
    ? [{ width: 390, height: 844 }]
    : [{ width: 390, height: 844 }, { width: 1440, height: 900 }];
const scenarios = process.env.NUTRISCAN_ACCEPTANCE_RETRIEVAL_ONLY ? ['reconstruction'] as const : ['local-table', 'reconstruction'] as const;

async function clearOnboarding(page: Page) {
  const onboarding = page.getByRole('dialog', { name: 'Make NutriScan yours' });
  if (await onboarding.isVisible().catch(() => false)) {
    await onboarding.getByLabel('Understand nutrition and portions').check();
    await onboarding.getByRole('button', { name: 'Continue' }).click();
    await onboarding.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => !document.querySelector('dialog')?.open);
  }
}

async function enterLabelText(page: Page) {
  const advanced = page.locator('.empty-thread-advanced');
  if (await advanced.getAttribute('open') === null) await advanced.locator(':scope > summary').click();
  await page.getByRole('button', { name: 'Enter label text' }).click();
  await page.getByLabel('Label text').fill(labelText);
  await page.getByRole('button', { name: 'Read label text' }).click();
  await page.locator('.thread-workspace').waitFor({ state: 'visible' });
}

async function openPackageInspector(page: Page) {
  const details = page.locator('.advanced-inspector');
  await details.waitFor({ state: 'attached' });
  if (await details.getAttribute('open') === null) await page.getByRole('button', { name: /Open package inspector/ }).click();
  await page.getByRole('button', { name: 'Package', exact: true }).click();
}

async function applyCorrection(page: Page, route: 'local-table' | 'reconstruction') {
  if (route === 'local-table') {
    await page.getByText('Full label table', { exact: false }).click();
    await page.getByRole('button', { name: 'Add Sodium label reading' }).click();
    await page.getByLabel('Label value').fill('450');
    await page.locator('.nutrition-row-editor select').nth(0).selectOption('mg');
    await page.getByLabel('Printed basis').fill('100');
    await page.getByLabel('Basis unit').selectOption('g');
    await page.getByRole('button', { name: 'Save correction' }).click();
  } else {
    await page.getByRole('button', { name: 'Add a missing nutrient value' }).click();
    await page.getByLabel('Missing nutrient', { exact: true }).selectOption('sodium');
    await page.getByLabel('Missing nutrient value', { exact: true }).fill('450');
    await page.getByLabel('Missing nutrient unit', { exact: true }).selectOption('mg');
    await page.getByLabel('Missing nutrient basis amount', { exact: true }).fill('100');
    await page.getByLabel('Missing nutrient basis unit', { exact: true }).selectOption('g');
    await page.getByRole('button', { name: 'Save my reading' }).click();
    await page.getByText('Your supplied reading').waitFor({ state: 'visible' });
  }
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const outcomes: Array<Record<string, unknown>> = [];
try {
  for (const viewport of viewports) {
    for (const scenario of scenarios) {
      const context = await browser.newContext({ viewport });
      await context.addInitScript(() => sessionStorage.setItem('nutriscan.onboarding.complete.v1', '1'));
      const page = await context.newPage();
      const providerCalls: string[] = [];
      const externalRequests: string[] = [];
      const pageErrors: string[] = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      page.on('request', request => {
        const requestUrl = new URL(request.url());
        if (!['127.0.0.1', 'localhost', '[::1]'].includes(requestUrl.hostname)) externalRequests.push(requestUrl.origin);
      });
      await page.route('**/api/status', async route => {
        const response = await route.fetch();
        const body = await response.json();
        body.gemini = { ...body.gemini, enabled: scenario === 'reconstruction', paidFallbackEnabled: false };
        await route.fulfill({ response, json: body });
      });
      await page.route('**/api/assist', async route => {
        providerCalls.push(route.request().method());
        const requestBody = route.request().postDataJSON() as { package?: unknown; workspacePortion?: { amount?: number; unit?: 'g' | 'ml' }; question?: string };
        const parsedPackage = packageSchema.safeParse(requestBody.package);
        const portion = requestBody.workspacePortion;
        const calculations = parsedPackage.success && portion?.amount && portion.unit
          ? buildAudit(parsedPackage.data, portion.amount, portion.unit, defaultProfile, requestBody.question ?? '').calculations
          : [];
        const sodium = calculations.find(calculation => calculation.nutrient === 'sodium');
        const carbohydrateObservationIds = parsedPackage.success
          ? parsedPackage.data.nutrients.find(nutrient => nutrient.key === 'carbohydrate')?.observationIds ?? []
          : [];
        const packageReconstruction = {
          ...reconstruction,
          nutritionRows: reconstruction.nutritionRows.map(row => row.nutrientKey === 'carbohydrate'
            ? { ...row, evidence: { observationIds: carbohydrateObservationIds, imageRegions: [] } }
            : row),
        };
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
          answer: sodium ? `For ${sodium.portion} ${sodium.portionUnit}: ${sodium.result} ${sodium.unit} sodium.` : 'This fictional panel has no recorded sodium value. A value entered from the package is treated as a user reading.',
          calculations, uiComponents: [], tentativeCandidates: [], agentEvidence: scenario === 'reconstruction' ? [retrievedSource] : [],
          analysisReceipt: { model: 'provider-intercepted-development-fixture', method: 'tesseract-text' },
          packageReconstruction,
        }) });
      });
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent?.includes('Enter label text') && !button.disabled), { timeout: 30_000 });
      await clearOnboarding(page);

      if (scenario === 'local-table') {
        await page.locator('.empty-thread-advanced > summary').click();
        await page.locator('.local-only-settings > summary').click();
        const localOnly = page.getByRole('checkbox', { name: /Use local-only analysis in this tab/ });
        if (!await localOnly.isChecked()) await localOnly.check();
        await enterLabelText(page);
        assert.equal(providerCalls.length, 0);
      } else {
        await page.locator('.empty-thread-advanced > summary').click();
        await page.locator('.local-only-settings > summary').click();
        const localOnly = page.getByRole('checkbox', { name: /Use local-only analysis in this tab/ });
        if (await localOnly.isChecked()) await localOnly.uncheck();
        const advanced = page.locator('.empty-thread-advanced');
        if (await advanced.getAttribute('open') !== null) await advanced.locator(':scope > summary').click();
        if (await advanced.getAttribute('open') === null) await advanced.locator(':scope > summary').click();
        await page.getByLabel('Product name or detail').fill(labelText);
        await advanced.locator(':scope > summary').click();
        await page.locator('#initial-question').fill('How much sodium is in 30 g?');
        await page.getByRole('button', { name: 'Analyze details' }).click();
        await page.locator('.thread-workspace').waitFor({ state: 'visible' });
        await openPackageInspector(page);
        await page.locator('.package-reconstruction').waitFor({ state: 'visible', timeout: 30_000 });
        await page.getByLabel('Interpreted package details').getByRole('heading', { name: 'Nutrition as printed' }).waitFor({ state: 'visible' });
        assert.equal(providerCalls.length, 1);
      }

      await openPackageInspector(page);
      await applyCorrection(page, scenario);
      await page.getByText(/Correction saved as your reading|Your supplied reading/).first().waitFor({ state: 'visible' });
      const sodiumRow = page.locator('.nutrition-edit-table tbody tr').filter({ has: page.getByRole('rowheader', { name: /Sodium/ }) });
      const sodiumReading = await sodiumRow.innerText().catch(() => '');
      const originalCarbohydrateVisible = await page.getByRole('rowheader', { name: /Carbohydrate/ }).isVisible().catch(() => false);
      await page.locator('#portion').fill('30').catch(() => {});
      const updatedAudit = await page.locator('.nutrition-edit-table tbody').innerText().catch(() => '');
      const userEvidence = await page.getByText(/User-corrected · source remains unverified|Unverified user correction/).count();
      const originalOcrCount = await page.locator('.observations-list .observation-entry:not(.correction-observation)').count().catch(() => 0);
      await page.getByRole('button', { name: /Close package inspector/ }).click();
      await page.locator('#followup').fill('How much sodium is in 30 g?');
      await page.getByRole('button', { name: 'Send follow-up' }).click();
      const followup = page.locator('.thread-turn').last().locator('.thread-assistant-message');
      await followup.waitFor({ state: 'visible' });
      await page.locator('.thread-turn').last().locator('.thread-working').waitFor({ state: 'detached', timeout: 30_000 });
      await followup.waitFor({ state: 'visible' });
      const followupText = await followup.innerText();
      const updatedPortionCalculation = /135\s*mg sodium for 30 g/i.test(followupText) || /135\s*mg/.test(followupText);
      const retrievedOnlyVisible = await page.locator('.conversation-retrieved-evidence summary').count() > 0;
      await page.getByLabel('Save chat').check();
      await page.waitForTimeout(500);
      await page.getByRole('button', { name: /Recent scans/ }).click();
      await page.locator('.history-row').first().click();
      await page.getByText(/Reopened .* saved conversation turns/).waitFor({ state: 'visible' });
      await openPackageInspector(page);
      const reopenedReading = scenario === 'local-table'
        ? await page.locator('.nutrition-edit-table tbody tr').filter({ has: page.getByRole('rowheader', { name: /Sodium/ }) }).innerText()
        : await page.locator('.reconstruction-rows .reconstruction-row').filter({ hasText: /Sodium/i }).innerText();
      const savedReopenPreservedCorrection = reopenedReading.includes('450 mg') && /Your correction|Your supplied reading|User-corrected/.test(reopenedReading);
      const retrievedOnlyRetainedOnReopen = await page.locator('.conversation-retrieved-evidence summary').count() > 0;
      const axe = await new AxeBuilder({ page }).analyze();
      const dimensions = await page.evaluate(() => ({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
      const screenshotPath = path.resolve('.data/m2-missing-nutrient-ui', `${viewport.width}x${viewport.height}-${scenario}.png`);
      await mkdir(path.dirname(screenshotPath), { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: true });
      const outcome = {
        viewport: `${viewport.width}x${viewport.height}`, scenario,
        editorOpened: true, sodiumReading: sodiumRow.count ? sodiumReading : '',
        originalCarbohydrateVisible, updatedAudit, userCorrectionVisible: userEvidence > 0,
        originalOcrCount, followupText, updatedPortionCalculation, savedReopenPreservedCorrection,
        retrievedOnlyVisible, retrievedOnlyRetainedOnReopen,
        reopenedReading, providerCalls: providerCalls.length, pageErrors,
        externalRequests: [...new Set(externalRequests)], axeViolationIds: axe.violations.map(v => v.id),
        horizontalOverflow: dimensions.scrollWidth > dimensions.viewport, screenshotPath,
      };
      outcomes.push(outcome);
      console.log(JSON.stringify(outcome));
      await context.close();
    }
  }
} finally {
  await browser.close();
}
assert.equal(outcomes.length, viewports.length * scenarios.length);
for (const outcome of outcomes) {
  assert.equal(outcome.editorOpened, true);
  assert.equal(outcome.userCorrectionVisible, true);
  assert.equal(outcome.updatedPortionCalculation, true);
  assert.equal(outcome.savedReopenPreservedCorrection, true);
  assert.equal(outcome.retrievedOnlyVisible, outcome.scenario === 'reconstruction');
  assert.equal(outcome.retrievedOnlyRetainedOnReopen, outcome.scenario === 'reconstruction');
  assert.deepEqual(outcome.pageErrors, []);
  assert.deepEqual(outcome.externalRequests, []);
  assert.deepEqual(outcome.axeViolationIds, []);
  assert.equal(outcome.horizontalOverflow, false);
  assert.equal(outcome.providerCalls, outcome.scenario === 'local-table' ? 0 : 2);
}
await mkdir(path.resolve('.data/m2-missing-nutrient-ui'), { recursive: true });
await writeFile('.data/m2-missing-nutrient-ui/receipt.json', `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), localLoopback: true, syntheticLabel: true, allPassed: true, outcomes }, null, 2)}\n`);
