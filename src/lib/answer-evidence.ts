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
const contextualFollowupPattern=/^(?:(?:(?:and|also)\s+)?(?:what|how)\s+about\s+(?:that|it|this|them|those|the same|(?:just\s+|only\s+)?(?:\d|one\b|two\b|three\b|four\b|five\b|half\b|whole\b|a portion\b|a serving\b))|(?:(?:and|also)\s+)?(?:does|is|can|should|would)\s+(?:that|it)\b|(?:and\s+)?for\s+(?:that|it|the same|(?:just\s+|only\s+)?(?:\d|one\b|two\b|three\b|four\b|five\b|half\b|whole\b|a portion\b|a serving\b)))|\b(?:same as before|does that apply|what does that mean)\b/i;
const isContextDependentFollowup=(question:string)=>contextualFollowupPattern.test(question.trim());
const healthDomainPattern=/\b(?:health|medical|disease|diabetes|prediabet\w*|blood\s+(?:sugar|glucose|pressure|lipids?)|(?:ldl|hdl)|cholesterol|heart|cardiovascular|gut|digest\w*|allerg\w*|inflamm\w*|weight|cancer|kidney|liver|symptom\w*|immune|glycem\w*|insulin|hypertension|fibre|fiber|sodium|salt|sugar|carbohydrat\w*|protein|fat|calorie\w*|nutrient|pregnan\w*|infant|child|adult|bone|brain|probiotic\w*|prebiotic\w*|microbiome|dental|cavity|tooth|anemi\w*)\b/i;
const healthEffectPattern=/\b(?:caus\w*|prevent\w*|reduc\w*|lower\w*|increas\w*|rais\w*|improv\w*|worsen\w*|protect\w*|treat\w*|cur\w*|manag\w*|benefit\w*|help\w*|support\w*|recommend\w*|promot\w*|trigger\w*|associated\s+with|linked\s+to|good\s+for|bad\s+for|should\s+(?:eat|avoid|limit|consume|choose|include|reduce|increase|take|use))\b/i;
const explicitSafetyAssertionPattern=/\b(?:is|are|may\s+be|can\s+be|could\s+be|should\s+be)\s+(?:not\s+)?(?:safe|unsafe|healthy|harmful)\b|\b(?:safe|unsafe|healthy|harmful)\s+for\s+(?:you|children|a\s+child|infants?|pregnan\w*\s+(?:people|women))\b|\bsafe\s+to\s+(?:eat|consume|use)\b/i;

/** Catch clear unreferenced health effects, safety claims and dietary advice.
 * This conservative guard does not decide whether a cited source entails a
 * claim; linked sources still pass through topical and jurisdiction checks.
 */
function isUnreferencedScientificAssertion(sentence:string):boolean{
  if(/\b(?:does\s+not|doesn['’]t|cannot|can['’]t|not\s+enough\s+to)\s+(?:establish|prove|show|determine|confirm|identify)\b/i.test(sentence))return false;
  return explicitSafetyAssertionPattern.test(sentence)||(healthDomainPattern.test(sentence)&&healthEffectPattern.test(sentence));
}

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

/**
 * Withhold sentences with missing/off-topic/out-of-scope source records and
 * obvious health-effect or dietary-guidance assertions with no source. This
 * does not check whether a topical cited record entails a sentence's meaning.
 */
export function filterAnswerBySourceScope<T extends SourceIdentity & Pick<EvidenceSource, 'summary' | 'category' | 'jurisdiction'>>(
  answer: string,
  sources: readonly T[],
  aliases: ReadonlyMap<string, string>,
  question: string,
  explicitlySharedCountry = '',
  previousQuestions: readonly string[] = [],
): {
  answer: string;
  withheldSentenceCount: number;
  withheldSourceSentenceCount: number;
  withheldUnreferencedScientificSentenceCount: number;
} {
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
  let withheldSourceSentenceCount = 0;
  let withheldUnreferencedScientificSentenceCount = 0;

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
      if (unresolvedHandle || invalidSource) {
        withheldSentenceCount += 1;
        withheldSourceSentenceCount += 1;
        return false;
      }
      if (!referenced.length && !(inspectingSuppliedSource && sources.length > 0) && isUnreferencedScientificAssertion(sentence)) {
        withheldSentenceCount += 1;
        withheldUnreferencedScientificSentenceCount += 1;
        return false;
      }
      return true;
    });
    if (acceptedSentences.length) acceptedLines.push(headingPrefix + listPrefix + acceptedSentences.join(' '));
  }

  return {
    answer: acceptedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    withheldSentenceCount,
    withheldSourceSentenceCount,
    withheldUnreferencedScientificSentenceCount,
  };
}
