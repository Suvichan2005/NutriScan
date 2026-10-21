import { describe, expect, it } from 'vitest';
import { packageSchema, type PackageData } from '../../lib/contracts';
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
    expect(result.answer).toContain('Tentative model suggestion');
    expect(result.answer).toContain('Not verified and not added to package facts');
    expect(fixturePackage).toEqual(before);
    expect(fixturePackage.nutrients).toEqual([]);
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
});
