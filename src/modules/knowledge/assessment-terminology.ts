import {z} from 'zod';
import definitions from '../../../data/assessment-terminology.json';
import type {EvidenceSource} from '../../lib/contracts';

const vocabulary=z.object({schemaVersion:z.literal(1),declaredScope:z.string(),source:z.object({title:z.string(),url:z.string().url(),catalogUrl:z.string().url(),edition:z.string(),reviewedAt:z.string(),rights:z.string()}),terms:z.array(z.object({id:z.string(),label:z.string(),scope:z.string(),pdfPages:z.array(z.number().int().positive()).min(1).max(3),summary:z.string().max(1000)}))}).parse(definitions);

/** A source legend, not an interpretation/classification of the returned ADI. */
export function jecfaAssessmentTerminology(fields:readonly{label:string}[]) {
  if(!fields.some(field=>field.label.trim().toUpperCase()==='ADI'))return null;
  return {
    declaredScope:vocabulary.declaredScope,
    relation:'Terminology references only; Gemini must interpret the dated record, its functional class, comments and assessment conditions. No status, exposure, personal target or legal permission is inferred here.',
    terms:vocabulary.terms.map(term=>({...term,sourceId:`who-ehc240-term-${term.id}`})),
    evidence:vocabulary.terms.map((term):EvidenceSource=>({
      id:`who-ehc240-term-${term.id}`,title:`WHO/JECFA terminology: ${term.label}`,publisher:'World Health Organization / FAO',url:`${vocabulary.source.url}#page=${term.pdfPages[0]}`,category:'registry',
      jurisdiction:'International assessment terminology; not national food law or an individual substance evaluation',publishedAt:vocabulary.source.edition,effectiveAt:null,retrievedAt:vocabulary.source.reviewedAt,
      summary:term.summary,limitations:`${term.scope}. Original summary, not a replacement for the complete glossary or substance-specific evaluation.`,license:vocabulary.source.rights,
    })),
  };
}
