import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { chromium, type Page } from '@playwright/test';

const baseUrl = process.env.NUTRISCAN_BASE_URL ?? 'http://127.0.0.1:3400';
assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseUrl).hostname), 'Acceptance requires a loopback app.');
assert((await fetch(new URL('/api/status', baseUrl), { signal: AbortSignal.timeout(15_000) })).ok, 'NutriScan status is unavailable.');
const photoPath = 'docs/evidence/private/nutella-nutrition-es-off-3017620422003.jpg';
const outcomes: Array<Record<string, unknown>> = [];

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
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const context = await browser.newContext({ viewport });
    await context.addInitScript(() => sessionStorage.setItem('nutriscan.onboarding.complete.v1', '1'));
    const page = await context.newPage();
    const pageErrors: string[] = [];
    const externalRequests: string[] = [];
    const providerCalls: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('request', request => {
      const url = new URL(request.url());
      if (['http:', 'https:'].includes(url.protocol) && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) externalRequests.push(url.hostname);
      if (url.pathname === '/api/assist') providerCalls.push(url.pathname);
    });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.getAttribute('aria-label') === 'Scan or add package photos' && !button.disabled), { timeout: 30_000 });
    await clearOnboarding(page);
    await page.locator('.empty-thread-advanced > summary').click();
    await page.locator('.local-only-settings > summary').click();
    const localOnly = page.getByRole('checkbox', { name: /Use local-only analysis in this tab/ });
    if (!await localOnly.isChecked()) await localOnly.check();
    await page.locator('#initial-question').fill('How much carbohydrate is in 20 g?');
    await page.getByRole('button', { name: 'Scan or add package photos' }).click();
    await page.getByLabel('Choose package sides').setInputFiles(photoPath);
    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Analyze package' }).click();
    await page.locator('.thread-workspace').waitFor({ state: 'visible', timeout: 90_000 });
    const turn = page.locator('.thread-turn').last();
    await turn.locator('.thread-assistant-message').waitFor({ state: 'visible' });
    await turn.locator('.thread-working').waitFor({ state: 'detached', timeout: 90_000 }).catch(() => {});
    const answer = await turn.locator('.thread-assistant-message').innerText();
    const inspector = page.locator('.advanced-inspector');
    if (await inspector.getAttribute('open') === null) await page.getByRole('button', { name: /Open package inspector/ }).click();
    await page.getByRole('button', { name: 'Package', exact: true }).click();
    await page.getByText('Full label table', { exact: false }).click();
    const carbohydrate = await page.locator('.nutrition-edit-table tbody tr').filter({ has: page.getByRole('rowheader', { name: /Carbohydrate/ }) }).innerText();
    const serving = await page.locator('.nutrition-edit-table tbody tr').filter({ has: page.getByRole('rowheader', { name: /Carbohydrate/ }) }).locator('td').nth(1).innerText();
    await page.getByRole('button', { name: 'Sources & OCR' }).click();
    await page.getByText('Raw OCR text & corrections', { exact: true }).click();
    const ocrObservations = await page.locator('.observations-list .observation-entry .ocr-line-text').allInnerTexts();
    const axe = await new AxeBuilder({ page }).analyze();
    const dimensions = await page.evaluate(() => ({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    const screenshotPath = path.resolve('.data/m3-local-language-gap', `${viewport.width}x${viewport.height}-nutella-es.png`);
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const outcome = {
      viewport: `${viewport.width}x${viewport.height}`,
      input: 'private non-held-out Spanish-language development photo; local-only OCR and answer',
      question: 'How much carbohydrate is in 20 g?', answer, carbohydrate, serving,
      ocrObservationCount: ocrObservations.length, ocrPreview: ocrObservations.slice(0, 10),
      providerCalls: providerCalls.length, externalRequests: [...new Set(externalRequests)], pageErrors,
      axeViolationIds: axe.violations.map(violation => violation.id), horizontalOverflow: dimensions.scrollWidth > dimensions.viewport,
      screenshotPath,
    };
    outcomes.push(outcome);
    console.log(JSON.stringify(outcome));
    await context.close();
  }
} finally {
  await browser.close();
}
assert.equal(outcomes.length, 2);
for (const outcome of outcomes) {
  assert.ok(Number(outcome.ocrObservationCount) > 0);
  assert.deepEqual(outcome.pageErrors, []);
  assert.deepEqual(outcome.externalRequests, []);
  assert.equal(outcome.providerCalls, 0);
  assert.deepEqual(outcome.axeViolationIds, []);
  assert.equal(outcome.horizontalOverflow, false);
}
await mkdir('.data/m3-local-language-gap', { recursive: true });
await writeFile('.data/m3-local-language-gap/receipt.json', `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), localLoopback: true, privatePhoto: true, diagnosticOnly: true, outcomes }, null, 2)}\n`);
