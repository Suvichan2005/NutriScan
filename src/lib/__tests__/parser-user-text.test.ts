import { describe, expect, it } from 'vitest';
import { parseLabel } from '../parser';

describe('user-entered label text observations',()=>{
  it('retains unrepresented lines in input order without parsing trans fat as a nutrient',()=>{
    const text='Oat snack\nNutrition Facts\nPer 100 g\nProtein 8 g\nTrans fat 0 g\nSalt 1 g\nIngredients: oats, salt';
    const pkg=parseLabel(text,{origin:'user'});
    const rawLines=pkg.observations.filter(observation=>observation.field==='raw-text-line');
    const transFatLine=rawLines.find(observation=>observation.text==='Trans fat 0 g');
    const saltLine=pkg.observations.find(observation=>observation.field==='salt');
    const transFatIndex=pkg.observations.findIndex(observation=>observation.id===transFatLine?.id);
    const saltIndex=pkg.observations.findIndex(observation=>observation.id===saltLine?.id);

    expect(pkg.rawText).toBe(text);
    expect(rawLines.map(observation=>observation.text)).toEqual(['Nutrition Facts','Trans fat 0 g']);
    expect(transFatLine).toMatchObject({field:'raw-text-line',text:'Trans fat 0 g',side:'text',origin:'user',confidence:null});
    expect(transFatIndex).toBeGreaterThanOrEqual(0);
    expect(transFatIndex).toBeLessThan(saltIndex);
    expect(pkg.nutrients.some(nutrient=>(nutrient.key as string)==='transFat')).toBe(false);
    expect(pkg.nutrients.find(nutrient=>nutrient.key==='protein')?.value).toBe(8);
  });

  it('does not add a duplicate raw-line observation when the line is already represented',()=>{
    const existing={id:'existing-trans-fat-line',field:'raw-text-line',text:'Trans fat 0 g',side:'text' as const,origin:'user' as const,confidence:null};
    const pkg=parseLabel('Per 100 g\nTrans fat 0 g',{origin:'user',observations:[existing]});

    expect(pkg.observations.filter(observation=>observation.text==='Trans fat 0 g')).toHaveLength(1);
    expect(pkg.observations.find(observation=>observation.id===existing.id)).toEqual(existing);
    expect(pkg.nutrients.some(nutrient=>(nutrient.key as string)==='transFat')).toBe(false);
  });

  it('retains repeated identical unparsed lines as separate ordered observations',()=>{
    const text='Per 100 g\nTrans fat 0 g\nTrans fat 0 g';
    const pkg=parseLabel(text,{origin:'user'});
    const repeated=pkg.observations.filter(observation=>observation.field==='raw-text-line'&&observation.text==='Trans fat 0 g');
    const repeatedIndexes=repeated.map(observation=>pkg.observations.findIndex(item=>item.id===observation.id));

    expect(pkg.rawText).toBe(text);
    expect(repeated).toHaveLength(2);
    expect(new Set(repeated.map(observation=>observation.id)).size).toBe(2);
    expect(repeatedIndexes[0]).toBeLessThan(repeatedIndexes[1]);
    expect(pkg.nutrients.some(nutrient=>(nutrient.key as string)==='transFat')).toBe(false);
  });

  it('preserves a repeated product-name line after the single name observation',()=>{
    const pkg=parseLabel('Brand name\nBrand name',{origin:'user'});

    expect(pkg.observations.filter(observation=>observation.field==='name'&&observation.text==='Brand name')).toHaveLength(1);
    expect(pkg.observations.filter(observation=>observation.field==='raw-text-line'&&observation.text==='Brand name')).toHaveLength(1);
  });

  it('keeps added raw-line observations within the package observation limit',()=>{
    const text=Array.from({length:5000},(_,index)=>`x${index}`).join('\n');
    expect(text.length).toBeLessThanOrEqual(40000);
    const pkg=parseLabel(text,{origin:'user'});

    expect(pkg.observations.length).toBeLessThanOrEqual(4000);
    expect(pkg.observations.filter(observation=>observation.field==='raw-text-line').length).toBeLessThan(4000);
    expect(pkg.rawText).toBe(text);
  });
});
