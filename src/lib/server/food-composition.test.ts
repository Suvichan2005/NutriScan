import { describe, expect, it } from 'vitest';
import { rankFoodCompositionFoods, type FoodCompositionFood } from './food-composition';
import { fdcAmountText, selectFdcNutrients } from './gemini-tools';

const food = (fdcId: number, description: string): FoodCompositionFood => ({
  fdcId, description, category: 'Legumes and Legume Products', publicationDate: '4/1/2025', dataType: 'Foundation',
  nutrients: [
    { nutrientId: 1003, nutrientNumber: '203', name: 'Protein', unit: 'g', amount: 20, dataPoints: 8, min: 18, max: 22, median: 20, loq: null, derivation: 'Calculated' },
    { nutrientId: 1093, nutrientNumber: '307', name: 'Sodium, Na', unit: 'mg', amount: 0, dataPoints: 8, min: 0, max: 0, median: 0, loq: 0.03, derivation: 'Analytical' },
  ], portions: [],
});

describe('local FoodData Central Foundation retrieval', () => {
  it('ranks specific food phrases and withholds weak single-token matches', () => {
    const foods = [food(1, 'Rice, brown, long grain, raw'), food(2, 'Beans, dry, brown'), food(3, 'Chickpeas, dry'), food(4, 'Bread, chappatti or roti')];
    expect(rankFoodCompositionFoods('brown rice', foods).map(hit => hit.food.fdcId)).toEqual([1]);
    expect(rankFoodCompositionFoods('chickpeas', foods).map(hit => hit.food.fdcId)).toEqual([3]);
    expect(rankFoodCompositionFoods('chapatti roti', foods).map(hit => hit.food.fdcId)).toEqual([4]);
    expect(rankFoodCompositionFoods('chickpea flour', foods)).toEqual([]);
  });

  it('selects requested nutrients by recognized FDC IDs and leaves unavailable nutrients missing', () => {
    const sample = food(9, 'Lentils, dry');
    expect(selectFdcNutrients(sample, ['protein', 'fiber']).map(item => item.nutrientId)).toEqual([1003]);
    expect(selectFdcNutrients(sample, ['fiber'])).toEqual([]);
  });

  it('preserves a source quantification limit instead of presenting its zero storage value as zero intake', () => {
    expect(fdcAmountText({ amount: 0, unit: 'mg', loq: 0.03 })).toBe('<0.03 mg (below source quantification limit)');
    expect(fdcAmountText({ amount: 0, unit: 'mg', loq: null })).toBe('0 mg');
  });
});
