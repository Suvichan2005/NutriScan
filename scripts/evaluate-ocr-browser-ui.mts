import AxeBuilder from '@axe-core/playwright';
import { chromium, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

type ManifestRecord = {
  file: string;
  hash: string;
  manualAnnotation: {
    basis: { amount: number; unit: string } | null;
    nutrients: Array<{ key: string; value: number; unit: string }>;
  };
};

type Manifest = { records: ManifestRecord[] };
type Crop = { x: number; y: number; width: number; height: number };
type SourceSpec = { id: string; file: string; crop: Crop };
type CaseSpec = { id: string; sourceId: SourceSpec['id']; role: 'unknown' | 'nutrition'; crop?: Crop; initialQuestion?: string };
type Outcome = 'correct' | 'incorrect' | 'omitted' | 'withheld';

const root = process.cwd();
const baseUrl = process.env.NUTRISCAN_BASE_URL ?? 'http://127.0.0.1:3413';
const photoDirectory = path.join(root, 'docs/evidence/private');
const resultPath = path.join(root, 'docs/evidence/real-ocr-browser-ui-probe.json');
const labels: Record<string, string> = {
  energy: 'Energy', protein: 'Protein', carbohydrate: 'Carbohydrate', sugars: 'Sugars',
  addedSugars: 'Added sugars', fiber: 'Fiber', fat: 'Fat', saturatedFat: 'Saturated fat', sodium: 'Sodium',
};
const sources: SourceSpec[] = [
  { id: 'saffola', file: 'saffola-veggie-oats-nutrition-off-8901088068758.jpg', crop: { x: 3, y: 0, width: 93, height: 99 } },
  { id: 'bagrrys', file: 'bagrrys-white-oats-nutrition-off-8902710100150.jpg', crop: { x: 2, y: 2, width: 74, height: 96 } },
];
const cases: CaseSpec[] = [
  { id: 'saffola-unknown-role-full-image', sourceId: 'saffola', role: 'unknown', initialQuestion: 'What can you read from this label?' },
  { id: 'saffola-nutrition-role-full-image', sourceId: 'saffola', role: 'nutrition' },
  { id: 'saffola-nutrition-role-user-crop', sourceId: 'saffola', role: 'nutrition', crop: sources[0].crop },
  { id: 'saffola-nutrition-role-user-crop-repeat', sourceId: 'saffola', role: 'nutrition', crop: sources[0].crop },
  { id: 'bagrrys-nutrition-role-full-image', sourceId: 'bagrrys', role: 'nutrition' },
  { id: 'bagrrys-nutrition-role-user-crop', sourceId: 'bagrrys', role: 'nutrition', crop: sources[1].crop },
  { id: 'bagrrys-nutrition-role-user-crop-repeat', sourceId: 'bagrrys', role: 'nutrition', crop: sources[1].crop },
];

function assertLoopbackOrigin(value: string) {
  const url = new URL(value);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Browser OCR evaluation accepts loopback origins only.');
  }
}

function normalizedUnit(unit: string): string {
  return unit.toLowerCase().replaceAll('μ', 'µ');
}

function parseReading(text: string): { value: number; unit: string } | undefined {
  const match = text.match(/(-?\d+(?:[.,]\d+)?)\s*(kcal|kj|mg|g|ml)\b/i);
  if (!match) return undefined;
  return { value: Number(match[1].replace(',', '.')), unit: normalizedUnit(match[2]) };
}

async function scorePage(page: Page, record: ManifestRecord) {
  if (!record.manualAnnotation.basis) throw new Error(`Photo ${record.file} has no human-annotated nutrition basis.`);
  const rowData = await page.locator('.details-block table tbody tr').evaluateAll((rows) => rows.map((row) => {
    const cells = Array.from(row.querySelectorAll('th, td')).map((cell) => cell.textContent?.trim() ?? '');
    return { name: cells[0] ?? '', reading: cells[1] ?? '', basis: cells[2] ?? '', calculation: cells[3] ?? '' };
  }));
  const rowByKey = new Map<string, (typeof rowData)[number]>();
  for (const [key, label] of Object.entries(labels)) {
    const row = rowData.find((candidate) => candidate.name.toLowerCase() === label.toLowerCase());
    if (row) rowByKey.set(key, row);
  }

  let correct = 0;
  let incorrect = 0;
  let omitted = 0;
  let withheld = 0;
  const toleranceFor = (expected: number) => Math.max(0.015, Math.abs(expected) * 0.005);
  const fields = record.manualAnnotation.nutrients.map((expected) => {
    const row = rowByKey.get(expected.key);
    let outcome: Outcome;
    if (!row) {
      omitted += 1;
      outcome = 'omitted';
    } else {
      const basisMatch = row.basis.toLowerCase().includes(`${record.manualAnnotation.basis.amount} ${record.manualAnnotation.basis.unit}`.toLowerCase());
      const reading = parseReading(row.reading);
      if (!basisMatch || !reading || normalizedUnit(expected.unit) !== reading.unit || row.reading.toLowerCase().includes('conflict') || row.calculation.toLowerCase() === 'withheld') {
        withheld += 1;
        outcome = 'withheld';
      } else if (Math.abs(reading.value - expected.value) <= toleranceFor(expected.value)) {
        correct += 1;
        outcome = 'correct';
      } else {
        incorrect += 1;
        outcome = 'incorrect';
      }
    }
    return { field: expected.key, outcome };
  });
  return { expected: fields.length, correct, incorrect, omitted, withheld, fields };
}

async function main() {
  assertLoopbackOrigin(baseUrl);
  const manifest = JSON.parse(await readFile(path.join(root, 'data/semantic-photo-manifest.json'), 'utf8')) as Manifest;
  const records = new Map<SourceSpec['id'], ManifestRecord>();
  const actualHashes = new Map<SourceSpec['id'], string>();
  for (const source of sources) {
    const record = manifest.records.find((item) => item.file === source.file);
    if (!record) throw new Error(`Annotated ${source.id} photo record is missing from the manifest.`);
    if (!record.manualAnnotation.basis || !record.manualAnnotation.nutrients.length) throw new Error(`Photo ${source.file} lacks an annotated basis or nutrient fields.`);
    const photo = await readFile(path.join(photoDirectory, record.file));
    const actualHash = createHash('sha256').update(photo).digest('hex');
    if (actualHash !== record.hash.toLowerCase()) throw new Error(`${source.id} photo hash does not match its manifest annotation.`);
    records.set(source.id, record);
    actualHashes.set(source.id, actualHash);
  }
  const health = await fetch(baseUrl, { signal: AbortSignal.timeout(5000) });
  if (!health.ok) throw new Error(`Local application is unavailable (HTTP ${health.status}).`);

  await mkdir(photoDirectory, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const results = [];
  try {
    for (const spec of cases) {
      const record = records.get(spec.sourceId)!;
      const photoPath = path.join(photoDirectory, record.file);
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      let pageErrorCount = 0;
      page.on('pageerror', () => { pageErrorCount += 1; });
      await page.goto(baseUrl, { waitUntil: 'networkidle' });
      if (spec.initialQuestion) await page.getByLabel('What would you like to find out?').fill(spec.initialQuestion);
      const intakeScreenshot = spec.initialQuestion ? path.join(photoDirectory, 'browser-question-first-intake-mobile.png') : undefined;
      if (intakeScreenshot) await page.screenshot({ path: intakeScreenshot, fullPage: true });
      const intakeAxeViolationIds = intakeScreenshot
        ? (await new AxeBuilder({ page }).analyze()).violations.map((violation) => violation.id).sort()
        : null;
      await page.getByLabel('Add one or more product photos').setInputFiles(photoPath);
      if (spec.role === 'nutrition') await page.getByLabel('Optional photo hint').selectOption('nutrition');
      if (spec.crop) {
        await page.getByText('Focus OCR on one photo region').click();
        await page.getByLabel('Use a crop on a selected photo').check();
        await page.getByLabel('Photo to crop').selectOption({ index: 1 });
        const cropSelector = page.locator('.crop-preview');
        const bounds = await cropSelector.boundingBox();
        if (!bounds) throw new Error('Visual crop selector has no rendered bounds.');
        await page.mouse.move(bounds.x + bounds.width * spec.crop.x / 100, bounds.y + bounds.height * spec.crop.y / 100);
        await page.mouse.down();
        await page.mouse.move(bounds.x + bounds.width * (spec.crop.x + spec.crop.width) / 100, bounds.y + bounds.height * (spec.crop.y + spec.crop.height) / 100, { steps: 10 });
        await page.mouse.up();
        const selected = await page.locator('.crop-fields input').evaluateAll((inputs) => inputs.map((input) => Number((input as HTMLInputElement).value)));
        const expected = [spec.crop.x, spec.crop.y, spec.crop.width, spec.crop.height];
        if (selected.some((value, index) => Math.abs(value - expected[index]) > 1)) throw new Error(`Visual crop selection mismatch: ${selected.join(',')}.`);
      }
      await page.getByRole('button', { name: /Read these photos/ }).click();
      await page.locator('.results-section').waitFor({ state: 'visible', timeout: 120_000 });
      const initialQuestionPreserved = spec.initialQuestion
        ? await page.locator('.conversation .user-message').filter({ hasText: spec.initialQuestion }).count() === 1
        : null;
      await page.getByText('See the label & calculation maths').click();
      await page.locator('.details-block table').waitFor({ state: 'visible' });
      const scored = await scorePage(page, record);
      const axe = await new AxeBuilder({ page }).analyze();
      const screenshotPath = path.join(photoDirectory, `browser-ocr-${spec.id}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      results.push({
        id: spec.id,
        sourceId: spec.sourceId,
        role: spec.role,
        crop: spec.crop,
        cropSelection: spec.crop ? 'pointer-drag' : null,
        initialQuestionJourney: spec.initialQuestion ? {
          enteredBeforePhoto: true,
          preservedAfterRead: initialQuestionPreserved,
          axeViolationIds: intakeAxeViolationIds,
          intakeScreenshot: intakeScreenshot ? path.relative(root, intakeScreenshot).replaceAll('\\', '/') : undefined,
        } : null,
        ...scored,
        parsedNutrientRows: await page.locator('.details-block table tbody tr').count(),
        axeViolationIds: axe.violations.map((violation) => violation.id).sort(),
        pageErrorCount,
        screenshot: path.relative(root, screenshotPath).replaceAll('\\', '/'),
      });
      await context.close();
    }
  } finally {
    await browser.close();
  }

  const receipt = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    browser: 'Chrome via Playwright, headless; viewport 390x844',
    sources: sources.map((source) => {
      const record = records.get(source.id)!;
      return { id: source.id, file: record.file, sha256: actualHashes.get(source.id), annotationBasis: record.manualAnnotation.basis, expectedFields: record.manualAnnotation.nutrients.length };
    }),
    method: 'Actual upload, role selection, optional crop selected by dragging over the displayed image, and in-browser OCR on two hash-verified English package photos. Crop percentage controls are checked against the requested rectangle within one percentage point. Scoring requires matching the human-annotated basis and unit; tolerance is max(0.015, 0.5% of expected). No OCR text or image bytes are stored in this receipt.',
    results,
  };
  await writeFile(resultPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ resultPath: path.relative(root, resultPath), results: results.map(({ id, correct, incorrect, omitted, withheld, parsedNutrientRows, initialQuestionJourney, axeViolationIds, pageErrorCount }) => ({ id, correct, incorrect, omitted, withheld, parsedNutrientRows, initialQuestionJourney, axeViolationIds, pageErrorCount })) }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Browser OCR evaluation failed.');
  process.exitCode = 1;
});
