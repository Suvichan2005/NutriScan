import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = process.env.NUTRISCAN_BASE_URL ?? 'http://127.0.0.1:3400';
const photoFile = 'saffola-veggie-oats-nutrition-off-8901088068758.jpg';
const manifest = JSON.parse(await readFile('data/semantic-photo-manifest.json', 'utf8')) as { records: Array<{ file: string; hash: string; manualAnnotation?: { basis: { amount: number; unit: 'g'|'ml' }|null; nutrients: Array<{key:string;value:number;unit:string}> } }> };
const record = manifest.records.find((item) => item.file === photoFile);
const expectedSatFat = record?.manualAnnotation?.nutrients.find((item) => item.key === 'saturatedFat');
if (!record || !record.manualAnnotation?.basis || !expectedSatFat) throw new Error('The audited photo is missing a human-read saturated-fat annotation.');
const photoPath = path.resolve('docs/evidence/private', photoFile);
const photoBytes = await readFile(photoPath);
if (createHash('sha256').update(photoBytes).digest('hex') !== record.hash.toLowerCase()) throw new Error('The photo does not match the source manifest hash.');
const origin = new URL(baseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) throw new Error('This acceptance run only permits a loopback app URL.');
if (!(await fetch(baseUrl, { signal: AbortSignal.timeout(5000) })).ok) throw new Error('NutriScan is not responding.');

const captureDir = path.resolve('docs/evidence/private/core-journey-audit');
await mkdir(captureDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results: Array<Record<string, unknown>> = [];
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    const nonLoopbackRequests: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('request', (request) => {
      const requestUrl = new URL(request.url());
      const effectiveHostname = requestUrl.origin === 'null' ? '' : new URL(requestUrl.origin).hostname;
      if (effectiveHostname && !['127.0.0.1', 'localhost', '[::1]'].includes(effectiveHostname)) nonLoopbackRequests.push(requestUrl.origin);
    });
    const prefix = viewport.width === 390 ? 'mobile' : 'desktop';
    const axeIds: Record<string, string[]> = {};
    const axe = async (step: string) => { axeIds[step] = (await new AxeBuilder({ page }).analyze()).violations.map((violation) => violation.id).sort(); };

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    await page.screenshot({ path: path.join(captureDir, `${prefix}-01-intake.png`) });
    await axe('intake');
    await page.getByLabel('What would you like to find out?').fill('What does this package show for saturated fat?');
    await page.getByLabel('Add one or more product photos').setInputFiles(photoPath);
    await page.getByLabel('Optional photo hint').selectOption('nutrition');
    await page.getByText('Focus OCR on one photo region').click();
    await page.getByLabel('Use a crop on a selected photo').check();
    await page.getByLabel('Photo to crop').selectOption({ index: 1 });
    const crop = page.locator('.crop-preview');
    const bounds = await crop.boundingBox();
    if (!bounds) throw new Error(`${prefix}: crop selector did not render.`);
    await page.mouse.move(bounds.x + bounds.width * .03, bounds.y);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * .96, bounds.y + bounds.height * .99, { steps: 10 });
    await page.mouse.up();
    const cropCoordinates = await page.locator('.crop-fields input').evaluateAll((inputs) => inputs.map((input) => Number((input as HTMLInputElement).value)));
    if (cropCoordinates.some((value, index) => Math.abs(value - [3, 0, 93, 99][index]) > 1)) throw new Error(`${prefix}: the selected nutrition-panel crop was incorrect.`);
    await page.locator('.crop-tools').screenshot({ path: path.join(captureDir, `${prefix}-02-photo-and-crop.png`) });
    await axe('photo and crop');

    await page.getByRole('button', { name: /Read these photos/ }).click();
    await page.locator('.results-section').waitFor({ state: 'visible', timeout: 120_000 });
    const observations = await page.locator('.observations-list p').count();
    const nameObservationConfidence = await page.locator('.observations-list p').evaluateAll((nodes) => {
      const title = document.querySelector('.results-section h2')?.textContent?.trim() ?? '';
      const match = nodes.find((node) => !!title && node.textContent?.includes(title));
      const score = match?.querySelector('span')?.textContent?.match(/(\d+)%/)?.[1];
      return score ? Number(score) : null;
    });
    const parsedRows = await page.locator('.details-block table tbody tr').count();
    const packageName = (await page.locator('.results-section h2').innerText()).trim();
    const unknownSummary = await page.locator('.unknown-card .unknown-summary').innerText();
    const addPhotoAction = page.getByRole('button', { name: 'Add a front, ingredients, or barcode photo' });
    const addPhotoActionVisible = await addPhotoAction.isVisible();
    let addPhotoPickerOpened = false;
    if (addPhotoActionVisible) {
      const picker = page.waitForEvent('filechooser');
      await addPhotoAction.click();
      const chooser = await picker;
      addPhotoPickerOpened = chooser.isMultiple();
      await chooser.setFiles([]);
    }
    const labelNotes = page.locator('.unknown-card details').first();
    const labelNotesCollapsed = await labelNotes.evaluate((details) => !(details as HTMLDetailsElement).open);
    const labelNotesDisclosure = await labelNotes.locator('summary').innerText();
    await labelNotes.locator('summary').click();
    const detailedLabelNotes = await labelNotes.locator('ul').innerText();
    const labelNotesPreserveParserDetails = /multiple numeric values retained/i.test(detailedLabelNotes) && /invalid value withheld/i.test(detailedLabelNotes);
    await labelNotes.locator('summary').click();
    const mathsDetails = page.locator('.nutrition-card .details-block');
    if (!(await mathsDetails.evaluate((details) => (details as HTMLDetailsElement).open))) await page.getByText('See the label & calculation maths').click();
    const calculated = await mathsDetails.locator('table tbody tr').evaluateAll((rows) => rows.filter((row) => !!row.cells[2]?.textContent?.trim() && !/withheld/i.test(row.cells[2].textContent ?? '')).length);
    const satFatCells = await mathsDetails.locator('table tbody tr').filter({ hasText: 'Saturated fat' }).locator('td').allInnerTexts();
    const labelValue = Number.parseFloat(satFatCells[0] ?? '');
    const exactSatFatMatch = Math.abs(labelValue - expectedSatFat.value) <= Math.max(.015, Math.abs(expectedSatFat.value) * .005)
      && (satFatCells[0] ?? '').includes(expectedSatFat.unit)
      && (satFatCells[1] ?? '').includes(`${record.manualAnnotation.basis.amount} ${record.manualAnnotation.basis.unit}`);
    await page.locator('.results-section').screenshot({ path: path.join(captureDir, `${prefix}-03-findings.png`) });
    await axe('findings');

    const initialUserMessages = await page.locator('.conversation .user-message').allTextContents();
    const initialQuestionRetained = initialUserMessages.some((message) => message.trim() === 'What does this package show for saturated fat?');
    await page.getByLabel('Ask about this package').fill('What remains uncertain?');
    await page.getByRole('button', { name: 'Send follow-up' }).click();
    await page.locator('.conversation .user-message').filter({ hasText: 'What remains uncertain?' }).waitFor({ state: 'visible', timeout: 20_000 });
    await page.locator('.conversation').screenshot({ path: path.join(captureDir, `${prefix}-04-follow-up.png`) });

    await page.getByRole('button', { name: 'Correct a value' }).click();
    await page.locator('.dialog-body select').nth(0).selectOption({ label: 'Saturated fat' });
    await page.getByLabel('Label value').fill('3.4');
    await page.screenshot({ path: path.join(captureDir, `${prefix}-05-correction-dialog.png`) });
    await axe('correction dialog');
    await page.getByRole('button', { name: 'Recalculate with correction' }).click();
    await page.getByText('Correction applied. Original OCR observations remain in the evidence ledger.').waitFor({ state: 'visible' });
    await page.locator('#portion').fill('50');
    if (!(await mathsDetails.evaluate((details) => (details as HTMLDetailsElement).open))) await page.getByText('See the label & calculation maths').click();
    const corrected = page.locator('.details-block table tbody tr').filter({ hasText: 'Saturated fat' });
    const correctedText = await corrected.innerText();
    const calculation = await corrected.locator('td').nth(2).innerText();
    const retainedObservations = await page.locator('.observations-list p').count() === observations;
    await page.locator('.nutrition-card').screenshot({ path: path.join(captureDir, `${prefix}-06-calculation.png`) });
    await axe('corrected calculation');

    await page.getByRole('button', { name: 'Add optional context', exact: true }).click();
    await page.getByLabel('Health considerations or professional guidance').fill('Type 2 diabetes');
    await page.getByRole('button', { name: 'Use for this session' }).click();
    const personalizedQuestion = 'How much carbohydrate should I eat daily with diabetes?';
    await page.getByLabel('Ask about this package').fill(personalizedQuestion);
    await page.getByRole('button', { name: 'Send follow-up' }).click();
    const personalizedUserMessage = page.locator('.conversation .user-message').filter({ hasText: personalizedQuestion });
    await personalizedUserMessage.waitFor({ state: 'visible', timeout: 20_000 });
    const personalizedAnswer = (await page.locator('.conversation .assistant-message').last().innerText()).trim();
    const niddkFinding = page.locator('.finding').filter({ hasText: 'Healthy Living with Diabetes' });
    await niddkFinding.locator('details.finding-evidence summary').click();
    const niddkLink = niddkFinding.getByRole('link', { name: /Healthy Living with Diabetes/ });
    const niddkHref = await niddkLink.getAttribute('href').catch(() => null);
    await page.locator('.unknown-card').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(captureDir, `${prefix}-07-personalized-viewport.png`) });
    await page.locator('.results-section').screenshot({ path: path.join(captureDir, `${prefix}-07-personalized-follow-up.png`) });
    await axe('personalized diabetes follow-up');

    results.push({
      viewport: `${viewport.width}x${viewport.height}`,
      initialQuestionRetained,
      realPhotoHashVerified: true,
      cropCoordinates,
      selectedNameLineConfidence: nameObservationConfidence,
      packageName,
      ocrObservations: observations,
      parsedNutrientRows: parsedRows,
      addPhotoActionVisible,
      addPhotoPickerOpened,
      calculatedNutrients: calculated,
      plainLanguageUnknownSummary: unknownSummary,
      summaryHidesParserJargon: !/unit missing|invalid value withheld|multiple numeric values retained/i.test(unknownSummary),
      labelNotesInitiallyCollapsed: labelNotesCollapsed,
      labelNotesDisclosure,
      labelNotesPreserveParserDetails,
      exactSaturatedFatObservation: exactSatFatMatch,
      followUpMessages: await page.locator('.conversation .assistant-message').count(),
      correctionApplied: correctedText.toLowerCase().includes('corrected'),
      originalObservationsRetained: retainedObservations,
      portion: await page.locator('#portion').inputValue(),
      fiftyGramCalculation: /1\.7/.test(calculation),
      syntheticProfileOnly: true,
      personalizedQuestionRetained: (await personalizedUserMessage.innerText()).includes(personalizedQuestion),
      personalCarbohydrateTargetWithheld: /does not establish total carbohydrate/i.test(personalizedAnswer) && /cannot calculate a package amount or a daily target/i.test(personalizedAnswer) && !/\b\d+(?:\.\d+)?\s*g\s*\/\s*day/i.test(personalizedAnswer),
      clinicianContextVisible: /health care team/i.test(personalizedAnswer) && /not an individual allowance/i.test(personalizedAnswer),
      diabetesPlanningOptionsVisible: /plate method/i.test(personalizedAnswer) && /not everyone with diabetes needs to count carbs/i.test(personalizedAnswer),
      niddkSourceLinked: niddkHref === 'https://www.niddk.nih.gov/health-information/diabetes/overview/healthy-living-with-diabetes',
      noNonLoopbackRequests: nonLoopbackRequests.length === 0,
      nonLoopbackRequestOrigins: [...new Set(nonLoopbackRequests.map(requestUrl => new URL(requestUrl).origin))],
      axeViolationIds: axeIds,
      pageErrors,
    });
    await context.close();
  }
  const receipt = { schemaVersion: 1, kind: 'core-intake-to-audit-design-review', generatedAt: new Date().toISOString(), captureTool: 'Playwright using installed Chrome', appOrigin: origin.origin, acceptanceMode: process.env.NUTRISCAN_ACCEPTANCE_MODE ?? 'loopback local application', photoFile, screenshots: 'docs/evidence/private/core-journey-audit', outcomes: results };
  await writeFile('docs/evidence/core-journey-audit.json', `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ receipt: 'docs/evidence/core-journey-audit.json', screenshotDirectory: 'docs/evidence/private/core-journey-audit', outcomes: results }, null, 2));
  if (results.length !== 2 || results.some((item) => !item.realPhotoHashVerified || !item.initialQuestionRetained || item.packageName !== 'Unidentified package' || !item.summaryHidesParserJargon || !item.addPhotoActionVisible || !item.addPhotoPickerOpened || !item.labelNotesInitiallyCollapsed || !String(item.labelNotesDisclosure).startsWith('Label-reading notes') || !item.labelNotesPreserveParserDetails || !item.exactSaturatedFatObservation || !item.fiftyGramCalculation || !item.originalObservationsRetained || !item.personalizedQuestionRetained || !item.personalCarbohydrateTargetWithheld || !item.clinicianContextVisible || !item.diabetesPlanningOptionsVisible || !item.niddkSourceLinked || !item.noNonLoopbackRequests || item.pageErrors.length || Object.values(item.axeViolationIds).some((ids) => ids.length))) process.exitCode = 1;
} finally {
  await browser.close();
}
