import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = process.env.NUTRISCAN_BASE_URL ?? 'http://127.0.0.1:3400';
const origin = new URL(baseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) throw new Error('Package-text acceptance only accepts a loopback origin.');
if (!(await fetch(baseUrl, { signal: AbortSignal.timeout(5000) })).ok) throw new Error('NutriScan is unavailable.');

const captureDir = path.resolve('docs/evidence/private/package-text-conversation');
await mkdir(captureDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const outcomes: Array<Record<string, unknown>> = [];
const viewports = [{ width: 390, height: 844 }, { width: 1440, height: 900 }];
const labelText = [
  'Synthetic evaluation label, not a real product',
  'Nutrition information per 100 g',
  'Energy 380 kcal',
  'Carbohydrate 60 g',
  'Ingredients: Oats, milk powder, salt',
  'Contains: Milk',
  'High protein',
].join('\n');

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    const nonLoopbackRequests: string[] = [];
    const providerCalls: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('request', request => {
      const requestUrl = new URL(request.url());
      if (requestUrl.origin !== 'null' && !['127.0.0.1', 'localhost', '[::1]'].includes(requestUrl.hostname)) nonLoopbackRequests.push(requestUrl.origin);
      if (['/api/assist', '/api/vision'].includes(requestUrl.pathname)) providerCalls.push(`${request.method()} ${requestUrl.pathname}`);
    });
    const prefix = viewport.width === 390 ? 'mobile' : 'desktop';
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    const intakeAxe = await new AxeBuilder({ page }).analyze();
    await page.screenshot({ path: path.join(captureDir, `${prefix}-01-intake.png`) });

    await page.getByRole('button', { name: 'Optional context', exact: true }).click();
    await page.getByLabel('What are you trying to understand?').fill('Synthetic profile text must remain session-only');
    await page.getByRole('button', { name: 'Use for this session' }).click();

    await page.getByLabel('What would you like to find out?').fill('What ingredients are listed?');
    await page.getByRole('button', { name: 'Paste label text' }).click();
    await page.getByLabel('Label text').fill(labelText);
    await page.getByRole('button', { name: 'Read label text' }).click();
    await page.locator('.results-section').waitFor({ state: 'visible' });
    await page.locator('.assistant-message').filter({ hasText: /Ingredients: Oats, milk powder, salt/ }).first().waitFor({ state: 'visible' });
    await page.getByText('Recorded ingredient text').waitFor({ state: 'visible' });
    const observationDisclosure = await page.locator('.assistant-message').filter({ hasText: /observations, not independently verified product facts/ }).first().isVisible();
    const firstAnswerAxe = await new AxeBuilder({ page }).analyze();

    await page.getByLabel('Ask about this package').fill('Is milk mentioned in an allergen statement?');
    await page.getByRole('button', { name: 'Send follow-up' }).click();
    await page.locator('.assistant-message').filter({ hasText: /Contains: Milk/ }).last().waitFor({ state: 'visible' });
    await page.getByText('Recorded allergen statement').waitFor({ state: 'visible' });
    const conversationAxe = await new AxeBuilder({ page }).analyze();
    await page.screenshot({ path: path.join(captureDir, `${prefix}-02-grounded-conversation.png`), fullPage: true });

    await page.getByRole('checkbox', { name: /Save this local conversation on this device/ }).check();
    await page.getByRole('button', { name: /Recent scans/ }).click();
    await page.getByRole('button', { name: /2 local turns/ }).waitFor({ state: 'visible' });
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /Recent scans/ }).click();
    await page.getByRole('button', { name: /2 local turns/ }).click();
    await page.locator('.chat-turn').filter({ hasText: /What ingredients are listed\?/ }).waitFor({ state: 'visible' });
    const restoredTurnCount = await page.locator('.chat-turn').count();
    await page.getByRole('button', { name: 'Optional context', exact: true }).click();
    const restoredProfileValue = await page.getByLabel('What are you trying to understand?').inputValue();
    const restoredProfileRemainedBlank = restoredProfileValue === '';
    await page.getByRole('button', { name: 'Use for this session' }).click();
    const restoredAxe = await new AxeBuilder({ page }).analyze();
    await page.getByRole('checkbox', { name: /Save this local conversation on this device/ }).uncheck();
    await page.getByRole('button', { name: /Recent scans/ }).click();
    const packageOnlyHistory = page.getByRole('button', { name: /saved label/ }).first();
    await packageOnlyHistory.waitFor({ state: 'visible' });
    const conversationRemovalConfirmed = !(await packageOnlyHistory.innerText()).includes('local turns');

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.getByLabel('What would you like to find out?').fill('What ingredients are listed?');
    await page.getByRole('button', { name: 'Paste label text' }).click();
    await page.getByLabel('Label text').fill('Synthetic evaluation label\nNutrition information per 100 g\nEnergy 380 kcal');
    await page.getByRole('button', { name: 'Read label text' }).click();
    await page.locator('.results-section').waitFor({ state: 'visible' });
    const missingTextAnswer = await page.locator('.assistant-message').first().innerText();
    const missingTextUnknown = /No readable ingredient text is recorded/i.test(missingTextAnswer) && /does not establish that the package has none/i.test(missingTextAnswer);
    const missingTextHasNoFinding = await page.getByText('Recorded ingredient text').count() === 0;
    const missingTextAxe = await new AxeBuilder({ page }).analyze();

    const axeViolationIds = [intakeAxe, firstAnswerAxe, conversationAxe, restoredAxe, missingTextAxe].flatMap(result => result.violations.map(violation => violation.id));
    const outcome = {
      viewport: `${viewport.width}x${viewport.height}`,
      syntheticLabelInput: true,
      observedIngredientQuestionAnswered: true,
      allergenFollowUpAnsweredFromRecordedText: true,
      localConversationOptInRestored: restoredTurnCount === 2,
      savedConversationTurnCount: restoredTurnCount,
      profileRemainedSessionOnly: restoredProfileRemainedBlank,
      conversationOptOutRemovedSavedTurns: conversationRemovalConfirmed,
      observationDisclosureVisible: observationDisclosure,
      missingTextRemainedUnknown: missingTextUnknown,
      missingTextProducedNoObservationFinding: missingTextHasNoFinding,
      axeViolationIds: [...new Set(axeViolationIds)].sort(),
      pageErrors,
      providerCalls,
      nonLoopbackRequestOrigins: [...new Set(nonLoopbackRequests)],
    };
    outcomes.push(outcome);
    console.log(JSON.stringify(outcome));
    if (!observationDisclosure || !missingTextUnknown || !missingTextHasNoFinding || !outcome.localConversationOptInRestored || !restoredProfileRemainedBlank || !conversationRemovalConfirmed || outcome.axeViolationIds.length || pageErrors.length || providerCalls.length || nonLoopbackRequests.length) process.exitCode = 1;
    await context.close();
  }

  const passed = outcomes.length === 2 && outcomes.every(outcome => outcome.observedIngredientQuestionAnswered === true && outcome.allergenFollowUpAnsweredFromRecordedText === true && outcome.localConversationOptInRestored === true && outcome.profileRemainedSessionOnly === true && outcome.conversationOptOutRemovedSavedTurns === true && outcome.observationDisclosureVisible === true && outcome.missingTextRemainedUnknown === true && outcome.missingTextProducedNoObservationFinding === true && Array.isArray(outcome.axeViolationIds) && outcome.axeViolationIds.length === 0 && Array.isArray(outcome.pageErrors) && outcome.pageErrors.length === 0 && Array.isArray(outcome.providerCalls) && outcome.providerCalls.length === 0 && Array.isArray(outcome.nonLoopbackRequestOrigins) && outcome.nonLoopbackRequestOrigins.length === 0);
  const receipt = { schemaVersion: 1, kind: 'synthetic-package-text-conversation-browser-acceptance', generatedAt: new Date().toISOString(), appOrigin: origin.origin, captureTool: 'Playwright using installed Chrome', evaluationInput: 'synthetic label text; not real-photo OCR evidence', persistence: 'explicit local opt-in restores 2 recent turns; opt-out removes saved turns; optional profile remains session-only', screenshots: 'docs/evidence/private/package-text-conversation', outcomes, passed };
  await writeFile('docs/evidence/package-text-conversation-browser.json', `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ receipt: 'docs/evidence/package-text-conversation-browser.json', passed }));
  if (!passed) process.exitCode = 1;
} finally {
  await browser.close();
}
