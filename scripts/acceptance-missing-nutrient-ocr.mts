import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { chromium, type Page } from '@playwright/test';

const baseUrl = process.env.NUTRISCAN_BASE_URL ?? 'http://127.0.0.1:3400';
assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseUrl).hostname), 'Acceptance requires a loopback app.');
assert((await fetch(new URL('/api/status', baseUrl), { signal: AbortSignal.timeout(15_000) })).ok, 'NutriScan status is unavailable.');
const photoPath = process.env.NUTRISCAN_OCR_PHOTO_PATH ?? 'docs/evidence/private/coca-cola-label-off-5449000000996.jpg';
const viewports = process.env.NUTRISCAN_OCR_VIEWPORT === 'mobile'
  ? [{ width: 390, height: 844 }]
  : process.env.NUTRISCAN_OCR_VIEWPORT === 'desktop'
    ? [{ width: 1440, height: 900 }]
    : [{ width: 390, height: 844 }, { width: 1440, height: 900 }];

async function clearOnboarding(page: Page) {
  const onboarding = page.getByRole('dialog', { name: 'Make NutriScan yours' });
  if (await onboarding.isVisible().catch(() => false)) {
    await onboarding.getByLabel('Understand nutrition and portions').check();
    await onboarding.getByRole('button', { name: 'Continue' }).click();
    await onboarding.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => !document.querySelector('dialog')?.open);
  }
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const outcomes: Array<Record<string, unknown>> = [];
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport });
    await context.addInitScript(() => sessionStorage.setItem('nutriscan.onboarding.complete.v1', '1'));
    const page = await context.newPage();
    const errors: string[] = [];
    const externalRequests: string[] = [];
    const providerCalls: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      const requestUrl = new URL(request.url());
      if (['http:', 'https:'].includes(requestUrl.protocol) && !['127.0.0.1', 'localhost', '[::1]'].includes(requestUrl.hostname)) externalRequests.push(requestUrl.hostname);
    });
    page.on('request', request => { if (new URL(request.url()).pathname === '/api/assist') providerCalls.push(request.url()); });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.getAttribute('aria-label') === 'Scan or add package photos' && !button.disabled), { timeout: 30_000 });
    await clearOnboarding(page);
    await page.locator('.empty-thread-advanced > summary').click();
    await page.locator('.local-only-settings > summary').click();
    const localOnly = page.getByRole('checkbox', { name: /Use local-only analysis in this tab/ });
    if (!await localOnly.isChecked()) await localOnly.check();
    await page.getByRole('button', { name: 'Scan or add package photos' }).click();
    await page.getByLabel('Choose package sides').setInputFiles(photoPath);
    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Analyze package' }).click();
    await page.locator('.thread-workspace').waitFor({ state: 'visible', timeout: 90_000 });
    await page.locator('.thread-working').waitFor({ state: 'detached', timeout: 90_000 }).catch(() => {});
    const inspector = page.locator('.advanced-inspector');
    if (await inspector.getAttribute('open') === null) await page.getByRole('button', { name: /Open package inspector/ }).click();
    await page.getByRole('button', { name: 'Package', exact: true }).click();
    await page.getByText('Full label table', { exact: false }).click();
    const sodiumRow = page.locator('.nutrition-edit-table tbody tr').filter({ has: page.getByRole('rowheader', { name: /Sodium/ }) });
    const missingSodium = await sodiumRow.innerText();
    assert.match(missingSodium, /Not established/i, `Expected sodium to remain missing: ${missingSodium}`);
    await page.getByRole('button', { name: 'Add Sodium label reading' }).click();
    const editorVisible = await page.getByLabel('Label value').isVisible();
    const emptyValue = await page.getByLabel('Label value').inputValue();
    const originalRows = await page.locator('.nutrition-edit-table tbody tr').count();
    const axe = await new AxeBuilder({ page }).analyze();
    const dimensions = await page.evaluate(() => ({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    const screenshotPath = path.resolve('.data/m2-missing-nutrient-ui', `${viewport.width}x${viewport.height}-real-local-ocr.png`);
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await page.getByRole('button', { name: 'Sources & OCR' }).click();
    const originalOcrObservationCount = await page.locator('.observations-list .observation-entry').count();
    assert.ok(originalOcrObservationCount > 0, 'Expected source OCR observations from the private photo.');
    await page.getByRole('button', { name: 'Package', exact: true }).click();
    await page.getByRole('button', { name: /Close package inspector/ }).click();
    await page.locator('#followup').fill('How much sodium is in 30 g?');
    await page.getByRole('button', { name: 'Send follow-up' }).click();
    const answerTurn = page.locator('.thread-turn').last();
    await answerTurn.locator('.thread-assistant-message').waitFor({ state: 'visible' });
    await answerTurn.locator('.thread-working').waitFor({ state: 'detached', timeout: 30_000 }).catch(() => {});
    const localAnswer = await answerTurn.locator('.thread-assistant-message').innerText();
    assert.match(localAnswer, /sodium/i);
    assert.doesNotMatch(localAnswer, /\b0\s*mg\b/i, 'An absent sodium value must not become zero.');
    await page.getByLabel('Save chat').check();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: /Recent scans/ }).click();
    await page.locator('.history-row').first().click();
    await page.getByText(/Reopened .* saved conversation turns/).waitFor({ state: 'visible' });
    const reopenedInspector = page.locator('.advanced-inspector');
    if (await reopenedInspector.getAttribute('open') === null) await page.getByRole('button', { name: /Open package inspector/ }).click();
    await page.getByRole('button', { name: 'Package', exact: true }).click();
    await page.getByText('Full label table', { exact: false }).click();
    const reopenedSodium = await page.locator('.nutrition-edit-table tbody tr').filter({ has: page.getByRole('rowheader', { name: /Sodium/ }) }).innerText();
    assert.match(reopenedSodium, /Not established/i);
    await page.getByRole('button', { name: 'Sources & OCR' }).click();
    const reopenedOcrObservationCount = await page.locator('.observations-list .observation-entry').count();
    const answerScreenshotPath = path.resolve('.data/m2-missing-nutrient-ui', `${viewport.width}x${viewport.height}-real-local-ocr-answer-reopened.png`);
    await page.screenshot({ path: answerScreenshotPath, fullPage: true });
    const outcome = {
      viewport: `${viewport.width}x${viewport.height}`,
      input: 'private local development photograph; no provider calls',
      packageTitle: await page.locator('.thread-package-identity strong').innerText().catch(() => ''),
      editorVisible, missingSodium, correctionValueInitiallyBlank: emptyValue === '',
      existingNutritionRows: originalRows, originalOcrObservationCount, reopenedOcrObservationCount,
      reopenedSodium, localAnswer, answerScreenshotPath, providerCalls: providerCalls.length,
      pageErrors: errors, externalRequests: [...new Set(externalRequests)],
      axeViolationIds: axe.violations.map(violation => violation.id),
      axeViolations: axe.violations.map(violation => ({ id: violation.id, impact: violation.impact, nodes: violation.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) })),
      horizontalOverflow: dimensions.scrollWidth > dimensions.viewport, screenshotPath,
    };
    outcomes.push(outcome);
    console.log(JSON.stringify(outcome));
    await context.close();
  }
} finally {
  await browser.close();
}
assert.equal(outcomes.length, viewports.length);
for (const outcome of outcomes) {
  assert.equal(outcome.editorVisible, true);
  assert.equal(outcome.correctionValueInitiallyBlank, true);
  assert.ok(Number(outcome.originalOcrObservationCount) > 0);
  assert.equal(outcome.reopenedOcrObservationCount, outcome.originalOcrObservationCount);
  assert.match(String(outcome.reopenedSodium), /Not established/i);
  assert.match(String(outcome.localAnswer), /sodium/i);
  assert.doesNotMatch(String(outcome.localAnswer), /\b0\s*mg\b/i);
  assert.equal(outcome.providerCalls, 0);
  assert.deepEqual(outcome.pageErrors, []);
  assert.deepEqual(outcome.externalRequests, []);
  assert.deepEqual(outcome.axeViolationIds, []);
  assert.equal(outcome.horizontalOverflow, false);
}
await mkdir('.data/m2-missing-nutrient-ui', { recursive: true });
await writeFile('.data/m2-missing-nutrient-ui/ocr-photo-receipt.json', `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), localLoopback: true, privatePhoto: true, outcomes }, null, 2)}\n`);
