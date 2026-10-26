import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = process.env.NUTRISCAN_BASE_URL ?? 'http://127.0.0.1:3400';
const origin = new URL(baseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) throw new Error('Trans-fat acceptance only accepts a loopback origin.');
if (!(await fetch(baseUrl, { signal: AbortSignal.timeout(5000) })).ok) throw new Error('NutriScan is unavailable.');

const privateCaptureDirectory = path.resolve('docs/evidence/private/trans-fat-browser');
await mkdir(privateCaptureDirectory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const outcomes: Array<Record<string, unknown>> = [];
const syntheticLabel = [
  'Synthetic evaluation label, not a real product',
  'Nutrition information per 100 g',
  'Trans fat 0 g',
  'Ingredients: wheat flour, vegetable oil, salt',
].join('\n');

try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    const providerCalls: string[] = [];
    const nonLoopbackRequests: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('request', request => {
      const requestUrl = new URL(request.url());
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(requestUrl.hostname)) nonLoopbackRequests.push(requestUrl.origin);
      if (['/api/assist', '/api/vision'].includes(requestUrl.pathname)) providerCalls.push(`${request.method()} ${requestUrl.pathname}`);
    });

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
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
    if (!(await localOnly.isChecked())) await localOnly.check();
    await page.getByRole('button', { name: 'Enter label text' }).click();
    await page.getByRole('textbox', { name: 'Label text' }).fill(syntheticLabel);
    await page.getByRole('button', { name: 'Read label text' }).click();
    await page.locator('.thread-workspace').waitFor({ state: 'visible' });

    await page.getByRole('textbox', { name: 'Ask about this package' }).fill('What does the trans fat line mean?');
    await page.getByRole('button', { name: 'Send follow-up' }).click();
    const response = page.locator('.thread-turn').last();
    await response.locator('.thread-assistant-message').waitFor({ state: 'visible' });
    const responseText = await response.locator('.thread-assistant-message').innerText();
    const transFatNotStructured = await response.locator('[data-testid="thread-ui-component-portion-calculator"]').count() === 0;
    const observationIsRetainedAsUnverified = /“Trans fat 0 g” \(user-entered observation\)/.test(responseText)
      && /not verified facts/i.test(responseText)
      && /does not establish a numeric amount, zero, or a portion calculation/i.test(responseText);
    const populationGuidanceIsQualified = /below 1% of total energy is population guidance, not a personal target/i.test(responseText);
    const datedLawIsQualified = /dated rule summary does not determine current law or this product’s compliance/i.test(responseText);
    const sourceCard = response.locator('.conversation-evidence');
    if (await sourceCard.count()) await sourceCard.locator('summary').click();
    const sourceTitles = await response.innerText();
    const whoSourceVisible = /Trans fat/.test(sourceTitles);
    const fssaiSourceVisible = /Food Safety and Standards \(Prohibition and Restrictions on Sales\) Second Amendment Regulations, 2021: trans-fat limit/.test(sourceTitles);

    await page.getByRole('textbox', { name: 'Ask about this package' }).fill('What is the current FSSAI law for trans fat?');
    await page.getByRole('button', { name: 'Send follow-up' }).click();
    const currentLawResponse = page.locator('.thread-turn').last();
    await currentLawResponse.locator('.thread-assistant-message').waitFor({ state: 'visible' });
    const currentLawText = await currentLawResponse.locator('.thread-assistant-message').innerText();
    const currentLawAbstained = /Current legal or regulatory status is unresolved/i.test(currentLawText) && /exact product and jurisdiction/i.test(currentLawText);

    const axe = await new AxeBuilder({ page }).analyze();
    const name = viewport.width === 390 ? 'mobile' : 'desktop';
    await page.screenshot({ path: path.join(privateCaptureDirectory, `${name}-trans-fat-follow-up.png`), fullPage: true });
    const outcome = {
      viewport,
      syntheticTypedLabel: true,
      transFatNotStructured,
      observationIsRetainedAsUnverified,
      populationGuidanceIsQualified,
      datedLawIsQualified,
      whoSourceVisible,
      fssaiSourceVisible,
      currentLawAbstained,
      axeViolationIds: axe.violations.map(violation => violation.id),
      pageErrors,
      providerCalls,
      nonLoopbackRequests: [...new Set(nonLoopbackRequests)],
    };
    outcomes.push(outcome);
    await context.close();
  }
} finally {
  await browser.close();
}

const passed = outcomes.length === 2 && outcomes.every(outcome =>
  outcome.transFatNotStructured === true
  && outcome.observationIsRetainedAsUnverified === true
  && outcome.populationGuidanceIsQualified === true
  && outcome.datedLawIsQualified === true
  && outcome.whoSourceVisible === true
  && outcome.fssaiSourceVisible === true
  && outcome.currentLawAbstained === true
  && Array.isArray(outcome.axeViolationIds) && outcome.axeViolationIds.length === 0
  && Array.isArray(outcome.pageErrors) && outcome.pageErrors.length === 0
  && Array.isArray(outcome.providerCalls) && outcome.providerCalls.length === 0
  && Array.isArray(outcome.nonLoopbackRequests) && outcome.nonLoopbackRequests.length === 0);
const receipt = {
  schemaVersion: 1,
  kind: 'local-trans-fat-explanation-browser-acceptance',
  generatedAt: new Date().toISOString(),
  evidenceClass: 'synthetic typed-label product-flow acceptance; not photo accuracy, held-out retrieval, legal verification or model behavior',
  baseOrigin: origin.origin,
  providerCalls: 0,
  outcomes,
  passed,
};
await writeFile('docs/evidence/trans-fat-browser.json', `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(receipt, null, 2));
if (!passed) process.exitCode = 1;
