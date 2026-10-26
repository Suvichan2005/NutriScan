import type { EvidenceSource } from './contracts';

type SourceIdentity = Pick<EvidenceSource, 'id'|'title'|'publisher'|'url'|'publishedAt'>;

/** Present native prompt references without exposing implementation handles.
 * Only a source in the effective evidence set can become a named reference.
 * This changes presentation after quantity validation, never evidence support.
 */
export function renderAnswerEvidenceReferences(
  answer: string,
  aliases: ReadonlyMap<string, string>,
  sources: readonly SourceIdentity[],
  calculations: readonly { id: string }[],
): string {
  const sourceTitles = new Map(sources.map(source => [source.id, source.title]));
  const calculationIds = new Set(calculations.map(calculation => calculation.id));
  const labels: Record<string, string> = { OBS: 'label observation', IMG: 'package photo', ROW: 'nutrition row', CAND: 'provisional reading' };
  return answer.replace(/\b(OBS|IMG|SRC|CALC|CAND|ROW)_[A-Z0-9]+\b/g, (handle, kind: string) => {
    const id = aliases.get(handle);
    if (!id) return 'unavailable reference';
    if (kind === 'SRC') return sourceTitles.get(id) ?? 'unavailable source';
    if (kind === 'CALC') return calculationIds.has(id) ? 'saved calculation' : 'unavailable calculation';
    return labels[kind];
  });
}
const normalized = (text:string) => text.normalize('NFKC').toLocaleLowerCase('en-IN').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const includesIdentity = (text:string,identity:string) => !!identity && ` ${text} `.includes(` ${identity} `);

/**
 * Link source identities mentioned in ordinary prose to existing records.
 * This selects optional references, never judges semantics or edits the answer.
 * A shared publisher/acronym requires a unique dated record; a URL or complete
 * title identifies a record directly. Unused retrieval candidates stay out of
 * consumer citations while remaining available in the package inspector.
 */
export function selectCitedEvidence<T extends SourceIdentity>(answer:string,sources:readonly T[]):T[]{
  const prose=answer.replace(/https?:\/\/[^\s<>\[\]"]+/gi,' ');
  const text=normalized(prose);
  const urls=new Set((answer.match(/https?:\/\/[^\s<>\[\]"]+/gi)??[]).map(url=>url.replace(/[),.;:]+$/,'')));
  const aliases=(source:T)=>{
    const publisher=source.publisher.split(';',1)[0].replace(/\([^)]*\)/g,'').trim();
    const words=publisher.match(/[\p{L}\p{N}]+/gu)??[];
    const acronym=words.length>=3?words.filter(word=>!['and','of','the','for'].includes(word.toLowerCase())).map(word=>word[0]).join(''):'';
    return [...new Set([normalized(publisher),...(acronym.length>=3&&acronym.length<=8?[normalized(acronym)]:[])])].filter(alias=>alias.length>=3);
  };
  const sourceAliases=new Map(sources.map(source=>[source.id,aliases(source)]));
  return sources.filter(source=>{
    const title=normalized(source.title);
    if(urls.has(source.url)||(title.length>=12&&includesIdentity(text,title)))return true;
    return (sourceAliases.get(source.id)??[]).some(alias=>{
      if(!includesIdentity(text,alias))return false;
      const candidates=sources.filter(item=>(sourceAliases.get(item.id)??[]).includes(alias));
      if(candidates.length===1)return true;
      const year=source.publishedAt?.match(/^\d{4}(?:-|$)/)?.[0].slice(0,4);
      return !!year&&prose.split(/\n\s*\n/).some(paragraph=>includesIdentity(normalized(paragraph),alias)&&includesIdentity(normalized(paragraph),year))
        &&candidates.filter(item=>item.publishedAt?.startsWith(year)).length===1;
    });
  });
}
