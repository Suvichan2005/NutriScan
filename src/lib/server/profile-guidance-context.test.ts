import { describe, expect, it } from 'vitest';
import { addProfileGuidanceContextSources, profileGuidanceContextSources } from './profile-guidance-context';

describe('profile-aware local guidance context', () => {
  it('adds applicable diabetes and population sodium sources from explicit profile and package topics', () => {
    const sources = profileGuidanceContextSources({
      question: 'What should I consider for this portion with diabetes and hypertension?',
      package: {
        nutrients: [],
        reconstruction: { nutritionRows: [
          { nutrient: 'Carbohydrate', printedLabel: 'Carbohydrate (g)' },
          { nutrient: 'Sodium', printedLabel: 'Sodium (mg)' },
        ] },
      },
      profile: { healthConsiderations: 'Type 2 diabetes and hypertension', goals: 'Balanced eating', country: 'India' },
    });

    expect(sources.map(source => source.id)).toContain('idf-healthy-nutrition-diabetes-2024');
    expect(sources.map(source => source.id)).toContain('who-sodium');
    expect(sources).toHaveLength(2);
    expect(sources.every(source => source.license && source.limitations)).toBe(true);
  });

  it('adds no profile-derived guidance when no health context was explicitly supplied', () => {
    expect(profileGuidanceContextSources({
      question: 'What is the carbohydrate amount?',
      package: { nutrients: [{ key: 'carbohydrate' }], reconstruction: null },
    })).toEqual([]);
    expect(profileGuidanceContextSources({
      question: 'What should I consider?',
      package: { nutrients: [], reconstruction: null },
      profile: { healthConsiderations: '   ', goals: '', country: 'India' },
    })).toEqual([]);
  });

  it('retains beverage-specific carbohydrate context across an India-market transfer case', () => {
    const sources = profileGuidanceContextSources({
      question: 'Would this sweetened dairy drink fit with diabetes?',
      package: { nutrients: [{ key: 'carbohydrate' }, { key: 'sugars' }, { key: 'sodium' }], reconstruction: null },
      profile: { healthConsiderations: 'Type 2 diabetes', goals: '', country: 'India' },
    });

    expect(sources.map(source => source.id)).toContain('idf-healthy-nutrition-diabetes-2024');
    expect(sources.some(source => source.jurisdiction === 'United States')).toBe(false);
  });

  it('keeps supplied evidence intact and does not duplicate a source already selected by the audit', () => {
    const input = {
      question: 'What should I consider for this portion with diabetes and hypertension?',
      package: { nutrients: [], reconstruction: { nutritionRows: [
        { nutrient: 'Carbohydrate', printedLabel: 'Carbohydrate (g)' },
        { nutrient: 'Sodium', printedLabel: 'Sodium (mg)' },
      ] } },
      profile: { healthConsiderations: 'Type 2 diabetes and hypertension', goals: 'Balanced eating', country: 'India' },
    };
    const selected = profileGuidanceContextSources(input);
    const merged = addProfileGuidanceContextSources({ ...input, evidence: [selected[0]] });

    expect(merged[0]).toEqual(selected[0]);
    expect(new Set(merged.map(source => source.id)).size).toBe(merged.length);
  });

  it('never exceeds the shared 30-source request bound', () => {
    const input = {
      question: 'What should I consider for this portion with diabetes and hypertension?',
      package: { nutrients: [], reconstruction: { nutritionRows: [
        { nutrient: 'Carbohydrate', printedLabel: 'Carbohydrate (g)' },
        { nutrient: 'Sodium', printedLabel: 'Sodium (mg)' },
      ] } },
      profile: { healthConsiderations: 'Type 2 diabetes and hypertension', goals: '', country: 'India' },
    };
    const source = profileGuidanceContextSources(input)[0];
    const supplied = Array.from({ length: 29 }, (_, index) => ({
      ...source,
      id: `existing-${index}`,
      title: `Existing source ${index}`,
      url: `https://example.org/source-${index}`,
    }));

    const merged = addProfileGuidanceContextSources({ ...input, evidence: supplied });
    expect(merged).toHaveLength(30);
    expect(merged.slice(0, supplied.length)).toEqual(supplied);
  });
});
