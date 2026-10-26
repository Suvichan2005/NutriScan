import type { EvidenceSource } from './contracts';
import { isGuidanceEvidenceInScope, isLocalEvidenceTopicallyRelevant } from './followup-evidence';

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
  const sourceTitles = new Map(sources.map(source => [source.id,
    sources.filter(other=>normalized(other.title)===normalized(source.title)).length>1
      ?`${source.title} (${source.url})`:source.title]));
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
const contextualFollowupPattern=/^(?:(?:(?:and|also)\s+)?(?:what|how)\s+about\s+(?:that|it|this|them|those|the same|(?:just\s+|only\s+)?(?:\d|one\b|two\b|three\b|four\b|five\b|half\b|whole\b|a portion\b|a serving\b))|(?:(?:and|also)\s+)?(?:does|is|can|should|would)\s+(?:that|it)\b|(?:and\s+)?for\s+(?:that|it|the same|(?:just\s+|only\s+)?(?:\d|one\b|two\b|three\b|four\b|five\b|half\b|whole\b|a portion\b|a serving\b)))|\b(?:same as before|does that apply|what does that mean)\b/i;
const isContextDependentFollowup=(question:string)=>contextualFollowupPattern.test(question.trim());

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
    if(urls.has(source.url))return true;
    if(title.length>=12&&includesIdentity(text,title)){
      const sameTitle=sources.filter(item=>normalized(item.title)===title);
      const longerTitles=[...new Set(sources.map(item=>normalized(item.title)))]
        .filter(other=>other.length>title.length&&includesIdentity(other,title))
        .sort((a,b)=>b.length-a.length);
      let independentMentions=` ${text} `;
      for(const other of longerTitles)independentMentions=independentMentions.replaceAll(` ${other} `,' ');
      const moreSpecific=!includesIdentity(independentMentions,title);
      if(!moreSpecific&&sameTitle.length===1)return true;
      const year=source.publishedAt?.match(/^\d{4}(?:-|$)/)?.[0].slice(0,4);
      if(!moreSpecific&&year&&sameTitle.filter(item=>item.publishedAt?.startsWith(year)).length===1
        &&prose.split(/\n\s*\n/).some(paragraph=>includesIdentity(normalized(paragraph),title)&&includesIdentity(normalized(paragraph),year)))return true;
      // A shorter/ambiguous title must not fall through to its publisher and
      // acquire the citation already identifying a different specific record.
      return false;
    }
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

/**
 * Withhold sentences that explicitly rely on a source record that is missing,
 * off-topic for the current question, or outside the requested guidance scope.
 * This is a source-selection guard, not a check that the record entails the
 * sentence's scientific meaning.
 */
export function filterAnswerBySourceScope<T extends SourceIdentity & Pick<EvidenceSource, 'summary' | 'category' | 'jurisdiction'>>(
  answer: string,
  sources: readonly T[],
  aliases: ReadonlyMap<string, string>,
  question: string,
  explicitlySharedCountry = '',
  previousQuestions: readonly string[] = [],
): { answer: string; withheldSentenceCount: number } {
  const sourcesById = new Map(sources.map(source => [source.id, source]));
  const acceptedLines: string[] = [];
  const inspectingSuppliedSource = /\b(?:supplied|provided|selected)\s+(?:source|reference|guidance|evidence)\b/i.test(question);
  const contextDependent = isContextDependentFollowup(question);
  const contextualQuestions = [question];
  if (contextDependent) {
    for (const prior of [...previousQuestions].slice(-4).reverse()) {
      if (prior.trim()) contextualQuestions.push(prior);
      if (!isContextDependentFollowup(prior)) break;
    }
  }
  const topicalQuestion = contextualQuestions.join(' ');
  let withheldSentenceCount = 0;

  for (const line of answer.replace(/\r\n?/g, '\n').split('\n')) {
    const trimmed = line.trim();
    const headingPrefix = trimmed.match(/^#{1,6}\s+/)?.[0] ?? '';
    const content = trimmed.slice(headingPrefix.length);
    const listPrefix = content.match(/^(?:\d+[.)]|[-*+])\s+/)?.[0] ?? '';
    const sentences = content.slice(listPrefix.length)
      .split(/(?<=[.!?])\s+(?=[\p{L}\p{N}"“])/u)
      .filter(Boolean);
    const acceptedSentences = sentences.filter(sentence => {
      const handles = sentence.match(/\bSRC_[A-Z0-9]+\b/gi) ?? [];
      const handleSources: T[] = [];
      let unresolvedHandle = false;
      for (const handle of handles) {
        const id = aliases.get(handle);
        const source = id ? sourcesById.get(id) : undefined;
        if (!source) unresolvedHandle = true;
        else if (!handleSources.some(item => item.id === source.id)) handleSources.push(source);
      }

      const identitySources = selectCitedEvidence(sentence, sources);
      const referenced = [...new Map([...handleSources, ...identitySources].map(source => [source.id, source])).values()];
      const invalidSource = referenced.some(source =>
        !inspectingSuppliedSource
        && (!isLocalEvidenceTopicallyRelevant(source, topicalQuestion)
          || !isGuidanceEvidenceInScope(source, topicalQuestion, explicitlySharedCountry)),
      );
      if (!unresolvedHandle && !invalidSource) return true;
      withheldSentenceCount += 1;
      return false;
    });
    if (acceptedSentences.length) acceptedLines.push(headingPrefix + listPrefix + acceptedSentences.join(' '));
  }

  return {
    answer: acceptedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    withheldSentenceCount,
  };
}
