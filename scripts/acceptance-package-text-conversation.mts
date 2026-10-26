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
  'Serving size 30 g',
  'Nutrition information per 100 g',
  'Energy 380 kcal',
  'Carbohydrate 60 g',
  'Sugars 4 g',
  'Fibre 8 g',
  'Ingredients: Oats, milk powder, salt',
  'Contains: Milk',
  'May contain traces of peanuts',
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
    await page.waitForFunction(() => { const button = [...document.querySelectorAll('button')].find(item => item.textContent?.includes('Optional context')); return !!button && !button.disabled; });
    const onboarding = page.getByRole('dialog', { name: 'Make NutriScan yours' });
    if (await onboarding.isVisible()) {
      await onboarding.getByLabel('Understand nutrition and portions').check();
      await onboarding.getByRole('button', { name: 'Continue', exact: true }).click();
      await onboarding.waitFor({ state: 'hidden' });
    }
    const intakeAxe = await new AxeBuilder({ page }).analyze();
    await page.screenshot({ path: path.join(captureDir, `${prefix}-01-intake.png`) });

    await page.getByRole('button', { name: 'Optional context', exact: true }).click();
    const profileStartedWithoutHealthContext = await page.getByLabel('Health considerations or professional guidance').inputValue() === ''
      && await page.getByLabel('Food allergies').inputValue() === ''
      && !(await page.getByRole('checkbox', { name: /Remember this context on this device/ }).isChecked());
    await page.getByLabel('What are you trying to understand?').fill('Synthetic profile text must remain session-only');
    await page.getByLabel('Food allergies').fill('peanuts');
    await page.getByRole('button', { name: 'Use for this session' }).click();

    await page.locator('#initial-question').fill('What ingredients are listed?');
    await page.getByRole('button', { name: 'Enter label text' }).click();
    await page.getByLabel('Label text').fill(labelText);
    await page.getByRole('button', { name: 'Read label text' }).click();
    await page.locator('.thread-workspace').waitFor({ state: 'visible' });
    const initialReply = page.locator('.thread-assistant-message').first();
    await initialReply.waitFor({ state: 'visible' });
    const initialAnswer = await initialReply.innerText();
    const ingredientsAnswered = /oats/i.test(initialAnswer) && /milk powder/i.test(initialAnswer) && /salt/i.test(initialAnswer);
    const observationDisclosure = /On-device reading · recorded package observations and calculations/.test(initialAnswer);
    const firstAnswerAxe = await new AxeBuilder({ page }).analyze();

    await page.getByLabel('Ask about this package').fill('How many calories, carbohydrates, and sugars are in this serving?');
    await page.getByRole('button', { name: 'Send follow-up' }).click();
    const multiNutrientReply = page.locator('.thread-assistant-message').filter({ hasText: /114 kcal energy/ }).last();
    await multiNutrientReply.waitFor({ state: 'visible' });
    const multiNutrientAnswer = await multiNutrientReply.innerText();
    const multiNutrientQuestionAnswered = /114 kcal energy/.test(multiNutrientAnswer) && /18 g carbohydrate/.test(multiNutrientAnswer) && /1\.2 g total sugars/.test(multiNutrientAnswer);

    await page.getByLabel('Ask about this package').fill('What does WHO recommend about dietary fibre?');
    await page.getByRole('button', { name: 'Send follow-up' }).click();
    const whoGuidanceReply = page.locator('.thread-assistant-message').filter({ hasText: /WHO|World Health Organization/i }).last();
    await whoGuidanceReply.waitFor({ state: 'visible' });
    const whoGuidanceAnswer = await whoGuidanceReply.innerText();
    const whoGuidanceAnswered = /at least 25 g\/day of naturally occurring dietary fibre/i.test(whoGuidanceAnswer) && /2\.4 g fibre/i.test(whoGuidanceAnswer) && /not a product-specific threshold or individual prescription/i.test(whoGuidanceAnswer) && /not a measure of whole-day intake/i.test(whoGuidanceAnswer);
    const whoTurn = page.locator('.thread-turn').filter({ hasText: /What does WHO recommend about dietary fibre\?/ }).last();
    const whoSourceCard = whoTurn.locator('details.conversation-evidence').last();
    if (await whoSourceCard.count()) await whoSourceCard.locator('summary').click();
    const whoSourceText = await whoSourceCard.innerText().catch(() => '');
    const whoSourceVisible = /WHO|World Health Organization/i.test(whoSourceText) && /Carbohydrate intake/i.test(whoSourceText);

    await page.getByLabel('Ask about this package').fill('And for children?');
    await page.getByRole('button', { name: 'Send follow-up' }).click();
    const childGuidanceReply = page.locator('.thread-assistant-message').filter({ hasText: /15 g\/day of naturally occurring dietary fibre from foods at ages 2–5/ }).last();
    await childGuidanceReply.waitFor({ state: 'visible' });
    const childGuidanceAnswer = await childGuidanceReply.innerText();
    const childGuidanceAnswered = /15 g\/day.*ages 2–5.*21 g\/day.*ages 6–9.*25 g\/day.*ages 10 or older/i.test(childGuidanceAnswer) && /population guidance for the whole diet/i.test(childGuidanceAnswer) && /2\.4 g fibre/i.test(childGuidanceAnswer);

    await page.getByLabel('Ask about this package').fill('Is milk mentioned in an allergen statement?');
    await page.getByRole('button', { name: 'Send follow-up' }).click();
    const allergenReply = page.locator('.thread-assistant-message').last();
    await allergenReply.waitFor({ state: 'visible' });
    const allergenAnswer = await allergenReply.innerText();
    const allergenFollowUpAnsweredFromRecordedText = /Contains: Milk/i.test(allergenAnswer);

    await page.getByLabel('Ask about this package').fill('How should I interpret the May contain traces of peanuts statement?');
    await page.getByRole('button', { name: 'Send follow-up' }).click();
    const crossContactReply = page.locator('.thread-assistant-message').last();
    await crossContactReply.waitFor({ state: 'visible' });
    const crossContactAnswer = await crossContactReply.innerText();
    const precautionaryAllergyDistinguished = /May contain traces of peanuts/i.test(crossContactAnswer) && /does not confirm that an allergen is present/i.test(crossContactAnswer) && /does not establish actual allergen presence, amount or exposure, individual risk or safety/i.test(crossContactAnswer);
    const crossContactGuidanceAnswered = /cross-contamination|cross-contact/i.test(crossContactAnswer) && /package compliance/i.test(crossContactAnswer);
    const crossContactTurn = page.locator('.thread-turn').filter({ hasText: /How should I interpret the May contain traces of peanuts statement\?/ }).last();
    const crossContactSourceCard = crossContactTurn.locator('details.conversation-evidence').last();
    if (await crossContactSourceCard.count()) await crossContactSourceCard.locator('summary').click();
    const crossContactSourceText = await crossContactSourceCard.innerText().catch(() => '');
    const crossContactSourceVisible = /Food Safety and Standards/i.test(crossContactSourceText) && /Labelling and Display/i.test(crossContactSourceText);
    const conversationAxe = await new AxeBuilder({ page }).analyze();
    await page.screenshot({ path: path.join(captureDir, `${prefix}-02-grounded-conversation.png`), fullPage: true });

    await page.getByRole('checkbox', { name: 'Save chat' }).check();
    await page.getByRole('button', { name: /Recent scans/ }).click();
    await page.getByRole('button', { name: /6 local turns/ }).waitFor({ state: 'visible' });
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /Recent scans/ }).click();
    await page.getByRole('button', { name: /6 local turns/ }).click();
    await page.locator('.thread-turn').filter({ hasText: /What ingredients are listed\?/ }).waitFor({ state: 'visible' });
    const restoredTurnCount = await page.locator('.thread-turn').count();
    await page.getByRole('button', { name: 'Optional context', exact: true }).click();
    const restoredProfileValue = await page.getByLabel('What are you trying to understand?').inputValue();
    const restoredProfileRemainedBlank = restoredProfileValue === '';
    await page.getByRole('button', { name: 'Use for this session' }).click();
    const restoredAxe = await new AxeBuilder({ page }).analyze();
    await page.getByRole('checkbox', { name: 'Save chat' }).uncheck();
    await page.getByRole('button', { name: /Recent scans/ }).click();
    const packageOnlyHistory = page.getByRole('button', { name: /saved label/ }).first();
    await packageOnlyHistory.waitFor({ state: 'visible' });
    const conversationRemovalConfirmed = !(await packageOnlyHistory.innerText()).includes('local turns');

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Optional context', exact: true }).click();
    const rememberContext = page.getByRole('checkbox', { name: /Remember this context on this device/ });
    const profileStartedEmpty = profileStartedWithoutHealthContext;
    await page.getByLabel('What are you trying to understand?').fill('Synthetic profile persistence acceptance fixture');
    await rememberContext.check();
    await page.getByText('Your context is saved separately on this device.').waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(captureDir, `${prefix}-03-optional-context.png`), fullPage: true });
    const profileAxe = await new AxeBuilder({ page }).analyze();
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Optional context', exact: true }).click();
    const restoredRememberedValue = await page.getByLabel('What are you trying to understand?').inputValue();
    const rememberedProfileRestored = restoredRememberedValue === 'Synthetic profile persistence acceptance fixture' && await page.getByRole('checkbox', { name: /Remember this context on this device/ }).isChecked();
    await page.getByRole('button', { name: 'Use for this session' }).click();
    await page.getByRole('button', { name: /Recent scans/ }).click();
    const priorSavedLabel = page.getByRole('button', { name: /saved label/ }).first();
    await priorSavedLabel.waitFor({ state: 'visible' });
    await priorSavedLabel.click();
    await page.getByRole('button', { name: 'Optional context', exact: true }).click();
    const rememberedProfileSurvivedScanReopen = await page.getByLabel('What are you trying to understand?').inputValue() === 'Synthetic profile persistence acceptance fixture';
    const scanRecordExcludesProfile = await page.evaluate(async () => await new Promise<boolean>((resolve, reject) => {
      const request = indexedDB.open('keyval-store');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction('keyval', 'readonly');
        const history = transaction.objectStore('keyval').get('nutriscan.history.v1');
        history.onerror = () => reject(history.error);
        history.onsuccess = () => {
          const serialized = JSON.stringify(history.result ?? []);
          resolve(!serialized.includes('Synthetic profile persistence acceptance fixture') && !serialized.includes('healthConsiderations') && !serialized.includes('allergies'));
          db.close();
        };
      };
    }));
    const uncheckRememberContext = page.getByRole('checkbox', { name: /Remember this context on this device/ });
    await uncheckRememberContext.uncheck();
    await page.getByText('The remembered copy was removed. Your context remains in this session.').waitFor({ state: 'visible' });
    const uncheckingPreservesSessionContext = await page.getByLabel('What are you trying to understand?').inputValue() === 'Synthetic profile persistence acceptance fixture';
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Optional context', exact: true }).click();
    const uncheckingRemovedRememberedContext = await page.getByLabel('What are you trying to understand?').inputValue() === 'Synthetic profile persistence acceptance fixture'
      && !(await page.getByRole('checkbox', { name: /Remember this context on this device/ }).isChecked());
    await page.getByRole('button', { name: 'Use for this session' }).click();

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.locator('#initial-question').fill('What ingredients are listed?');
    await page.getByRole('button', { name: 'Enter label text' }).click();
    await page.getByLabel('Label text').fill('Synthetic evaluation label\nNutrition information per 100 g\nEnergy 380 kcal');
    await page.getByRole('button', { name: 'Read label text' }).click();
    await page.locator('.thread-workspace').waitFor({ state: 'visible' });
    const missingTextAnswer = await page.locator('.thread-assistant-message').first().innerText();
    const missingTextUnknown = /No readable ingredient text is recorded/i.test(missingTextAnswer) && /does not establish that the package has none/i.test(missingTextAnswer);
    const missingTextHasNoFinding = await page.getByText('Recorded ingredient text').count() === 0;
    const missingTextAxe = await new AxeBuilder({ page }).analyze();

    const axeViolationIds = [intakeAxe, firstAnswerAxe, conversationAxe, restoredAxe, profileAxe, missingTextAxe].flatMap(result => result.violations.map(violation => violation.id));
    const outcome = {
      viewport: `${viewport.width}x${viewport.height}`,
      syntheticLabelInput: true,
      observedIngredientQuestionAnswered: ingredientsAnswered,
      allergenFollowUpAnsweredFromRecordedText,
      profileAllergyMatchedPrecautionaryWording: precautionaryAllergyDistinguished,
      crossContactGuidanceAnswered,
      crossContactSourceVisible,
      crossContactSourceText,
      multiNutrientQuestionAnswered,
      whoGuidanceAnswered,
      whoSourceVisible,
      whoSourceText,
      childGuidanceAnswered,
      localConversationOptInRestored: restoredTurnCount === 6,
      savedConversationTurnCount: restoredTurnCount,
      profileRemainedSessionOnly: restoredProfileRemainedBlank,
      profileStartedEmpty,
      rememberedProfileRestored,
      rememberedProfileSurvivedScanReopen,
      scanRecordExcludesProfile,
      uncheckingPreservesSessionContext,
      uncheckingRemovedRememberedContext,
      conversationOptOutRemovedSavedTurns: conversationRemovalConfirmed,
      observationDisclosureVisible: observationDisclosure,
      missingTextRemainedUnknown: missingTextUnknown,
      missingTextAnswer: missingTextAnswer.slice(0, 500),
      missingTextProducedNoObservationFinding: missingTextHasNoFinding,
      axeViolationIds: [...new Set(axeViolationIds)].sort(),
      pageErrors,
      providerCalls,
      nonLoopbackRequestOrigins: [...new Set(nonLoopbackRequests)],
    };
    outcomes.push(outcome);
    console.log(JSON.stringify(outcome));
    if (!ingredientsAnswered || !observationDisclosure || !allergenFollowUpAnsweredFromRecordedText || !precautionaryAllergyDistinguished || !multiNutrientQuestionAnswered || !whoGuidanceAnswered || !whoSourceVisible || !childGuidanceAnswered || !crossContactGuidanceAnswered || !crossContactSourceVisible || !missingTextUnknown || !missingTextHasNoFinding || !outcome.localConversationOptInRestored || !restoredProfileRemainedBlank || !profileStartedEmpty || !rememberedProfileRestored || !rememberedProfileSurvivedScanReopen || !scanRecordExcludesProfile || !uncheckingPreservesSessionContext || !uncheckingRemovedRememberedContext || !conversationRemovalConfirmed || outcome.axeViolationIds.length || pageErrors.length || providerCalls.length || nonLoopbackRequests.length) process.exitCode = 1;
    await context.close();
  }

  const passed = outcomes.length === 2 && outcomes.every(outcome => outcome.observedIngredientQuestionAnswered === true && outcome.allergenFollowUpAnsweredFromRecordedText === true && outcome.profileAllergyMatchedPrecautionaryWording === true && outcome.crossContactGuidanceAnswered === true && outcome.crossContactSourceVisible === true && outcome.multiNutrientQuestionAnswered === true && outcome.whoGuidanceAnswered === true && outcome.whoSourceVisible === true && outcome.childGuidanceAnswered === true && outcome.localConversationOptInRestored === true && outcome.profileRemainedSessionOnly === true && outcome.profileStartedEmpty === true && outcome.rememberedProfileRestored === true && outcome.rememberedProfileSurvivedScanReopen === true && outcome.scanRecordExcludesProfile === true && outcome.uncheckingPreservesSessionContext === true && outcome.uncheckingRemovedRememberedContext === true && outcome.conversationOptOutRemovedSavedTurns === true && outcome.observationDisclosureVisible === true && outcome.missingTextRemainedUnknown === true && outcome.missingTextProducedNoObservationFinding === true && Array.isArray(outcome.axeViolationIds) && outcome.axeViolationIds.length === 0 && Array.isArray(outcome.pageErrors) && outcome.pageErrors.length === 0 && Array.isArray(outcome.providerCalls) && outcome.providerCalls.length === 0 && Array.isArray(outcome.nonLoopbackRequestOrigins) && outcome.nonLoopbackRequestOrigins.length === 0);
  const receipt = { schemaVersion: 1, kind: 'synthetic-package-text-conversation-browser-acceptance', generatedAt: new Date().toISOString(), appOrigin: origin.origin, captureTool: 'Playwright using installed Chrome', evaluationInput: 'synthetic label text; not real-photo OCR evidence', persistence: 'explicit local opt-in restores 6 recent turns; opt-out removes saved turns; optional profile is remembered only after separate opt-in and is excluded from scan records', screenshots: 'docs/evidence/private/package-text-conversation', outcomes, passed };
  await writeFile('docs/evidence/package-text-conversation-browser.json', `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ receipt: 'docs/evidence/package-text-conversation-browser.json', passed }));
  if (!passed) process.exitCode = 1;
} finally {
  await browser.close();
}
