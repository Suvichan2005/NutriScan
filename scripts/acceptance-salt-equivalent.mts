import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = process.env.NUTRISCAN_BASE_URL ?? 'http://127.0.0.1:3400';
const origin = new URL(baseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) throw new Error('Salt-equivalent acceptance accepts loopback origins only.');
if (!(await fetch(baseUrl, { signal: AbortSignal.timeout(5000) })).ok) throw new Error('NutriScan is unavailable.');

const captures = path.resolve('docs/evidence/private/salt-equivalent');
await mkdir(captures, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const outcomes: Array<Record<string, unknown>> = [];
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    const externalRequests: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('request', (request) => {
      const host = new URL(request.url()).hostname;
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) externalRequests.push(new URL(request.url()).origin);
    });
    const prefix = viewport.width === 390 ? 'mobile' : 'desktop';
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    await page.getByLabel('What would you like to find out?').fill('At 30 g, how much salt?');
    const intakeAxe = (await new AxeBuilder({ page }).analyze()).violations.map((violation) => violation.id).sort();
    await page.screenshot({ path: path.join(captures, `${prefix}-intake.png`), fullPage: true });
    await page.getByRole('button', { name: 'Paste label text' }).click();
    await page.getByLabel('Label text').fill('Nutrition information per 100 g\nSodium 500 mg');
    await page.getByRole('button', { name: 'Read label text' }).click();
    await page.locator('.results-section').waitFor({ state: 'visible' });
    const conversation = page.locator('.conversation .assistant-message p').last();
    const response = (await conversation.innerText()).trim();
    const mathsDetails = page.locator('.nutrition-card .details-block');
    if (!(await mathsDetails.evaluate((details) => (details as HTMLDetailsElement).open))) await page.getByText('See the label & calculation maths').click();
    const sodiumRow = mathsDetails.locator('table tbody tr').filter({ hasText: 'Sodium' });
    const hasSodiumOnlyObservation = await sodiumRow.count() > 0;
    const hasApproximateSaltEquivalent = /approximately 0\.375 g salt equivalent/i.test(response);
    const answerSaysNotPrinted = /not a printed salt declaration/i.test(response);
    const calculationText = await mathsDetails.innerText();
    const calculationVisible = /approximate salt equivalent in 30 g: 500 mg sodium .* ÷ 400 mg sodium per g salt/i.test(calculationText);
    const axeViolationIds = (await new AxeBuilder({ page }).analyze()).violations.map((violation) => violation.id).sort();
    await page.screenshot({ path: path.join(captures, `${prefix}-result.png`), fullPage: true });
    outcomes.push({
      viewport: `${viewport.width}x${viewport.height}`,
      syntheticTextOnlyInput: true,
      sodiumObservationVisible: hasSodiumOnlyObservation,
      approximateSaltEquivalentAnswer: hasApproximateSaltEquivalent,
      notMisrepresentedAsPrintedSalt: answerSaysNotPrinted,
      calculationVisible,
      calculationDetails: calculationText,
      intakeAxeViolationIds: intakeAxe,
      resultAxeViolationIds: axeViolationIds,
      pageErrors,
      externalRequests: [...new Set(externalRequests)],
      screenshots: [`docs/evidence/private/salt-equivalent/${prefix}-intake.png`, `docs/evidence/private/salt-equivalent/${prefix}-result.png`],
    });
    await context.close();
  }
} finally {
  await browser.close();
}

const receipt = {
  schemaVersion: 1,
  kind: 'salt-equivalent-browser-acceptance',
  generatedAt: new Date().toISOString(),
  captureTool: 'Playwright using installed Chrome',
  origin: 'loopback',
  input: 'Synthetic text-only label: sodium 500 mg per 100 g; user asks for the salt equivalent at 30 g.',
  expectedCalculation: 'WHO approximate relation: 500 mg/100 g × 30 g ÷ 400 mg sodium per g salt = 0.375 g salt equivalent.',
  limitations: ['Synthetic typed text validates the user-facing conversion, not OCR or product identity.', 'The salt equivalent is approximate and is not a printed salt declaration or individual health guidance.'],
  outcomes,
};
await writeFile('docs/evidence/salt-equivalent-browser.json', `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ receipt: 'docs/evidence/salt-equivalent-browser.json', outcomes }, null, 2));
if (outcomes.length !== 2 || outcomes.some((outcome) => !outcome.sodiumObservationVisible || !outcome.approximateSaltEquivalentAnswer || !outcome.notMisrepresentedAsPrintedSalt || !outcome.calculationVisible || outcome.pageErrors.length || outcome.externalRequests.length || outcome.intakeAxeViolationIds.length || outcome.resultAxeViolationIds.length)) process.exitCode = 1;
