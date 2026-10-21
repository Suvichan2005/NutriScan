import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = process.env.NUTRISCAN_BASE_URL ?? 'http://127.0.0.1:3400';
const query = 'oat beta glucan';
const origin = new URL(baseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) throw new Error('Science acceptance accepts loopback origins only.');
const response = await fetch(baseUrl, { signal: AbortSignal.timeout(5000) });
if (!response.ok) throw new Error(`NutriScan is unavailable: HTTP ${response.status}.`);

const screenshotDirectory = path.resolve('docs/evidence/private/science-research');
await mkdir(screenshotDirectory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const outcomes: Array<Record<string, unknown>> = [];
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    const routeStatuses: number[] = [];
    const nonLoopbackRequests: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('request', (request) => {
      const requestUrl = new URL(request.url());
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(requestUrl.hostname)) nonLoopbackRequests.push(requestUrl.origin);
    });
    page.on('response', (routeResponse) => {
      if (new URL(routeResponse.url()).pathname === '/api/research') routeStatuses.push(routeResponse.status());
    });

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    await page.getByRole('button', { name: 'Paste label text' }).click();
    await page.getByRole('textbox', { name: 'Label text' }).fill('Ingredients: oats, water.');
    await page.getByRole('button', { name: 'Read label text' }).click();
    await page.locator('.results-section').waitFor({ state: 'visible' });
    await page.getByLabel('Public search terms').fill(query);
    await page.getByRole('button', { name: 'Research sources' }).click();
    const results = page.locator('.research-results article');
    await results.first().waitFor({ state: 'visible', timeout: 30_000 });
    const firstCard = results.first();
    const firstText = await firstCard.innerText();
    const abstractPreview = await firstCard.locator('p').first().innerText();
    const expandableAbstract = firstCard.getByText('Read full abstract or source excerpt', { exact: true });
    const hasExpandableAbstract = await expandableAbstract.count() === 1;
    const fullAbstractLength = hasExpandableAbstract
      ? await (async () => {
          await expandableAbstract.click();
          return (await firstCard.locator('details p').innerText()).length;
        })()
      : abstractPreview.length;
    if (hasExpandableAbstract) await expandableAbstract.click();
    const sourceHref = await firstCard.getByRole('link').first().getAttribute('href');
    const allText = await page.locator('.research-results').innerText();
    const axe = await new AxeBuilder({ page }).analyze();
    const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    const prefix = viewport.width === 390 ? 'mobile' : 'desktop';
    await page.screenshot({ path: path.join(screenshotDirectory, `${prefix}.png`), fullPage: true });

    const outcome = {
      viewport: `${viewport.width}x${viewport.height}`,
      query,
      liveCandidateCount: await results.count(),
      officialEuropePmcSourceLink: Boolean(sourceHref?.startsWith('https://europepmc.org/article/')),
      abstractPreviewLength: abstractPreview.length,
      longAbstractAvailableOnDemand: hasExpandableAbstract && fullAbstractLength > abstractPreview.length,
      publicationMetadataVisible: /published/i.test(firstText) && /retrieved/i.test(firstText),
      candidateScopeVisible: /candidate publications, not an evidence synthesis or personalized advice/i.test(await page.locator('.remote-status').innerText()),
      studyQualityLimitVisible: /study quality, dose, population, conflicts, retraction status and applicability have not been assessed/i.test(allText),
      noRawHtmlRendered: !/<(?:script|iframe|img)\b/i.test(allText),
      researchRouteStatuses: routeStatuses,
      noNonLoopbackBrowserRequests: nonLoopbackRequests.length === 0,
      horizontalOverflow,
      axeViolationIds: axe.violations.map((violation) => violation.id).sort(),
      pageErrors,
      screenshot: `docs/evidence/private/science-research/${prefix}.png`,
    };
    outcomes.push(outcome);
    await context.close();
  }
} finally {
  await browser.close();
}

const receipt = {
  schemaVersion: 1,
  kind: 'live-science-research-browser-acceptance',
  generatedAt: new Date().toISOString(),
  browser: 'Chrome via Playwright, headless',
  origin: 'loopback; public Europe PMC requests are made server-side',
  query,
  upstream: 'Europe PMC REST API',
  limitations: ['Live literature discovery returns candidates, not a checked evidence synthesis.', 'This query and its results do not establish study quality, dose, population applicability, consensus, or a personal recommendation.'],
  outcomes,
};
await writeFile('docs/evidence/science-research-browser.json', `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ receipt: 'docs/evidence/science-research-browser.json', outcomes }, null, 2));
if (outcomes.length !== 2 || outcomes.some((outcome) => !outcome.liveCandidateCount || !outcome.officialEuropePmcSourceLink || outcome.abstractPreviewLength > 400 || !outcome.longAbstractAvailableOnDemand || !outcome.publicationMetadataVisible || !outcome.candidateScopeVisible || !outcome.studyQualityLimitVisible || !outcome.noRawHtmlRendered || !outcome.researchRouteStatuses.includes(200) || !outcome.noNonLoopbackBrowserRequests || outcome.horizontalOverflow || outcome.axeViolationIds.length || outcome.pageErrors.length)) process.exitCode = 1;
