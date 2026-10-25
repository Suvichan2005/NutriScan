import {expect,it} from 'vitest';
import {jecfaAssessmentTerminology} from '../assessment-terminology';
import {sourceSchema} from '../../../lib/contracts';

it('supplies a source-dated legend without classifying or rewriting an ADI value',()=>{
  const record=[{label:'ADI',text:'NOT SPECIFIED'},{label:'Comments',text:'Specifications only.'}];
  const before=structuredClone(record),reference=jecfaAssessmentTerminology(record)!;
  expect(record).toEqual(before);
  expect(reference.terms.map(term=>term.id)).toEqual(['adi','adi-not-specified','no-adi-allocated','temporary-adi']);
  expect(reference.evidence.every(source=>sourceSchema.safeParse(source).success)).toBe(true);
  expect(reference.evidence.every(source=>source.publishedAt==='2009'&&source.license?.includes('all rights reserved'))).toBe(true);
  expect(reference.evidence.find(source=>source.id.endsWith('adi-not-specified'))?.summary).toContain('very low toxicity');
  expect(reference.terms.find(term=>term.id==='adi-not-specified')?.scope).toContain('veterinary-drug wording is separate');
});
it('does not infer ADI terminology from an ingredient name, unrecognized field or missing assessment',()=>{
  for(const fields of [[],[{label:'Chemical Names',text:'ADI'}],[{label:'Comments',text:'Not specified'}],[{label:'TDI',text:'unknown'}]])expect(jecfaAssessmentTerminology(fields)).toBeNull();
  const unknown=[{label:'ADI',text:'Unknown upstream status 123'}];
  expect(jecfaAssessmentTerminology(unknown)?.terms).toHaveLength(4);
  expect(unknown[0].text).toBe('Unknown upstream status 123');
});
