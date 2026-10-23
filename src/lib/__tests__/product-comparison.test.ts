import { describe, expect, it } from 'vitest';
import type { Nutrient, ProductRecord } from '../contracts';
import type { InterpretedNutrientReading } from '../interpreted-nutrients';
import { compareProductNutrition } from '../product-comparison';

const reading = (key: Nutrient['key'], value: number, unit: Nutrient['unit'], amount: number | null, basisUnit: 'g' | 'ml' = 'g', status: Nutrient['status'] = 'observed'): Nutrient => ({ key, value, unit, basis: amount ? { amount, unit: basisUnit, description: `per ${amount} ${basisUnit}` } : null, observationIds: ['observation-1'], status });
const record = (key: ProductRecord['nutrients'][number]['key'], value: number, unit: string, basis: ProductRecord['nutrients'][number]['basis'] = { amount: 100, unit: 'g' }): ProductRecord['nutrients'][number] => ({ key, value, unit, basis });
const interpreted = (value: number, amount: number, id = `candidate-${value}`): InterpretedNutrientReading => ({ key: 'protein', value, unit: 'g', basis: { amount, unit: 'g', description: `per ${amount} g` }, candidateIds: [id], observationIds: [`line-${id}`], imageIds: [], uncertainty: 'OCR words and layout linked; original pixels not confirmed.' });

describe('evidence-aligned product nutrition comparison', () => {
  it('normalizes package serving values to the same explicit 100 g basis', () => {
    const [row] = compareProductNutrition([reading('sugars', 5, 'g', 25)], [record('sugars', 20, 'g')]);
    expect(row).toMatchObject({ status: 'comparable', unit: 'g', basisUnit: 'g', packagePer100: 20, recordPer100: 20, difference: 0 });
  });
  it('reports signed per-basis differences without calling either option healthier', () => {
    const [packageLower] = compareProductNutrition([reading('sugars', 4, 'g', 25)], [record('sugars', 20, 'g')]);
    expect(packageLower).toMatchObject({ status: 'comparable', packagePer100: 16, recordPer100: 20, difference: 4 });
    const [recordLower] = compareProductNutrition([reading('sugars', 6, 'g', 25)], [record('sugars', 20, 'g')]);
    expect(recordLower).toMatchObject({ status: 'comparable', packagePer100: 24, recordPer100: 20, difference: -4 });
  });
  it('normalizes sodium units without confusing sodium and salt', () => {
    const rows = compareProductNutrition([reading('sodium', 0.025, 'g', 25)], [record('sodium', 100, 'mg')]);
    expect(rows[0]).toMatchObject({ status: 'comparable', unit: 'mg', packagePer100: 100, recordPer100: 100, difference: 0 });
    expect(compareProductNutrition([reading('salt', 0.25, 'g', 25)], [record('salt', 1, 'g')])[0]).toMatchObject({ status: 'comparable', unit: 'g', packagePer100: 1, recordPer100: 1 });
  });
  it('normalizes energy units and preserves explicitly corrected values', () => {
    const [row] = compareProductNutrition([reading('energy', 100, 'kcal', 25, 'g', 'corrected')], [record('energy', 1673.6, 'kJ')]);
    expect(row.status).toBe('comparable');
    expect(row.packagePer100).toBe(400);
    expect(row.recordPer100).toBeCloseTo(400);
    expect(row.packageReading?.status).toBe('corrected');
  });
  it('does not compare missing, conflicted or unknown-basis readings', () => {
    expect(compareProductNutrition([], [record('protein', 10, 'g')])[0].status).toBe('package-reading-missing');
    expect(compareProductNutrition([reading('protein', 10, 'g', 100, 'g', 'conflict')], [record('protein', 10, 'g')])[0].status).toBe('package-reading-conflict');
    expect(compareProductNutrition([reading('protein', 10, 'g', null)], [record('protein', 10, 'g')])[0].status).toBe('package-basis-unknown');
    expect(compareProductNutrition([reading('protein', 10, 'g', 100)], [record('protein', 10, 'g', null)])[0].status).toBe('record-basis-unknown');
  });
  it('shows package nutrients omitted from the community record', () => {
    const rows = compareProductNutrition([reading('protein', 8, 'g', 100), reading('sodium', 120, 'mg', 100)], [record('protein', 7, 'g')]);
    expect(rows.find(row => row.key === 'sodium')).toMatchObject({ status: 'record-reading-missing', packagePer100: null, recordPer100: null, difference: null, recordReading: null });
  });
  it('withholds normalized values when package identity is disputed', () => {
    const [row] = compareProductNutrition([reading('protein', 10, 'g', 100)], [record('protein', 10, 'g')], { identityConflict: true });
    expect(row).toMatchObject({ status: 'package-identity-conflict', packageReading: null, packagePer100: null, recordPer100: null, difference: null });
  });
  it('does not equate mass and volume bases or incompatible units', () => {
    expect(compareProductNutrition([reading('sugars', 5, 'g', 100, 'g')], [record('sugars', 5, 'g', { amount: 100, unit: 'ml' })])[0].status).toBe('basis-type-mismatch');
    expect(compareProductNutrition([reading('protein', 5, 'kcal', 100)], [record('protein', 5, 'g')])[0].status).toBe('unit-mismatch');
  });
  it('preserves explicit zero when both sources provide comparable bases', () => {
    const [row] = compareProductNutrition([reading('sugars', 0, 'g', 100)], [record('sugars', 0, 'g')]);
    expect(row).toMatchObject({ status: 'comparable', packagePer100: 0, recordPer100: 0, difference: 0 });
  });
  it('uses a complete OCR-linked model interpretation when package parsing has no row, and labels its provenance', () => {
    const [row] = compareProductNutrition([], [record('protein', 9, 'g')], { interpretedReadings: [interpreted(2, 25)] });
    expect(row).toMatchObject({ status: 'comparable', packageReadingSource: 'gemini-interpretation', packagePer100: 8, recordPer100: 9, packageReading: { value: 2, basis: { amount: 25, unit: 'g' }, interpretationIds: ['candidate-2'], observationIds: ['line-candidate-2'] } });
  });
  it('uses an OCR-linked basis to complete one observed value only when its value and unit agree', () => {
    const incomplete: Nutrient = { key: 'protein', value: 2, unit: 'g', basis: null, observationIds: ['parsed-protein'], status: 'observed' };
    const [completed] = compareProductNutrition([incomplete], [record('protein', 9, 'g')], { interpretedReadings: [interpreted(2, 25)] });
    expect(completed).toMatchObject({ status: 'comparable', packageReadingSource: 'gemini-interpretation', packagePer100: 8, packageReading: { value: 2, basis: { amount: 25 }, observationIds: ['parsed-protein', 'line-candidate-2'] } });

    const [disagreement] = compareProductNutrition([incomplete], [record('protein', 9, 'g')], { interpretedReadings: [interpreted(3, 25)] });
    expect(disagreement).toMatchObject({ status: 'package-basis-unknown', packageReadingSource: 'package-observation', packageReading: { value: 2, basis: null, status: 'observed' }, packagePer100: null });
  });
  it('normalizes consistent per-serving and per-100 interpretations while retaining all OCR lineage', () => {
    const [row] = compareProductNutrition([], [record('protein', 4, 'g')], { interpretedReadings: [interpreted(1, 25), interpreted(4, 100)] });
    expect(row).toMatchObject({ status: 'comparable', packageReadingSource: 'gemini-interpretation', packagePer100: 4, recordPer100: 4, packageReading: { value: 4, basis: { amount: 100 }, interpretationIds: ['candidate-1', 'candidate-4'], observationIds: ['line-candidate-1', 'line-candidate-4'] } });
  });
  it('does not let a model interpretation override package conflicts or disputed identity', () => {
    const conflict = compareProductNutrition([reading('protein', 5, 'g', 100, 'g', 'conflict')], [record('protein', 9, 'g')], { interpretedReadings: [interpreted(9, 100)] })[0];
    expect(conflict).toMatchObject({ status: 'package-reading-conflict', packageReading: { value: 5, status: 'conflict' }, packageReadingSource: 'package-observation' });
    const identity = compareProductNutrition([], [record('protein', 9, 'g')], { identityConflict: true, interpretedReadings: [interpreted(9, 100)] })[0];
    expect(identity).toMatchObject({ status: 'package-identity-conflict', packageReading: null, packageReadingSource: null });
  });
  it('withholds inconsistent interpretations instead of selecting a convenient value', () => {
    const [row] = compareProductNutrition([], [record('protein', 9, 'g')], { interpretedReadings: [interpreted(4, 100), interpreted(5, 100)] });
    expect(row).toMatchObject({ status: 'package-reading-conflict', packageReading: null, packagePer100: null, difference: null });
  });
});
