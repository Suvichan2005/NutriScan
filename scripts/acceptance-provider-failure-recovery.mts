import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';

const baseUrl = process.env.NUTRISCAN_BASE_URL ?? 'http://127.0.0.1:3400';
const origin = new URL(baseUrl);
assert(['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname), 'Acceptance must use a loopback server.');
assert((await fetch(baseUrl, { signal: AbortSignal.timeout(20_000) })).ok, 'NutriScan is unavailable.');

const receiptDirectory = path.resolve('.data/m6-provider-failure-recovery');
await mkdir(receiptDirectory, { recursive: true });
const privateScreenshotDirectory = path.resolve('docs/evidence/private/m6-provider-failure-recovery');
await mkdir(privateScreenshotDirectory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const outcomes: Array<Record<string, unknown>> = [];
const labelText = [
  'NUTRISCAN MOCK PACKAGE',
  'Fictional development label; not a real product',
  'Serving size 30 g',
  'Nutrition information per 100 g',
  'Carbohydrate 60 g',
  'Sodium 760 mg',
].join('\n');

try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const assistantAttempts: string[] = [];
    const externalRequests: string[] = [];
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('request', request => {
      const requestUrl = new URL(request.url());
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(requestUrl.hostname)) externalRequests.push(requestUrl.origin);
    });
    await page.route('**/api/status', async route => {
      const response = await route.fetch();
      const status = await response.json();
      status.gemini = { ...status.gemini, enabled: true, paidFallbackEnabled: false };
      await route.fulfill({ response, json: status });
    });
    await page.route('**/api/assist', async route => {
      assistantAttempts.push(`${route.request().method()} /api/assist`);
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'error', code: 'provider_unavailable', message: 'Gemini is temporarily unavailable.' }),
      });
    });

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent?.includes('Enter label text') && !button.disabled));
    const onboarding = page.getByRole('dialog', { name: 'Make NutriScan yours' });
    if (await onboarding.isVisible().catch(() => false)) {
      await onboarding.getByLabel('Understand nutrition and portions').check();
      await onboarding.getByRole('button', { name: 'Continue' }).click();
      await onboarding.waitFor({ state: 'hidden' });
    }
    await page.locator('.empty-thread-advanced > summary').click();
    await page.locator('.local-only-settings > summary').click();
    const localOnly = page.getByRole('checkbox', { name: /Use local-only analysis in this tab/ });
    if (await localOnly.isChecked()) await localOnly.uncheck();
    const advancedSettings = page.locator('.empty-thread-advanced');
    if (await advancedSettings.getAttribute('open') !== null) await advancedSettings.locator(':scope > summary').click();
    if (await advancedSettings.getAttribute('open') === null) await advancedSettings.locator(':scope > summary').click();
    await page.getByLabel('Product name or detail').fill(labelText);
    await advancedSettings.locator(':scope > summary').click();
    await page.getByLabel('What would you like to know?').fill('How much carbohydrate and sodium are in 30 g?');
    await page.getByRole('button', { name: 'Analyze details' }).click();

    const turn = page.locator('.thread-turn').last();
    await turn.locator('.thread-turn-fallback').waitFor({ state: 'visible' });
    const visibleAnswer = await turn.locator('.thread-assistant-message').innerText();
    const failureDetail = await turn.locator('.thread-turn-fallback').innerText();
    const retryAvailable = await turn.getByRole('button', { name: 'Retry Gemini' }).isVisible();
    const usefulCalculationsRetained = /18 g carbohydrate/.test(visibleAnswer) && /228 mg sodium/.test(visibleAnswer);
    const failureExplained = /unavailable|could not reach/i.test(failureDetail);
    const axe = await new AxeBuilder({ page }).analyze();
    const screenshotName = viewport.width === 390 ? 'mobile.png' : 'desktop.png';
    await page.screenshot({ path: path.join(privateScreenshotDirectory, screenshotName), fullPage: true });
    outcomes.push({
      viewport,
      mockedProviderUnavailable: true,
      assistantRequestsIntercepted: assistantAttempts.length,
      usefulCalculationsRetained,
      failureExplained,
      retryAvailable,
      pageErrors,
      axeViolationIds: axe.violations.map(violation => violation.id),
      externalRequests: [...new Set(externalRequests)],
    });
    await context.close();
  }
} finally {
  await browser.close();
}

const passed = outcomes.length === 2 && outcomes.every(outcome =>
  outcome.assistantRequestsIntercepted === 1
  && outcome.usefulCalculationsRetained === true
  && outcome.failureExplained === true
  && outcome.retryAvailable === true
  && Array.isArray(outcome.pageErrors) && outcome.pageErrors.length === 0
  && Array.isArray(outcome.axeViolationIds) && outcome.axeViolationIds.length === 0
  && Array.isArray(outcome.externalRequests) && outcome.externalRequests.length === 0);
const receipt = {
  schemaVersion: 1,
  kind: 'mocked-provider-failure-recovery-browser-acceptance',
  generatedAt: new Date().toISOString(),
  evidenceClass: 'fictional typed-package product-flow acceptance with browser-intercepted 503; not a real Gemini failure or answer-quality result',
  baseOrigin: origin.origin,
  providerCallsReached: 0,
  outcomes,
  passed,
};
await writeFile(path.join(receiptDirectory, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(receipt, null, 2));
if (!passed) process.exitCode = 1;
