import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { defaultProfile, packageSchema, type Observation, type ProductRecord, type TentativeStructuredCandidate } from '../contracts';
import { buildAudit } from '../engine';
import { reconcileInterpretedNutrition } from '../interpreted-nutrients';
import { parseLabel } from '../parser';
import { productEvidenceSource } from '../product-evidence';
import { ThreadGenerativeUI } from '../../components/thread-generative-ui';
import { ThreadPublicProductRecord } from '../../components/thread-public-product-record';

const imageId = 'package-photo-1';
const runId = 'ocr-run-1';

function makeObservation(id: string, text: string, tokens: string[], bounds: Array<[number, number]>, y: number): Observation {
  const ocrWords = tokens.map((word, wordIndex) => ({ wordIndex, text: word, confidence: 92, bbox: { x0: bounds[wordIndex][0], x1: bounds[wordIndex][1], y0: y, y1: y + 22 } }));
  return {
    id, field: 'ocr-line', text, side: 'back', confidence: 92, origin: 'ocr', imageId, ocrWords,
    bbox: { x0: Math.min(...ocrWords.map(word => word.bbox.x0)), y0: y, x1: Math.max(...ocrWords.map(word => word.bbox.x1)), y1: y + 22 },
    readingOrder: { runId, blockIndex: 0, paragraphIndex: 0, lineIndex: y },
  };
}

it('renders a reconciled missing nutrient in the selected-record comparison with OCR trace and unverified label', () => {
  const row = makeObservation('protein-row', 'Protein 8.8 g', ['Protein', '8.8', 'g'], [[100, 220], [650, 690], [700, 730]], 100);
  const basis = makeObservation('protein-basis', 'Per 100 g', ['Per', '100', 'g'], [[590, 620], [640, 680], [690, 710]], 60);
  const base = parseLabel('Package label', { origin: 'user' });
  const pkg = packageSchema.parse({
    ...base, name: 'Unidentified package', nutrients: [], observations: [row, basis], rawText: `${row.text}\n${basis.text}`,
    ocrCaptures: [{ runId, imageId, side: 'back', sourceImage: { width: 1000, height: 1000 }, preparedImage: { width: 1000, height: 1000 }, bboxCoordinateSpace: 'prepared-image-pixels', engine: { name: 'fixture-reader', version: '1', language: 'eng', confidenceScale: '0-100', segmentationMode: 'single-block' }, processing: { rotation: 0, contrast: false, invert: false, cropPercent: null } }],
  });
  const candidate: TentativeStructuredCandidate = {
    candidateId: 'protein-reading-1', kind: 'nutrient', field: 'protein', proposedValue: '8.8 g per 100 g', numericValue: 8.8, unit: 'g',
    basis: { amount: 100, unit: 'g', description: 'Per 100 g' }, normalizedEntity: 'protein', status: 'tentative',
    observationIds: [row.id, basis.id], sourceIds: [], supportingSpans: [{ kind: 'observation', id: row.id, quote: row.text }, { kind: 'observation', id: basis.id, quote: basis.text }],
    ocrWordEvidence: [{ observationId: row.id, role: 'label', wordIndexes: [0] }, { observationId: row.id, role: 'value', wordIndexes: [1] }, { observationId: row.id, role: 'unit', wordIndexes: [2] }, { observationId: basis.id, role: 'basis', wordIndexes: [0, 1, 2] }],
    uncertainty: 'This fixture represents an OCR-linked model interpretation, not provider or photo-accuracy evidence.',
  };
  const interpretedReadings = reconcileInterpretedNutrition(pkg, [candidate]).readings;
  const selectedProduct: ProductRecord = {
    id: 'community-candidate-1', name: 'Example community candidate', brand: 'Example', barcode: '', quantity: '', countries: [], url: 'https://world.openfoodfacts.org/product/0000000000000',
    retrievedAt: '2026-10-22T00:00:00.000Z', lastModified: null, nutrients: [{ key: 'protein', value: 10, unit: 'g', basis: { amount: 100, unit: 'g' } }],
    ingredients: '', allergens: [], match: 'candidate', availability: 'local stock unverified',
  };
  const source = productEvidenceSource(selectedProduct, selectedProduct.retrievedAt)!;
  const recordCard = renderToStaticMarkup(<ThreadPublicProductRecord product={selectedProduct} querySource="label-text" identityConflict={false} canCompare={interpretedReadings.length > 0} otherCandidates={[]} onCompare={() => {}}/>);
  const markup = renderToStaticMarkup(<ThreadGenerativeUI
    components={[{ type: 'product-comparison', observationIds: [], sourceIds: [source.id], calculationIds: [] }]}
    pkg={pkg} audit={buildAudit(pkg, 30, 'g', defaultProfile, 'Compare protein', [candidate])} portion={30} portionUnit="g"
    onPortionChange={() => {}} onPortionUnitChange={() => {}} onSaveCorrection={() => true}
    canInspect={() => true} isInspecting={() => false} onInspect={() => {}} candidates={[candidate]}
    interpretedReadings={interpretedReadings} sources={[source]} selectedProduct={selectedProduct}
  />);

  expect(interpretedReadings).toHaveLength(1);
  expect(recordCard).toContain('Compare with this label');
  expect(recordCard).not.toContain('disabled=""');
  expect(markup).toContain('8.8 g per 100 g');
  expect(markup).toContain('10 g per 100 g');
  expect(markup).toContain('Gemini interpretation · unverified against photo');
  expect(markup).toContain('Trace to OCR (2)');
  expect(markup).toContain('Inspect photo region');
});
