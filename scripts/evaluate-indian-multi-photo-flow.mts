import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const baselineReceiptPath = path.resolve(root, 'docs/evidence/india-maggi-multi-photo-flow-before-sodium-recovery.json');
const baselineReceipt = JSON.parse(await readFile(baselineReceiptPath, 'utf8')) as {
  sourcePhotos?: Array<{ key?: string; sha256?: string }>;
  coverageFirstEvaluation?: { productGroups?: Array<{ nutrition?: { denominator?: number; correctAccepted?: number; incorrectAccepted?: number; omitted?: number; withheld?: number; fields?: Array<{ nutrient?: string; expected?: { value?: number; basis?: { amount?: number } }; status?: string }> } }> };
};
const sources = [
  {
    key: 'nutrition',
    file: path.resolve(root, '.data/indian-hindi-label-probe/maggi-noodles-nutrition-en-r13.jpg'),
    url: 'https://images.openfoodfacts.org/images/products/890/105/802/2193/nutrition_en.13.full.jpg',
  },
  {
    key: 'ingredients',
    file: path.resolve(root, '.data/indian-hindi-label-probe/maggi-noodles-ingredients-en-r19.jpg'),
    url: 'https://images.openfoodfacts.org/images/products/890/105/802/2193/ingredients_en.19.full.jpg',
  },
];
const sourceReceipts = await Promise.all(sources.map(async source => {
  const bytes = await readFile(source.file);
  return { key: source.key, url: source.url, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
}));
const baseUrl = process.env.NUTRISCAN_BASE_URL ?? 'http://127.0.0.1:3413';
const appOrigin = new URL(baseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(appOrigin.hostname)) throw new Error('Acceptance requires a loopback application origin.');

const browser = await chromium.launch({ channel: 'chrome', headless: false });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const page = await context.newPage();
const apiRequests: Array<{ method: string; path: string }> = [];
const externalRequests: Array<{ method: string; origin: string; bytes?: number }> = [];
const errors: string[] = [];
const modelResponses = new Map<string, number>();
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  const url = new URL(request.url());
  if (url.origin === appOrigin.origin && url.pathname.startsWith('/api/')) apiRequests.push({ method: request.method(), path: url.pathname });
  else if (url.origin !== appOrigin.origin) externalRequests.push({ method: request.method(), origin: url.origin });
});
page.on('response', response => {
  const url = new URL(response.url());
  if (url.hostname === 'paddle-model-ecology.bj.bcebos.com') modelResponses.set(url.href, Number(response.headers()['content-length'] ?? 0));
});

const outputDir = path.resolve(root, '.data/indian-hindi-label-probe/multi-photo-acceptance');
await mkdir(outputDir, { recursive: true });
const viewportResults: Array<Record<string, unknown>> = [];
let packageResult: Record<string, unknown> | undefined;
let coverageEvaluation: Record<string, unknown> | undefined;
let firstAnswer = '';
let followupAnswer = '';

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  const intakeAxe = await new AxeBuilder({ page }).analyze();
  await page.getByLabel('Add one or more product photos').setInputFiles(sources.map(source => source.file));
  const initialQuestion = 'How much protein is in a 70 g serving?';
  await page.getByLabel('What would you like to find out?').fill(initialQuestion);
  await page.getByRole('button', { name: /Read .*photos/ }).click();
  await page.locator('.results-section').waitFor({ state: 'visible', timeout: 120_000 });
  await page.waitForFunction(before => {
    const messages = Array.from(document.querySelectorAll('.assistant-message p'));
    return messages.length > 0 && messages.at(-1)?.textContent?.trim() !== before;
  }, firstAnswer, { timeout: 20_000 });
  firstAnswer = (await page.locator('.assistant-message p').last().innerText()).trim();

  const followup = 'What allergen warnings did the package state?';
  await page.getByLabel('Ask about this package').fill(followup);
  await page.getByRole('button', { name: 'Send follow-up' }).click();
  await page.waitForFunction(before => {
    const messages = Array.from(document.querySelectorAll('.assistant-message p'));
    return messages.length > 1 && messages.at(-1)?.textContent?.trim() !== before;
  }, firstAnswer, { timeout: 20_000 });
  followupAnswer = (await page.locator('.assistant-message p').last().innerText()).trim();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export evidence report' }).click();
  const stream = await (await downloadPromise).createReadStream();
  if (!stream) throw new Error('Evidence export was unavailable.');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const exported = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { package: Record<string, unknown> };
  const pkg = exported.package as {
    name?: string; brand?: string; barcode?: string; serving?: { value: number; unit: 'g' | 'ml' }; ingredients?: string[]; allergens?: string[]; additives?: string[]; warnings?: string[];
    nutrients?: Array<{ key: string; value: number; unit: string; basis?: { amount: number; unit: string } | null; status: string }>;
    observations?: Array<{ id?: string; field: string; text: string; imageId?: string; ocrWords?: Array<{ text?: string; confidence?: number; bbox?: unknown }>; bbox?: unknown; readingOrder?: { runId?: string }; derivedFromObservationIds?: string[] }>;
    ocrCaptures?: Array<{ runId?: string; engine?: { name?: string }; imageId?: string }>;
    parserDiagnostics?: Array<{ decision: string }>;
  };
  const expected: Record<string, Array<{ value: number; unit: string }>> = {
    energy: [{ value: 384, unit: 'kcal' }, { value: 269, unit: 'kcal' }],
    protein: [{ value: 8.2, unit: 'g' }, { value: 5.7, unit: 'g' }],
    carbohydrate: [{ value: 59.6, unit: 'g' }, { value: 41.7, unit: 'g' }],
    sugars: [{ value: 1.8, unit: 'g' }, { value: 1.3, unit: 'g' }],
    addedSugars: [{ value: 1.1, unit: 'g' }, { value: 0.8, unit: 'g' }],
    fat: [{ value: 12.5, unit: 'g' }, { value: 8.8, unit: 'g' }],
    saturatedFat: [{ value: 8.2, unit: 'g' }, { value: 5.8, unit: 'g' }],
    sodium: [{ value: 1000, unit: 'mg' }, { value: 700, unit: 'mg' }],
  };
  const nutrients = pkg.nutrients ?? [];
  let exactFields = 0;
  let acceptedWrongFields = 0;
  let withheldFields = 0;
  let omittedFields = 0;
  const nutrientFieldCases: Array<Record<string, unknown>> = [];
  for (const [key, values] of Object.entries(expected)) {
    for (const [index, reference] of values.entries()) {
      const basisAmount = index === 0 ? 100 : 70;
      const matching = nutrients.filter(item => item.key === key && item.basis?.amount === basisAmount && item.basis.unit === 'g');
      const accepted = matching.filter(item => item.status === 'observed');
      const exact = accepted.some(item => item.value === reference.value && item.unit === reference.unit);
      const wrong = accepted.some(item => item.value !== reference.value || item.unit !== reference.unit);
      const unresolved = nutrients.some(item => item.key === key && (item.status === 'conflict' || !item.basis));
      const status = wrong ? 'incorrect-accepted' : exact ? 'correct-accepted' : matching.length || unresolved ? 'withheld' : 'omitted';
      if (status === 'incorrect-accepted') acceptedWrongFields++;
      else if (status === 'correct-accepted') exactFields++;
      else if (status === 'withheld') withheldFields++;
      else omittedFields++;
      nutrientFieldCases.push({
        nutrient: key,
        expected: { value: reference.value, unit: reference.unit, basis: { amount: basisAmount, unit: 'g' } },
        status,
        accepted: matching.filter(item => item.status === 'observed').map(item => ({ value: item.value, unit: item.unit, basis: item.basis })),
        parserCandidates: nutrients.filter(item => item.key === key && (item.status !== 'observed' || item.basis?.amount === basisAmount)).map(item => ({ value: item.value, unit: item.unit, basis: item.basis ?? null, status: item.status })),
      });
    }
  }
  const observations = pkg.observations ?? [];
  const ocrLines = observations.filter(item => item.field === 'ocr-line');
  const captures = pkg.ocrCaptures ?? [];
  const captureByRun = new Map(captures.map(capture => [capture.runId, capture]));
  const ingredientObservations = observations.filter(item => item.field === 'ingredients');
  const allergenObservations = observations.filter(item => item.field === 'allergens');
  const nutrientRowPatterns: Record<string, RegExp> = {
    energy: /\benergy\b/i,
    protein: /\bprotein\b/i,
    carbohydrate: /\bcarbohydrates?\b/i,
    sugars: /\b(?:total\s+)?sugars?\b/i,
    addedSugars: /\badded\s+sugars?\b/i,
    fat: /\btotal\s+fat\b|(?<!saturated\s)\bfat\b/i,
    saturatedFat: /\bsaturated\s+fat\b/i,
    sodium: /\bsodium\b/i,
  };
  const baselineNutrition = baselineReceipt.coverageFirstEvaluation?.productGroups?.[0]?.nutrition;
  const baselineFields = baselineNutrition?.fields ?? [];
  const candidateLevelRecoveryFields = nutrientFieldCases.map(item => {
    const expectedField = item.expected as { value: number; unit: string; basis: { amount: number; unit: string } };
    const key = item.nutrient as string;
    const rowObservations = ocrLines.filter(observation => nutrientRowPatterns[key]?.test(observation.text));
    const rowIds = new Set(rowObservations.map(observation => observation.id).filter((id): id is string => !!id));
    const rawRowEvidence = rowObservations.map(observation => ({
      observationId: observation.id ?? null,
      imageId: observation.imageId ?? null,
      reader: captureByRun.get(observation.readingOrder?.runId)?.engine?.name ?? 'unknown',
      text: observation.text,
      numericWordTokens: (observation.ocrWords ?? []).filter(word => /^\d[\d.,/]*$/.test(word.text ?? '')).map(word => word.text),
    }));
    const reconstructedRows = observations.filter(observation => observation.field === 'nutrition-row-candidate' && observation.derivedFromObservationIds?.some(id => rowIds.has(id)));
    const parserCandidates = nutrients.filter(nutrient => nutrient.key === key).map(nutrient => ({ value: nutrient.value, unit: nutrient.unit, basis: nutrient.basis ?? null, status: nutrient.status }));
    const correctValueUnitCandidateAvailable = parserCandidates.some(candidate => candidate.value === expectedField.value && candidate.unit === expectedField.unit);
    const correctValueUnitBasisCandidateAvailable = parserCandidates.some(candidate => candidate.value === expectedField.value && candidate.unit === expectedField.unit && candidate.basis?.amount === expectedField.basis.amount && candidate.basis.unit === expectedField.basis.unit && candidate.status === 'observed');
    const expectedDigits = String(expectedField.value).replace(/\D/g, '');
    const correctDigitsSubstringPresentInSameRow = rawRowEvidence.some(row => row.numericWordTokens.some(token => token.replace(/\D/g, '').includes(expectedDigits)));
    const exactStandaloneValueTokenPresentInSameRow = rawRowEvidence.some(row => row.numericWordTokens.some(token => Number(token.replace(',', '.')) === expectedField.value));
    const relevantRuns = new Set(rowObservations.map(observation => `${observation.imageId ?? ''}\u0000${observation.readingOrder?.runId ?? ''}`));
    const relevantHeaderEvidence = ocrLines.filter(observation => relevantRuns.has(`${observation.imageId ?? ''}\u0000${observation.readingOrder?.runId ?? ''}`) && /100\s*g|70\s*g|per\s*serve/i.test(observation.text)).map(observation => ({ imageId: observation.imageId ?? null, text: observation.text }));
    const priorStatus = baselineFields.find(field => field.nutrient === key && field.expected?.value === expectedField.value && field.expected?.basis?.amount === expectedField.basis.amount)?.status ?? null;
    const currentStatus = item.status as string;
    let blockingStage: string | null = null;
    if (currentStatus !== 'correct-accepted') {
      if (!rowObservations.length) blockingStage = 'nutrient-row text detection or recognition';
      else if (!correctDigitsSubstringPresentInSameRow) blockingStage = 'numeric value detection or recognition within the nutrient row';
      else if (!correctValueUnitCandidateAvailable) blockingStage = 'numeric token segmentation or value-to-row reconstruction';
      else if (!correctValueUnitBasisCandidateAvailable) blockingStage = 'unit, serving-basis association, or parser validation';
      else blockingStage = 'downstream acceptance or duplicate/conflict reconciliation';
    }
    return {
      nutrient: key,
      expected: expectedField,
      currentOutcome: currentStatus,
      priorReceiptOutcome: priorStatus,
      rawRowEvidence,
      correctDigitsSubstringPresentInSameRow,
      exactStandaloneValueTokenPresentInSameRow,
      candidateAvailable: { correctValueAndUnit: correctValueUnitCandidateAvailable, correctValueUnitAndBasisAccepted: correctValueUnitBasisCandidateAvailable },
      reconstructedCandidateTexts: reconstructedRows.map(observation => ({ id: observation.id ?? null, text: observation.text, derivedFromObservationIds: observation.derivedFromObservationIds ?? [] })),
      relevantHeaderEvidence,
      blockingStage,
    };
  });
  const samePhotoFingerprints = (baselineReceipt.sourcePhotos ?? []).length === sourceReceipts.length && sourceReceipts.every(source => baselineReceipt.sourcePhotos?.some(prior => prior.key === source.key && prior.sha256 === source.sha256));
  const expectedAllergenStatements = ['Allergen Note: Contains Wheat & Nut.', 'May contain Milk, Oats and Soy.'];
  const correctAllergenCount = expectedAllergenStatements.filter(statement => allergenObservations.some(item => item.text === statement)).length;
  const incorrectAllergenCount = allergenObservations.filter(item => !expectedAllergenStatements.includes(item.text)).length;
  const identityWasWithheld = pkg.name === 'Unidentified package' && (pkg.warnings ?? []).some(warning => /OCR name candidate appeared only in photos that also contain nutrition tables/i.test(warning));
  const productIdentityStatus = pkg.name && /maggi/i.test(pkg.name) ? 'correct-accepted' : pkg.name && pkg.name !== 'Unidentified package' ? 'incorrect-accepted' : identityWasWithheld ? 'withheld' : 'omitted';
  const servingStatus = !pkg.serving ? 'omitted' : pkg.serving.value === 70 && pkg.serving.unit === 'g' ? 'correct-accepted' : 'incorrect-accepted';
  const observationText = ocrLines.map(item => item.text.toLocaleLowerCase('en-IN')).join('\n');
  const privacy = await page.getByText(/Photos stay in this browser unless/).count().catch(() => 0);
  const ingredientSection = page.locator('.ingredients-section');
  const ingredientSectionVisible = await ingredientSection.isVisible().catch(() => false);
  const ingredientTagCount = await ingredientSection.locator('.ingredient-tags span').count().catch(() => 0);
  packageResult = {
    photoCount: sources.length,
    photoRolesWereUnspecified: true,
    packageName: pkg.name ?? 'Unidentified package',
    identityWarnings: (pkg.warnings ?? []).filter(warning => /product name|identity/i.test(warning)),
    brand: pkg.brand ?? null,
    barcode: pkg.barcode ?? null,
    serving: pkg.serving ?? null,
    ingredientSectionCount: pkg.ingredients?.length ?? 0,
    ingredientLinesLinkedToPhoto: observations.filter(item => item.field === 'ingredients').length,
    ingredientLinesLinkedToSourceOcr: observations.filter(item => item.field === 'ingredients' && (item.derivedFromObservationIds?.length ?? 0) > 0 && !!item.imageId && !!item.bbox).length,
    ingredientSectionVisible,
    ingredientTagCount,
    allergens: pkg.allergens ?? [],
    allergenLinesLinkedToPhoto: observations.filter(item => item.field === 'allergens').length,
    observedIngredientSignals: Object.fromEntries(['wheat', 'palm oil', 'iodized salt'].map(term => [term, observationText.includes(term)])),
    observedAllergenSignals: Object.fromEntries(['wheat', 'nut', 'milk', 'oats', 'soy'].map(term => [term, observationText.includes(term)])),
    additives: pkg.additives ?? [],
    nutritionFieldCases: 16,
    exactValueUnitBasis: exactFields,
    acceptedWrong: acceptedWrongFields,
    withheld: withheldFields,
    omitted: omittedFields,
    totalUnusable: withheldFields + omittedFields,
    usableCoverage: `${exactFields}/16`,
    nutrients: nutrients.map(({ key, value, unit, basis, status }) => ({ key, value, unit, basis, status })),
    ocrLineCount: ocrLines.length,
    wordBoxCount: ocrLines.reduce((sum, item) => sum + (item.ocrWords?.length ?? 0), 0),
    engines: [...new Set(captures.map(capture => capture.engine?.name).filter(Boolean))],
    parserDecisionCounts: (pkg.parserDiagnostics ?? []).reduce((counts, item) => { counts[item.decision] = (counts[item.decision] ?? 0) + 1; return counts; }, {} as Record<string, number>),
    privacyDisclosureVisible: privacy > 0,
  };
  const byBasis = (amount: number) => ({
    denominator: 8,
    correctAccepted: nutrientFieldCases.filter(item => (item.expected as { basis: { amount: number } }).basis.amount === amount && item.status === 'correct-accepted').length,
    incorrectAccepted: nutrientFieldCases.filter(item => (item.expected as { basis: { amount: number } }).basis.amount === amount && item.status === 'incorrect-accepted').length,
    omitted: nutrientFieldCases.filter(item => (item.expected as { basis: { amount: number } }).basis.amount === amount && item.status === 'omitted').length,
    withheld: nutrientFieldCases.filter(item => (item.expected as { basis: { amount: number } }).basis.amount === amount && item.status === 'withheld').length,
  });
  coverageEvaluation = {
    productGroups: [{
      productGroup: 'Maggi noodles 8901058022193',
      photos: 2,
      split: 'exploratory development; the photos and repeated serving columns are one product group, not independent samples',
      nutrition: { denominator: 16, correctAccepted: exactFields, incorrectAccepted: acceptedWrongFields, omitted: omittedFields, withheld: withheldFields, totalUnusable: withheldFields + omittedFields, usableCoverage: `${exactFields}/16`, byBasis: { per100g: byBasis(100), per70gServing: byBasis(70) }, fields: nutrientFieldCases },
      nonNutrient: {
        productIdentity: { denominator: 1, expected: 'Maggi noodles (same OFF product association; not independent image adjudication)', actual: pkg.name ?? null, correctAccepted: productIdentityStatus === 'correct-accepted' ? 1 : 0, incorrectAccepted: productIdentityStatus === 'incorrect-accepted' ? 1 : 0, omitted: productIdentityStatus === 'omitted' ? 1 : 0, withheld: productIdentityStatus === 'withheld' ? 1 : 0, candidateWithheldBy: identityWasWithheld ? 'candidate appears only in OCR from photos that also contain nutrition tables; front or verified identifier is absent' : null },
        servingDeclaration: { denominator: 1, expected: { value: 70, unit: 'g' }, actual: pkg.serving ?? null, correctAccepted: servingStatus === 'correct-accepted' ? 1 : 0, incorrectAccepted: servingStatus === 'incorrect-accepted' ? 1 : 0, omitted: servingStatus === 'omitted' ? 1 : 0, withheld: 0 },
        ingredients: { completeListsExpected: 1, completeListAccuracy: null, status: 'not independently scored; no adjudicated transcript', sourceLinkedSegments: ingredientObservations.filter(item => (item.derivedFromObservationIds?.length ?? 0) > 0 && !!item.imageId && !!item.bbox).length, availableSegments: ingredientObservations.length, correctSegments: null, incorrectSegments: null, omittedIngredients: null, withheldIngredients: null },
        allergens: { denominator: 2, correctAccepted: correctAllergenCount, incorrectAccepted: incorrectAllergenCount, omitted: Math.max(0, expectedAllergenStatements.length - correctAllergenCount), withheld: 0, reference: 'same-image visual check by one reviewer; not independent adjudication', observations: allergenObservations.map(item => item.text) },
      },
    }],
    acrossProductGroups: { productGroups: 1, independentProductCategories: ['noodles'], nutrition: { denominator: nutrientFieldCases.length, correctAccepted: exactFields, incorrectAccepted: acceptedWrongFields, omitted: omittedFields, withheld: withheldFields, totalUnusable: withheldFields + omittedFields, usableCoverage: `${exactFields}/16` }, note: 'Totals equal one product group; repeated columns and two photos are not counted as independent products.' },
    candidateLevelRecovery: {
      unusableFields: candidateLevelRecoveryFields.filter(item => item.currentOutcome !== 'correct-accepted'),
      allFields: candidateLevelRecoveryFields,
      priorReceiptCompared: 'docs/evidence/india-maggi-multi-photo-flow-before-sodium-recovery.json',
      samePhotoFingerprints,
      note: 'Digits found inside a fused token are only a character-substring signal, not proof of standalone OCR recognition. Reconstructed candidates retain links to the original OCR row.',
    },
    comparableBehaviorChange: {
      metric: 'complete exact nutrient value-unit-basis fields',
      before: { denominator: baselineNutrition?.denominator ?? null, correctAccepted: baselineNutrition?.correctAccepted ?? null, incorrectAccepted: baselineNutrition?.incorrectAccepted ?? null, omitted: baselineNutrition?.omitted ?? null, withheld: baselineNutrition?.withheld ?? null, totalUnusable: (baselineNutrition?.omitted ?? 0) + (baselineNutrition?.withheld ?? 0) },
      after: { denominator: nutrientFieldCases.length, correctAccepted: exactFields, incorrectAccepted: acceptedWrongFields, omitted: omittedFields, withheld: withheldFields, totalUnusable: omittedFields + withheldFields },
      samePhotoFingerprints,
      automaticallyRecoveredFields: candidateLevelRecoveryFields.filter(item => item.priorReceiptOutcome !== item.currentOutcome).map(item => ({ nutrient: item.nutrient, expected: item.expected, before: item.priorReceiptOutcome, after: item.currentOutcome })),
      automaticWithoutManualCorrection: true,
      accuracyClaim: 'Within-image exploratory comparison only; nutrient annotations are a single visual read from the same product source, not independent adjudication or held-out evaluation.',
    },
    referenceMethod: 'Nutrient reference was transcribed from the same package source, not independently adjudicated. Identity is evaluated against the associated Maggi product record; OCR-only package identity remains unverified. Ingredient exactness is unscored. Allergen text had one same-image visual check.',
  };
  await writeFile(path.resolve(root, '.data/indian-hindi-label-probe/multi-photo-ocr-debug.json'), JSON.stringify({
    createdAt: new Date().toISOString(),
    sources: sourceReceipts,
    captures: pkg.ocrCaptures ?? [],
    ocrLines: ocrLines.map(item => ({ id: item.id, imageId: item.imageId, text: item.text, bbox: item.bbox, readingOrder: item.readingOrder, ocrWords: item.ocrWords })),
    parsedIngredientObservations: observations.filter(item => item.field === 'ingredients'),
    parsedAllergenObservations: observations.filter(item => item.field === 'allergens'),
  }, null, 2) + '\n');

  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(150);
    const axe = await new AxeBuilder({ page }).analyze();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    const name = viewport.width === 390 ? 'mobile' : 'desktop';
    await page.screenshot({ path: path.join(outputDir, `${name}.png`), fullPage: true });
    viewportResults.push({ viewport: `${viewport.width}x${viewport.height}`, axeViolations: axe.violations.map(issue => issue.id).sort(), horizontalOverflow: overflow });
  }
} finally {
  await context.close();
  await browser.close();
}

const result = {
  schemaVersion: 1,
  kind: 'indian-market-two-photo-local-ocr-product-journey',
  generatedAt: new Date().toISOString(),
  appOrigin: appOrigin.origin,
  browser: 'Installed Chrome via Playwright, visible window, fresh context',
  datasetSplit: 'exploratory development; one product group; single manual reference from the same package source; not independent accuracy',
  sourceProduct: 'Maggi noodles barcode 8901058022193; OFF image CC BY-SA, exact attribution/reuse review pending; source bytes remain local and uncommitted',
  sourcePhotos: sourceReceipts,
  initialQuestion: 'How much protein is in a 70 g serving?',
  initialAnswer: firstAnswer,
  followupQuestion: 'What allergen warnings did the package state?',
  followupAnswer,
  package: packageResult,
  coverageFirstEvaluation: coverageEvaluation,
  viewports: viewportResults,
  localApiRoutes: [...new Set(apiRequests.map(request => request.path))].sort(),
  geminiRouteRequests: apiRequests.filter(request => ['/api/assist', '/api/vision'].includes(request.path)),
  externalRequests,
  paddleModelAssetBytes: [...modelResponses.values()].reduce((sum, bytes) => sum + bytes, 0),
  pageErrors: errors,
  screenshots: '.data/indian-hindi-label-probe/multi-photo-acceptance/',
  limitations: [
    'Both package photos are English-only and from one noodles product group.',
    'Reference readings were manually transcribed from the same source package, not independently adjudicated.',
    'Recovered ingredient segments still contain recognition errors and are not independently scored for exact ingredient transcription.',
    'This run does not establish population accuracy or regional Indian language readiness.',
    'A community record or product identity is not verified by matching words in a package photograph.',
  ],
};
await writeFile(path.resolve(root, 'docs/evidence/india-maggi-multi-photo-flow.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
