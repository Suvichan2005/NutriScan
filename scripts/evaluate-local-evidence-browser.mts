import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = process.env.NUTRISCAN_BASE_URL ?? 'http://127.0.0.1:3400';
const origin = new URL(baseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) throw new Error('Local-evidence acceptance accepts loopback origins only.');
const response = await fetch(baseUrl, { signal: AbortSignal.timeout(5000) });
if (!response.ok) throw new Error(`NutriScan is unavailable: HTTP ${response.status}.`);

const screenshotDirectory = path.resolve('docs/evidence/private/local-evidence');
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
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('request', (request) => {
      const requestUrl = new URL(request.url());
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(requestUrl.hostname)) nonLoopbackRequests.push(requestUrl.origin);
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
    await page.getByLabel('Public search terms').fill('INS 955');
    await page.getByRole('button', { name: 'Local evidence search' }).click();
    const evidenceCard = page.locator('.research-results article').filter({ hasText: 'Sucralose (955)' }).first();
    await evidenceCard.waitFor({ state: 'visible', timeout: 30_000 });
    const sourceLink = evidenceCard.getByRole('link').first();
    const sourceHref = await sourceLink.getAttribute('href');
    const sourceText = await evidenceCard.innerText();
    const exactCodexQuery = await page.getByLabel('Public search terms').inputValue() === 'INS 955';
    const exactCodexSourceVisible = /Sucralose \(955\)/.test(sourceText);
    const exactCodexSourceLink = sourceHref === 'https://www.fao.org/gsfaonline/additives/details.html?id=137';
    const codexPublisherAndJurisdictionVisible = /FAO\/WHO Codex Alimentarius/.test(sourceText) && /International Codex; not national authorization/.test(sourceText);
    const codexSourceLimitationsVisible = /does not establish dose, exposure, safety for an individual, or current Indian permission/i.test(sourceText);

    await page.getByLabel('Public search terms').fill('WHO adult naturally occurring dietary fibre 25 g daily');
    await page.getByRole('button', { name: 'Local evidence search' }).click();
    const whoEvidenceCard = page.locator('.research-results article').filter({ hasText: 'Carbohydrate intake for adults and children: WHO guideline' }).first();
    await whoEvidenceCard.waitFor({ state: 'visible', timeout: 30_000 });
    const whoSourceText = await whoEvidenceCard.innerText();
    const whoSourceLink = whoEvidenceCard.getByRole('link').first();
    const whoHref = await whoSourceLink.getAttribute('href');
    const axe = await new AxeBuilder({ page }).analyze();
    const prefix = viewport.width === 390 ? 'mobile' : 'desktop';
    await page.screenshot({ path: path.join(screenshotDirectory, `${prefix}.png`), fullPage: true });

    const outcome = {
      viewport: `${viewport.width}x${viewport.height}`,
      exactIdentifierQuery: exactCodexQuery,
      officialCodexSourceVisible: exactCodexSourceVisible,
      officialSourceLink: exactCodexSourceLink,
      publisherAndJurisdictionVisible: codexPublisherAndJurisdictionVisible,
      sourceLimitationsVisible: codexSourceLimitationsVisible,
      whoFibreQuery: await page.getByLabel('Public search terms').inputValue() === 'WHO adult naturally occurring dietary fibre 25 g daily',
      whoGuidelineVisible: /at least 25 g\/day of naturally occurring dietary fibre/.test(whoSourceText) && /400 g\/day of vegetables and fruits/.test(whoSourceText),
      whoOfficialSourceLink: whoHref === 'https://www.who.int/publications/i/9789240073593',
      whoPackageScopeLimitVisible: /cannot be directly equated with a packaged-food fibre declaration/i.test(whoSourceText),
      evidenceRouteStatuses: evidenceStatuses,
      noNonLoopbackRequests: nonLoopbackRequests.length === 0,
      axeViolationIds: axe.violations.map((violation) => violation.id).sort(),
      pageErrors,
      screenshot: `docs/evidence/private/local-evidence/${prefix}.png`,
    };
    outcomes.push(outcome);
    await context.close();
  }
} finally {
  await browser.close();
}

const receipt = {
  schemaVersion: 1,
  kind: 'local-evidence-search-browser-acceptance',
  generatedAt: new Date().toISOString(),
  browser: 'Chrome via Playwright, headless',
  origin: 'loopback',
  query: 'INS 955',
  sourceExpected: 'FAO/WHO Codex additive identity record for sucralose (955).',
  limitations: ['Uses an explicitly typed evidence query and a small curated source corpus.', 'Source retrieval is not proof of product ingredients, dose, exposure, safety for an individual or current Indian permission.'],
  outcomes,
};
await writeFile('docs/evidence/local-evidence-browser.json', `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ receipt: 'docs/evidence/local-evidence-browser.json', outcomes }, null, 2));
if (outcomes.length !== 2 || outcomes.some((outcome) => !outcome.exactIdentifierQuery || !outcome.officialCodexSourceVisible || !outcome.officialSourceLink || !outcome.publisherAndJurisdictionVisible || !outcome.sourceLimitationsVisible || !outcome.whoFibreQuery || !outcome.whoGuidelineVisible || !outcome.whoOfficialSourceLink || !outcome.whoPackageScopeLimitVisible || outcome.evidenceRouteStatuses.length < 2 || outcome.evidenceRouteStatuses.some((status) => status !== 200) || !outcome.noNonLoopbackRequests || outcome.axeViolationIds.length || outcome.pageErrors.length)) process.exitCode = 1;
