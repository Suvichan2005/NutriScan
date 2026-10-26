import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';

const baseUrl = process.env.NUTRISCAN_BASE_URL ?? 'http://127.0.0.1:3418';
const origin = new URL(baseUrl);
assert(['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname), 'Acceptance must use a loopback origin.');
const statusResponse = await fetch(new URL('/api/status', baseUrl));
assert(statusResponse.ok, 'NutriScan status endpoint is unavailable.');
const status = await statusResponse.json();
assert.equal(status.gemini?.enabled, false, 'Gemini must be disabled for this provider-free acceptance.');
assert.equal(status.gemini?.paidFallbackEnabled, false, 'Paid fallback must be disabled.');
assert.equal(status.gemini?.searchEnabled, false, 'Search grounding must be disabled.');
assert.equal(status.developerDiagnostics?.readableEvaluationCapture, false, 'Readable evaluation capture must be disabled.');

const captureDir = path.resolve('.data/m2-sweetened-dairy-transfer-20261027');
await mkdir(captureDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const outcomes: Array<Record<string, unknown>> = [];
const viewports = [{ width: 390, height: 844 }, { width: 1440, height: 900 }];
const labelText = [
  'Synthetic development label, not a real product',
  'Serving size 200 ml',
  'Nutrition information per 100 ml',
  'Energy 125 kcal',
  'Carbohydrate 13 g',
  'Total sugars 12 g',
  'Protein 3 g',
  'Sodium 90 mg',
  'Ingredients: Milk, water, sugar, cocoa',
  'Contains: Milk',
].join('\n');

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    const externalOrigins = new Set<string>();
    const providerCalls: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('request', request => {
      const url = new URL(request.url());
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) externalOrigins.add(url.origin);
      if (['/api/assist', '/api/vision'].includes(url.pathname)) providerCalls.push(`${request.method()} ${url.pathname}`);
    });
    await page.route('**/api/assist', async route => { providerCalls.push(`${route.request().method()} /api/assist`); await route.abort(); });
    await page.route('**/api/vision', async route => { providerCalls.push(`${route.request().method()} /api/vision`); await route.abort(); });
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent?.includes('Optional context') && !button.disabled));

    const onboarding = page.getByRole('dialog', { name: 'Make NutriScan yours' });
    if (await onboarding.isVisible().catch(() => false)) {
      await onboarding.getByLabel('Check ingredients and allergens').check();
      await onboarding.getByText('Add optional context', { exact: true }).click();
      await onboarding.getByLabel('Health considerations or guidance').fill('Fictional development context: type 2 diabetes and hypertension');
      await onboarding.getByRole('button', { name: 'Continue', exact: true }).click();
      await onboarding.waitFor({ state: 'hidden' });
    }
    await page.locator('.empty-thread-advanced > summary').click();
    await page.locator('.local-only-settings > summary').click();
    const localOnly = page.getByRole('checkbox', { name: /Use local-only analysis in this tab/ });
    if (!(await localOnly.isChecked())) await localOnly.check();
    await page.getByRole('button', { name: 'Optional context', exact: true }).click();
    await page.getByLabel('Health considerations or professional guidance').fill('Fictional development context: type 2 diabetes and hypertension');
    await page.getByRole('button', { name: 'Use for this session', exact: true }).click();
    await page.locator('dialog').waitFor({ state: 'hidden' });
    await page.locator('#initial-question').fill('What ingredients are listed?');
    await page.getByRole('button', { name: 'Enter label text' }).click();
    await page.getByLabel('Label text').fill(labelText);
    await page.getByRole('button', { name: 'Read label text' }).click();
    await page.locator('.thread-workspace').waitFor({ state: 'visible' });
    const initialAnswer = await page.locator('.thread-assistant-message').first().innerText();

    const ask = async (question: string, turn: number) => {
      await page.locator('#followup').fill(question);
      await page.getByRole('button', { name: 'Send follow-up' }).click();
      const answer = page.locator('.thread-assistant-message').nth(turn);
      await answer.waitFor({ state: 'visible' });
      return answer.innerText();
    };
    const portionAnswer = await ask('How much carbohydrate, sugar, and sodium are in 150 ml?', 1);
    const contextualQuestion = 'For my 150 ml portion, what does the sodium mean with hypertension and diabetes?';
    const contextualAnswer = await ask(contextualQuestion, 2);
    const contextualTurn = page.locator('.thread-turn').filter({ hasText: contextualQuestion }).last();
    const contextualSourceCard = contextualTurn.locator('.conversation-evidence');
    await contextualSourceCard.waitFor({ state: 'visible' });
    await contextualSourceCard.locator('summary').click();
    const contextualSourceText = await contextualSourceCard.innerText();
    const changedPortionAnswer = await ask('What if I have 250 ml instead?', 3);
    const absentNutrientAnswer = await ask('Is calcium listed?', 4);
    const guidanceAnswer = await ask('What does WHO say about sodium intake for adults?', 5);
    const sourceCard = page.locator('.conversation-evidence').filter({ hasText: /Sodium reduction/ }).last();
    await sourceCard.waitFor({ state: 'visible' });
    await sourceCard.locator('summary').click();
    const sourceCardText = await sourceCard.innerText();
    const axe = await new AxeBuilder({ page }).analyze();
    const viewportState = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth }));

    assert.match(initialAnswer, /Ingredients: Milk, water, sugar, cocoa/i);
    assert.match(portionAnswer, /19\.5 g carbohydrate/i);
    assert.match(portionAnswer, /18 g (?:total )?sugars/i);
    assert.match(portionAnswer, /135 mg sodium/i);
    assert.match(contextualAnswer, /19\.5 g carbohydrate/i);
    assert.match(contextualAnswer, /135 mg sodium/i);
    assert.match(contextualAnswer, /6\.75% of the WHO general adult reference/i);
    assert.match(contextualAnswer, /not a personal sodium allowance/i);
    assert.match(changedPortionAnswer, /32\.5 g carbohydrate/i);
    assert.match(changedPortionAnswer, /30 g (?:total )?sugars/i);
    assert.match(changedPortionAnswer, /225 mg sodium/i);
    assert.match(absentNutrientAnswer, /No calcium amount is recorded/i);
    assert.match(absentNutrientAnswer, /does not establish that the package contains none/i);
    assert.match(guidanceAnswer, /population|general adult/i);
    assert.match(sourceCardText, /World Health Organization|WHO/i);
    assert.match(contextualSourceText, /general adult population/i);
    assert.deepEqual(providerCalls, []);
    assert.deepEqual([...externalOrigins], []);
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(axe.violations.map(item => item.id), []);
    assert(viewportState.documentWidth <= viewportState.width, 'The page must not overflow horizontally.');

    const prefix = viewport.width === 390 ? 'mobile' : 'desktop';
    await page.screenshot({ path: path.join(captureDir, `${prefix}.png`), fullPage: true });
    outcomes.push({
      viewport: `${viewport.width}x${viewport.height}`,
      distinctSyntheticFamily: 'sweetened dairy drink',
      ingredientObservationVisible: true,
      portion150mlCalculationVisible: true,
      combinedProfileAnswerVisible: true,
      contextualSourceScopeVisible: true,
      changedPortion250mlCalculationVisible: true,
      missingCalciumRemainsUnknown: true,
      adultSodiumSourceVisible: true,
      sourceCardText,
      contextualSourceText,
      providerCalls,
      externalOrigins: [...externalOrigins],
      pageErrors,
      axeViolations: axe.violations.map(item => item.id),
      ...viewportState,
    });
    await context.close();
  }

  const receipt = {
    schemaVersion: 1,
    kind: 'provider-free-sweetened-dairy-conversation-transfer',
    generatedAt: new Date().toISOString(),
    appOrigin: origin.origin,
    scenario: 'Synthetic milk drink; fictional session-only diabetes and hypertension context; no image or real patient data.',
    screenshots: captureDir,
    results: outcomes,
    passed: outcomes.length === 2,
  };
  await writeFile('docs/evidence/m2-sweetened-dairy-transfer-20261027.json', `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  process.stdout.write(JSON.stringify({ receipt: 'docs/evidence/m2-sweetened-dairy-transfer-20261027.json', passed: receipt.passed, results: outcomes }, null, 2));
} finally {
  await browser.close();
}
