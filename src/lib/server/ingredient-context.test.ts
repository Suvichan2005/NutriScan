import { describe, expect, it } from 'vitest';
import { ingredientContext, ingredientContextInput } from './ingredient-context';

describe('automatic local ingredient context', () => {
  it('explains common ingredient functions without treating a function as a substance identity',async()=>{
    const result=await ingredientContext({items:[{name:'emulsifier',code:null},{name:'raising agents',code:null},{name:'edible vegetable oil',code:null}],question:''});
    expect(result.items.every(item=>item.consumerReference?.url.startsWith('https://'))).toBe(true);
    expect(result.items[0].consumerReference?.explanation).toContain('does not identify');
  });
  it('links explicit additive identity and milk source terminology without a safety verdict', async () => {
    const result = await ingredientContext(ingredientContextInput.parse({items:[{name:'whey',code:null},{name:'tertiary butylhydroquinone',code:'319'}],question:'What is in this package?'}));
    expect(result.items[0].families.some(match=>match.family==='milk')).toBe(true);
    expect(result.items[1].identity).toMatchObject({code:'319'});
    expect(result.items[1].sources.length).toBeGreaterThan(0);
    expect(result.note).toMatch(/do not establish dose/i);
  });
  it('marks a processing-form match as a candidate, not an exact source match',async()=>{
    const result=await ingredientContext({items:[{name:'whey powder',code:null},{name:'coconut milk powder',code:null}],question:''});
    expect(result.items[0].derivedFamilyMatch).toBe(true);
    expect(result.items[0].families.some(match=>match.family==='milk')).toBe(true);
    expect(result.items[1].families.some(match=>match.family==='milk')).toBe(false);
  });
  it('retrieves a related study only when its ingredient and outcome are present', async () => {
    const item={name:'oats',code:null};
    const relevant=await ingredientContext({items:[item],question:'How do oats relate to cholesterol?'});
    const unrelated=await ingredientContext({items:[item],question:'How much protein?'});
    expect(relevant.items[0].relations.some(relation=>relation.sourceIds.includes('pubmed-oat-beta-glucan-lipids-2022'))).toBe(true);
    expect(unrelated.items[0].relations).toEqual([]);
  });
  it('rejects oversized input',()=>expect(ingredientContextInput.safeParse({items:Array.from({length:41},()=>({name:'oats',code:null}))}).success).toBe(false));
});
