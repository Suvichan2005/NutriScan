import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = process.env.NUTRISCAN_BASE_URL ?? 'http://127.0.0.1:3400';
const photoFile = process.env.NUTRISCAN_CORE_PHOTO ?? 'saffola-veggie-oats-nutrition-off-8901088068758.jpg';
const photoFiles = (process.env.NUTRISCAN_CORE_PHOTOS ?? photoFile).split(',').map((file) => file.trim()).filter(Boolean);
const photoRoles = process.env.NUTRISCAN_CORE_PHOTO_ROLES?.split(',').map((role) => role.trim()).filter(Boolean) ?? [];
const receiptPath = path.resolve(process.env.NUTRISCAN_CORE_AUDIT_OUTPUT ?? 'docs/evidence/core-journey-audit.json');
const captureDir = path.resolve(process.env.NUTRISCAN_CORE_CAPTURE_DIR ?? 'docs/evidence/private/core-journey-audit');
const diagnosticOnly = process.env.NUTRISCAN_DIAGNOSTIC_ONLY === '1';
const useCrop = process.env.NUTRISCAN_USE_CROP === '1' || (!process.env.NUTRISCAN_USE_CROP && !diagnosticOnly);
type AuditBasis = { amount: number; unit: 'g'|'ml' };
type AuditNutrient = { key: string; value: number; unit: string; printedAlternatives?: Array<{ value: number; unit: string }> };
type AuditAdditionalColumn = {
  basis: AuditBasis;
  energyKcal?: number; proteinGrams?: number; carbohydrateGrams?: number; sugarsGrams?: number;
  fiberGrams?: number; fatGrams?: number; saturatedFatGrams?: number; sodiumMg?: number;
};
const evaluationRowPatterns: Record<string, RegExp> = {
  energy: /\b(?:energy|calories?)\b/i,
  protein: /\bprotein\b/i,
  carbohydrate: /\bcarbohyd(?:rates?)?\b|\bcarbs?\b/i,
  sugars: /\b(?:total\s+)?sugars?\b/i,
  addedSugars: /\badded\s+sugars?\b/i,
  fiber: /\b(?:dietary\s+)?fib(?:er|re)\b/i,
  fat: /\b(?:total\s+)?fat\b/i,
  saturatedFat: /\bsaturat(?:ed|es)?\s+fat\b/i,
  sodium: /\b(?:sodium|salt)\b/i,
};
const manifest = JSON.parse(await readFile('data/semantic-photo-manifest.json', 'utf8')) as { records: Array<{ file: string; hash: string; manualAnnotation?: { basis: AuditBasis|null; nutrients: AuditNutrient[]; additionalColumns?: AuditAdditionalColumn[] } }> };
const record = manifest.records.find((item) => item.file === photoFile);
const expectedSatFat = record?.manualAnnotation?.nutrients.find((item) => item.key === 'saturatedFat');
if (!record || (!diagnosticOnly && (!record.manualAnnotation.basis || !expectedSatFat))) throw new Error('The audited photo is missing a human-read saturated-fat annotation.');
if (photoRoles.length && photoRoles.length !== photoFiles.length) throw new Error('Photo roles must match the selected photo count.');
const verifiedPhotos = await Promise.all(photoFiles.map(async (file) => {
  const photoRecord = manifest.records.find((item) => item.file === file);
  if (!photoRecord) throw new Error(`Photo ${file} is not present in the source manifest.`);
  const photoPath = path.resolve('docs/evidence/private', file);
  const photoBytes = await readFile(photoPath);
  if (createHash('sha256').update(photoBytes).digest('hex') !== photoRecord.hash.toLowerCase()) throw new Error(`Photo ${file} does not match its source manifest hash.`);
  return { file, path: photoPath };
}));
const origin = new URL(baseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) throw new Error('This acceptance run only permits a loopback app URL.');
if (!(await fetch(baseUrl, { signal: AbortSignal.timeout(5000) })).ok) throw new Error('NutriScan is not responding.');

await mkdir(captureDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results: Array<Record<string, unknown>> = [];
try {
  for (const viewport of diagnosticOnly ? [{ width: 390, height: 844 }] : [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    const nonLoopbackRequests: string[] = [];
    const paddleModelAssetRequests: Array<{ origin: string; path: string; method: string }> = [];
    const geminiRouteRequests: string[] = [];
    let httpRequestCount=0;
    let postRequestCount=0;
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('request', (request) => {
      const requestUrl = new URL(request.url());
      if(requestUrl.protocol==='http:'||requestUrl.protocol==='https:'){httpRequestCount++;if(request.method()==='POST')postRequestCount++;}
      if (requestUrl.pathname === '/api/assist' || requestUrl.pathname === '/api/vision') geminiRouteRequests.push(`${request.method()} ${requestUrl.pathname}`);
      const effectiveHostname = requestUrl.origin === 'null' ? '' : new URL(requestUrl.origin).hostname;
      if (effectiveHostname && !['127.0.0.1', 'localhost', '[::1]'].includes(effectiveHostname)) {
        if (requestUrl.origin === 'https://paddle-model-ecology.bj.bcebos.com' && request.method() === 'GET') paddleModelAssetRequests.push({ origin: requestUrl.origin, path: requestUrl.pathname, method: request.method() });
        else nonLoopbackRequests.push(requestUrl.origin);
      }
    });
    const prefix = viewport.width === 390 ? 'mobile' : 'desktop';
    const axeIds: Record<string, string[]> = {};
    const axe = async (step: string) => { axeIds[step] = (await new AxeBuilder({ page }).analyze()).violations.map((violation) => violation.id).sort(); };

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    await page.screenshot({ path: path.join(captureDir, `${prefix}-01-intake.png`) });
    await axe('intake');
    await page.getByLabel('What would you like to find out?').fill('What does this package show for saturated fat?');
    await page.getByLabel('Add one or more product photos').setInputFiles(verifiedPhotos.map((photo) => photo.path));
    await page.getByLabel('Optional photo hint').nth(photoFiles.length - 1).waitFor({ state: 'visible' });
    const hints = await page.getByLabel('Optional photo hint').all();
    for (let index = 0; index < hints.length; index++) {
      const role = photoRoles[index] ?? (photoFiles.length === 1 ? 'nutrition' : 'unknown');
      await hints[index].selectOption(role);
    }
    const assignedPhotoRoles = await page.getByLabel('Optional photo hint').evaluateAll((nodes) => nodes.map((node) => (node as HTMLSelectElement).value));
    let cropCoordinates: number[] = [];
    if (useCrop) {
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
      cropCoordinates = await page.locator('.crop-fields input').evaluateAll((inputs) => inputs.map((input) => Number((input as HTMLInputElement).value)));
      if (cropCoordinates.some((value, index) => Math.abs(value - [3, 0, 93, 99][index]) > 1)) throw new Error(`${prefix}: the selected nutrition-panel crop was incorrect.`);
      await page.locator('.crop-tools').screenshot({ path: path.join(captureDir, `${prefix}-02-photo-and-crop.png`) });
      await axe('photo and crop');
    }

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
    const initialPortion = await page.locator('#portion').inputValue();
    await page.locator('.results-section').screenshot({ path: path.join(captureDir, `${prefix}-03-initial-results.png`) });
    const unknownSummary = await page.locator('.unknown-card .unknown-summary').innerText();
    const answerDisclosure = await page.locator('.answer-card p').innerText();
    const answerDisclosureMarkedUnverified = /label readings and their stated bases are not independently verified/i.test(answerDisclosure);
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
    const labelNotesPreserveParserDetails = detailedLabelNotes.trim().length > 0 && /unit|basis|conflict|multiple|approximate|bounded|unreadable|ambiguous/i.test(detailedLabelNotes);
    await labelNotes.locator('summary').click();
    const originalObservations=page.locator('.sources-section details').filter({hasText:'Original label observations'});
    await originalObservations.locator('summary').click();
    const showAllOcrLines=page.getByRole('button',{name:/Show all \d+ OCR lines/});
    if(await showAllOcrLines.count())await showAllOcrLines.click();
    const inspectableLine=page.locator('.observations-list .observation-entry').filter({has:page.locator('button.inspect-region-button')}).first();
    await inspectableLine.waitFor({state:'visible'});
    const rawOcrLine=(await inspectableLine.locator('.ocr-line-text').innerText()).trim();
    const requestsBeforeLocalInspection=httpRequestCount,postsBeforeLocalInspection=postRequestCount;
    await inspectableLine.getByRole('button',{name:'Inspect photo region'}).click();
    const inspectionDialog=page.getByRole('dialog');
    await inspectionDialog.getByRole('heading',{name:'Inspect OCR photo region'}).waitFor({state:'visible'});
    await page.waitForFunction(()=>{const image=document.querySelector<HTMLImageElement>('.ocr-region-preview img');return !!image?.complete&&image.naturalWidth>0;});
    const regionAnswer=(await inspectionDialog.locator('.ocr-region-line').innerText()).trim();
    const preparedDimensions=await inspectionDialog.locator('.ocr-region-preview img').evaluate(node=>({width:(node as HTMLImageElement).naturalWidth,height:(node as HTMLImageElement).naturalHeight}));
    const highlightedBox=await inspectionDialog.locator('.ocr-region-preview svg').evaluate(node=>{const rect=node.querySelector('rect');const viewBox=(node.getAttribute('viewBox')??'').split(/\s+/).map(Number);return{x:Number(rect?.getAttribute('x')),y:Number(rect?.getAttribute('y')),width:Number(rect?.getAttribute('width')),height:Number(rect?.getAttribute('height')),viewBoxWidth:viewBox[2],viewBoxHeight:viewBox[3]};});
    const localOcrRegionInspectionWorks=!!rawOcrLine&&regionAnswer.includes(rawOcrLine)&&preparedDimensions.width===highlightedBox.viewBoxWidth&&preparedDimensions.height===highlightedBox.viewBoxHeight&&highlightedBox.x>=0&&highlightedBox.y>=0&&highlightedBox.width>0&&highlightedBox.height>0&&highlightedBox.x+highlightedBox.width<=preparedDimensions.width&&highlightedBox.y+highlightedBox.height<=preparedDimensions.height;
    const localOcrRegionInspectionMadeNoHttpRequest=httpRequestCount===requestsBeforeLocalInspection&&postRequestCount===postsBeforeLocalInspection;
    await inspectionDialog.screenshot({path:path.join(captureDir,`${prefix}-03-ocr-evidence-region.png`)});
    await axe('local OCR image inspection');
    await inspectionDialog.getByRole('button',{name:'Close dialog'}).click();
    await inspectionDialog.waitFor({state:'hidden'});
    const exportPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export evidence report' }).click();
    const exportedStream = await (await exportPromise).createReadStream();
    if (!exportedStream) throw new Error(`${prefix}: evidence export could not be read in memory.`);
    const exportChunks: Buffer[] = [];
    for await (const chunk of exportedStream) exportChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const exported = JSON.parse(Buffer.concat(exportChunks).toString('utf8')) as { package: {
      name: string;
      brand?: string;
      serving?: { value: number; unit: string };
      ingredients: string[];
      observations: Array<{ id: string; field: string; text: string; imageId?: string; origin?: string; readingOrder?: { runId?: string; lineIndex?: number }; ocrWords?: Array<{ text?: string; bbox: { x0: number; y0: number; x1: number; y1: number } }> }>;
      ocrCaptures?: Array<{ imageId: string; runId?: string; preparedImage: { width: number; height: number }; processing?: { cropPercent: { x: number; y: number; width: number; height: number } | null }; engine?: { name: string; language: string } }>;
      nutrients: Array<{ key: string; value: number; unit: string; basis: { amount: number; unit: string } | null; status: 'observed'|'corrected'|'conflict' }>;
      parserDiagnostics?: Array<{
        field: string;
        decision: 'accepted'|'conflict'|'rejected';
        reasonCodes?: string[];
        numericCandidates?: Array<{ rawValueText: string; value: number|null; unit: string|null }>;
        basisCandidates?: Array<{ amount: number; unit: string; description?: string }>;
      }>;
    } };
    if (diagnosticOnly) {
      const diagnostics = exported.package.parserDiagnostics ?? [];
      const diagnostic = {
        viewport: `${viewport.width}x${viewport.height}`,
        realPhotoHashVerified: true,
        packageName: exported.package.name,
        brand: exported.package.brand ?? null,
        serving: exported.package.serving ?? null,
        initialPortion,
        ingredients: exported.package.ingredients,
        nutrientCount: exported.package.nutrients.length,
        nutrients: exported.package.nutrients.map(({ key, value, unit, basis, status }) => ({ key, value, unit, basis, status })),
        observationCount: exported.package.observations.length,
        ocrLineCount: exported.package.observations.filter((item) => item.field === 'ocr-line').length,
        wordBoxCount: exported.package.observations.filter((item) => item.field === 'ocr-line').reduce((sum, item) => sum + (item.ocrWords?.length ?? 0), 0),
        ocrEngineSelections: (exported.package.ocrCaptures ?? []).map((capture) => ({ name: capture.engine?.name ?? null, language: capture.engine?.language ?? null, runId: capture.runId ?? null, imageId: capture.imageId ?? null, side: capture.side, preparedImage: capture.preparedImage, cropPercent: capture.processing?.cropPercent ?? null })),
        assignedPhotoRoles,
        ocrLines: exported.package.observations.filter((item) => item.field === 'ocr-line').map((item) => ({ runId: item.readingOrder?.runId ?? null, text: item.text })),
        parserDiagnostics: diagnostics.map(({ field, decision, reasonCodes, numericCandidates, basisCandidates }) => ({
          field,
          decision,
          reasonCodes: reasonCodes ?? [],
          numericCandidates: (numericCandidates ?? []).map(({ value, unit }) => ({ value, unit })),
          basisCandidates: basisCandidates ?? [],
        })),
        screenshots: path.relative(process.cwd(), captureDir),
        externalRequests: [...new Set(nonLoopbackRequests)],
        paddleModelAssetRequestCount: paddleModelAssetRequests.length,
        geminiRouteRequests,
        pageErrors,
      };
      results.push(diagnostic);
      await writeFile(path.join(captureDir, `${prefix}-extraction-diagnostic.json`), `${JSON.stringify(diagnostic, null, 2)}\n`);
      await context.close();
      break;
    }
    const mathsDetails = page.locator('.nutrition-card .details-block');
    if (!(await mathsDetails.evaluate((details) => (details as HTMLDetailsElement).open))) await page.getByText('See the label & calculation maths').click();
    const ocrReadingAssumption = await mathsDetails.locator('p.formula small').first().innerText();
    const ocrReadingMarkedUnverified = /not independently verified/i.test(ocrReadingAssumption);
    const calculated = await mathsDetails.locator('table tbody tr').evaluateAll((rows) => rows.filter((row) => !!row.cells[2]?.textContent?.trim() && !/withheld/i.test(row.cells[2].textContent ?? '')).length);
    const satFatCells = await mathsDetails.locator('table tbody tr').filter({ hasText: 'Saturated fat' }).locator('td').allInnerTexts();
    const labelValue = Number.parseFloat(satFatCells[0] ?? '');
    const exactSatFatMatch = Math.abs(labelValue - expectedSatFat.value) <= Math.max(.015, Math.abs(expectedSatFat.value) * .005)
      && (satFatCells[0] ?? '').includes(expectedSatFat.unit)
      && (satFatCells[1] ?? '').includes(`${record.manualAnnotation.basis.amount} ${record.manualAnnotation.basis.unit}`);
    await page.locator('.results-section').screenshot({ path: path.join(captureDir, `${prefix}-03-findings.png`) });
    await axe('findings');

    const annotation = record.manualAnnotation!;
    const additionalFields: Record<string, keyof Omit<AuditAdditionalColumn, 'basis'>> = {
      energy: 'energyKcal', protein: 'proteinGrams', carbohydrate: 'carbohydrateGrams', sugars: 'sugarsGrams',
      fiber: 'fiberGrams', fat: 'fatGrams', saturatedFat: 'saturatedFatGrams', sodium: 'sodiumMg',
    };
    const expectedByBasis = [
      ...record.manualAnnotation!.nutrients.map((nutrient) => ({ ...nutrient, basis: annotation.basis! })),
      ...(annotation.additionalColumns ?? []).flatMap((column) => annotation.nutrients.flatMap((nutrient) => {
        const field = additionalFields[nutrient.key];
        const value = field ? column[field] : undefined;
        return typeof value === 'number' && Number.isFinite(value)
          ? [{ key: nutrient.key, value, unit: nutrient.unit, basis: column.basis, printedAlternatives: [] as Array<{ value: number; unit: string }> }]
          : [];
      })),
    ];
    const rawOcrLines = exported.package.observations.filter((item) => item.field === 'ocr-line' && item.origin === 'ocr');
    const engineByRun = new Map((exported.package.ocrCaptures ?? []).map((capture) => [capture.runId, capture.engine?.name ?? 'unknown reader']));
    const annotatedFields = expectedByBasis.map((expected) => {
      const candidatesAtBasis = exported.package.nutrients.filter((nutrient) => nutrient.key === expected.key
        && nutrient.basis?.amount === expected.basis.amount && nutrient.basis?.unit === expected.basis.unit);
      const acceptedReadings = [{ value: expected.value, unit: expected.unit }, ...(expected.printedAlternatives ?? [])];
      const diagnostics = (exported.package.parserDiagnostics ?? []).filter((diagnostic) => diagnostic.field === expected.key);
      const candidate = candidatesAtBasis[0] ?? null;
      const numericCandidates = diagnostics.flatMap((diagnostic) => diagnostic.numericCandidates ?? []);
      const uniqueNumericCandidates = [...new Map(numericCandidates.map((item) => [`${item.rawValueText}|${item.value}|${item.unit}`, item])).values()];
      const basisCandidates = diagnostics.flatMap((diagnostic) => diagnostic.basisCandidates ?? []);
      const uniqueBasisCandidates = [...new Map(basisCandidates.map((item) => [`${item.amount}|${item.unit}|${item.description ?? ''}`, item])).values()];
      const numericExact = !!candidate && acceptedReadings.some((reading) => Math.abs(candidate.value - reading.value) <= Math.max(.015, Math.abs(reading.value) * .005));
      const unitExact = !!candidate && acceptedReadings.some((reading) => candidate.unit === reading.unit && Math.abs(candidate.value - reading.value) <= Math.max(.015, Math.abs(reading.value) * .005));
      const basisExact = !!candidate && candidate.basis?.amount === expected.basis.amount && candidate.basis?.unit === expected.basis.unit;
      const ocrNumericCandidateExact = uniqueNumericCandidates.some((item) => item.value !== null && acceptedReadings.some((reading) => Math.abs(item.value! - reading.value) <= Math.max(.015, Math.abs(reading.value) * .005)));
      const ocrUnitCandidateExact = uniqueNumericCandidates.some((item) => acceptedReadings.some((reading) => item.unit === reading.unit));
      const ocrValueUnitCandidateExact = uniqueNumericCandidates.some((item) => item.value !== null && acceptedReadings.some((reading) => item.unit === reading.unit && Math.abs(item.value! - reading.value) <= Math.max(.015, Math.abs(reading.value) * .005)));
      const ocrBasisCandidateExact = uniqueBasisCandidates.some((item) => item.amount === expected.basis.amount && item.unit === expected.basis.unit);
      const rowPattern = evaluationRowPatterns[expected.key];
      const isExpectedRow = (line: typeof rawOcrLines[number]) => {
        if (!rowPattern?.test(line.text)) return false;
        if (expected.key === 'fat' && /\b(?:saturated|trans)\s+fat\b/i.test(line.text)) return false;
        if (expected.key === 'sugars' && /\badded\s+sugars?\b/i.test(line.text)) return false;
        if (expected.key === 'saturatedFat' && /\btrans\s+fat\b/i.test(line.text)) return false;
        return true;
      };
      const rawReaders = [...new Set(rawOcrLines.map((line) => line.readingOrder?.runId).filter((runId): runId is string => !!runId))].map((runId) => {
        const readerLines = rawOcrLines.filter((line) => line.readingOrder?.runId === runId);
        const rowLines = readerLines.filter(isExpectedRow);
        const exactValueOnLine = (line: typeof rawOcrLines[number]) => {
          const values = [...line.text.matchAll(/(?<![\d.,])\d+(?:[.,]\d+)?(?![\d.,])/g)].map((match) => Number(match[0].replace(',', '.'))).filter(Number.isFinite);
          return values.some((value) => acceptedReadings.some((reading) => Math.abs(value - reading.value) <= Math.max(.015, Math.abs(reading.value) * .005)));
        };
        const exactUnitOnLine = (line: typeof rawOcrLines[number]) => {
          const unit = expected.unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          return new RegExp(`\\b${unit}\\b`, 'i').test(line.text);
        };
        const exactValueRowLines = rowLines.filter(exactValueOnLine);
        const imageIds = new Set(rowLines.map((line) => line.imageId).filter((imageId): imageId is string => !!imageId));
        const basisPattern = new RegExp(`\\b${expected.basis.amount}\\s*${expected.basis.unit}\\b`, 'i');
        const basisTextInSameImage = readerLines.some((line) => !!line.imageId && imageIds.has(line.imageId) && basisPattern.test(line.text));
        return {
          reader: engineByRun.get(runId) ?? 'unknown reader',
          rowLabelLineCount: rowLines.length,
          rowLabelPresent: rowLines.length > 0,
          exactValueOnSameRowLine: exactValueRowLines.length > 0,
          exactUnitOnSameRowLine: rowLines.some(exactUnitOnLine),
          exactValueAndUnitOnSameRowLine: exactValueRowLines.some(exactUnitOnLine),
          basisTextInSameImage: basisTextInSameImage,
        };
      });
      let outcome: 'exact'|'incorrect'|'omitted'|'withheld';
      if (candidatesAtBasis.some((nutrient) => nutrient.status === 'conflict') || candidatesAtBasis.length > 1) outcome = 'withheld';
      else if (candidate) outcome = numericExact && unitExact && basisExact ? 'exact' : 'incorrect';
      else if (diagnostics.some((diagnostic) => diagnostic.decision === 'rejected' || diagnostic.decision === 'conflict')) outcome = 'withheld';
      else outcome = 'omitted';
      return { key: expected.key, expectedValue: expected.value, expectedUnit: expected.unit, expectedBasis: expected.basis, emittedValue: candidate?.value ?? null, emittedUnit: candidate?.unit ?? null, emittedBasis: candidate?.basis ?? null, numericExact, unitExact, basisExact, candidateCountAtBasis: candidatesAtBasis.length, ocrNumericCandidateCount: uniqueNumericCandidates.length, ocrNumericCandidateExact, ocrUnitCandidateExact, ocrValueUnitCandidateExact, ocrBasisCandidateExact, rawOcrEvidence: { rowLabelPresent: rawReaders.some((reader) => reader.rowLabelPresent), exactValueOnSameRowLine: rawReaders.some((reader) => reader.exactValueOnSameRowLine), exactUnitOnSameRowLine: rawReaders.some((reader) => reader.exactUnitOnSameRowLine), exactValueAndUnitOnSameRowLine: rawReaders.some((reader) => reader.exactValueAndUnitOnSameRowLine), basisTextInSameImage: rawReaders.some((reader) => reader.basisTextInSameImage), readers: rawReaders }, outcome, parserDiagnostics: diagnostics.map(({ decision, reasonCodes }) => ({ decision, reasonCodes: reasonCodes ?? [] })) };
    });
    const annotatedFieldCounts = {
      referenceStatus: 'single human visual read; not independently adjudicated',
      scoring: 'Value, unit, and basis are compared per annotated column; distinct bases are not treated as duplicate readings.',
      expected: annotatedFields.length,
      exact: annotatedFields.filter((field) => field.outcome === 'exact').length,
      incorrect: annotatedFields.filter((field) => field.outcome === 'incorrect').length,
      omitted: annotatedFields.filter((field) => field.outcome === 'omitted').length,
      withheld: annotatedFields.filter((field) => field.outcome === 'withheld').length,
      fields: annotatedFields,
    };
    const annotatedFieldScoreConserved = annotatedFieldCounts.exact + annotatedFieldCounts.incorrect + annotatedFieldCounts.omitted + annotatedFieldCounts.withheld === annotatedFieldCounts.expected;
    const noIncorrectAnnotatedFields = annotatedFieldCounts.incorrect === 0;
    const exportedOcrLines = exported.package.observations.filter((item) => item.field === 'ocr-line');
    const exportedOcrWords = exportedOcrLines.flatMap((item) => item.ocrWords ?? []);
    const captures = new Map((exported.package.ocrCaptures ?? []).map((item) => [item.imageId, item]));
    const ocrWordGeometryWithinCapture = exportedOcrWords.length > 0 && exportedOcrLines.every((line) => {
      const capture = line.imageId ? captures.get(line.imageId) : undefined;
      return !line.ocrWords?.length || !!capture && line.ocrWords.every((word) => word.bbox.x1 <= capture.preparedImage.width && word.bbox.y1 <= capture.preparedImage.height);
    });
    const ocrEngineSelections = (exported.package.ocrCaptures ?? []).map((capture) => ({ imageId: capture.imageId, name: capture.engine?.name ?? null, language: capture.engine?.language ?? null }));
    await writeFile(path.join(captureDir, `${prefix}-extraction-diagnostic.json`), `${JSON.stringify({
      photoFile,
      viewport: `${viewport.width}x${viewport.height}`,
      packageName,
      parsedRows,
      nutritionCards: await page.locator('.nutrition-card').count(),
      ocrObservations: observations,
      ocrEngineSelections,
      nutrients: exported.package.nutrients.map(({ key, value, unit, basis, status }) => ({ key, value, unit, basis, status })),
      parserDiagnostics: (exported.package.parserDiagnostics ?? []).map(({ field, decision, reasonCodes }) => ({ field, decision, reasonCodes: reasonCodes ?? [] })),
      pageErrors,
    }, null, 2)}\n`);
    const annotatedFieldsWithDiagnostics = annotatedFields.filter((field) => field.parserDiagnostics.length > 0);
    const rejectionReasonOccurrences: Record<string, number> = {};
    for (const diagnostic of annotatedFields.flatMap((field) => field.parserDiagnostics).filter((item) => item.decision === 'rejected')) {
      for (const reason of diagnostic.reasonCodes) rejectionReasonOccurrences[reason] = (rejectionReasonOccurrences[reason] ?? 0) + 1;
    }
    const stageDiagnostics = {
      referenceStatus: 'single human visual read; not independently adjudicated',
      textDetection: {
        observedLineBoxes: exportedOcrLines.length,
        observedWordBoxes: exportedOcrWords.length,
        precisionRecall: null,
        limitation: 'No independently annotated text-region boxes are available; observed boxes are not detection precision or recall.',
      },
      recognition: {
        annotatedFieldsWithExactNumericValueCandidate: annotatedFields.filter((field) => field.ocrNumericCandidateExact).length,
        annotatedFieldsWithExactUnitCandidate: annotatedFields.filter((field) => field.ocrUnitCandidateExact).length,
        annotatedFieldsWithExactValueAndUnitCandidate: annotatedFields.filter((field) => field.ocrValueUnitCandidateExact).length,
        annotatedFieldsWithExactBasisCandidate: annotatedFields.filter((field) => field.ocrBasisCandidateExact).length,
        expectedFields: annotatedFields.length,
        limitation: 'These counts are parser-diagnostic candidates, not standalone OCR accuracy; raw OCR row/value/unit/basis flags are recorded per field below.',
      },
      rawOcrEvidence: {
        fieldsWithRowLabelText: annotatedFields.filter((field) => field.rawOcrEvidence.rowLabelPresent).length,
        fieldsWithExactValueOnSameRowLine: annotatedFields.filter((field) => field.rawOcrEvidence.exactValueOnSameRowLine).length,
        fieldsWithExactUnitOnSameRowLine: annotatedFields.filter((field) => field.rawOcrEvidence.exactUnitOnSameRowLine).length,
        fieldsWithExactValueAndUnitOnSameRowLine: annotatedFields.filter((field) => field.rawOcrEvidence.exactValueAndUnitOnSameRowLine).length,
        fieldsWithBasisTextInSameImage: annotatedFields.filter((field) => field.rawOcrEvidence.basisTextInSameImage).length,
        expectedFields: annotatedFields.length,
        limitation: 'Literal same-line and same-image presence checks do not establish row-to-column association or independent detection precision/recall.',
      },
      tableStructure: {
        annotatedFieldsWithMultipleNumericCandidates: annotatedFields.filter((field) => field.ocrNumericCandidateCount > 1).length,
        annotatedFieldsWithoutParserDiagnostic: annotatedFields.filter((field) => field.parserDiagnostics.length === 0).length,
        rowColumnAssociationScored: false,
        limitation: 'Line and word geometry are retained, but no gold row or column regions exist for independent association scoring.',
      },
      parser: {
        annotatedFieldsWithDiagnostic: annotatedFieldsWithDiagnostics.length,
        rejectedFieldCount: annotatedFieldsWithDiagnostics.filter((field) => field.parserDiagnostics.some((diagnostic) => diagnostic.decision === 'rejected')).length,
        rejectionReasonOccurrences,
      },
    };

    const initialUserMessages = await page.locator('.conversation .user-message').allTextContents();
    const initialQuestionRetained = initialUserMessages.some((message) => message.trim() === 'What does this package show for saturated fat?');
    await page.getByLabel('Ask about this package').fill('What remains uncertain?');
    await page.getByRole('button', { name: 'Send follow-up' }).click();
    await page.locator('.conversation .user-message').filter({ hasText: 'What remains uncertain?' }).waitFor({ state: 'visible', timeout: 20_000 });
    const uncertaintyAnswer = (await page.locator('.conversation .assistant-message').last().innerText()).trim();
    const uncertaintyFollowUpUsesPackageEvidence = /need a closer look/i.test(uncertaintyAnswer) && /product name could not be established/i.test(uncertaintyAnswer) && /label-reading notes and original observations/i.test(uncertaintyAnswer) && /OCR is unverified/i.test(uncertaintyAnswer) && uncertaintyAnswer.length < 500 && !/parser diagnostic|numeric candidate/i.test(uncertaintyAnswer);
    await page.locator('.conversation').screenshot({ path: path.join(captureDir, `${prefix}-04-follow-up.png`) });

    await page.getByRole('button', { name: 'Correct a value' }).click();
    await page.locator('.dialog-body select').nth(0).selectOption({ label: 'Saturated fat' });
    const correctionBasisMatchesObserved = await page.getByLabel('Per amount').inputValue() === String(record.manualAnnotation.basis.amount);
    await page.getByLabel('Label value').fill(String(expectedSatFat.value));
    await page.screenshot({ path: path.join(captureDir, `${prefix}-05-correction-dialog.png`) });
    await axe('correction dialog');
    await page.getByRole('button', { name: 'Recalculate with correction' }).click();
    await page.getByText('Correction applied. Original OCR observations remain in the evidence ledger.').waitFor({ state: 'visible' });
    await page.locator('#portion').fill('50');
    if (!(await mathsDetails.evaluate((details) => (details as HTMLDetailsElement).open))) await page.getByText('See the label & calculation maths').click();
    const corrected = page.locator('.details-block table tbody tr').filter({ hasText: 'Saturated fat' });
    const correctedText = await corrected.innerText();
    const calculation = await corrected.locator('td').nth(2).innerText();
    const calculatedAmount = Number(calculation.match(/(-?\d+(?:[.,]\d+)?)/)?.[1]?.replace(',', '.') ?? NaN);
    const expected50gAmount = expectedSatFat.value * 50 / record.manualAnnotation.basis.amount;
    const correctedReadingAssumption = await mathsDetails.locator('p.formula small').first().innerText();
    const correctionMarkedUnverified = /not independently verified/i.test(correctedReadingAssumption);
    if (!(await originalObservations.evaluate((details) => (details as HTMLDetailsElement).open))) await originalObservations.locator('summary').click();
    const renderedOriginalOcrIds = await originalObservations.locator('.observations-list .observation-entry:not(.correction-observation)').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-observation-id')).filter((id): id is string => id !== null));
    const originalOcrIds = exported.package.observations.filter((item) => item.field === 'ocr-line').map((item) => item.id);
    const retainedObservations = originalOcrIds.length === exportedOcrLines.length && originalOcrIds.every((id) => renderedOriginalOcrIds.includes(id));
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
      detectedServing: exported.package.serving ?? null,
      initialPortion,
      ocrObservations: observations,
      ocrEngineSelections,
      exportedOcrLines: exportedOcrLines.length,
      exportedOcrWordBoxes: exportedOcrWords.length,
      ocrWordGeometryWithinCapture,
      parsedNutrientRows: parsedRows,
      annotatedFieldCounts,
      stageDiagnostics,
      answerDisclosureMarkedUnverified,
      annotatedFieldScoreConserved,
      noIncorrectAnnotatedFields,
      addPhotoActionVisible,
      addPhotoPickerOpened,
      calculatedNutrients: calculated,
      plainLanguageUnknownSummary: unknownSummary,
      summaryHidesParserJargon: !/unit missing|invalid value withheld|multiple numeric values retained/i.test(unknownSummary),
      labelNotesInitiallyCollapsed: labelNotesCollapsed,
      labelNotesDisclosure,
      labelNotesPreserveParserDetails,
      exactSaturatedFatObservation: exactSatFatMatch,
      localOcrRegionInspectionWorks,
      localOcrRegionInspectionMadeNoHttpRequest,
      uncertaintyFollowUpUsesPackageEvidence,
      uncertaintyAnswerLength: uncertaintyAnswer.length,
      followUpMessages: await page.locator('.conversation .assistant-message').count(),
      correctionApplied: correctedText.toLowerCase().includes('corrected'),
      correctionBasisMatchesObserved,
      originalObservationsRetained: retainedObservations,
      portion: await page.locator('#portion').inputValue(),
      fiftyGramCalculation: Number.isFinite(calculatedAmount) && Math.abs(calculatedAmount - expected50gAmount) <= Math.max(.1, Math.abs(expected50gAmount) * .015),
      ocrReadingMarkedUnverified,
      correctionMarkedUnverified,
      syntheticProfileOnly: true,
      personalizedQuestionRetained: (await personalizedUserMessage.innerText()).includes(personalizedQuestion),
      personalCarbohydrateTargetWithheld: /not a personal (?:daily )?target|cannot calculate .*daily target|does not establish .*daily target/i.test(personalizedAnswer) && !/\b\d+(?:\.\d+)?\s*g\s*\/\s*day/i.test(personalizedAnswer),
      clinicianContextVisible: /health care team/i.test(personalizedAnswer) && /not an individual allowance/i.test(personalizedAnswer),
      diabetesPlanningOptionsVisible: /plate method/i.test(personalizedAnswer) && /not everyone with diabetes needs to count carbs/i.test(personalizedAnswer),
      niddkSourceLinked: niddkHref === 'https://www.niddk.nih.gov/health-information/diabetes/overview/healthy-living-with-diabetes',
      noNonLoopbackRequests: nonLoopbackRequests.length === 0,
      nonLoopbackRequestOrigins: [...new Set(nonLoopbackRequests.map(requestUrl => new URL(requestUrl).origin))],
      paddleModelAssetRequests,
      geminiRouteRequests,
      noGeminiRouteRequests: geminiRouteRequests.length === 0,
      axeViolationIds: axeIds,
      pageErrors,
    });
    await context.close();
  }
  const receipt = { schemaVersion: 1, kind: diagnosticOnly ? 'core-real-photo-extraction-diagnostic' : 'core-intake-to-audit-design-review', generatedAt: new Date().toISOString(), captureTool: 'Playwright using installed Chrome', appOrigin: origin.origin, acceptanceMode: process.env.NUTRISCAN_ACCEPTANCE_MODE ?? 'loopback local application', photoFile, photoFiles, photoRoles, limitations: ['OCR field measurements use one source image and a single human visual read, not independent adjudication or a held-out accuracy estimate.', 'Axe results are automated checks, not full accessibility conformance.', 'The browser receipt counts Gemini route invocations, not downstream provider calls or provider cost.'], screenshots: path.relative(process.cwd(), captureDir), outcomes: results };
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ receipt: path.relative(process.cwd(), receiptPath), screenshotDirectory: path.relative(process.cwd(), captureDir), outcomes: results }, null, 2));
  if (!diagnosticOnly && (results.length !== 2 || results.some((item) => !item.realPhotoHashVerified || !item.initialQuestionRetained || item.packageName !== 'Unidentified package' || !item.summaryHidesParserJargon || !item.answerDisclosureMarkedUnverified || !item.addPhotoActionVisible || !item.addPhotoPickerOpened || !item.labelNotesInitiallyCollapsed || !String(item.labelNotesDisclosure).startsWith('Label-reading notes') || !item.labelNotesPreserveParserDetails || !item.exactSaturatedFatObservation || !item.annotatedFieldScoreConserved || !item.noIncorrectAnnotatedFields || !item.localOcrRegionInspectionWorks || !item.localOcrRegionInspectionMadeNoHttpRequest || !item.uncertaintyFollowUpUsesPackageEvidence || !item.ocrWordGeometryWithinCapture || !item.fiftyGramCalculation || !item.correctionBasisMatchesObserved || !item.ocrReadingMarkedUnverified || !item.correctionMarkedUnverified || !item.originalObservationsRetained || !item.personalizedQuestionRetained || !item.personalCarbohydrateTargetWithheld || !item.clinicianContextVisible || !item.diabetesPlanningOptionsVisible || !item.niddkSourceLinked || !item.noNonLoopbackRequests || !item.noGeminiRouteRequests || item.pageErrors.length || Object.values(item.axeViolationIds).some((ids) => ids.length)))) process.exitCode = 1;
} finally {
  await browser.close();
}
