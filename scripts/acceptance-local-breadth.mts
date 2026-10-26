import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';

const baseUrl = process.env.NUTRISCAN_BASE_URL ?? 'http://127.0.0.1:3412';
const origin = new URL(baseUrl);
assert(['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname), 'Acceptance must use a loopback server.');
const statusResponse = await fetch(new URL('/api/status', baseUrl));
assert(statusResponse.ok, 'NutriScan status endpoint is unavailable.');
const status = await statusResponse.json();
assert.equal(status.gemini?.enabled, false, 'Disable Gemini before this provider-free acceptance run.');
assert.equal(status.gemini?.paidFallbackEnabled, false, 'Paid fallback must be disabled.');
assert.equal(status.developerDiagnostics?.readableEvaluationCapture, false, 'Readable evaluation capture must be disabled.');

const receiptDirectory = path.resolve('.data/m2-local-breadth-acceptance');
await mkdir(receiptDirectory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results: Array<Record<string, unknown>> = [];
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const providerCalls: string[] = [];
    const externalRequests: string[] = [];
    const pageErrors: string[] = [];
    await page.route('**/api/assist', async route => { providerCalls.push(`${route.request().method()} /api/assist`); await route.abort(); });
    await page.route('**/api/vision', async route => { providerCalls.push(`${route.request().method()} /api/vision`); await route.abort(); });
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('request', request => {
      const url = new URL(request.url());
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) externalRequests.push(url.origin);
      if (['/api/assist', '/api/vision'].includes(url.pathname)) providerCalls.push(`${request.method()} ${url.pathname}`);
    });
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent?.includes('Optional context') && !button.disabled));
    const onboarding = page.getByRole('dialog', { name: 'Make NutriScan yours' });
    if (await onboarding.isVisible().catch(() => false)) {
      await onboarding.getByLabel('Check ingredients and allergens').check();
      await onboarding.getByText('Add optional context', { exact: true }).click();
      await onboarding.getByLabel('Allergies').fill('peanuts');
      await onboarding.getByLabel('Health considerations or guidance').fill('type 2 diabetes');
      await onboarding.getByRole('button', { name: 'Continue' }).click();
      await onboarding.waitFor({ state: 'hidden' });
      await page.waitForFunction(() => !document.querySelector('dialog')?.open);
    }

    await page.locator('.empty-thread-advanced > summary').click();
    await page.locator('.local-only-settings > summary').click();
    const localOnly = page.getByRole('checkbox', { name: /Use local-only analysis in this tab/ });
    if (!(await localOnly.isChecked())) await localOnly.check();
    await page.locator('#initial-question').fill('Which ingredients and allergens are listed?');
    await page.getByRole('button', { name: 'Enter label text' }).click();
    await page.getByLabel('Label text').fill([
      'Synthetic evaluation label, not a real product',
      'Serving size 30 g',
      'Nutrition information per 100 g',
      'Energy 380 kcal',
      'Carbohydrate 60 g',
      'Sugars 4 g',
      'Fibre 8 g',
      'Sodium 760 mg',
      'Ingredients: Oats, milk powder, salt',
      'Contains: Milk',
      'May contain traces of peanuts',
      'Sugar free',
    ].join('\n'));
    await page.getByRole('button', { name: 'Read label text' }).click();
    await page.locator('.thread-workspace').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.thread-package-identity .badge').innerText(), 'No package photos');
    await page.getByRole('button', { name: 'Add photos' }).waitFor({ state: 'visible' });
    assert.equal(await page.locator('.thread-photo-strip').count(), 0);
    const firstAnswer = await page.locator('.thread-assistant-message').first().innerText();

    const ask = async (question: string, turn: number) => {
      await page.locator('#followup').fill(question);
      await page.getByRole('button', { name: 'Send follow-up' }).click();
      const answer = page.locator('.thread-assistant-message').nth(turn);
      await answer.waitFor({ state: 'visible' });
      return answer.innerText();
    };
    const portionAnswer = await ask('How much sodium is in 30 g?', 1);
    const claimAnswer = await ask('Does sugar free mean carbohydrate-free?', 2);
    const missingNutrientAnswer = await ask('Is calcium listed?', 3);
    const combinedContextAnswer = await ask('Is this suitable with my peanut allergy and diabetes?', 4);
    const contextualSodiumAnswer = await ask('For my 30 g portion, what does the sodium mean with hypertension and diabetes?', 5);
    const contextualSodiumTurn = page.locator('.thread-turn').filter({ hasText: 'For my 30 g portion, what does the sodium mean with hypertension and diabetes?' }).last();
    const contextualSodiumSources = contextualSodiumTurn.locator('.conversation-evidence');
    await contextualSodiumSources.waitFor({ state: 'visible' });
    await contextualSodiumSources.locator('summary').click();
    const contextualSodiumSourceText = await contextualSodiumSources.innerText();
    const sourceLimitations = contextualSodiumSources.locator('.fine-print').last();
    await sourceLimitations.scrollIntoViewIfNeeded();
    const sourceVisibility = await sourceLimitations.evaluate(limitation => {
      const scroll = limitation.closest<HTMLElement>('.thread-scroll');
      const composer = document.querySelector<HTMLElement>('.thread-composer');
      if (!scroll || !composer || !limitation) return null;
      const scrollRect = scroll.getBoundingClientRect();
      const composerRect = composer.getBoundingClientRect();
      const limitationRect = limitation.getBoundingClientRect();
      return {
        scrollTop: scrollRect.top,
        scrollBottom: scrollRect.bottom,
        composerTop: composerRect.top,
        limitationTop: limitationRect.top,
        limitationBottom: limitationRect.bottom,
        limitationScrollTop: scroll.scrollTop,
      };
    });
    const axe = await new AxeBuilder({ page }).analyze();
    const dimensions = await page.evaluate(() => ({
      viewport: { width: innerWidth, height: innerHeight },
      documentWidth: document.documentElement.scrollWidth,
    }));
    const result = {
      viewport: `${viewport.width}x${viewport.height}`,
      firstAnswer,
      portionAnswer,
      claimAnswer,
      missingNutrientAnswer,
      combinedContextAnswer,
      contextualSodiumAnswer,
      contextualSodiumSourceText,
      sourceVisibility,
      providerCalls,
      externalRequests: [...new Set(externalRequests)],
      pageErrors,
      axeViolations: axe.violations.map(item => item.id),
      documentWidth: dimensions.documentWidth,
      ...dimensions,
    };
    assert.match(firstAnswer, /Ingredients: Oats, milk powder, salt/);
    assert.match(firstAnswer, /May contain traces of peanuts/);
    assert.match(portionAnswer, /228 mg sodium/);
    assert.match(claimAnswer, /does not establish zero carbohydrate/);
    assert.match(missingNutrientAnswer, /No calcium amount is recorded/);
    assert.match(missingNutrientAnswer, /does not establish that the package contains none/);
    assert.match(combinedContextAnswer, /18 g carbohydrate/);
    assert.match(combinedContextAnswer, /May-contain precautionary wording/);
    assert.match(combinedContextAnswer, /cannot establish individual suitability/);
    assert.match(contextualSodiumAnswer, /228 mg sodium/);
    assert.match(contextualSodiumAnswer, /11\.4% of the WHO general adult reference/);
    assert.match(contextualSodiumAnswer, /not a personal sodium allowance/);
    assert.match(contextualSodiumSourceText, /Sodium reduction/);
    assert.match(contextualSodiumSourceText, /World Health Organization/);
    assert.match(contextualSodiumSourceText, /Population guidance, not an individualized prescription/);
    assert(sourceVisibility, 'The source limitation must be present in the rendered evidence card.');
    assert(sourceVisibility.limitationTop >= sourceVisibility.scrollTop - 1, 'The source limitation must remain inside the conversation scroll area.');
    assert(sourceVisibility.limitationBottom <= sourceVisibility.scrollBottom + 1, 'The source limitation must be scrollable above the conversation composer.');
    assert(sourceVisibility.scrollBottom <= sourceVisibility.composerTop + 1, 'The conversation composer must not overlap the scroll area.');
    assert.deepEqual(providerCalls, []);
    assert.deepEqual(result.externalRequests, []);
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(result.axeViolations, []);
    assert(dimensions.documentWidth <= viewport.width, 'The page must not overflow horizontally.');

    const prefix = viewport.width === 390 ? 'mobile' : 'desktop';
    await page.screenshot({ path: path.join(receiptDirectory, `${prefix}.png`), fullPage: true });
    results.push(result);
    await context.close();
  }
  const receipt = { status: 'passed', mode: 'local-only', provider: 'disabled and intercepted', results };
  await writeFile(path.join(receiptDirectory, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  process.stdout.write(JSON.stringify(receipt, null, 2));
} finally {
  await browser.close();
}
