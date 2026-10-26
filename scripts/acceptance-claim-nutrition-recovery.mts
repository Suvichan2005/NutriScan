import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';

const baseUrl = process.env.NUTRISCAN_BASE_URL ?? 'http://127.0.0.1:3400';
const origin = new URL(baseUrl);
assert(['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname), 'Acceptance must use a loopback server.');
assert((await fetch(baseUrl, { signal: AbortSignal.timeout(20_000) })).ok, 'NutriScan is unavailable.');

const receiptDirectory = path.resolve('.data/m2-claim-nutrition-recovery');
await mkdir(receiptDirectory, { recursive: true });
const privateScreenshotDirectory = path.resolve('docs/evidence/private/claim-nutrition-recovery');
await mkdir(privateScreenshotDirectory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const outcomes: Array<Record<string, unknown>> = [];
const labelText = [
  'NUTRISCAN MOCK PACKAGE',
  'Fictional development label; not a real product',
  'Example Sugar Free Crackers',
  'Nutrition information per 100 g',
  'Carbohydrate 72 g',
  'Sugars 0.5 g',
].join('\n');

try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const assistantAttempts: string[] = [];
    let previousQuestionReachedSecondTurn = false;
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
      if (assistantAttempts.length === 2) {
        const requestBody = route.request().postDataJSON() as { conversationContext?: Array<{ question?: string }> };
        previousQuestionReachedSecondTurn = requestBody.conversationContext?.some(turn => turn.question?.includes('I am adding spinach')) ?? false;
      }
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
    const firstQuestion = 'I am adding spinach with these crackers. Does the sugar-free claim mean carbohydrate-free? What is the amount in 30 g?';
    await page.getByLabel('What would you like to know?').fill(firstQuestion);
    await page.getByRole('button', { name: 'Analyze details' }).click();

    const firstTurn = page.locator('.thread-turn').last();
    await firstTurn.locator('.thread-turn-fallback').waitFor({ state: 'visible' });
    const firstAnswer = await firstTurn.locator('.thread-assistant-message').innerText();
    const failureDetail = await firstTurn.locator('.thread-turn-fallback').innerText();
    const retryAvailable = await firstTurn.getByRole('button', { name: 'Retry Gemini' }).isVisible();
    const usefulCalculationsRetained = /21\.6 g carbohydrate for 30 g/.test(firstAnswer) && /0\.15 g sugars for 30 g/.test(firstAnswer);
    const claimDistinctionShown = /printed claim and the requested nutrition-panel amount are separate/i.test(firstAnswer);
    await page.getByLabel('Ask about this package').fill('Would that change the meal total?');
    await page.getByRole('button', { name: 'Send follow-up' }).click();
    const followupTurn = page.locator('.thread-turn').last();
    await followupTurn.locator('.thread-turn-fallback').waitFor({ state: 'visible' });
    const followupAnswer = await followupTurn.locator('.thread-assistant-message').innerText();
    const packageOnlyBoundaryShown = /package-only calculation; a combined meal total needs separate amounts and nutrition data for any other foods/i.test(followupAnswer);
    const followupRetainsSupportedCalculation = /21\.6 g carbohydrate for 30 g/.test(followupAnswer);
    const failureExplained = /unavailable|could not reach/i.test(failureDetail);
    const axe = await new AxeBuilder({ page }).analyze();
    const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    const screenshotName = viewport.width === 390 ? 'mobile.png' : 'desktop.png';
    await page.screenshot({ path: path.join(privateScreenshotDirectory, screenshotName), fullPage: true });
    outcomes.push({
      viewport,
      mockedProviderUnavailable: true,
      assistantRequestsIntercepted: assistantAttempts.length,
      previousQuestionReachedSecondTurn,
      claimDistinctionShown,
      usefulCalculationsRetained,
      packageOnlyBoundaryShown,
      followupRetainsSupportedCalculation,
      failureExplained,
      retryAvailable,
      pageErrors,
      axeViolationIds: axe.violations.map(violation => violation.id),
      horizontalOverflow,
      externalRequests: [...new Set(externalRequests)],
    });
    await context.close();
  }
} finally {
  await browser.close();
}

const passed = outcomes.length === 2 && outcomes.every(outcome =>
  outcome.assistantRequestsIntercepted === 2
  && outcome.previousQuestionReachedSecondTurn === true
  && outcome.claimDistinctionShown === true
  && outcome.usefulCalculationsRetained === true
  && outcome.packageOnlyBoundaryShown === true
  && outcome.followupRetainsSupportedCalculation === true
  && outcome.failureExplained === true
  && outcome.retryAvailable === true
  && Array.isArray(outcome.pageErrors) && outcome.pageErrors.length === 0
  && Array.isArray(outcome.axeViolationIds) && outcome.axeViolationIds.length === 0
  && outcome.horizontalOverflow === false
  && Array.isArray(outcome.externalRequests) && outcome.externalRequests.length === 0);
const receipt = {
  schemaVersion: 1,
  kind: 'mocked-provider-failure-claim-and-added-food-followup-browser-acceptance',
  generatedAt: new Date().toISOString(),
  evidenceClass: 'fictional sugar-free cracker and spinach-follow-up development journey with browser-intercepted 503; not a real Gemini failure, regulatory opinion or independent answer-quality result',
  baseOrigin: origin.origin,
  providerCallsReached: 0,
  outcomes,
  passed,
};
await writeFile(path.join(receiptDirectory, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(receipt, null, 2));
if (!passed) process.exitCode = 1;
