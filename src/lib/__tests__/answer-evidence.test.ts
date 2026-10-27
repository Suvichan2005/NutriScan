import {describe,expect,it} from 'vitest';
import {filterAnswerBySourceScope,prioritizeCitedEvidence,renderAnswerEvidenceReferences,selectCitedEvidence} from '../answer-evidence';
import {isGuidanceEvidenceInScope,isLocalEvidenceTopicallyRelevant} from '../followup-evidence';

const source=(id:string,title:string,publisher:string,publishedAt:string|null)=>({id,title,publisher,publishedAt,url:`https://example.org/${id}`});

it('preserves current context paraphrases without granting stale, foreign-scope or navigation records the same authority',()=>{
  const record={...source('sodium','Sodium intake guidance','WHO','2024'),category:'guideline' as const,jurisdiction:'Global',summary:'Population guidance on sodium intake.',limitations:'Not an individual prescription.'};
  const aliases=new Map([['SRC_1',record.id]]);
  const question='What should someone watching their blood pressure consider?';
  const answer='Consider the overall dietary pattern, rather than this drink alone [SRC_1].';
  expect(filterAnswerBySourceScope(answer,[record],aliases,question,'',[],new Set([record.id])).answer).toBe(answer);
  expect(filterAnswerBySourceScope(answer,[record],aliases,question).withheldSentenceCount).toBe(1);
  expect(filterAnswerBySourceScope(answer,[{...record,supportRole:'navigation' as const}],aliases,question,'',[],new Set([record.id])).withheldSentenceCount).toBe(1);
  expect(filterAnswerBySourceScope(answer,[{...record,jurisdiction:'United States'}],aliases,question,'India',[],new Set([record.id])).withheldSentenceCount).toBe(1);
  expect(filterAnswerBySourceScope('This conclusion uses SRC_9.',[record],aliases,question,'',[],new Set([record.id])).withheldSentenceCount).toBe(1);
});

it('renders known native references in multiline prose and lets explicit source handles resolve an ambiguous publisher',()=>{
  const a=source('a','Synthetic daily reference','Example Organization','2025');
  const b=source('b','Synthetic weekly reference','Example Organization','2025');
  const aliases=new Map([['SRC_1','a'],['CALC_7','calculation-1'],['ROW_2','row-1'],['OBS_A','observation-1'],['IMG_2','image-1'],['CAND_1','candidate-1']]);
  const text='The result uses CALC_7.\n\n* Source: [SRC_1]\n* Readings: ROW_2, OBS_A, IMG_2, CAND_1.\nINS 955 and NCT01234567 are label identifiers.';
  const rendered=renderAnswerEvidenceReferences(text,aliases,[a,b],[{id:'calculation-1'}]);
  expect(rendered).toBe('The result uses saved calculation.\n\n* Source: [Synthetic daily reference]\n* Readings: nutrition row, label observation, package photo, provisional reading.\nINS 955 and NCT01234567 are label identifiers.');
  expect(selectCitedEvidence(rendered,[a,b])).toEqual([a]);
});

it('does not invent source or calculation provenance for unknown or excluded references',()=>{
  const aliases=new Map([['SRC_1','excluded-source'],['CALC_1','excluded-calculation']]);
  expect(renderAnswerEvidenceReferences('SRC_1; CALC_1; SRC_9; OBS_9.',aliases,[],[])).toBe('unavailable source; unavailable calculation; unavailable reference; unavailable reference.');
  expect(selectCitedEvidence(renderAnswerEvidenceReferences('SRC_1',aliases,[],[]),[source('excluded-source','Synthetic reference','Example','2025')])).toEqual([]);
});
describe('conversation source identity linking',()=>{
  const lipid=source('lipid-review','Effects of oat beta-glucan intake on lipid profiles','Clinical Nutrition ESPEN; bibliographic record via PubMed','2022-05-13');
  const cardiac=source('cardiac-review','Effect of oat consumption on lipid profile','Current problems in cardiology','2022-02-19');
  const dog=source('dog-study','Oat beta-glucan as a dietary supplement for dogs','PloS one','2018-07-31');
  const bank=[lipid,cardiac,dog];
  it('does not turn supplied retrieval candidates into citations for a package-only answer',()=>{
    expect(selectCitedEvidence('The label lists fibre per 100 g.',bank)).toEqual([]);
  });
  it('links identifiable publications in natural prose without adding unused research results',()=>{
    const answer='A Clinical Nutrition ESPEN (2022) review discusses lipid outcomes. A Current Problems in Cardiology (2022) review also reports findings.';
    expect(selectCitedEvidence(answer,bank).map(item=>item.id)).toEqual(['lipid-review','cardiac-review']);
  });
  it('supports a unique publisher acronym and rejects substring coincidences',()=>{
    const idf=source('idf','Healthy nutrition patient education','International Diabetes Federation','2024');
    expect(selectCitedEvidence('IDF patient education describes individualized choices.',[idf])).toEqual([idf]);
    expect(selectCitedEvidence('An unidentified packet.',[idf])).toEqual([]);
  });
  it('requires disambiguation for a shared publisher and keeps explicit URLs or complete titles usable',()=>{
    const a=source('who-2015','Guideline on sugars intake','World Health Organization','2015');
    const b=source('who-2023','Guideline on carbohydrate intake','World Health Organization','2023');
    expect(selectCitedEvidence('WHO guidance is relevant.',[a,b])).toEqual([]);
    expect(selectCitedEvidence('WHO (2023) provides guidance.',[a,b])).toEqual([b]);
    expect(selectCitedEvidence(`Read ${a.url} for the source.`,[a,b])).toEqual([a]);
    expect(selectCitedEvidence(`Read ${a.url}-unrelated for the source.`,[a,b])).toEqual([]);
    expect(selectCitedEvidence('WHO guidance is relevant.\n\nAnother publisher released a study in 2023.',[a,b])).toEqual([]);
    expect(selectCitedEvidence('Guideline on carbohydrate intake explains the population recommendation.',[a,b])).toEqual([b]);
  });
  it('keeps navigation links openable but prevents them from becoming answer citations or supporting claims',()=>{
    const navigation={...source('fssai-link','FSSAI allergen labelling rules','Food Safety and Standards Authority of India','2025'),
      category:'regulation' as const,jurisdiction:'India',summary:'No source text was retrieved.',limitations:'Navigation only, not legal evidence.',supportRole:'navigation' as const};
    const claim='FSSAI explains how allergen labelling distinguishes ingredient declarations from cross-contamination wording.';
    expect(selectCitedEvidence(claim,[navigation])).toEqual([]);
    expect(filterAnswerBySourceScope(claim,[navigation],new Map(),'What does this allergen label mean?')).toEqual({answer:'',withheldSentenceCount:1});
    expect(filterAnswerBySourceScope('The label identifies a possible allergen. [SRC_A]',[navigation],new Map([['SRC_A',navigation.id]]),'What does this allergen label mean?')).toEqual({answer:'',withheldSentenceCount:1});
  });
  it('retains citation eligibility for a content-bearing source with the same subject',()=>{
    const content={...source('fssai-content','FAQ on food allergen labelling','Food Safety and Standards Authority of India','2023'),
      category:'regulation' as const,jurisdiction:'India',summary:'FSSAI distinguishes allergenic ingredients declared as Contains from potential cross-contamination declared as May Contains.',limitations:'Dated FAQ; check current rules.',supportRole:'content' as const};
    const claim='The FSSAI FAQ explains allergen labelling wording.';
    expect(selectCitedEvidence(claim,[content])).toEqual([content]);
    expect(filterAnswerBySourceScope(claim,[content],new Map(),'What does this allergen label mean?').withheldSentenceCount).toBe(0);
  });
});

describe('production answer source scope',()=>{
  const peanut={...source('peanut-guidance','Peanut allergy and ingredient labels','Global Allergy Institute','2024'),category:'guideline' as const,jurisdiction:'Global',effectiveAt:null,retrievedAt:'2026-10-26T00:00:00.000Z',summary:'Food ingredient labels can identify peanuts and related allergen warnings.',limitations:'General label interpretation; it cannot establish individual suitability.'};
  const salt={...source('salt-guidance','Population sodium guidance','World Health Organization','2023'),category:'guideline' as const,jurisdiction:'Global',effectiveAt:null,retrievedAt:'2026-10-26T00:00:00.000Z',summary:'Population recommendations discuss dietary sodium intake and blood pressure.',limitations:'Population guidance is not an individualized target.'};

  it('keeps a relevant cited explanation and package prose while withholding a mismatched scientific citation',()=>{
    const aliases=new Map([['SRC_1',peanut.id],['SRC_2',salt.id],['SRC_9','missing-source']]);
    const answer='The label lists peanuts among its ingredients. Peanut guidance describes “Food ingredient labels can identify peanuts and related allergen warnings.” SRC_1. WHO guidance recommends limiting population sodium intake SRC_2. Unknown reference SRC_9 is unavailable.';
    const result=filterAnswerBySourceScope(answer,[peanut,salt],aliases,'Does the package list peanuts?');
    expect(result.answer).toBe('The label lists peanuts among its ingredients. Peanut guidance describes “Food ingredient labels can identify peanuts and related allergen warnings.” SRC_1.');
    expect(result.withheldSentenceCount).toBe(2);
  });

  it('keeps a topic-matched citation in scope without treating scope as proof of entailment',()=>{
    const aliases=new Map([['SRC_1',salt.id]]);
    const question='What does WHO say about sodium and blood pressure?';
    const answer='The package lists 420 mg sodium per 100 g. WHO discusses sodium intake and blood pressure at a population level SRC_1.';
    expect(isLocalEvidenceTopicallyRelevant(salt,question)).toBe(true);
    expect(isGuidanceEvidenceInScope(salt,question)).toBe(true);
    const result=filterAnswerBySourceScope(answer,[salt],aliases,question);
    expect(result.answer).toBe(answer);
    expect(result.withheldSentenceCount).toBe(0);
  });

  it('retains a natural source-attributed paraphrase without requiring a copied summary',()=>{
    const aliases=new Map([['SRC_1',salt.id]]);
    const answer='WHO guidance discusses limiting sodium intake to reduce blood pressure risk at the population level SRC_1.';
    expect(answer).not.toContain(salt.summary);
    expect(filterAnswerBySourceScope(answer,[salt],aliases,'What does WHO say about sodium and blood pressure?').answer).toBe(answer);
  });

  it('does not let a source relevant to the question support an off-topic scientific sentence',()=>{
    const aliases=new Map([['SRC_1',salt.id]]);
    const question='What does WHO say about sodium and blood pressure?';
    const supported='WHO guidance discusses limiting sodium intake to reduce blood pressure risk at the population level SRC_1.';
    const unrelated='The same WHO source says omega-3 prevents heart attacks SRC_1.';
    const answer=`${supported} ${unrelated}`;
    expect(isLocalEvidenceTopicallyRelevant(salt,question)).toBe(true);
    expect(isLocalEvidenceTopicallyRelevant(salt,unrelated)).toBe(false);
    expect(filterAnswerBySourceScope(answer,[salt],aliases,question)).toEqual({answer:supported,withheldSentenceCount:1});
  });

  it('withholds guidance outside a user-named jurisdiction but allows explicit source inspection',()=>{
    const us={...peanut,id:'us-peanut-guidance',jurisdiction:'United States'};
    const aliases=new Map([['SRC_1',us.id]]);
    expect(filterAnswerBySourceScope('This US source says peanut warnings vary by product SRC_1.',[us],aliases,'How are peanut warnings handled in India?').withheldSentenceCount).toBe(1);
    const suppliedSourceAnswer='The supplied US reference describes ingredient-label context SRC_1.';
    expect(filterAnswerBySourceScope(suppliedSourceAnswer,[us],aliases,'Explain the supplied reference.').answer).toBe(suppliedSourceAnswer);
  });

  it('uses only prior user questions to resolve a contextual multi-turn source reference',()=>{
    const diabetes={...salt,id:'diabetes-guidance',title:'Diabetes and carbohydrate choices',publisher:'International Diabetes Federation',summary:'People living with diabetes may consider carbohydrate amounts and food choices with individual context.'};
    const aliases=new Map([['SRC_1',diabetes.id]]);
    const answer='The International Diabetes Federation discusses individualized food choices in the diabetes context SRC_1.';
    const history=['Does this snack fit with type 2 diabetes?','What about just two biscuits?'];
    expect(filterAnswerBySourceScope(answer,[diabetes],aliases,'Does that change for 25 g?', '',history).answer).toBe(answer);
    expect(filterAnswerBySourceScope(answer,[diabetes],aliases,'And for 25 g?', '',history).answer).toBe(answer);
    expect(filterAnswerBySourceScope(answer,[diabetes],aliases,'Does this package list peanuts?', '',history).withheldSentenceCount).toBe(1);
  });
});

describe('citation record identity collisions',()=>{
  it('does not select a shorter title contained in the cited publication title',()=>{
    const a=source('overview','Dietary evidence review','Example Institute','2024');
    const b=source('specific','Dietary evidence review for adults','Example Institute','2024');
    expect(selectCitedEvidence('See [Dietary evidence review for adults].',[a,b])).toEqual([b]);
    expect(selectCitedEvidence('Compare [Dietary evidence review] with [Dietary evidence review for adults].',[a,b])).toEqual([a,b]);
    expect(selectCitedEvidence(`See ${a.url}.`,[a,b])).toEqual([a]);
  });
  it('does not silently choose two versions sharing the same complete title',()=>{
    const a=source('old','Dietary evidence review','Example Institute','2020');
    const b=source('new','Dietary evidence review','Example Institute','2024');
    expect(selectCitedEvidence('See Dietary evidence review.',[a,b])).toEqual([]);
    expect(selectCitedEvidence('See Dietary evidence review (2024).',[a,b])).toEqual([b]);
  });
});

it('preserves an exact native source identity when different records have identical titles',()=>{
  const a=source('old','Shared scientific reference','Example Institute','2020');
  const b=source('new','Shared scientific reference','Example Institute','2024');
  const rendered=renderAnswerEvidenceReferences('Read SRC_1.',new Map([['SRC_1','new']]),[a,b],[]);
  expect(rendered).toContain(b.url);
  expect(selectCitedEvidence(rendered,[a,b])).toEqual([b]);
});

it('prioritizes exact cited records before applying a bounded evidence limit',()=>{
  const sources=Array.from({length:21},(_,index)=>source(`source-${index+1}`,`Distinct evidence record ${index+1}`,'Example Institute',String(2000+index)));
  const answer='See SRC_L.';
  const aliases=new Map([['SRC_L','source-21']]);
  const retained=prioritizeCitedEvidence(answer,sources,aliases,20);
  expect(retained).toHaveLength(20);
  expect(retained[0]).toEqual(sources[20]);
  expect(retained.map(item=>item.id).includes(sources[19].id)).toBe(false);
});
