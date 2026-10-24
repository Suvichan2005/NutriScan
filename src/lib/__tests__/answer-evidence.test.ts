import {describe,expect,it} from 'vitest';
import {selectCitedEvidence} from '../answer-evidence';

const source=(id:string,title:string,publisher:string,publishedAt:string|null)=>({id,title,publisher,publishedAt,url:`https://example.org/${id}`});
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
});
