import { describe, expect, it } from 'vitest';
import { defaultProfile, packageSchema, tentativeStructuredCandidateSchema, type Calculation, type PackageData } from '../../lib/contracts';
import { InferenceModuleError, validateInferenceOutput } from './index';

const fixturePackage: PackageData = packageSchema.parse({
  id: 'synthetic-package',
  name: 'Unidentified package',
  ingredients: [],
  additives: [],
  allergens: [],
  claims: [],
  nutrients: [],
  observations: [{
    id: 'ocr-line-1',
    field: 'ocr-line',
    text: 'Protein approx 8.8 g',
    side: 'back',
    confidence: 54,
    bbox: { x0: 12, y0: 20, x1: 250, y1: 42 },
    ocrWords: [
      { wordIndex: 0, text: 'Protein', confidence: 92, bbox: { x0: 12, y0: 20, x1: 92, y1: 42 } },
      { wordIndex: 1, text: 'approx', confidence: 43, bbox: { x0: 98, y0: 20, x1: 153, y1: 42 } },
      { wordIndex: 2, text: '8.8', confidence: 49, bbox: { x0: 159, y0: 20, x1: 198, y1: 42 } },
      { wordIndex: 3, text: 'g', confidence: 70, bbox: { x0: 205, y0: 20, x1: 217, y1: 42 } },
    ],
    origin: 'ocr',
    imageId: 'synthetic-image',
    readingOrder: { runId: 'synthetic-run', blockIndex: 0, paragraphIndex: 0, lineIndex: 0 },
  }],
  ocrCaptures: [{
    runId: 'synthetic-run',
    imageId: 'synthetic-image',
    side: 'back',
    sourceImage: { width: 300, height: 500 },
    preparedImage: { width: 300, height: 500 },
    bboxCoordinateSpace: 'prepared-image-pixels',
    engine: { name: 'fixture-reader', version: '1', language: 'eng', confidenceScale: '0-100', segmentationMode: 'single-block' },
    processing: { rotation: 0, contrast: false, invert: false, cropPercent: null },
  }],
  rawText: 'Protein approx 8.8 g',
  warnings: [],
  synthetic: true,
  createdAt: '2026-01-01T00:00:00.000Z',
});

const observationSpan = { kind: 'observation' as const, id: 'ocr-line-1', quote: 'Protein approx 8.8 g' };

describe('provider-independent inference output validation', () => {
  it('supports source-linked allergen, warning and package-claim candidate kinds', () => {
    const base = { candidateId: 'label-candidate', field: 'label-content', proposedValue: 'Contains wheat', numericValue: null, unit: null, basis: null, normalizedEntity: null, status: 'tentative' as const, observationIds: ['ocr-line-1'], sourceIds: [], supportingSpans: [{ kind: 'observation' as const, id: 'ocr-line-1', quote: 'Protein approx 8.8 g' }], uncertainty: 'Preserved as an unverified example.' };
    for (const kind of ['allergen', 'warning', 'package-claim'] as const) expect(tentativeStructuredCandidateSchema.safeParse({ ...base, kind }).success).toBe(true);
  });

  it('renders a traceable synthesis while preserving uncertainty about the basis', () => {
    const output = {
      answer: 'Ignored free-form answer',
      claims: [{
        mode: 'synthesis',
        text: 'The OCR line appears to show about 8.8 g of protein, but its serving basis is unresolved.',
        observationIds: ['ocr-line-1'],
        sourceIds: [],
        supportingSpans: [observationSpan],
      }],
      limitations: [],
      inspectImage: null,
    };

    const result = validateInferenceOutput(output, { package: fixturePackage });

    expect(result.claims).toHaveLength(1);
    expect(result.answer).toContain('Evidence-linked interpretation');
    expect(result.answer).toContain('serving basis is unresolved');
    expect(result.answer).toContain('Protein approx 8.8 g');
    expect(result.answer).not.toContain('Ignored free-form answer');
  });

  it('accepts exact citations to a source record limitation', () => {
    const source = {
      id: 'assessment-source', title: 'Assessment record', publisher: 'Public authority',
      url: 'https://example.org/assessment', category: 'assessment' as const, jurisdiction: 'European Union',
      publishedAt: '2026-01-01', effectiveAt: null, retrievedAt: '2026-01-02',
      summary: 'This assessment discusses a substance under stated conditions.',
      limitations: 'It does not establish product presence, dose or personal safety.',
    };
    const result = validateInferenceOutput({
      answer: '',
      claims: [{
        mode: 'synthesis', text: 'The assessment does not establish this product’s dose or personal safety.',
        observationIds: [], sourceIds: [source.id],
        supportingSpans: [{ kind: 'source', id: source.id, quote: source.limitations }],
      }],
      limitations: [], inspectImage: null,
    }, { package: fixturePackage, evidence: [source] });

    expect(result.claims).toHaveLength(1);
    expect(result.answer).toContain('product presence, dose or personal safety');
  });

  it('keeps dose and exposure limitations while withholding personalized safety and treatment advice', () => {
    const result = validateInferenceOutput({
      answer: '',
      claims: [
        {
          mode: 'synthesis',
          text: 'This OCR line does not state a dose, so product amount and dietary exposure cannot be calculated.',
          observationIds: ['ocr-line-1'],
          sourceIds: [],
          supportingSpans: [observationSpan],
        },
        {
          mode: 'synthesis',
          text: 'This product is safe for you.',
          observationIds: ['ocr-line-1'],
          sourceIds: [],
          supportingSpans: [observationSpan],
        },
        {
          mode: 'synthesis',
          text: 'The available record does not establish that this product is safe for you.',
          observationIds: ['ocr-line-1'],
          sourceIds: [],
          supportingSpans: [observationSpan],
        },
        {
          mode: 'synthesis',
          text: 'You should avoid this product to treat diabetes.',
          observationIds: ['ocr-line-1'],
          sourceIds: [],
          supportingSpans: [observationSpan],
        },
      ],
      limitations: [],
      inspectImage: null,
    }, { package: fixturePackage });

    expect(result.claims).toHaveLength(2);
    expect(result.answer).toContain('does not state a dose');
    expect(result.answer).not.toContain('This product is safe for you.');
    expect(result.answer).toContain('does not establish that this product is safe');
    expect(result.answer).not.toContain('avoid this product');
  });

  it('withholds numeric synthesis that conflicts with cited OCR while allowing equivalent units', () => {
    const result = validateInferenceOutput({
      answer: '',
      claims: [
        {
          mode: 'synthesis',
          text: 'The OCR appears to show 80.8 g of protein, but its basis is unresolved.',
          observationIds: ['ocr-line-1'],
          sourceIds: [],
          supportingSpans: [observationSpan],
        },
        {
          mode: 'synthesis',
          text: 'The OCR may show 8800 mg of protein, but its basis is unresolved.',
          observationIds: ['ocr-line-1'],
          sourceIds: [],
          supportingSpans: [observationSpan],
        },
      ],
      limitations: [],
      inspectImage: null,
    }, { package: fixturePackage });

    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].text).toContain('8800 mg');
    expect(result.answer).not.toContain('80.8 g');
  });

  it('normalizes decimal-comma values before comparing grounded quantities', () => {
    const europeanPackage = packageSchema.parse({
      ...fixturePackage,
      id: 'synthetic-european-package',
      observations: [{ id: 'ocr-line-eu', field: 'ocr-line', text: 'Fibre 1.234,5 mg', side: 'back', confidence: 80, origin: 'ocr' }],
      ocrCaptures: [],
      rawText: 'Fibre 1.234,5 mg',
      nutrients: [],
    });
    const span = { kind: 'observation' as const, id: 'ocr-line-eu', quote: 'Fibre 1.234,5 mg' };
    const result = validateInferenceOutput({
      answer: '',
      claims: [{
        mode: 'synthesis',
        text: 'The label may report 1.2345 g of fibre.',
        observationIds: ['ocr-line-eu'],
        sourceIds: [],
        supportingSpans: [span],
      }],
      limitations: [],
      inspectImage: null,
    }, { package: europeanPackage });

    expect(result.claims).toHaveLength(1);
  });

  it('normalizes energy, volume and percentage quantities without crossing dimensions', () => {
    const cases = [
      { source: 'Energy 4.1840 kJ', claim: 'The line may show 1 kcal.' },
      { source: 'Volume 1 l', claim: 'The line may show 1000 ml.' },
      { source: 'Guidance 10 percent', claim: 'The cited guidance says 10%.' },
    ];
    for (const [index, item] of cases.entries()) {
      const observationId = `ocr-unit-${index}`;
      const pkg = packageSchema.parse({
        ...fixturePackage,
        id: `synthetic-unit-package-${index}`,
        observations: [{ id: observationId, field: 'ocr-line', text: item.source, side: 'back', confidence: 80, origin: 'ocr' }],
        ocrCaptures: [],
        rawText: item.source,
        nutrients: [],
      });
      const result = validateInferenceOutput({
        answer: '',
        claims: [{
          mode: 'synthesis',
          text: item.claim,
          observationIds: [observationId],
          sourceIds: [],
          supportingSpans: [{ kind: 'observation', id: observationId, quote: item.source }],
        }],
        limitations: [],
        inspectImage: null,
      }, { package: pkg });

      expect(result.claims).toHaveLength(1);
    }
  });

  it('checks paraphrased quantities against cited deterministic calculations', () => {
    const calculation: Calculation = {
      id: 'calc-protein-50g',
      label: 'Protein for 50 g',
      nutrient: 'protein',
      input: 8.8,
      inputUnit: 'g',
      basisAmount: 100,
      portion: 50,
      portionUnit: 'g',
      result: 4.4,
      unit: 'g',
      formula: '8.8 g × 50 g ÷ 100 g',
      evidenceText: 'A 50 g portion using 8.8 g protein per 100 g calculates to 4.4 g protein.',
      observationIds: ['ocr-line-1'],
      assumptions: ['The OCR reading is unverified.'],
    };
    const span = { kind: 'calculation' as const, id: calculation.id, quote: calculation.evidenceText! };
    const result = validateInferenceOutput({
      answer: '',
      claims: [
        {
          mode: 'synthesis',
          text: 'A 50 g portion calculates to 4.4 g protein.',
          observationIds: [],
          sourceIds: [],
          calculationIds: [calculation.id],
          supportingSpans: [span],
        },
        {
          mode: 'synthesis',
          text: 'A 50 g portion calculates to 4.8 g protein.',
          observationIds: [],
          sourceIds: [],
          calculationIds: [calculation.id],
          supportingSpans: [span],
        },
      ],
      limitations: [],
      inspectImage: null,
    }, { package: fixturePackage, calculations: [calculation] });

    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].text).toContain('4.4 g');
    expect(result.answer).not.toContain('4.8 g');
  });

  it('drops a forged quotation even when it uses a real observation identifier', () => {
    const result = validateInferenceOutput({
      answer: 'Sodium is 500 mg.',
      claims: [{
        mode: 'direct-quote',
        text: 'Sodium 500 mg',
        observationIds: ['ocr-line-1'],
        sourceIds: [],
        supportingSpans: [{ ...observationSpan, quote: 'Sodium 500 mg' }],
      }],
      limitations: [],
      inspectImage: null,
    }, { package: fixturePackage });

    expect(result.claims).toEqual([]);
    expect(result.answer).toContain('No supported factual conclusion');
    expect(result.answer).not.toContain('Sodium 500 mg');
  });

  it('retains a traceable OCR candidate as tentative without mutating package facts', () => {
    const before = structuredClone(fixturePackage);
    const candidate = {
      candidateId: 'candidate-protein-1',
      kind: 'nutrient',
      field: 'protein',
      proposedValue: '8.8 g',
      numericValue: 8.8,
      unit: 'g',
      basis: null,
      normalizedEntity: 'protein',
      status: 'tentative',
      observationIds: ['ocr-line-1'],
      sourceIds: [],
      supportingSpans: [observationSpan],
      ocrWordEvidence: [{ observationId: 'ocr-line-1', role: 'value', wordIndexes: [2, 3] }],
      uncertainty: 'The reading is approximate and the serving basis is unknown.',
    };

    const result = validateInferenceOutput({
      answer: '',
      claims: [],
      tentativeCandidates: [candidate],
      limitations: [],
      inspectImage: null,
    }, { package: fixturePackage });

    expect(result.tentativeCandidates).toEqual([candidate]);
    expect(result.answer).toContain('tentative package readings');
    expect(result.answer).toContain('clearly labeled arithmetic');
    expect(result.answer).toContain('remain outside calculations');
    expect(result.answer).not.toContain('8.8 g');
    expect(fixturePackage).toEqual(before);
    expect(fixturePackage.nutrients).toEqual([]);
  });

  it('accepts image-linked claims and candidates as unverified without promoting package facts', () => {
    const before = structuredClone(fixturePackage);
    const visualEvidence = {
      imageId: 'synthetic-image',
      visibleText: 'Protein 5.7 g per 70 g',
      region: { x: 0.2, y: 0.3, width: 0.4, height: 0.12 },
    };
    const candidate = {
      candidateId: 'vision-protein-1',
      kind: 'nutrient',
      field: 'protein',
      proposedValue: '5.7 g',
      numericValue: 5.7,
      unit: 'g',
      basis: { amount: 70, unit: 'g', description: 'per serving' },
      normalizedEntity: 'protein',
      status: 'tentative',
      observationIds: [],
      sourceIds: [],
      supportingSpans: [],
      visualEvidence: [visualEvidence],
      uncertainty: 'The image reading is model-reported and has not been independently verified.',
    };

    const result = validateInferenceOutput({
      answer: '',
      claims: [{
        mode: 'synthesis',
        text: 'The photo appears to show 5.7 g protein per 70 g serving.',
        observationIds: [],
        sourceIds: [],
        supportingSpans: [],
        visualEvidence: [visualEvidence],
      }],
      tentativeCandidates: [candidate],
      limitations: [],
      inspectImage: null,
    }, { package: fixturePackage, images: [{ handle: 'synthetic-image' }] });

    expect(result.claims).toHaveLength(1);
    expect(result.answer).toContain('Tentative visual interpretation');
    expect(result.answer).toContain('unverified');
    expect(result.answer).toContain('[image:synthetic-image]');
    expect(result.tentativeCandidates).toEqual([candidate]);
    expect(fixturePackage).toEqual(before);
    expect(fixturePackage.nutrients).toEqual([]);
  });

  it('rejects unknown image references and numeric visual claims unsupported by the reported text', () => {
    const visualEvidence = { imageId: 'synthetic-image', visibleText: 'Protein 5.7 g per 70 g', region: null };
    const output = {
      answer: '',
      claims: [{
        mode: 'synthesis',
        text: 'The photo appears to show 5.8 g protein per 70 g serving.',
        observationIds: [],
        sourceIds: [],
        supportingSpans: [],
        visualEvidence: [visualEvidence],
      }],
      limitations: [],
      inspectImage: null,
    };

    expect(() => validateInferenceOutput(output, { package: fixturePackage })).toThrowError(InferenceModuleError);
    const result = validateInferenceOutput(output, { package: fixturePackage, images: [{ handle: 'synthetic-image' }] });
    expect(result.claims).toEqual([]);
    expect(result.answer).toContain('No supported factual conclusion');
    expect(result.answer).not.toContain('5.8 g');
  });

  it('returns typed errors for malformed output and unknown evidence identifiers', () => {
    expect(() => validateInferenceOutput({ nope: true }, { package: fixturePackage })).toThrowError(InferenceModuleError);
    expect(() => validateInferenceOutput({
      answer: '',
      claims: [{
        mode: 'direct-quote',
        text: 'Missing evidence',
        observationIds: ['missing'],
        sourceIds: [],
        supportingSpans: [{ kind: 'observation', id: 'missing', quote: 'Missing evidence' }],
      }],
      limitations: [],
      inspectImage: null,
    }, { package: fixturePackage })).toThrowError(expect.objectContaining({ code: 'unknown_citation' }));
  });

  it('keeps only unique UI requests whose backing evidence exists and can be rendered', () => {
    const productSource = {
      id: 'community-oats', title: 'Example Oats', publisher: 'Open Food Facts community database',
      url: 'https://world.openfoodfacts.org/product/123456789', category: 'product' as const, jurisdiction: 'India',
      publishedAt: null, effectiveAt: null, retrievedAt: '2026-10-22T00:00:00.000Z', summary: 'Protein: 13 g per 100 g',
      limitations: 'Community record; verify the variant.',
    };
    const result = validateInferenceOutput({
      answer: '', claims: [], limitations: [], inspectImage: null,
      uiComponents: [
        { type: 'nutrition-table', observationIds: ['ocr-line-1'], sourceIds: [], calculationIds: [] },
        { type: 'nutrition-table', observationIds: ['ocr-line-1'], sourceIds: [], calculationIds: [] },
        { type: 'package-evidence', observationIds: ['not-present'], sourceIds: [], calculationIds: [] },
        { type: 'product-comparison', observationIds: ['ocr-line-1'], sourceIds: ['community-oats'], calculationIds: [] },
        { type: 'source-reference-cards', observationIds: [], sourceIds: ['unknown-source'], calculationIds: [] },
      ],
    }, { package: fixturePackage, evidence: [productSource] });

    expect(result.uiComponents.map(component => component.type)).toEqual(['nutrition-table', 'product-comparison']);
    expect(result.uiComponents[1].sourceIds).toEqual(['community-oats']);
  });

  it('shows a personalized UI choice only when a validated claim cites supplied profile context', () => {
    const profile = { ...defaultProfile, goals: 'Understand the nutrition label.' };
    const output = {
      answer: '',
      claims: [{
        mode: 'direct-quote' as const,
        text: profile.goals,
        observationIds: [], sourceIds: [], profileFieldIds: ['goals'],
        supportingSpans: [{ kind: 'profile' as const, id: 'goals', quote: profile.goals }],
      }],
      limitations: [], inspectImage: null,
      uiComponents: [{ type: 'personalized-finding' as const, observationIds: [], sourceIds: [], calculationIds: [] }],
    };
    expect(validateInferenceOutput({ ...output, claims: [] }, { package: fixturePackage }).uiComponents).toEqual([]);
    expect(validateInferenceOutput(output, { package: fixturePackage, profile }).uiComponents).toEqual(output.uiComponents);
  });
});
