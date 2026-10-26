import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = process.env.NUTRISCAN_BASE_URL ?? 'http://127.0.0.1:3400';
const origin = new URL(baseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) throw new Error('Nutrient-claim acceptance only accepts a loopback origin.');
if (!(await fetch(baseUrl, { signal: AbortSignal.timeout(5000) })).ok) throw new Error('NutriScan is unavailable.');

const captureDirectory = path.resolve('docs/evidence/private/nutrient-claim-browser');
await mkdir(captureDirectory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const outcomes: Array<Record<string, unknown>> = [];
const label = [
  'Synthetic evaluation label, not a real product',
  'Nutrition information per 100 g',
  'Protein 8 g',
  'Fibre 8 g',
  'Sugars 4 g',
  'High protein',
  'High fibre',
  'Low sugars',
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
    await page.waitForFunction(() => {
      const dialog = document.querySelector('dialog.onboarding-dialog');
      const button = [...document.querySelectorAll('button')].find(item => item.textContent?.includes('Enter label text'));
      return !!dialog?.open || (!!button && !button.disabled);
    });
    const onboarding = page.getByRole('dialog', { name: 'Make NutriScan yours' });
    if (await onboarding.isVisible()) {
      await onboarding.getByRole('radio', { name: 'Understand a food claim' }).check();
      await onboarding.getByRole('button', { name: 'Continue' }).click();
    }
    await page.waitForFunction(() => {
      if (document.querySelector('dialog.onboarding-dialog')?.open) return false;
      const button = [...document.querySelectorAll('button')].find(item => item.textContent?.includes('Enter label text'));
      return !!button && !button.disabled;
    });
    await page.getByRole('button', { name: 'Enter label text' }).click();
    await page.getByRole('textbox', { name: 'Label text' }).fill(label);
    await page.getByRole('button', { name: 'Read label text' }).click();
    const composer = page.getByRole('textbox', { name: 'Ask about this package' });
    await composer.fill('What do high protein, high fibre and low sugars mean under FSSAI?');
    await page.getByRole('button', { name: 'Send follow-up' }).click();
    const response = page.locator('.thread-turn').last();
    await response.getByText(/lists these generic criteria/i).waitFor({ state: 'visible' });
    const responseText = await response.innerText();
    const criteriaExplained = /20% of RDA per 100 g for solids/.test(responseText)
      && /6 g per 100 g for solids/.test(responseText)
      && /not more than 5 g of sugars per 100 g for solids/.test(responseText);
    const labelTextStaysUnverified = /OCR observation|user-entered observation/.test(responseText)
      && /may be misread or transcribed incorrectly/i.test(responseText);
    const noComplianceVerdict = /does not determine which product basis applies.*establish whether the product makes or meets the claim/i.test(responseText)
      && !/the package (?:does|does not) qualify|the claim is compliant/i.test(responseText);
    const firstEvidence = response.locator('details.conversation-evidence');
    if (await firstEvidence.count()) await firstEvidence.locator('summary').click();
    const citedTitles = await response.locator('.conversation-evidence-title').allInnerTexts();
    const compendiumVisible = citedTitles.some(title => /Food Safety and Standards \(Advertising and Claims\) Regulations, 2018: Version IV Compendium/i.test(title));
    const amendmentIndexVisible = citedTitles.some(title => /Food Safety and Standards \(Advertising and Claims\) Regulations: Amendments index/i.test(title));

    await composer.fill('Does the high protein claim meet current FSSAI rules?');
    await page.getByRole('button', { name: 'Send follow-up' }).click();
    const currentRules = page.locator('.thread-turn').last();
    await currentRules.getByText(/Current legal or regulatory status is unresolved/i).waitFor({ state: 'visible' });
    const currentRulesText = await currentRules.innerText();
    const currentEvidence = currentRules.locator('details.conversation-evidence');
    if (await currentEvidence.count()) await currentEvidence.locator('summary').click();
    const currentEvidenceTitles = await currentRules.locator('.conversation-evidence-title').allInnerTexts();
    const currentSourcesVisible = currentEvidenceTitles.some(title => /Version IV Compendium/i.test(title))
      && currentEvidenceTitles.some(title => /Amendments index/i.test(title));
    const currentStatusAbstained = /(?:does|do) not establish current applicability or compliance/i.test(currentRulesText);

    const axe = await new AxeBuilder({ page }).analyze();
    const outcome = {
      viewport,
      syntheticTypedLabel: true,
      criteriaExplained,
      labelTextStaysUnverified,
      noComplianceVerdict,
      compendiumVisible,
      amendmentIndexVisible,
      currentSourcesVisible,
      currentStatusAbstained,
      axeViolationIds: axe.violations.map(violation => violation.id),
      pageErrors,
      providerCalls,
      nonLoopbackRequests: [...new Set(nonLoopbackRequests)],
    };
    outcomes.push(outcome);
    const name = viewport.width === 390 ? 'mobile' : 'desktop';
    await page.screenshot({ path: path.join(captureDirectory, `${name}-nutrient-claim-follow-up.png`), fullPage: true });
    await context.close();
  }
} finally {
  await browser.close();
}

const passed = outcomes.length === 2 && outcomes.every(outcome =>
  outcome.criteriaExplained === true
  && outcome.labelTextStaysUnverified === true
  && outcome.noComplianceVerdict === true
  && outcome.compendiumVisible === true
  && outcome.amendmentIndexVisible === true
  && outcome.currentSourcesVisible === true
  && outcome.currentStatusAbstained === true
  && Array.isArray(outcome.axeViolationIds) && outcome.axeViolationIds.length === 0
  && Array.isArray(outcome.pageErrors) && outcome.pageErrors.length === 0
  && Array.isArray(outcome.providerCalls) && outcome.providerCalls.length === 0
  && Array.isArray(outcome.nonLoopbackRequests) && outcome.nonLoopbackRequests.length === 0);
const receipt = {
  schemaVersion: 1,
  kind: 'local-nutrient-content-claim-browser-acceptance',
  generatedAt: new Date().toISOString(),
  evidenceClass: 'synthetic typed-label product-flow acceptance; not photo accuracy, held-out retrieval, current legal verification, or model behavior',
  baseOrigin: origin.origin,
  providerCalls: 0,
  outcomes,
  passed,
};
await writeFile('docs/evidence/nutrient-claim-browser.json', `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(receipt, null, 2));
if (!passed) process.exitCode = 1;
