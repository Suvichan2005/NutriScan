import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = process.env.NUTRISCAN_BASE_URL ?? 'http://127.0.0.1:3400';
const origin = new URL(baseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) throw new Error('FSSAI additive acceptance only accepts a loopback origin.');
if (!(await fetch(baseUrl, { signal: AbortSignal.timeout(5000) })).ok) throw new Error('NutriScan is unavailable.');

const query = 'What does FSSAI Appendix A list for xanthan gum INS 415 in dairy products?';
const captureDir = path.resolve('docs/evidence/private/fssai-additive-compendium');
await mkdir(captureDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const outcomes: Array<Record<string, unknown>> = [];

try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    const routeStatuses: number[] = [];
    const providerCalls: string[] = [];
    const nonLoopbackRequests: string[] = [];
    let routeStartedAt = 0;
    let researchRouteLatencyMs: number | null = null;
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('request', request => {
      const requestUrl = new URL(request.url());
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(requestUrl.hostname)) nonLoopbackRequests.push(requestUrl.origin);
      if (['/api/assist', '/api/vision'].includes(requestUrl.pathname)) providerCalls.push(`${request.method()} ${requestUrl.pathname}`);
      if (requestUrl.pathname === '/api/research') routeStartedAt = Date.now();
    });
    page.on('response', response => {
      if (new URL(response.url()).pathname !== '/api/research') return;
      routeStatuses.push(response.status());
      researchRouteLatencyMs = Date.now() - routeStartedAt;
    });

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    await page.getByRole('button', { name: 'Paste label text' }).click();
    await page.getByLabel('Label text').fill('Synthetic evaluation label\nNutrition information per 100 g\nEnergy 380 kcal\nIngredients: oats, sugar');
    await page.getByRole('button', { name: 'Read label text' }).click();
    await page.locator('.results-section').waitFor({ state: 'visible' });
    await page.getByLabel('Public search terms').fill(query);
    await page.getByLabel('Research topic').selectOption('regulation');
    await page.getByRole('button', { name: 'Research sources' }).click();
    const sourceCard = page.locator('.research-results article').filter({ hasText: /Appendix A/i }).first();
    await sourceCard.waitFor({ state: 'visible', timeout: 60_000 });
    const disclosure = sourceCard.getByText('Read full abstract or source excerpt', { exact: true });
    if (await disclosure.count() === 1) await disclosure.click();
    const fullText = await sourceCard.innerText();
    const expandedSummary = await sourceCard.locator('details p').innerText();
    const sourceUrl = await sourceCard.locator('h3 a').getAttribute('href');
    const publisher = await sourceCard.locator('small').innerText();
    const sourceLinkValid = !!sourceUrl && sourceUrl.startsWith('https://www.fssai.gov.in/') && /Appendix%20A(?:\(4\))?\.pdf/i.test(sourceUrl);
    const publisherIdentified = /Food Safety and Standards Authority of India/i.test(publisher);
    const amendmentIndexLinked = await page.locator('.research-results article h3 a[href*="food-products-standards"]').count() > 0;
    const excerptChecks = {
      sourceTextMarker: /Official PDF text excerpt/.test(expandedSummary),
      xanthanMention: /xanthan/i.test(expandedSummary),
      ins415Mention: /415/.test(expandedSummary),
      categoryTermInExcerpt: /dairy|0[1-9]\.\d{1,2}/i.test(expandedSummary),
    };
    const excerptVisible = excerptChecks.sourceTextMarker && excerptChecks.xanthanMention && excerptChecks.ins415Mention;
    const nonbindingDisclosure = /cannot be considered a legal document|not a legal document|nonbinding/i.test(fullText);
    const gazettePrecedenceDisclosure = /original.*(?:notifications|amendments).*prevail|Gazette.*prevail/i.test(fullText);
    const categoryApplicabilityCaveat = /exact food category and conditions of use/i.test(fullText);
    const currentStatusRemainsUnverified = /current legal status and package compliance remain unverified/i.test(await page.locator('.remote-status').last().innerText().catch(() => ''));
    const expandedSummaryChars = expandedSummary.length;
    const axe = await new AxeBuilder({ page }).analyze();
    const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    const prefix = viewport.width === 390 ? 'mobile' : 'desktop';
    await page.screenshot({ path: path.join(captureDir, `${prefix}.png`), fullPage: true });
    const outcome = {
      viewport: `${viewport.width}x${viewport.height}`,
      syntheticLabelInput: true,
      sourceLinkValid,
      publisherIdentified,
      amendmentIndexLinked,
      excerptVisible,
      excerptChecks,
      nonbindingDisclosure,
      gazettePrecedenceDisclosure,
      categoryApplicabilityCaveat,
      currentStatusRemainsUnverified,
      expandedSummaryChars,
      researchRouteStatuses: routeStatuses,
      researchRouteLatencyMs,
      providerCalls,
      nonLoopbackRequests: [...new Set(nonLoopbackRequests)],
      axeViolationIds: axe.violations.map(violation => violation.id).sort(),
      horizontalOverflow,
      pageErrors,
      screenshot: `docs/evidence/private/fssai-additive-compendium/${prefix}.png`,
    };
    outcomes.push(outcome);
    await context.close();
  }
} finally {
  await browser.close();
}

const passed = outcomes.length === 2 && outcomes.every(outcome =>
  outcome.syntheticLabelInput === true && outcome.sourceLinkValid === true && outcome.publisherIdentified === true && outcome.amendmentIndexLinked === true && outcome.excerptVisible === true &&
    outcome.nonbindingDisclosure === true && outcome.gazettePrecedenceDisclosure === true && outcome.categoryApplicabilityCaveat === true &&
  outcome.currentStatusRemainsUnverified === true && (outcome.expandedSummaryChars as number) <= 1250 &&
  (outcome.researchRouteStatuses as number[]).includes(200) && typeof outcome.researchRouteLatencyMs === 'number' &&
  (outcome.providerCalls as string[]).length === 0 && (outcome.nonLoopbackRequests as string[]).length === 0 &&
  (outcome.axeViolationIds as string[]).length === 0 && outcome.horizontalOverflow === false && (outcome.pageErrors as string[]).length === 0,
);
const receipt = {
  schemaVersion: 1,
  kind: 'live-fssai-additive-compendium-browser-acceptance',
  generatedAt: new Date().toISOString(),
  appOrigin: origin.origin,
  captureTool: 'Playwright using installed Chrome',
  query,
  evaluationInput: 'synthetic label text; official FSSAI source fetched on user action; no photo/OCR evaluation',
  evidenceLimits: [
    'The FSSAI compendium itself says it cannot be considered a legal document and that original Gazette notifications prevail.',
    'This verifies bounded source retrieval and disclosure only; exact category conditions, amendments, current permission and package compliance remain unresolved.',
    'The amendment index is offered for source discovery only; no Gazette amendment was fetched or interpreted by this test.',
    'The query and result do not establish that a product contains the additive or that a use is authorized for a specific food.',
  ],
  outcomes,
  passed,
};
await writeFile('docs/evidence/fssai-additive-compendium-browser.json', `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ receipt: 'docs/evidence/fssai-additive-compendium-browser.json', passed, outcomes }, null, 2));
if (!passed) process.exitCode = 1;
