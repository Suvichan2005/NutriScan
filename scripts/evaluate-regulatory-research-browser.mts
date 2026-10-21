import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = process.env.NUTRISCAN_BASE_URL ?? 'http://127.0.0.1:3400';
const query = 'Is this ORS legal in India today?';
const origin = new URL(baseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) throw new Error('Regulatory acceptance accepts loopback origins only.');
const response = await fetch(baseUrl, { signal: AbortSignal.timeout(5000) });
if (!response.ok) throw new Error(`NutriScan is unavailable: HTTP ${response.status}.`);

await mkdir(path.resolve('docs/evidence/private/regulatory-research'), { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const outcomes: Array<Record<string, unknown>> = [];
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    const routeStatuses: number[] = [];
    const nonLoopbackRequests: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('request', request => {
      const requestUrl = new URL(request.url());
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(requestUrl.hostname)) nonLoopbackRequests.push(requestUrl.origin);
    });
    page.on('response', routeResponse => {
      if (new URL(routeResponse.url()).pathname === '/api/research') routeStatuses.push(routeResponse.status());
    });
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    await page.getByRole('button', { name: 'Paste label text' }).click();
    await page.getByRole('textbox', { name: 'Label text' }).fill('Ingredients: glucose, sodium chloride, potassium chloride, citrate.');
    await page.getByRole('button', { name: 'Read label text' }).click();
    await page.locator('.results-section').waitFor({ state: 'visible' });
    await page.getByLabel('Public search terms').fill(query);
    await page.getByLabel('Research topic').selectOption('regulation');
    await page.getByRole('button', { name: 'Research sources' }).click();
    const results = page.locator('.research-results article');
    await results.first().waitFor({ state: 'visible', timeout: 30_000 });
    const first = results.first();
    const firstCategory = await first.locator('.eyebrow').innerText();
    const firstSummary = await first.locator('p').first().innerText();
    const more = first.getByText('Read full abstract or source excerpt', { exact: true });
    const hasDetails = await more.count() === 1;
    if (hasDetails) await more.click();
    const fullFirstSummary = hasDetails ? await first.locator('details p').innerText() : firstSummary;
    const firstLimitations = await first.locator('.fine-print').innerText();
    const allText = await page.locator('.research-results').innerText();
    const directOnlyCount = await page.locator('.research-results article').filter({ hasText: 'could not retrieve usable source text' }).count();
    const sourceOutcomes = await Promise.all(await results.all().then(cards => cards.map(async card => ({
      title: (await card.locator('h3').innerText()).replace(/\s*↗\s*$/, ''),
      textRetrieved: (await card.locator('p').first().innerText()).startsWith('Official PDF text excerpt'),
      sourceTextUnavailable: /could not retrieve usable source text/.test(await card.locator('p').first().innerText()),
    }))));
    const scanned2025Titles = new Set([
      'FSSAI withdrawal of prior ORS brand-name permissions',
      'FSSAI clarification on ORS in food-product names',
    ]);
    const unavailableScanned2025Count = sourceOutcomes.filter(source => scanned2025Titles.has(source.title) && source.sourceTextUnavailable).length;
    const historicalDirectionRetrieved = sourceOutcomes.some(source => source.title === 'FSSAI direction on ORS-substitute advertising and marketing' && source.textRetrieved);
    const remoteStatus = await page.locator('.remote-status').innerText();
    const axe = await new AxeBuilder({ page }).analyze();
    const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    const prefix = viewport.width === 390 ? 'mobile' : 'desktop';
    await page.screenshot({ path: path.resolve(`docs/evidence/private/regulatory-research/${prefix}.png`), fullPage: true });
    outcomes.push({
      viewport: `${viewport.width}x${viewport.height}`,
      candidateCount: await results.count(),
      firstCandidateCategory: firstCategory,
      historicalExcerptVisible: /02nd February, 2024/i.test(fullFirstSummary) && /ORS/i.test(fullFirstSummary),
      historicalDirectionRetrieved,
      supersededLimitVisible: /historical context only.*14 October 2025 withdrawal.*Do not apply/i.test(firstLimitations),
      failedSourcesRemainExplicit: unavailableScanned2025Count === scanned2025Titles.size,
      unavailableScanned2025Count,
      directOnlyCount,
      sourceOutcomes,
      currentLawAndProductComplianceUnverified: /Current legal status and package compliance remain unverified/i.test(remoteStatus),
      directSourcesNotRenderedAsHtml: !/<(?:script|iframe|img)\b/i.test(allText),
      researchRouteStatuses: routeStatuses,
      noNonLoopbackBrowserRequests: nonLoopbackRequests.length === 0,
      horizontalOverflow,
      axeViolationIds: axe.violations.map(violation => violation.id).sort(),
      pageErrors,
      screenshot: `docs/evidence/private/regulatory-research/${prefix}.png`,
    });
    await context.close();
  }
} finally { await browser.close(); }

const receipt = {
  schemaVersion: 1,
  kind: 'live-fssai-regulatory-research-browser-acceptance',
  generatedAt: new Date().toISOString(),
  browser: 'Chrome via Playwright, headless',
  origin: 'loopback; public FSSAI and court sources retrieved server-side',
  query,
  limitations: [
    'The extractable 2024 FSSAI order is superseded historical context, not current permission.',
    'The 2025 scanned FSSAI PDFs did not yield usable text; court-PDF extraction can vary across route attempts.',
    'The 2022 direction is historical evidence, and the 2024 order is superseded; neither establishes current legal status.',
    'This journey does not establish current law, exact product category or package compliance.',
  ],
  outcomes,
};
await writeFile('docs/evidence/regulatory-research-browser.json', `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ receipt: 'docs/evidence/regulatory-research-browser.json', outcomes }, null, 2));
if (outcomes.length !== 2 || outcomes.some(outcome => outcome.candidateCount !== 5 || !outcome.historicalExcerptVisible || !outcome.historicalDirectionRetrieved || !outcome.supersededLimitVisible || !outcome.failedSourcesRemainExplicit || !outcome.currentLawAndProductComplianceUnverified || !outcome.directSourcesNotRenderedAsHtml || !(outcome.researchRouteStatuses as number[]).includes(200) || !outcome.noNonLoopbackBrowserRequests || outcome.horizontalOverflow || (outcome.axeViolationIds as string[]).length || (outcome.pageErrors as string[]).length)) process.exitCode = 1;
