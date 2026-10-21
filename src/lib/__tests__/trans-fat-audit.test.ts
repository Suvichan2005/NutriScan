import { describe, expect, it } from 'vitest';
import { buildAudit } from '../engine';
import { defaultProfile, type Observation } from '../contracts';
import { parseLabel } from '../parser';

function ocrLine(id:string,text:string):Observation {
  return {id,field:'ocr-line',text,side:'back',origin:'ocr',confidence:71,imageId:'development-label-back'};
}

describe('trans-fat label questions',()=>{
  it('answers a consumer label question with scoped sources and the literal unverified OCR line',()=>{
    const line=ocrLine('trans-fat-row','Trans Fat 0 g');
    const pkg=parseLabel('Per 100 g\nTrans Fat 0 g\nProtein 8 g',{origin:'ocr',observations:[line]});
    const audit=buildAudit(pkg,30,'g',defaultProfile,'What does trans fat mean on this label?');

    expect(pkg.nutrients.some(nutrient=>(nutrient.key as string)==='transFat')).toBe(false);
    expect(audit.answer).toContain('below 1% of total energy');
    expect(audit.answer).toContain('2 g industrial trans fat per 100 g total fat');
    expect(audit.answer).toContain('no more than 2% industrial trans fat by mass of total oils/fats');
    expect(audit.answer).toContain('Trans Fat 0 g');
    expect(audit.answer).toMatch(/OCR observation \(71% recognition confidence\)/);
    expect(audit.answer).toMatch(/not verified facts.*does not establish a numeric amount, zero, or a portion calculation/i);
    expect(audit.calculations.every(calculation=>(calculation.nutrient as string)!=='transFat')).toBe(true);
    expect(audit.sources.map(source=>source.id)).toEqual(expect.arrayContaining(['who-trans-fat-2024','fssai-industrial-trans-fat-2021']));
    const finding=audit.findings.find(entry=>entry.title==='Trans-fat context and recorded label text');
    expect(finding?.status).toBe('uncertain');
    expect(finding?.observationIds).toContain(line.id);
    expect(finding?.sourceIds).toEqual(['who-trans-fat-2024','fssai-industrial-trans-fat-2021']);
  });

  it('does not turn a missing trans-fat line into zero or a calculated amount',()=>{
    const pkg=parseLabel('Per 100 g\nFat 10 g',{origin:'ocr',observations:[ocrLine('fat-row','Fat 10 g')]});
    const audit=buildAudit(pkg,30,'g',defaultProfile,'How much trans fat is in this portion?');

    expect(audit.answer).toMatch(/No literal trans-fat-related line is retained/i);
    expect(audit.answer).toMatch(/does not establish absence or zero/i);
    expect(audit.answer).toMatch(/no numeric amount or portion calculation is available/i);
    expect(audit.answer).not.toMatch(/0 g trans fat/i);
    expect(audit.calculations.every(calculation=>(calculation.nutrient as string)!=='transFat')).toBe(true);
    const finding=audit.findings.find(entry=>entry.title==='Trans-fat context and recorded label text');
    expect(finding?.observationIds).toEqual([]);
    expect(finding?.sourceIds).toEqual(['who-trans-fat-2024','fssai-industrial-trans-fat-2021']);
  });

  it('keeps topic-specific uncertainty and the original observation linked',()=>{
    const line=ocrLine('uncertain-trans-fat-row','Trans Fatty Acids 0 g');
    const pkg=parseLabel('Per 100 g\nTrans Fatty Acids 0 g',{origin:'ocr',observations:[line]});
    const audit=buildAudit(pkg,25,'g',defaultProfile,'What remains uncertain about trans fat in this scan?');

    expect(audit.answer).toMatch(/OCR observation.*not verified facts/i);
    expect(audit.answer).toMatch(/does not establish a numeric amount, zero, or a portion calculation/i);
    expect(audit.findings.find(entry=>entry.title==='Trans-fat context and recorded label text')?.observationIds).toContain(line.id);
    expect(audit.calculations.every(calculation=>(calculation.nutrient as string)!=='transFat')).toBe(true);
  });

  it('retains a user-entered literal line as user context rather than a parsed package fact',()=>{
    const userLine:Observation={id:'user-trans-fat-note',field:'trans-fat-note',text:'I can read: Trans Fat 0 g',side:'text',origin:'user',confidence:null};
    const pkg=parseLabel('Per 100 g\nFat 5 g',{origin:'ocr',observations:[userLine]});
    const audit=buildAudit(pkg,30,'g',defaultProfile,'What does trans fat mean here?');

    expect(audit.answer).toContain('I can read: Trans Fat 0 g');
    expect(audit.answer).toMatch(/user-entered observation.*not verified facts/i);
    expect(audit.findings.find(entry=>entry.title==='Trans-fat context and recorded label text')?.observationIds).toContain(userLine.id);
    expect(audit.calculations.every(calculation=>(calculation.nutrient as string)!=='transFat')).toBe(true);
  });

  it('answers a historical FSSAI notification question from the dated source without calling it current law',()=>{
    const pkg=parseLabel('Per 100 g\nFat 5 g',{origin:'ocr'});
    const audit=buildAudit(pkg,30,'g',defaultProfile,'What did the 2021 FSSAI Gazette say about trans-fat limits?');

    expect(audit.answer).toContain('products manufactured on or after 1 January 2022');
    expect(audit.answer).toContain('This dated rule summary does not determine current law');
    expect(audit.sources.map(source=>source.id)).toContain('fssai-industrial-trans-fat-2021');
    expect(audit.trace.find(entry=>entry.tool==='check_regulatory_updates')).toBeUndefined();
  });

  it('abstains on current FSSAI applicability and requests live regulatory research',()=>{
    const line=ocrLine('current-law-label','Trans Fat 0 g');
    const pkg=parseLabel('Per 100 g\nTrans Fat 0 g',{origin:'ocr',observations:[line]});
    for(const question of [
      'Is this snack currently compliant with FSSAI trans-fat rules in India?',
      'Does this package comply with FSSAI trans-fat regulations?',
    ]){
      const audit=buildAudit(pkg,30,'g',defaultProfile,question);
      expect(audit.answer).toMatch(/Current legal or regulatory status is unresolved/i);
      expect(audit.trace.find(entry=>entry.tool==='check_regulatory_updates')?.status).toMatch(/live research required; not performed locally/);
      expect(audit.limitations.join(' ')).toMatch(/Static corpus entries do not establish current law/i);
      expect(audit.answer).not.toMatch(/is compliant|complies with current law|meets the current rule/i);
    }
  });
});
