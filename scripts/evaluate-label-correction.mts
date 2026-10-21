import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const baseUrl = process.env.NUTRISCAN_BASE_URL ?? 'http://127.0.0.1:3400';
const photoFile = 'saffola-veggie-oats-nutrition-off-8901088068758.jpg';
const record = (JSON.parse(await readFile('data/semantic-photo-manifest.json', 'utf8')) as { records: Array<{ file: string; hash: string }> }).records.find((item) => item.file === photoFile);
if (!record) throw new Error('The annotated Saffola photo is absent from the manifest.');
const photoPath = path.resolve('docs/evidence/private', photoFile);
const bytes = await readFile(photoPath);
if (createHash('sha256').update(bytes).digest('hex') !== record.hash.toLowerCase()) throw new Error('The Saffola photo does not match its manifest hash.');
const origin = new URL(baseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) throw new Error('Label-correction acceptance only accepts a loopback origin.');
if (!(await fetch(baseUrl, { signal: AbortSignal.timeout(5000) })).ok) throw new Error('NutriScan is unavailable.');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const outcomes: Array<Record<string, unknown>> = [];
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.getByLabel('What would you like to find out?').fill('What does this label show for saturated fat?');
    await page.getByLabel('Add one or more product photos').setInputFiles(photoPath);
    await page.getByLabel('Optional photo hint').selectOption('nutrition');
    await page.getByText('Focus OCR on one photo region').click();
    await page.getByLabel('Use a crop on a selected photo').check();
    await page.getByLabel('Photo to crop').selectOption({ index: 1 });
    const crop = page.locator('.crop-preview');
    const bounds = await crop.boundingBox();
    if (!bounds) throw new Error('The crop selector did not render.');
    await page.mouse.move(bounds.x + bounds.width * .03, bounds.y);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * .96, bounds.y + bounds.height * .99, { steps: 10 });
    await page.mouse.up();
    const coordinates = await page.locator('.crop-fields input').evaluateAll((inputs) => inputs.map((input) => Number((input as HTMLInputElement).value)));
    const expectedCoordinates = [3, 0, 93, 99];
    if (coordinates.some((value, index) => Math.abs(value - expectedCoordinates[index]) > 1)) throw new Error('The selected crop did not match the annotated panel region.');

    await page.getByRole('button', { name: /Read these photos/ }).click();
    await page.locator('.results-section').waitFor({ state: 'visible', timeout: 120_000 });
    const initialOcrObservationCount = await page.locator('.observations-list p').count();
    await page.locator('#portion').fill('50');
    await page.getByRole('button', { name: 'Correct a value' }).click();
    await page.locator('.dialog-body select').nth(0).selectOption({ label: 'Saturated fat' });
    await page.getByLabel('Label value').fill('3.4');
    await page.getByRole('button', { name: 'Recalculate with correction' }).click();
    await page.getByText('Correction applied. Original OCR observations remain in the evidence ledger.').waitFor({ state: 'visible' });
    await page.getByText('See the label & calculation maths').click();
    const correctedRow = page.locator('.details-block table tbody tr').filter({ hasText: 'Saturated fat' });
    const correctedRowText = await correctedRow.innerText();
    const calculationCell = await correctedRow.locator('td').nth(2).innerText();
    const currentOcrObservationCount = await page.locator('.observations-list p').count();
    const axe = await new AxeBuilder({ page }).analyze();
    const outcome = {
      viewport: `${viewport.width}x${viewport.height}`,
      cropCoordinatesAccepted: true,
      genuineOcrObservationCount: initialOcrObservationCount,
      originalOcrObservationsRetained: initialOcrObservationCount > 0 && currentOcrObservationCount === initialOcrObservationCount,
      userCorrectionApplied: correctedRowText.toLowerCase().includes('corrected'),
      portionRetained: await page.locator('#portion').inputValue() === '50',
      calculationVerified: /1\.7/.test(calculationCell),
      axeViolationIds: axe.violations.map((violation) => violation.id).sort(),
      pageErrors,
    };
    outcomes.push(outcome);
    console.log(JSON.stringify(outcome));
    if (!outcome.originalOcrObservationsRetained || !outcome.userCorrectionApplied || !outcome.portionRetained || !outcome.calculationVerified || outcome.axeViolationIds.length || pageErrors.length) process.exitCode = 1;
    await context.close();
  }
  const allViewportsPassed = outcomes.length === 2 && outcomes.every((item) => item.originalOcrObservationsRetained && item.userCorrectionApplied && item.portionRetained && item.calculationVerified && Array.isArray(item.axeViolationIds) && item.axeViolationIds.length === 0 && Array.isArray(item.pageErrors) && item.pageErrors.length === 0);
  const receipt = { schemaVersion: 1, kind: 'genuine-photo-user-correction-browser-acceptance', generatedAt: new Date().toISOString(), origin: 'local loopback', photoFile, outcomes, allViewportsPassed };
  await writeFile('docs/evidence/label-correction-browser.json', `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ output: 'docs/evidence/label-correction-browser.json', allViewportsPassed }));
  if (!allViewportsPassed) process.exitCode = 1;
} finally {
  await browser.close();
}
