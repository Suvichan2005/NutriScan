import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = process.env.NUTRISCAN_BASE_URL ?? 'http://127.0.0.1:3400';
const origin = new URL(baseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) throw new Error('Conversational evidence acceptance accepts loopback origins only.');
const response = await fetch(baseUrl, { signal: AbortSignal.timeout(5000) });
if (!response.ok) throw new Error('NutriScan is unavailable: HTTP ' + response.status + '.');

const screenshotDirectory = path.resolve('docs/evidence/private/conversational-evidence');
await mkdir(screenshotDirectory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const outcomes: Array<Record<string, unknown>> = [];
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    const nonLoopbackRequests: string[] = [];
    const evidenceStatuses: number[] = [];
    const providerRoutes: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('request', (request) => {
      const requestUrl = new URL(request.url());
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(requestUrl.hostname)) nonLoopbackRequests.push(requestUrl.origin);
      if (/\/api\/(?:assist|vision)$/.test(requestUrl.pathname)) providerRoutes.push(requestUrl.pathname);
    });
    page.on('response', (routeResponse) => {
      if (new URL(routeResponse.url()).pathname === '/api/evidence') evidenceStatuses.push(routeResponse.status());
    });

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    await page.getByRole('button', { name: 'Paste label text' }).click();
    await page.getByRole('textbox', { name: 'Label text' }).fill('Ingredients: oats, water.');
    await page.getByRole('button', { name: 'Read label text' }).click();
    await page.locator('.results-section').waitFor({ state: 'visible' });

    const mealQuestion = 'How can I plan a meal around diabetes?';
    await page.getByRole('textbox', { name: 'Ask about this package' }).fill(mealQuestion);
    await page.getByRole('button', { name: 'Send follow-up' }).click();
    const mealTurn = page.locator('.chat-turn').last();
    const niddkCard = mealTurn.locator('.conversation-evidence article').filter({ hasText: 'Healthy Living with Diabetes' }).first();
    await niddkCard.waitFor({ state: 'visible', timeout: 30_000 });
    const niddkText = await niddkCard.innerText();
    const niddkHref = await niddkCard.getByRole('link').first().getAttribute('href');
    const responseText = await mealTurn.innerText();
    const summaryVisible = /Carbohydrates can raise blood glucose/.test(niddkText) && /carb counting/i.test(niddkText);
    const sourceScopeVisible = /United States; general diabetes education/.test(niddkText)
      && /not an Indian dietary composition table, an individualized meal plan, or a fixed carbohydrate allowance/.test(niddkText);
    const candidateCaveatVisible = /retrieval match is a discovery cue/i.test(responseText)
      && /does not establish that this source applies to this package or your personal situation/i.test(responseText);

    const unrelatedQuestion = 'Explain quantum mechanics.';
    await page.getByRole('textbox', { name: 'Ask about this package' }).fill(unrelatedQuestion);
    await page.getByRole('button', { name: 'Send follow-up' }).click();
    const unrelatedTurn = page.locator('.chat-turn').last();
    await unrelatedTurn.getByText(/did not return a source candidate above its development relevance floor/i)
      .waitFor({ state: 'visible', timeout: 30_000 });
    const noMatchAbstained = await unrelatedTurn.locator('.conversation-evidence article').count() === 0
      && /does not mean relevant evidence does not exist/i.test(await unrelatedTurn.innerText());

    const axe = await new AxeBuilder({ page }).analyze();
    const prefix = viewport.width === 390 ? 'mobile' : 'desktop';
    const screenshot = 'docs/evidence/private/conversational-evidence/' + prefix + '.png';
    await page.screenshot({ path: path.resolve(screenshot), fullPage: true });
    outcomes.push({
      viewport: viewport.width + 'x' + viewport.height,
      mealQuestion,
      summaryVisible,
      sourceScopeVisible,
      officialNiddkLink: niddkHref === 'https://www.niddk.nih.gov/health-information/diabetes/overview/healthy-living-with-diabetes',
      candidateCaveatVisible,
      noMatchAbstained,
      evidenceRouteStatuses: evidenceStatuses,
      noNonLoopbackRequests: nonLoopbackRequests.length === 0,
      noAssistOrVisionCalls: providerRoutes.length === 0,
      axeViolationIds: axe.violations.map((violation) => violation.id).sort(),
      pageErrors,
      screenshot,
    });
    await context.close();
  }
} finally {
  await browser.close();
}

const receipt = {
  schemaVersion: 1,
  kind: 'conversational-local-evidence-browser-acceptance',
  generatedAt: new Date().toISOString(),
  browser: 'Chrome via Playwright, headless',
  origin: 'loopback',
  input: 'Synthetic typed label; explicit general meal-planning and unrelated follow-up questions.',
  evidenceExpected: 'NIDDK Healthy Living with Diabetes source summary with its US scope and limitations; no match for quantum mechanics.',
  limitations: [
    'This verifies the UI-to-local-index journey and source presentation, not independent retrieval relevance or health-outcome accuracy.',
    'The package input is synthetic typed text; no real photo or OCR result is evaluated.',
    'Gemini is disabled; no provider call or model synthesis is tested.',
    'The local relevance floor has not been calibrated on an independent user-query set.'
  ],
  outcomes,
};
await writeFile('docs/evidence/conversational-evidence-browser.json', JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ receipt: 'docs/evidence/conversational-evidence-browser.json', outcomes }, null, 2));
if (outcomes.length !== 2 || outcomes.some((outcome) =>
  !outcome.summaryVisible || !outcome.sourceScopeVisible || !outcome.officialNiddkLink
  || !outcome.candidateCaveatVisible || !outcome.noMatchAbstained
  || (outcome.evidenceRouteStatuses as number[]).length !== 2 || (outcome.evidenceRouteStatuses as number[]).some((status) => status !== 200)
  || !outcome.noNonLoopbackRequests || !outcome.noAssistOrVisionCalls
  || (outcome.axeViolationIds as string[]).length > 0 || (outcome.pageErrors as string[]).length > 0
)) process.exitCode = 1;
