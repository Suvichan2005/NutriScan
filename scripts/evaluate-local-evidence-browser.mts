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
    await page.getByRole('textbox', { name: 'Ask about this package' }).fill('What is potassium sorbate?');
    await page.getByRole('button', { name: 'Send follow-up' }).click();
    const additiveFollowup = page.locator('.chat-turn').last();
    await additiveFollowup.getByText(/INS 202 is Potassium Sorbate/).waitFor({ state: 'visible' });
    const additiveFollowupText = await additiveFollowup.innerText();
    const additiveQuestionDoesNotAssertPresence = /does not establish that this package contains it/i.test(additiveFollowupText);
    const additiveAnswerSourceVisible = await page.locator('.sources-section').getByText('JECFA additive identity: Potassium Sorbate (202)').count() > 0;

    await page.getByLabel('Public search terms').fill('INS 211');
    const exactIdentifierQuery = await page.getByLabel('Public search terms').inputValue() === 'INS 211';
    await page.getByRole('button', { name: 'Local evidence search' }).click();
    const sodiumBenzoateCard = page.locator('.research-results article').filter({ hasText: 'Sodium Benzoate (211)' }).first();
    await sodiumBenzoateCard.waitFor({ state: 'visible', timeout: 30_000 });
    const sodiumBenzoateText = await sodiumBenzoateCard.innerText();
    const sodiumBenzoateHref = await sodiumBenzoateCard.getByRole('link').first().getAttribute('href');
    const sodiumBenzoateLimitVisible = /does not establish ingredient presence, amount, food-category permission/i.test(sodiumBenzoateText);
    const sodiumBenzoatePublisherAndJurisdictionVisible = /Joint FAO\/WHO Expert Committee on Food Additives/.test(sodiumBenzoateText) && /International JECFA specifications; not national authorization/.test(sodiumBenzoateText);

    await page.getByLabel('Public search terms').fill('WHO adult naturally occurring dietary fibre 25 g daily');
    const whoFibreQuery = await page.getByLabel('Public search terms').inputValue() === 'WHO adult naturally occurring dietary fibre 25 g daily';
    await page.getByRole('button', { name: 'Local evidence search' }).click();
    const whoEvidenceCard = page.locator('.research-results article').filter({ hasText: 'Carbohydrate intake for adults and children: WHO guideline' }).first();
    await whoEvidenceCard.waitFor({ state: 'visible', timeout: 30_000 });
    const whoSourceText = await whoEvidenceCard.innerText();
    const whoSourceLink = whoEvidenceCard.getByRole('link').first();
    const whoHref = await whoSourceLink.getAttribute('href');

    await page.getByLabel('Public search terms').fill('What does WHO mean by free sugars?');
    const whoSugarQuery = await page.getByLabel('Public search terms').inputValue() === 'What does WHO mean by free sugars?';
    await page.getByRole('button', { name: 'Local evidence search' }).click();
    const whoSugarCard = page.locator('.research-results article').filter({ hasText: 'Guideline: sugars intake for adults and children' }).first();
    await whoSugarCard.waitFor({ state: 'visible', timeout: 30_000 });
    const whoSugarText = await whoSugarCard.innerText();
    const whoSugarHref = await whoSugarCard.getByRole('link').first().getAttribute('href');
    const whoSugarScreenshot = `docs/evidence/private/local-evidence/${viewport.width === 390 ? 'mobile' : 'desktop'}-who-free-sugars.png`;
    await whoSugarCard.screenshot({ path: path.resolve(whoSugarScreenshot) });

    await page.getByLabel('Public search terms').fill('What is the weather forecast for Delhi tomorrow?');
    await page.getByRole('button', { name: 'Local evidence search' }).click();
    const outOfDomainNotice = page.locator('.remote-status').filter({ hasText: 'No local source candidate cleared the conservative relevance floor' });
    await outOfDomainNotice.waitFor({ state: 'visible', timeout: 30_000 });
    const unrelatedQueryAbstained = await page.locator('.research-results article').count() === 0;

    await page.getByLabel('Public search terms').fill('Is an ORS food product name currently allowed in India?');
    await page.getByRole('button', { name: 'Local evidence search' }).click();
    const regulatoryNotice = page.locator('.remote-status').filter({ hasText: 'not a current-law source' });
    await regulatoryNotice.waitFor({ state: 'visible', timeout: 30_000 });
    const currentLawQueryAbstained = await page.locator('.research-results article').count() === 0;

    await page.getByLabel('Public search terms').fill('What is the current FSSAI labelling rule for nutrition declarations?');
    await page.getByRole('button', { name: 'Local evidence search' }).click();
    const fssaiNotice = page.locator('.remote-status').filter({ hasText: 'not a current-law source' });
    await fssaiNotice.waitFor({ state: 'visible', timeout: 30_000 });
    const fssaiQueryAbstained = await page.locator('.research-results article').count() === 0;
    const axe = await new AxeBuilder({ page }).analyze();
    const prefix = viewport.width === 390 ? 'mobile' : 'desktop';
    await page.screenshot({ path: path.join(screenshotDirectory, `${prefix}.png`), fullPage: true });

    const outcome = {
      viewport: `${viewport.width}x${viewport.height}`,
      exactIdentifierQuery,
      officialJecfaSourceVisible: /Sodium Benzoate \(211\)/.test(sodiumBenzoateText),
      officialSourceLink: sodiumBenzoateHref === 'https://www.fao.org/food/food-safety-quality/scientific-advice/jecfa/jecfa-additives/details-simple/en/?ins_id=211',
      publisherAndJurisdictionVisible: sodiumBenzoatePublisherAndJurisdictionVisible,
      sourceLimitationsVisible: sodiumBenzoateLimitVisible,
      additiveNameFollowupGrounded: /INS 202 is Potassium Sorbate/.test(additiveFollowupText),
      additiveQuestionDoesNotAssertPresence,
      additiveAnswerSourceVisible,
      whoFibreQuery,
      whoGuidelineVisible: /at least 25 g\/day of naturally occurring dietary fibre/.test(whoSourceText) && /400 g\/day of vegetables and fruits/.test(whoSourceText),
      whoOfficialSourceLink: whoHref === 'https://www.who.int/publications/i/9789240073593',
      whoPackageScopeLimitVisible: /cannot be directly equated with a packaged-food fibre declaration/i.test(whoSourceText),
      whoSugarQuery,
      whoFreeSugarGuidelineVisible: /less than 10% of total daily energy/i.test(whoSugarText) && /honey, syrups, fruit juices/i.test(whoSugarText),
      whoSugarOfficialSourceLink: whoSugarHref === 'https://www.who.int/publications/i/item/9789241549028',
      whoSugarPackageScopeLimitVisible: /not a product threshold, per-serving target or individualized prescription/i.test(whoSugarText),
      whoSugarScreenshot,
      unrelatedQueryAbstained,
      currentLawQueryAbstained,
      fssaiQueryAbstained,
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
  query: 'Potassium sorbate conversational follow-up; INS 211; WHO free-sugars guidance; WHO dietary-fibre guidance',
  sourceExpected: 'FAO/WHO JECFA additive identity record, WHO carbohydrate-quality guidance and WHO free-sugars guideline.',
  limitations: ['Uses explicitly typed queries and a small curated source corpus.', 'The development relevance floor and query-intent guard are not calibrated on independent user queries.', 'Source retrieval is not proof of product ingredients, dose, exposure, safety for an individual or current Indian permission.'],
  outcomes,
};
await writeFile('docs/evidence/local-evidence-browser.json', `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ receipt: 'docs/evidence/local-evidence-browser.json', outcomes }, null, 2));
if (outcomes.length !== 2 || outcomes.some((outcome) => !outcome.exactIdentifierQuery || !outcome.officialJecfaSourceVisible || !outcome.officialSourceLink || !outcome.publisherAndJurisdictionVisible || !outcome.sourceLimitationsVisible || !outcome.additiveNameFollowupGrounded || !outcome.additiveQuestionDoesNotAssertPresence || !outcome.additiveAnswerSourceVisible || !outcome.whoFibreQuery || !outcome.whoGuidelineVisible || !outcome.whoOfficialSourceLink || !outcome.whoPackageScopeLimitVisible || !outcome.whoSugarQuery || !outcome.whoFreeSugarGuidelineVisible || !outcome.whoSugarOfficialSourceLink || !outcome.whoSugarPackageScopeLimitVisible || !outcome.unrelatedQueryAbstained || !outcome.currentLawQueryAbstained || !outcome.fssaiQueryAbstained || outcome.evidenceRouteStatuses.length !== 6 || outcome.evidenceRouteStatuses.some((status) => status !== 200) || !outcome.noNonLoopbackRequests || outcome.axeViolationIds.length || outcome.pageErrors.length)) process.exitCode = 1;
