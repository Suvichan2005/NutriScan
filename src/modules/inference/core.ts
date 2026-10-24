import {
  calculationEvidenceText,
  type Calculation,
  type EvidenceSource,
  type PackageData,
  type PackageReconstructionContent,
  type Profile,
} from '../../lib/contracts';
import { InferenceModuleError } from './errors';
import { assistOutput } from './schema';

export type AssistValidationContext = {
  package: PackageData;
  question?: string;
  evidence?: EvidenceSource[];
  calculations?: Calculation[];
  profile?: Profile;
  images?: { handle: string }[];
  diagnostic?: (event: { stage: 'claim' | 'answer-part' | 'natural-answer' | 'structured-answer' | 'candidate' | 'ui' | 'image-action'; index: number; decision: 'accepted' | 'rejected'; reason?: string }) => void;
};

type PackageReconstructionFact = { id: string; text: string };

/**
 * Expose non-nutrient reconstructed package details as stable, validated
 * evidence references. These facts remain provisional when derived from a
 * photo, and never replace the original observations or saved source lineage.
 */
export function packageReconstructionFactReferences(
  reconstruction: PackageData['reconstruction'] | PackageReconstructionContent | undefined,
  pkg: PackageData,
  requestImageIds: readonly string[] = [],
): PackageReconstructionFact[] {
  if (!reconstruction) return [];
  const observations = new Set(pkg.observations.map(item => item.id));
  const images = new Set([
    ...pkg.observations.flatMap(item => item.imageId ? [item.imageId] : []),
    ...(pkg.ocrCaptures ?? []).map(item => item.imageId),
    ...(pkg.visionCaptures ?? []).map(item => item.imageId),
    ...requestImageIds,
  ]);
  const statusUsable = (status: string) => status === 'clear' || status === 'provisional';
  const traceable = (evidence: { observationIds: string[]; imageRegions: { imageId: string }[] }) =>
    evidence.observationIds.some(id => observations.has(id))
    || evidence.imageRegions.some(region => images.has(region.imageId));
  const facts: PackageReconstructionFact[] = [];
  const add = (id: string, text: string, status: string, evidence: { observationIds: string[]; imageRegions: { imageId: string }[] }) => {
    if (statusUsable(status) && traceable(evidence) && text.trim()) facts.push({ id: `package-fact:${id}`, text: text.trim().slice(0, 1600) });
  };

  const identity = reconstruction.identity;
  const identityParts = [identity.brand, identity.name, identity.variant].filter((part): part is string => !!part?.trim());
  if (identityParts.length) add('identity', `Reconstructed package identity: ${identityParts.join(' ')}.`, identity.status, identity.evidence);

  const serving = reconstruction.serving;
  if (serving) {
    const details = [serving.printedText, serving.quantity !== null && serving.unit ? `${serving.quantity} ${serving.unit}` : null,
      serving.pieceCount !== null ? `${serving.pieceCount} ${serving.pieceDescription ?? 'pieces'}` : null].filter((part): part is string => !!part?.trim());
    if (details.length) add('serving', `Reconstructed serving declaration: ${[...new Set(details)].join('; ')}.`, serving.status, serving.evidence);
  }

  reconstruction.ingredients.forEach((item, index) => {
    const text = [`Ingredient ${index + 1}: ${item.name}.`, item.printedText ? `Printed wording: ${item.printedText}.` : null,
      item.printedPercentage !== null ? `Printed percentage: ${item.printedPercentage}%.` : null].filter(Boolean).join(' ');
    add(`ingredient:${index}`, text, item.status, item.evidence);
  });
  reconstruction.additives.forEach((item, index) => {
    add(`additive:${index}`, `Package additive: ${item.printedName}${item.code ? ` (${item.code})` : ''}${item.normalizedName && item.normalizedName !== item.printedName ? `; normalized as ${item.normalizedName}` : ''}.`, item.status, item.evidence);
  });
  reconstruction.statements.forEach((item, index) => {
    add(`statement:${index}`, `Package ${item.kind}${item.label ? ` (${item.label})` : ''}: ${item.text}`, item.status, item.evidence);
  });
  return facts;
}

function normalizedPhraseAppears(text: string, phrase: string | null | undefined): boolean {
  if (!phrase?.trim()) return false;
  const normalizedText = ` ${normalizeLabelText(text)} `;
  const normalizedPhrase = normalizeLabelText(phrase);
  return !!normalizedPhrase && normalizedText.includes(` ${normalizedPhrase} `);
}

/** Restore an omitted citation only when the claim repeats a precise, traceable reconstructed fact. */
function linkExactReconstructedPackageFacts<T extends { text: string; packageFactIds?: string[] }>(
  claim: T,
  reconstruction: PackageReconstructionContent | undefined,
  availableFacts: Map<string, string>,
): T {
  if (!reconstruction) return claim;
  const linked = new Set(claim.packageFactIds ?? []);
  const add = (id: string, matches: boolean) => {
    const factId = `package-fact:${id}`;
    if (matches && availableFacts.has(factId)) linked.add(factId);
  };

  const identity=reconstruction.identity;
  const informativeIdentityPhrase=(part:string|null)=>!!part?.trim()
    &&part.trim().split(/[^\p{L}\p{N}]+/u).filter(token=>token.length>=3).length>=2
    &&normalizedPhraseAppears(claim.text,part);
  add('identity',!!identity.brand?.trim()&&normalizedPhraseAppears(claim.text,identity.brand)
    ||informativeIdentityPhrase(identity.name)||informativeIdentityPhrase(identity.variant));

  const serving = reconstruction.serving;
  if (serving) {
    const mentionsMass = serving.quantity !== null && !!serving.unit
      && quantityWithUnitAppears(claim.text, serving.quantity, serving.unit);
    const count = serving.pieceCount;
    const description = serving.pieceDescription;
    const countAsWords: Record<number, string> = { 0: 'zero', 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten' };
    const mentionsCount = count !== null && !!description
      && normalizedPhraseAppears(claim.text, description)
      && new RegExp(`(?:^|\\D)(?:${count}|${countAsWords[count] ?? '(?!)'})(?:\\D|$)`, 'i').test(claim.text);
    const servingContext = /\b(?:servings?|portions?|biscuits?|pieces?|packs?)\b/i.test(claim.text);
    add('serving', servingContext && (mentionsMass || mentionsCount));
  }

  reconstruction.ingredients.forEach((item, index) => {
    add(`ingredient:${index}`, [item.name, item.normalizedName]
      .some(phrase => normalizedPhraseAppears(claim.text, phrase)));
  });
  reconstruction.additives.forEach((item, index) => {
    add(`additive:${index}`, [item.printedName, item.normalizedName, item.code]
      .some(phrase => normalizedPhraseAppears(claim.text, phrase)));
  });
  reconstruction.statements.forEach((item, index) => {
    add(`statement:${index}`, [item.label, item.text]
      .some(phrase => normalizedPhraseAppears(claim.text, phrase)));
  });

  const packageFactIds = [...linked];
  return packageFactIds.length ? { ...claim, packageFactIds } : claim;
}

function fail(code: ConstructorParameters<typeof InferenceModuleError>[0], message: string): never {
  throw new InferenceModuleError(code, message);
}

function normalizeLabelText(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function claimNamesReconstructedNutrient(claim: string, row: { nutrient: string; printedLabel: string }): boolean {
  const label = normalizeLabelText(`${row.nutrient} ${row.printedLabel}`);
  const text = normalizeLabelText(claim);
  const families: Array<[RegExp, RegExp]> = [
    [/added sugars?/, /\badded sugars?\b/],
    [/saturated fat/, /\bsaturated fat\b/],
    [/carbohydrates?|carbs?/, /\b(?:carbohydrates?|carbs?)\b/],
    [/total sugars?|sugars?/, /\b(?:total sugars?|sugars?)\b/],
    [/protein/, /\bprotein\b/],
    [/total fat|fat/, /\b(?:total fat|fat)\b/],
    [/fibre|fiber/, /\b(?:fibre|fiber)\b/],
    [/sodium/, /\bsodium\b/],
    [/salt/, /\bsalt\b/],
    [/energy|calories?/, /\b(?:energy|calories?)\b/],
  ];
  const family = families.find(([rowPattern]) => rowPattern.test(label));
  if (family) return family[1].test(text);
  const meaningfulWords = label.split(' ').filter(word => word.length > 2 && !['total', 'amount', 'label'].includes(word));
  return meaningfulWords.length > 0 && meaningfulWords.every(word => text.split(' ').includes(word));
}

function claimNamesAnyNutrient(claim: string): boolean {
  return /\b(?:carbohydrat\w*|carbs?|protein|proten|fat|saturat\w*\s+fat|sugars?|sodium|salt|fibre|fiber|energy|kcal|kilojoules?)\b/i.test(claim);
}

function numericToken(value: number): string {
  return String(value).replace('.', '[.,]');
}

function quantityWithUnitAppears(text: string, value: number, unit: string, basis = false): boolean {
  const unitPattern = ({
    g: '(?:g|grams?)', mg: '(?:mg|milligrams?)', kcal: '(?:kcal|kilocalories?)',
    kj: '(?:kj|kilojoules?)', ml: '(?:ml|millilit(?:er|re)s?)',
  } as Record<string, string>)[unit.toLocaleLowerCase()];
  if (!unitPattern) return false;
  const quantity = `${numericToken(value)}\\s*${unitPattern}\\b`;
  return new RegExp(basis ? `\\bper\\s+${quantity}` : `(?:^|[^\\d.,])${quantity}`, 'i').test(text);
}

function linkExactReconstructedRows<T extends {
  observationIds: string[];
  interpretationRowIds?: string[];
}>(claim: T & { text: string }, rows: Array<{
  rowId: string; nutrient: string; printedLabel: string; value: number | null; unit: string | null;
  columnLabel?: string | null; basisText?: string | null; basisAmount: number | null; basisUnit: string | null; status: string; evidence: { observationIds: string[] };
}>, servingBasis?: { quantity: number; unit: string } | null): T {
  const linked = new Set(claim.interpretationRowIds ?? []);
  const matches = rows.filter(row => {
    const printedBasis=[row.columnLabel??'',row.basisText??''].filter(value=>value.trim()).join('; ');
    const hasNumericBasis=row.basisAmount!==null&&!!row.basisUnit;
    if (!['clear', 'provisional'].includes(row.status) || row.value === null || !row.unit || (!hasNumericBasis&&!printedBasis)) return false;
    if (!claimNamesReconstructedNutrient(claim.text, row)) return false;
    const mentionsServing = /\bper\s+(?:the\s+)?serving\b/i.test(claim.text);
    const sameAsDeclaredServing = !!servingBasis && row.basisAmount === servingBasis.quantity
      && row.basisUnit?.toLocaleLowerCase() === servingBasis.unit.toLocaleLowerCase();
    const hasRowBasis = (hasNumericBasis&&quantityWithUnitAppears(claim.text, row.basisAmount!, row.basisUnit!, true))
      || (mentionsServing && sameAsDeclaredServing)
      || (/\bper\s+(?:servings?|portions?|packs?|packages?|biscuits?|pieces?)\b/i.test(claim.text)
        && basisMentionsAreSupported(claim.text, [printedBasis, ...(hasNumericBasis?[`per ${row.basisAmount} ${row.basisUnit}`]:[])]));
    return quantityWithUnitAppears(claim.text, row.value, row.unit) && hasRowBasis;
  });
  // Exact nutrient, value, unit and basis matches can restore an omitted row
  // link even when Gemini forgot its citation. The caller supplies only rows
  // whose original OCR or image lineage is retained. These stay provisional.
  for (const row of matches) linked.add(row.rowId);
  return linked.size ? { ...claim, interpretationRowIds: [...linked] } : claim;
}

const calculationNutrientLabels: Record<Calculation['nutrient'], string> = {
  energy: 'energy', carbohydrate: 'carbohydrates', sugars: 'total sugars', addedSugars: 'added sugars',
  protein: 'protein', fat: 'total fat', saturatedFat: 'saturated fat', fiber: 'fibre', sodium: 'sodium', salt: 'salt',
};

/** Restore a missing calculation citation only for a uniquely matching nutrient and rounded result. */
function linkExactCalculatedResult<T extends { text: string; calculationIds?: string[] }>(
  claim: T,
  calculations: Calculation[],
): T {
  if (claim.calculationIds?.length) return claim;
  const matching = calculations.filter(calculation => {
    const nutrient = calculationNutrientLabels[calculation.nutrient];
    if (!claimNamesReconstructedNutrient(claim.text, { nutrient, printedLabel: nutrient })) return false;
    const expected = numericMentions(`${calculation.result} ${calculation.unit}`).find(item => item.dimension !== 'unitless');
    if (!expected) return false;
    return numericMentions(claim.text).some(actual => {
      if (actual.dimension !== expected.dimension || actual.dimension === 'unitless' || actual.localeAmbiguous || expected.localeAmbiguous) return false;
      if (actual.value === 0 || expected.value === 0) return actual.value === expected.value;
      const roundingTolerance = 0.5 * 10 ** (-actual.decimalPlaces) * actual.factor;
      const floatingTolerance = Number.EPSILON * Math.max(1, Math.abs(actual.value), Math.abs(expected.value)) * 8;
      return Math.abs(actual.value - expected.value) <= roundingTolerance + floatingTolerance;
    });
  });
  // If identical rounded values could refer to different portions, keep the
  // model's citation unresolved rather than selecting a calculation by guess.
  return matching.length === 1 ? { ...claim, calculationIds: [matching[0].id] } : claim;
}

function conflictsWithReconstructedNutrientAssociation(claim: { text: string; observationIds: string[] }, rows: Array<{
  nutrient: string; printedLabel: string; value: number | null; unit: string | null; basisAmount: number | null;
  basisUnit: string | null; status: string; evidence: { observationIds: string[] };
}>): boolean {
  if (!claim.observationIds.length || !claimNamesAnyNutrient(claim.text)) return false;
  const sameEvidenceRows = rows.filter(row => ['clear', 'provisional'].includes(row.status)
    && row.value !== null && row.unit && row.basisAmount !== null && row.basisUnit
    && claim.observationIds.some(id => row.evidence.observationIds.includes(id))
    && quantityWithUnitAppears(claim.text, row.value, row.unit)
    && quantityWithUnitAppears(claim.text, row.basisAmount, row.basisUnit, true));
  return sameEvidenceRows.length > 0 && !sameEvidenceRows.some(row => claimNamesReconstructedNutrient(claim.text, row));
}

function isUnsafeMedicalConclusion(text: string) {
  const safetyVerdict = /\b(?:is|are|may be|might be|seems? to be|considered)\s+(?:safe|unsafe|suitable|unsuitable)\b|\b(?:is|are)\s+not\s+(?:safe|suitable)\b/i.test(text);
  const explicitSafetyCaveat = /\b(?:does not|doesn't|cannot|can't|unable to|insufficient evidence|insufficient information|no evidence (?:that|to conclude)|not enough (?:evidence|information)|not established|unclear whether)\b.{0,120}\b(?:safe|unsafe|suitable|unsuitable)\b/i.test(text);
  return (safetyVerdict && !explicitSafetyCaveat)
    || /\b(?:you should|you must|you need to)\b.{0,80}\b(?:eat|consume|avoid|limit|take|stop|start|adjust|increase|decrease|treat|dose|medication|insulin)\b/i.test(text)
    || /\b(?:diagnose|treat|cure)\s+(?:you|your|diabetes|hypertension|kidney disease|an allergy)\b/i.test(text);
}

// Package text can establish what was printed, but not that a quantity is
// "low", "high", "healthy", or otherwise favorable. Those judgments need an
// applicable cited source so interpretation is not mistaken for a label fact.
function needsComparativeReference(text:string){
  return /\b(?:low|high|rich|poor|good|great|excellent|bad|healthy|unhealthy|balanced|unbalanced|better|worse|moderate|excessive|too much|too little|ideal|preferable|favorable|unfavourable|unfavorable|reasonable|appropriate|recommend(?:ed|ation)?|riskier|safer)\b/i.test(text);
}

/** A requested food-choice judgment may synthesize cited package facts without claiming clinical safety. */
function isQuestionBoundPackageAssessment(text:string,question:string|undefined,claims:Array<{
  text:string;observationIds?:string[];calculationIds?:string[];interpretationRowIds?:string[];packageFactIds?:string[];
}|undefined>):boolean{
  if(!question||! /\b(?:good|bad|healthy|unhealthy|suitable|unsuitable|appropriate|daily|every\s+day|regular(?:ly)?|snack(?:ing)?|recommend(?:ed|ation)?|should\s+i|can\s+i\s+(?:eat|have|include))\b/i.test(question))return false;
  if(! /\b(?:daily|every\s+day|regular(?:ly)?|snack(?:ing)?|everyday|occasional|routine|choice)\b/i.test(text))return false;
  // Keep objective nutrient rankings and physiological effects source-backed.
  // The exemption is only for a qualified, question-requested choice grounded
  // in the cited package; it cannot establish safe portions or clinical targets.
  if(/\b(?:low|high|rich|poor|more|less|better|worse|excessive|too\s+much)\b.{0,48}\b(?:carbohydrat\w*|carbs?|sugars?|fibr?e|fat|sodium|salt|blood\s+glucose|glycemi\w*|insulin)\b/i.test(text)
    && !/\b(?:does\s+not|doesn't|cannot|can't|not)\s+(?:establish|prove|show|mean|necessarily\s+indicate)\b.{0,48}\b(?:low|high|safe|healthy)\b/i.test(text))return false;
  if(/\b(?:blood\s+glucose|glycemi\w*|insulin|diabetic\s+complication|medical\s+risk)\b/i.test(text))return false;
  return claims.some(claim=>!!claim&&((claim.observationIds?.length??0)>0||(claim.calculationIds?.length??0)>0||(claim.interpretationRowIds?.length??0)>0||(claim.packageFactIds?.length??0)>0)
    &&hasEvidenceSpecificAnswerAnchor(text,[claim]));
}

function answerSentences(text:string):string[]{
  // Abbreviations such as "approx." are common in package serving declarations.
  // A split there can leave a dangling clause ("... serving (approx.") while
  // the numeric continuation is independently rejected, silently losing the
  // useful answer. Protect the period during sentence segmentation.
  const protectedText=text.replace(/\b(approx|e\.g|i\.e|vs)\.(?=\s+[\p{L}\p{N}])/giu,'$1\uE000');
  return protectedText.split(/(?<=[.!?])\s+(?=[\p{L}\p{N}])/u).map(part=>part.replace(/\uE000/g,'.').trim()).filter(Boolean);
}

const genericAnswerTerms=new Set('about according also appears available based because being cannot clear could details does doesnt evidence exactly expected food foods from generally guidance have information interpret interpretation label labels may might model much need package packages perhaps portions product products read reading reference references reported result safe says see show shows source sources states support supported text that the their there these they this those unclear unresolved user usually was were what when which will with without'.split(' '));
function hasEvidenceSpecificAnswerAnchor(answer:string,claims:{text:string}[]):boolean{
  const terms=(text:string)=>new Set((text.toLocaleLowerCase().match(/[\p{L}]{4,}/gu)??[])
    .map(term=>term.endsWith('ies')&&term.length>5?`${term.slice(0,-3)}y`:term.endsWith('s')&&term.length>5?term.slice(0,-1):term)
    .filter(term=>!genericAnswerTerms.has(term)));
  const evidenceTerms=new Set(claims.flatMap(claim=>[...terms(claim.text)]));
  return [...terms(answer)].some(term=>evidenceTerms.has(term));
}

function hasStrongAnswerPartAnchor(answer:string,claims:{text:string}[]):boolean{
  const terms=(text:string)=>new Set((text.toLocaleLowerCase().match(/[\p{L}]{4,}/gu)??[])
    .map(term=>term.endsWith('ies')&&term.length>5?`${term.slice(0,-3)}y`:term.endsWith('s')&&term.length>5?term.slice(0,-1):term)
    .filter(term=>!genericAnswerTerms.has(term)));
  const answerTerms=terms(answer);
  if(!answerTerms.size)return false;
  const evidenceTerms=new Set(claims.flatMap(claim=>[...terms(claim.text)]));
  const shared=[...answerTerms].filter(term=>evidenceTerms.has(term)).length;
  const required=answerTerms.size<=6?2:Math.max(4,Math.ceil(answerTerms.size*0.3));
  return shared>=required;
}

function hasExplicitUncertainty(text:string):boolean{
  return /\b(?:not enough|insufficient|cannot establish|can't establish|could not establish|does not establish|doesn't establish|can't determine|cannot determine|could not determine|cannot tell|can't tell|unclear|unresolved|unknown|not established|missing|ambiguous|conflict(?:ing)?)\b|\b(?:does not|doesn't)\s+\w{1,30}\s+(?:enough|sufficient)\s+(?:information|evidence)\b/i.test(text);
}

function nutrientFamily(text:string):string|null{
  const families:Array<[string,RegExp]>=[
    ['added-sugars',/\badded sugars?\b/i],['carbohydrate',/\b(?:carbohydrat\w*|carbs?)\b/i],
    ['sugars',/\b(?:total )?sugars?\b/i],['protein',/\b(?:protein|proten)\b/i],
    ['saturated-fat',/\bsaturat\w* fat\b/i],['fat',/\b(?:total )?fat\b/i],
    ['fiber',/\b(?:fibre|fiber)\b/i],['sodium',/\bsodium\b/i],['salt',/\bsalt\b/i],
    ['energy',/\b(?:energy|calories?|kcal|kilojoules?|kj)\b/i],
  ];
  return families.find(([,pattern])=>pattern.test(text))?.[0]??null;
}

function repeatsValidatedClaimText(answer:string,claims:{text:string}[]):boolean{
  const normalized=answer.replace(/\s+/g,' ').trim().toLocaleLowerCase();
  return claims.some(claim=>claim.text.replace(/\s+/g,' ').trim().toLocaleLowerCase()===normalized);
}

/** A natural-language comparison may synthesize package facts with relevant source evidence. */
function hasRelevantSourceForComparativeAnswer(answer:string,claims:Array<{
  text:string;
  sourceIds:string[];
  observationIds?:string[];
  calculationIds?:string[];
  interpretationRowIds?:string[];
  packageFactIds?:string[];
}|undefined>):boolean{
  const terms=(text:string)=>new Set((text.toLocaleLowerCase().match(/[\p{L}]{4,}/gu)??[])
    .map(term=>term.endsWith('ies')&&term.length>5?`${term.slice(0,-3)}y`:term.endsWith('s')&&term.length>5?term.slice(0,-1):term)
    .filter(term=>!genericAnswerTerms.has(term)));
  const answerTerms=terms(answer);
  const hasPackageEvidence=claims.some(claim=>!!claim&&((claim.observationIds?.length??0)>0||(claim.calculationIds?.length??0)>0||(claim.interpretationRowIds?.length??0)>0||(claim.packageFactIds?.length??0)>0));
  return hasPackageEvidence&&claims.some(claim=>!!claim&&claim.sourceIds.length>0&&[...terms(claim.text)].some(term=>answerTerms.has(term)));
}

const physiologicalOutcomePatterns = [
  /\b(?:blood\s+)?(?:glucose|sugar)\b|\bglyc(?:a|e)emi\w*/i,
  /\binsulin\b|\bdiabet(?:es|ic)\b/i,
  /\b(?:blood\s+pressure|hypertension)\b/i,
  /\b(?:cholesterol|lipids?|ldl|hdl|triglycerides?)\b/i,
  /\b(?:kidneys?|renal|ckd|egfr)\b/i,
  /\b(?:allerg\w*|anaphylaxis|celiac|coeliac|gluten)\b/i,
  /\b(?:cardiovascular|heart\s+(?:disease|health)|inflammation)\b/i,
];
const physiologicalRelationshipPattern = /\b(?:affect\w*|impact\w*|rais\w*|lower\w*|increas\w*|decreas\w*|reduc\w*|improv\w*|worsen\w*|contribut\w*|caus\w*|trigger\w*|spik\w*|chang\w*|influenc\w*|correlat\w*|associat\w*\s+with|link\w*\s+to|lead\s+to|control\w*|regulat\w*|protect\w*|harm\w*|risk\w*|benefit\w*|help\w*|response|effect)\b/i;
const physiologicalTopicTerms = new Set([
  'blood', 'glucose', 'glycemia', 'glycaemia', 'glycemic', 'glycaemic', 'insulin', 'diabetes', 'diabetic',
  'pressure', 'hypertension', 'cholesterol', 'lipid', 'ldl', 'hdl', 'triglyceride', 'kidney', 'renal', 'ckd',
  'egfr', 'allergy', 'allergies', 'allergic', 'allergen', 'anaphylaxis', 'celiac', 'coeliac', 'gluten',
  'cardiovascular', 'heart', 'inflammation',
]);
const relationshipTerms = /^(?:affect\w*|impact\w*|rais\w*|lower\w*|increas\w*|decreas\w*|reduc\w*|improv\w*|worsen\w*|contribut\w*|caus\w*|trigger\w*|spik\w*|chang\w*|influenc\w*|correlat\w*|associat\w*|link\w*|lead|control\w*|regulat\w*|protect\w*|harm\w*|risk\w*|benefit\w*|help\w*|response|effect)$/i;

function hasPhysiologicalOutcome(text: string): boolean {
  return physiologicalOutcomePatterns.some(pattern => pattern.test(text));
}

function requiresPhysiologicalSource(text: string): boolean {
  return hasPhysiologicalOutcome(text) && physiologicalRelationshipPattern.test(text);
}

function negatesPhysiologicalRelationship(text: string): boolean {
  return /\b(?:no|not|never|cannot|can't|doesn't|don't|didn't|isn't|aren't|wasn't|weren't)\b.{0,48}\b(?:affect\w*|impact\w*|rais\w*|lower\w*|increas\w*|decreas\w*|reduc\w*|improv\w*|worsen\w*|contribut\w*|caus\w*|trigger\w*|spik\w*|chang\w*|influenc\w*|correlat\w*|associat\w*|link\w*|lead|control\w*|regulat\w*|protect\w*|harm\w*|risk\w*|benefit\w*|help\w*|response|effect)\b/i.test(text)
    || /\b(?:affect\w*|impact\w*|rais\w*|lower\w*|increas\w*|decreas\w*|reduc\w*|improv\w*|worsen\w*|contribut\w*|caus\w*|trigger\w*|spik\w*|chang\w*|influenc\w*|correlat\w*|associat\w*|link\w*|lead|control\w*|regulat\w*|protect\w*|harm\w*|risk\w*|benefit\w*|help\w*|response|effect)\b.{0,32}\b(?:not|no|never)\b/i.test(text);
}

function healthSupportTerms(text: string): Set<string> {
  const result = new Set<string>();
  for (const raw of text.toLocaleLowerCase().match(/[\p{L}]{3,}/gu) ?? []) {
    let term = raw;
    if (term === 'carb' || term === 'carbs' || term === 'carbohydrates') term = 'carbohydrate';
    else if (term === 'glycemia' || term === 'glycaemia' || term === 'glycemic' || term === 'glycaemic') term = 'glucose';
    else if (term.endsWith('ies') && term.length > 5) term = `${term.slice(0, -3)}y`;
    else if (term.endsWith('s') && term.length > 5) term = term.slice(0, -1);
    if (genericAnswerTerms.has(term) || physiologicalTopicTerms.has(term) || relationshipTerms.test(term)
      || /^(?:can|people|person|persons|individual|individuals|some|when|then|like|faster|quickly|slowly)$/i.test(term)) continue;
    result.add(term);
  }
  return result;
}

/** A physiological food-effect statement needs a linked source whose summary covers the same outcome and food concept. */
function relevantSourcesForPhysiologicalEffect(
  statement: string,
  evidence: readonly Pick<EvidenceSource, 'id' | 'category' | 'summary'>[],
): Array<Pick<EvidenceSource, 'id' | 'category' | 'summary'>> {
  if (!requiresPhysiologicalSource(statement)) return [];
  const outcomes = physiologicalOutcomePatterns.filter(pattern => pattern.test(statement));
  const statementTerms = healthSupportTerms(statement);
  return evidence.filter(source => {
    if (!['guideline', 'assessment', 'literature', 'regulation', 'web-search'].includes(source.category)) return false;
    return answerSentences(source.summary).some(sourceStatement => {
      if (!physiologicalRelationshipPattern.test(sourceStatement)
        || !outcomes.some(pattern => pattern.test(sourceStatement))
        || negatesPhysiologicalRelationship(statement) !== negatesPhysiologicalRelationship(sourceStatement)) return false;
      const sourceTerms = healthSupportTerms(sourceStatement);
      return [...statementTerms].some(term => sourceTerms.has(term));
    });
  });
}

function hasRelevantSourceForPhysiologicalEffect(
  statement: string,
  claims: Array<{ text: string; sourceIds: string[] } | undefined>,
  evidence: readonly Pick<EvidenceSource, 'id' | 'category' | 'summary'>[],
): boolean {
  if (!requiresPhysiologicalSource(statement)) return true;
  const outcomes = physiologicalOutcomePatterns.filter(pattern => pattern.test(statement));
  const matchedSources = new Map(relevantSourcesForPhysiologicalEffect(statement, evidence).map(source => [source.id, source]));
  return claims.some(claim => !!claim && requiresPhysiologicalSource(claim.text)
    && claimsHaveOverlappingOutcome(statement, claim.text, outcomes)
    && claim.sourceIds.some(id => {
      const source = matchedSources.get(id);
      return !!source && [...healthSupportTerms(claim.text)].some(term => healthSupportTerms(source.summary).has(term));
    }));
}

const sourceAttributionPattern=/\baccording to\b|\b(?:official|authoritative|clinical|dietary|nutrition|medical)\b.{0,140}\b(?:guidance|guidelines?|recommendations?|standards?|assessment|research|stud(?:y|ies)|report)\b|\b(?:guidance|guidelines?|recommendations?|standards?|assessment|research|stud(?:y|ies)|report)\b.{0,120}\b(?:from|by|published by)\b/i;
function sourceAcronym(source:Pick<EvidenceSource,'publisher'>):string{
  return(source.publisher.match(/[\p{L}\p{N}]+/gu)??[]).map(word=>word[0]).join('').toLocaleUpperCase();
}
function sourceAttributionHasMatchingReference(
  text:string,
  sourceIds:readonly string[],
  evidence:readonly Pick<EvidenceSource,'id'|'title'|'publisher'>[],
):boolean{
  if(!sourceAttributionPattern.test(text))return true;
  const linked=evidence.filter(source=>sourceIds.includes(source.id));
  if(!linked.length)return false;
  const acronyms=[...text.matchAll(/\(([A-Z][A-Z0-9-]{1,9})\)/g)].map(match=>match[1]);
  if(!acronyms.length)return true;
  return acronyms.every(acronym=>linked.some(source=>sourceAcronym(source)===acronym
    ||new RegExp(`(?:^|[^\\p{L}\\p{N}])${acronym}(?:$|[^\\p{L}\\p{N}])`,'iu').test(`${source.publisher} ${source.title}`)));
}

function claimsHaveOverlappingOutcome(statement: string, claimText: string, outcomes: RegExp[]): boolean {
  return outcomes.some(pattern => pattern.test(claimText) && pattern.test(statement));
}

/** Validate and safely render model output without invoking a provider. */
export function validateInferenceOutput(output: unknown, data: AssistValidationContext) {
  const result = assistOutput.safeParse(output);
  if (!result.success) {
    if (process.env.NODE_ENV !== 'production') {
      // Keep local provider debugging useful without ever logging generated text,
      // evidence, profile context, images, or prompt contents.
      console.warn('Gemini structured-output validation rejected fields', {
        issueCount: result.error.issues.length,
        issues: result.error.issues.slice(0, 20).map(issue => ({
          code: issue.code,
          field: issue.path.filter((part): part is string | number => typeof part === 'string' || typeof part === 'number').join('.'),
        })),
      });
    }
    fail('provider_invalid', 'The model output failed validation. No result was accepted.');
  }

  const observations = new Map(data.package.observations.map(observation => [observation.id, observation.text]));
  // Source limitations are attributable evidence too. A model must be able to
  // cite the record's own scope caveat rather than making it an unsupported
  // disclaimer that the exact-span validator silently drops.
  const sources = new Map((data.evidence ?? []).map(source => [source.id, `${source.summary}\n${source.limitations}`]));
  const calculations = new Map((data.calculations ?? []).map(calculation => [
    calculation.id,
    calculation.evidenceText ?? calculationEvidenceText(calculation),
  ]));
  const calculationsById = new Map((data.calculations ?? []).map(calculation=>[calculation.id,calculation]));
  const profileFields = new Map(Object.entries(data.profile ?? {}).filter(([, value]) => value.trim().length > 0));
  const imageIds = new Set((data.images ?? []).map(image => image.handle));
  // A saved interpretation keeps its original photo lineage. That lineage can
  // support a follow-up without transmitting the same photo again. New direct
  // visual claims still require bytes attached to this request (imageIds).
  const retainedPackageImageIds = new Set([
    ...imageIds,
    ...data.package.observations.flatMap(observation => observation.imageId ? [observation.imageId] : []),
    ...(data.package.ocrCaptures ?? []).map(capture => capture.imageId),
    ...(data.package.visionCaptures ?? []).map(capture => capture.imageId),
  ]);

  const reconstructionRows=result.data.packageReconstruction?.nutritionRows
    ??(data.package.reconstruction?.current?data.package.reconstruction.nutritionRows:[]);
  const reconstructionForUi=result.data.packageReconstruction??(data.package.reconstruction?.current?data.package.reconstruction:undefined);
  const serving=reconstructionForUi?.serving;
  const servingHasEvidence=!!serving&&['clear','provisional'].includes(serving.status)
    &&(serving.evidence.observationIds.some(id=>observations.has(id))
      ||serving.evidence.imageRegions.some(region=>retainedPackageImageIds.has(region.imageId)));
  const servingBasis=serving&&servingHasEvidence&&serving.quantity!==null&&serving.unit
    ?{quantity:serving.quantity,unit:serving.unit}:null;
  const hasUnresolvedNutrientAnchor=(text:string)=>{
    if(!hasExplicitUncertainty(text))return false;
    const family=nutrientFamily(text);
    if(!family)return false;
    const matchingRows=reconstructionRows.filter(row=>nutrientFamily(`${row.nutrient} ${row.printedLabel}`)===family);
    return matchingRows.every(row=>row.status!=='clear'||row.value===null||!row.unit);
  };
  const packageFacts = new Map(packageReconstructionFactReferences(
    result.data.packageReconstruction ?? (data.package.reconstruction?.current ? data.package.reconstruction : undefined),
    data.package,
    data.images?.map(image => image.handle),
  ).map(fact => [fact.id, fact.text]));
  const interpretationRows=new Map(reconstructionRows.flatMap(row=>{
    const hasEvidence=row.evidence.observationIds.some(id=>observations.has(id))||row.evidence.imageRegions.some(region=>retainedPackageImageIds.has(region.imageId));
    const printedBasis=[row.columnLabel,row.basisText].filter((value):value is string=>!!value?.trim()).join('; ');
    const hasNumericBasis=row.basisAmount!==null&&!!row.basisUnit;
    if(!hasEvidence||!['clear','provisional'].includes(row.status)||row.value===null||!row.unit||(!hasNumericBasis&&!printedBasis))return [];
    const normalizedBasis=hasNumericBasis?`; per ${row.basisAmount} ${row.basisUnit}`:'';
    const sameAsServing=!!servingBasis&&row.basisAmount===servingBasis.quantity
      &&row.basisUnit?.toLocaleLowerCase()===servingBasis.unit.toLocaleLowerCase();
    const servingAlias=sameAsServing?`; per serving (serving size ${servingBasis.quantity} ${servingBasis.unit})`:'';
    return [[row.rowId,`${row.nutrient} ${row.qualifier?`${row.qualifier} `:''}${row.value} ${row.unit}; ${printedBasis}${normalizedBasis}${servingAlias}`] as const];
  }));
  const traceableRows=reconstructionRows.filter(row=>interpretationRows.has(row.rowId));
  const hasReconstructedIngredients=(reconstructionForUi?.ingredients??[]).some((item,index)=>packageFacts.has(`package-fact:ingredient:${index}`))
    ||(reconstructionForUi?.additives??[]).some((item,index)=>packageFacts.has(`package-fact:additive:${index}`));
  const hasReconstructedStatements=(reconstructionForUi?.statements??[]).some((item,index)=>packageFacts.has(`package-fact:statement:${index}`));
  const linkPackageFactsToClaim=(claim:typeof result.data.claims[number])=>linkExactReconstructedPackageFacts(
    claim,
    result.data.packageReconstruction??(data.package.reconstruction?.current?data.package.reconstruction:undefined),
    packageFacts,
  );
  const linkRowToClaim=(claim: typeof result.data.claims[number])=>linkExactCalculatedResult(
    linkExactReconstructedRows(linkPackageFactsToClaim(claim),traceableRows,servingBasis),
    data.calculations??[],
  );
  const supportedByIndex = new Map<number, (typeof result.data.claims)[number] & {supportingSpans:NonNullable<(typeof result.data.claims)[number]['supportingSpans']>}>();
  const supported = result.data.claims.flatMap((originalClaim, claimIndex) => {
    let claim = linkRowToClaim(originalClaim);
    const hasLinkedPackageContext = claim.observationIds.length > 0 || (claim.calculationIds?.length ?? 0) > 0
      || (claim.interpretationRowIds?.length ?? 0) > 0 || (claim.packageFactIds?.length ?? 0) > 0
      || (claim.visualEvidence?.length ?? 0) > 0;
    if (claim.mode === 'synthesis' && hasLinkedPackageContext && requiresPhysiologicalSource(claim.text)
      && !hasRelevantSourceForPhysiologicalEffect(claim.text, [claim], data.evidence ?? [])) {
      const matches = relevantSourcesForPhysiologicalEffect(claim.text, data.evidence ?? []);
      // Reuse a single unambiguous source already selected for this request.
      // If several records match, leave source choice to the agent and keep the
      // unsupported sentence out of the accepted claim until it cites one.
      if (matches.length === 1) {
        const source = matches[0];
        claim = {
          ...claim,
          sourceIds: [...new Set([...claim.sourceIds, source.id])],
          supportingSpans: [...(claim.supportingSpans ?? []), { kind: 'source' as const, id: source.id, quote: source.summary }],
        };
      }
    }
    const reject = (reason: string) => {
      data.diagnostic?.({ stage: 'claim', index: claimIndex, decision: 'rejected', reason });
      return [];
    };
    const visualEvidence = claim.visualEvidence ?? [];
    if (!claim.observationIds.length && !claim.sourceIds.length && !(claim.calculationIds?.length) && !(claim.interpretationRowIds?.length) && !(claim.packageFactIds?.length) && !(claim.profileFieldIds?.length) && !visualEvidence.length) return reject('no-evidence-reference');
    if (claim.observationIds.some(id => !observations.has(id))
      || claim.sourceIds.some(id => !sources.has(id))
      || (claim.calculationIds ?? []).some(id => !calculations.has(id))
      || (claim.interpretationRowIds??[]).some(id=>!interpretationRows.has(id))
      || (claim.packageFactIds??[]).some(id=>!packageFacts.has(id))
      || (claim.profileFieldIds ?? []).some(id => !profileFields.has(id))) return reject('unknown-evidence-id');
    if(answerSentences(claim.text).some(sentence=>!sourceAttributionHasMatchingReference(sentence,claim.sourceIds,data.evidence??[])))return reject('source-attribution-needs-linked-source');
    if (visualEvidence.some(reference => !imageIds.has(reference.imageId))) {
      return reject('unknown-image-id');
    }

    const refs = [
      ...claim.observationIds.map(id => ({ kind: 'observation' as const, id, text: observations.get(id)! })),
      ...claim.sourceIds.map(id => ({ kind: 'source' as const, id, text: sources.get(id)! })),
      ...(claim.calculationIds ?? []).map(id => ({ kind: 'calculation' as const, id, text: calculations.get(id)! })),
      ...(claim.interpretationRowIds??[]).map(id=>({kind:'interpretation' as const,id,text:interpretationRows.get(id)!})),
      ...(claim.packageFactIds??[]).map(id=>({kind:'package-fact' as const,id,text:packageFacts.get(id)!})),
      ...(claim.profileFieldIds ?? []).map(id => ({ kind: 'profile' as const, id, text: profileFields.get(id)! })),
    ];
    const spans = claim.supportingSpans??[];
    const validSpans=spans.filter(span=>refs.some(ref=>ref.kind===span.kind&&ref.id===span.id&&ref.text.includes(span.quote)));
    const mode = claim.mode;
    // Keep source/observation quotations scoped to the exact validated span.
    // Structured, evidence-linked package facts and reconstructed rows carry
    // their own stable references, so include their full normalized records
    // even when the model also supplied a shorter OCR quotation. This lets a
    // linked row supply its unit/basis without broadening an external source
    // citation beyond the span the model actually cited.
    const citedPackageFacts=[
      ...(claim.interpretationRowIds??[]).map(id=>interpretationRows.get(id)),
      ...(claim.packageFactIds??[]).map(id=>packageFacts.get(id)),
    ].filter((text):text is string=>typeof text==='string');
    const evidenceTexts=validSpans.length
      ?[...validSpans.map(span=>span.quote),...citedPackageFacts]
      :refs.map(ref=>ref.text);
    if (mode === 'synthesis') {
      const sentences = answerSentences(claim.text);
      const retainedSentences = sentences.filter(sentence => {
        if (!requiresPhysiologicalSource(sentence)
          || hasRelevantSourceForPhysiologicalEffect(sentence, [claim], data.evidence ?? [])) return true;
        data.diagnostic?.({ stage: 'claim', index: claimIndex, decision: 'rejected', reason: 'health-effect-needs-relevant-source' });
        return false;
      });
      if (!retainedSentences.length) return reject('health-effect-needs-relevant-source');
      if (retainedSentences.length !== sentences.length) claim = { ...claim, text: retainedSentences.join(' ') };
    }
    // Structured label interpretations are usable, traceable candidates, not
    // independently verified package facts. Numeric wording must match the
    // exact interpreted row, including its printed unit and basis.
    const citedCalculationResults=(claim.calculationIds??[]).flatMap(id=>{
      const calculation=calculationsById.get(id);
      return calculation?[
        {value:calculation.result,unit:calculation.unit},
        {value:calculation.portion,unit:calculation.portionUnit},
      ]:[];
    });
    if (conflictsWithReconstructedNutrientAssociation(claim, reconstructionRows)) return reject('unsupported-nutrient-association');
    if (!numericMentionsAreSupported(claim.text, evidenceTexts,citedCalculationResults)) return reject('unsupported-numeric-value');
    if (!basisMentionsAreSupported(claim.text, evidenceTexts)) return reject('unsupported-basis');
    if(mode==='direct-quote'&&!validSpans.some(span=>span.quote===claim.text))return reject('direct-quote-needs-exact-evidence');
    if (mode === 'synthesis' && isUnsafeMedicalConclusion(claim.text)) return reject('unsafe-medical-conclusion');
    if(mode==='synthesis'&&needsComparativeReference(claim.text)&&!claim.sourceIds.length
      &&!isQuestionBoundPackageAssessment(claim.text,data.question,[claim]))return reject('comparative-judgment-needs-reference');
    const accepted = { ...claim, supportingSpans:validSpans, mode, text:claim.text };
    supportedByIndex.set(claimIndex, accepted);
    data.diagnostic?.({ stage: 'claim', index: claimIndex, decision: 'accepted', ...(claim.interpretationRowIds?.length && !originalClaim.interpretationRowIds?.length ? { reason: 'linked-exact-provisional-reconstruction-row' } : {}) });
    return [accepted];
  });

  const seenUiTypes = new Set<string>();
  const uiComponents = (result.data.uiComponents ?? []).filter((component, componentIndex) => {
    const reject = (reason: string) => {
      data.diagnostic?.({ stage: 'ui', index: componentIndex, decision: 'rejected', reason });
      return false;
    };
    if (component.observationIds.some(id => !observations.has(id))
      || component.sourceIds.some(id => !sources.has(id))
      || component.calculationIds.some(id => !calculations.has(id))) return reject('unknown-evidence-id');
    const hasObservations = component.observationIds.length > 0;
    const hasSources = component.sourceIds.length > 0;
    const hasCalculations = component.calculationIds.length > 0;
    const hasProductEvidence = component.sourceIds.some(id => data.evidence?.some(source => source.id === id && source.category === 'product'));
    const supportedByData = (() => { switch (component.type) {
      // A component may be backed by the saved multimodal reconstruction even
      // when the model's row/ingredient interpretation came from image regions
      // rather than OCR observation IDs.
      case 'nutrition-table': return (hasObservations && data.package.observations.length > 0) || traceableRows.length > 0;
      case 'portion-calculator': return hasCalculations;
      case 'ingredient-explorer':
        return hasObservations || hasReconstructedIngredients;
      case 'allergen-explanation': return hasObservations || hasReconstructedStatements;
      case 'package-evidence': return hasObservations || packageFacts.size > 0;
      case 'package-details': return hasObservations || packageFacts.size > 0;
      case 'source-reference-cards': return hasSources;
      case 'product-comparison': return hasObservations && hasProductEvidence;
      case 'personalized-finding': return supported.some(claim => (claim.profileFieldIds?.length ?? 0) > 0);
    } })();
    if (!supportedByData) return reject('component-not-supported-by-available-data');
    if (seenUiTypes.has(component.type)) return reject('duplicate-component-type');
    seenUiTypes.add(component.type);
    data.diagnostic?.({ stage: 'ui', index: componentIndex, decision: 'accepted' });
    return true;
  });

  if (result.data.inspectImage && !data.images?.some(image => image.handle === result.data.inspectImage!.handle)) {
    data.diagnostic?.({ stage: 'image-action', index: 0, decision: 'rejected', reason: 'unknown-image-id' });
  }
  const inspectImage = result.data.inspectImage && data.images?.some(image => image.handle === result.data.inspectImage!.handle)
    ? { ...result.data.inspectImage, reason: 'A specific package detail may need a closer look. Review the selected image before choosing to send it.' }
    : null;
  if (inspectImage) data.diagnostic?.({ stage: 'image-action', index: 0, decision: 'accepted' });

  const tentativeCandidates = (result.data.tentativeCandidates ?? []).flatMap((candidate, candidateIndex) => {
    const reject = (reason: string) => {
      data.diagnostic?.({ stage: 'candidate', index: candidateIndex, decision: 'rejected', reason });
      return [];
    };
    if (candidate.observationIds.some(id => !observations.has(id)) || candidate.sourceIds.some(id => !sources.has(id))) {
      return reject('unknown-evidence-id');
    }
    const visualEvidence = candidate.visualEvidence ?? [];
    if (visualEvidence.some(reference => !imageIds.has(reference.imageId))) return reject('unknown-image-id');

    const validSpans = candidate.supportingSpans.filter(span => {
      const evidence = span.kind === 'observation' ? observations.get(span.id) : sources.get(span.id);
      return !!evidence && evidence.includes(span.quote);
    });
    const linkedObservationIds = candidate.observationIds.filter(id => {
      const observation = data.package.observations.find(item => item.id === id);
      return observation?.origin === 'ocr' && observation.field === 'ocr-line'
        && validSpans.some(span => span.kind === 'observation' && span.id === id);
    });
    const linkedSourceIds = candidate.sourceIds.filter(id => validSpans.some(span => span.kind === 'source' && span.id === id));
    // Image-based readings are useful as traceable tentative candidates. A
    // region can support review, but exact OCR geometry remains mandatory for
    // downstream arithmetic and never promotes an image reading to package fact.
    const visualRegions = visualEvidence.filter(reference => !!reference.region);
    if (!validSpans.length && !visualRegions.length) return reject('no-traceable-package-evidence');
    if (!linkedObservationIds.length && !visualRegions.length) return reject('no-package-evidence');
    if (candidate.numericValue !== null) {
      const packageTextEvidence = [
        ...validSpans.filter(span => span.kind === 'observation').map(span => span.quote),
        ...visualRegions.map(reference => reference.visibleText),
      ];
      if (!packageTextEvidence.some(text => numericValueAppearsInEvidence(candidate.numericValue!, text))) {
        return reject('candidate-value-not-visible-in-package-evidence');
      }
    }

    const seenWordRoles = new Set<string>();
    const validWordEvidence = (candidate.ocrWordEvidence ?? []).filter(reference => {
      const observation = data.package.observations.find(item => item.id === reference.observationId);
      const roleKey = `${reference.observationId}:${reference.role}`;
      if (seenWordRoles.has(roleKey) || !linkedObservationIds.includes(reference.observationId) || !observation
        || observation.origin !== 'ocr' || observation.field !== 'ocr-line' || !observation.imageId
        || !observation.readingOrder || !observation.ocrWords) return false;
      const uniqueIndexes = new Set(reference.wordIndexes);
      const orderedIndexes = reference.wordIndexes.every((index, position) =>
        index < observation.ocrWords!.length && (position === 0 || index > reference.wordIndexes[position - 1]),
      );
      if (uniqueIndexes.size !== reference.wordIndexes.length || !orderedIndexes) return false;
      const selectedWords = reference.wordIndexes.map(index => normalizeEvidenceToken(observation.ocrWords![index].text));
      if (selectedWords.some(word => !word)) return false;
      const exactWordsLinked = validSpans.some(span => span.kind === 'observation' && span.id === observation.id && containsOrderedEvidenceTokens(span.quote, selectedWords));
      if (exactWordsLinked) seenWordRoles.add(roleKey);
      return exactWordsLinked;
    });

    const missingNumericWordRoles = candidate.kind === 'nutrient' && candidate.numericValue !== null
      && (['label', 'value', 'unit', 'basis'] as const).some(role => !validWordEvidence.some(reference => reference.role === role));
    const incompleteReferences = missingNumericWordRoles
      || linkedObservationIds.length !== candidate.observationIds.length
      || linkedSourceIds.length !== candidate.sourceIds.length
      || validSpans.length !== candidate.supportingSpans.length
      || validWordEvidence.length !== (candidate.ocrWordEvidence?.length ?? 0)
      || visualRegions.length !== visualEvidence.length;
    const linkNote = 'Some evidence links are incomplete; this remains unverified.';
    const uncertainty = incompleteReferences
      ? `${candidate.uncertainty.slice(0, Math.max(1, 500 - linkNote.length - 1))} ${linkNote}`
      : candidate.uncertainty;
    data.diagnostic?.({ stage: 'candidate', index: candidateIndex, decision: 'accepted', ...(incompleteReferences ? { reason: 'kept-tentative-with-only-exact-evidence-links' } : {}) });
    return [{
      ...candidate,
      observationIds: linkedObservationIds,
      sourceIds: linkedSourceIds,
      supportingSpans: validSpans,
      ...(candidate.visualEvidence ? { visualEvidence: visualRegions } : {}),
      ...(candidate.ocrWordEvidence ? { ocrWordEvidence: validWordEvidence } : {}),
      uncertainty,
    }];
  });

  const displayedClaimsByIndex = new Map<number, (typeof supported)[number]>();
  let displayedClaimLength = 0;
  for (let claimIndex = 0; claimIndex < result.data.claims.length; claimIndex += 1) {
    const claim = supportedByIndex.get(claimIndex);
    if (!claim || displayedClaimLength + claim.text.length > 6800) continue;
    displayedClaimsByIndex.set(claimIndex, claim);
    displayedClaimLength += claim.text.length;
  }
  const displayedClaims = [...displayedClaimsByIndex.values()];
  const referencedEvidenceTexts=(claim:typeof result.data.claims[number])=>[
    ...claim.observationIds.map(id=>observations.get(id)),
    ...claim.sourceIds.map(id=>sources.get(id)),
    ...(claim.calculationIds??[]).map(id=>calculations.get(id)),
    ...(claim.interpretationRowIds??[]).map(id=>interpretationRows.get(id)),
    ...(claim.packageFactIds??[]).map(id=>packageFacts.get(id)),
    ...(claim.profileFieldIds??[]).map(id=>profileFields.get(id)),
  ].filter((text):text is string=>typeof text==='string');
  const claimSupportsAnswer=(answer:string,claim:typeof result.data.claims[number])=>{
    if(hasEvidenceSpecificAnswerAnchor(answer,[claim])
      ||isQuestionBoundPackageAssessment(answer,data.question,[claim]))return true;
    if(numericOccurrences(answer).length&&numericMentionsAreSupported(answer,[claim.text]))return true;
    const uncertainty=/\b(?:not enough|insufficient|cannot establish|can't establish|could not establish|cannot tell|can't tell|unclear|unresolved|unknown|not established|missing|ambiguous|conflict(?:ing)?)\b/i;
    return uncertainty.test(answer)&&uncertainty.test(claim.text);
  };

  const answerPartRejections: string[] = [];
  let numericAnswerOrBasisWithheld=false;
  const validatedAnswerParts = (result.data.answerParts ?? []).flatMap((part, answerPartIndex) => {
    const reject = (reason: string) => {
      answerPartRejections.push(reason);
      if(reason==='unsupported-numeric-value'||reason==='unsupported-basis')numericAnswerOrBasisWithheld=true;
      data.diagnostic?.({ stage: 'answer-part', index: answerPartIndex, decision: 'rejected', reason });
      return [];
    };
    const linkedClaims = part.claimIndexes.map(index => displayedClaimsByIndex.get(index));
    if (!linkedClaims.length || linkedClaims.some(claim => !claim)) return reject('unsupported-claim-link');
    const supportedLinkedClaims=linkedClaims.filter((claim):claim is NonNullable<(typeof linkedClaims)[number]>=>!!claim);
    const answerText = part.text.replace(/\s+/g, ' ').trim();
    if (!answerText) return reject('empty-answer-part');
    const acceptedSegments:string[]=[];
    for(const segment of answerSentences(answerText)){
      const segmentClaims=supportedLinkedClaims;
      const linkedEvidence=segmentClaims.flatMap(claim=>referencedEvidenceTexts(claim));
      const linkedCalculationResults=[...new Set(segmentClaims.flatMap(claim=>claim.calculationIds??[]))].flatMap(id=>{
        const calculation=calculationsById.get(id);
        return calculation?[
          {value:calculation.result,unit:calculation.unit},
          {value:calculation.portion,unit:calculation.portionUnit},
        ]:[];
      });
      // Validate every displayed sentence against only its linked evidence;
      // nearby package facts cannot authenticate a separate source claim.
      if (!numericMentionsAreSupported(segment, linkedEvidence,linkedCalculationResults)) return reject('unsupported-numeric-value');
      if (!basisMentionsAreSupported(segment, linkedEvidence)) return reject('unsupported-basis');
      if (requiresPhysiologicalSource(segment)
        && !hasRelevantSourceForPhysiologicalEffect(segment, segmentClaims, data.evidence ?? [])) return reject('health-effect-needs-relevant-source');
       if(!sourceAttributionHasMatchingReference(segment,segmentClaims.flatMap(claim=>claim.sourceIds),data.evidence??[]))return reject('source-attribution-needs-linked-source');
      if (needsComparativeReference(segment) && !hasRelevantSourceForComparativeAnswer(segment, segmentClaims)
        &&!isQuestionBoundPackageAssessment(segment,data.question,segmentClaims)) return reject('comparative-judgment-needs-reference');
      if (isUnsafeMedicalConclusion(segment)) return reject('unsafe-medical-conclusion');
      const family=nutrientFamily(segment);
      const quantitativeAnchor=numericOccurrences(segment).length>0
        &&numericMentionsAreSupported(segment,linkedEvidence,linkedCalculationResults)
        &&basisMentionsAreSupported(segment,linkedEvidence)
        &&!!family&&segmentClaims.some(claim=>nutrientFamily(claim.text)===family);
      const uncertaintyAnchored=hasExplicitUncertainty(segment)&&segmentClaims.some(claim=>hasExplicitUncertainty(claim.text));
      if(!hasStrongAnswerPartAnchor(segment,segmentClaims)
        &&!quantitativeAnchor
        &&!repeatsValidatedClaimText(segment,segmentClaims)
        &&!uncertaintyAnchored
        &&!hasUnresolvedNutrientAnchor(segment))return reject('unsupported-claim-link');
      acceptedSegments.push(segment);
    }
    if(!acceptedSegments.length)return reject('empty-answer-part');
    data.diagnostic?.({ stage: 'answer-part', index: answerPartIndex, decision: 'accepted' });
    return [acceptedSegments.join(' ')];
  });
  // The model's natural answer is checked sentence-by-sentence against only
  // validated claims with a relevant semantic anchor. Aggregate references
  // cannot lend support to unrelated prose; numbers, bases, sources and safety
  // language remain independently checked.
  const naturalAnswer = result.data.answer.replace(/\s+/g, ' ').trim();
  let validatedNaturalAnswer: string | null = null;
  if (naturalAnswer) {
    const segments=answerSentences(naturalAnswer);
    const supportedSegments:string[]=[];
    if (!displayedClaims.length) data.diagnostic?.({ stage: 'natural-answer', index: 0, decision: 'rejected', reason:'no-validated-claims' });
    else for(const [index,segment] of segments.entries()){
      const reject=(reason:string)=>{
        if(reason==='unsupported-numeric-value'||reason==='unsupported-basis')numericAnswerOrBasisWithheld=true;
        data.diagnostic?.({stage:'natural-answer',index:index+1,decision:'rejected',reason});
      };
      const segmentClaims=displayedClaims.filter(claim=>claimSupportsAnswer(segment,claim));
      if(!segmentClaims.length){reject('no-validated-claim-anchor');continue;}
      const answerEvidence=segmentClaims.flatMap(referencedEvidenceTexts);
      const answerCalculations = [...new Set(segmentClaims.flatMap(claim => claim.calculationIds ?? []))].flatMap(id => {
        const calculation = calculationsById.get(id);
        return calculation ? [
          { value: calculation.result, unit: calculation.unit },
          { value: calculation.portion, unit: calculation.portionUnit },
        ] : [];
      });
      if(!numericMentionsAreSupported(segment,answerEvidence,answerCalculations)){reject('unsupported-numeric-value');continue;}
      if(!basisMentionsAreSupported(segment,answerEvidence)){reject('unsupported-basis');continue;}
      if(isUnsafeMedicalConclusion(segment)){reject('unsafe-medical-conclusion');continue;}
      if(requiresPhysiologicalSource(segment)
        && !hasRelevantSourceForPhysiologicalEffect(segment, segmentClaims, data.evidence ?? [])){reject('health-effect-needs-relevant-source');continue;}
      if(!sourceAttributionHasMatchingReference(segment,segmentClaims.flatMap(claim=>claim.sourceIds),data.evidence??[])){reject('source-attribution-needs-linked-source');continue;}
      if(needsComparativeReference(segment)&&!hasRelevantSourceForComparativeAnswer(segment,segmentClaims)
        &&!isQuestionBoundPackageAssessment(segment,data.question,segmentClaims)){reject('comparative-judgment-needs-reference');continue;}
      const family=nutrientFamily(segment);
      const quantitativeAnchor=numericOccurrences(segment).length>0
        &&numericMentionsAreSupported(segment,answerEvidence,answerCalculations)
        &&basisMentionsAreSupported(segment,answerEvidence)
        &&!!family&&segmentClaims.some(claim=>nutrientFamily(claim.text)===family);
      const uncertaintyAnchored=hasExplicitUncertainty(segment)&&segmentClaims.some(claim=>hasExplicitUncertainty(claim.text));
      if(!hasStrongAnswerPartAnchor(segment,segmentClaims)
        &&!quantitativeAnchor
        &&!repeatsValidatedClaimText(segment,segmentClaims)
        &&!uncertaintyAnchored
        &&!hasUnresolvedNutrientAnchor(segment)){reject('no-validated-claim-anchor');continue;}
      supportedSegments.push(segment);
    }
    if(supportedSegments.length){
      validatedNaturalAnswer=supportedSegments.join(' ');
      data.diagnostic?.({ stage: 'natural-answer', index: 0, decision: 'accepted' });
    }else if(displayedClaims.length)data.diagnostic?.({stage:'natural-answer',index:0,decision:'rejected',reason:'no-supported-answer-sentence'});
  }
  const isNutritionQuestion=!!data.question&&(
    /\b(?:nutrition|nutrients?|calories?|energy|carbohydrat\w*|carbs?|sugars?|protein|fat|fibre|fiber|sodium|salt|per\s+(?:the\s+)?serving|per\s+\d+(?:\.\d+)?\s*(?:g|grams?|mg|milligrams?|ml|millilit(?:er|re)s?))\b/i.test(data.question)
    ||nutrientFamily(data.question)!==null
  );
  const structuredNutritionSummary=(()=>{
    if(!numericAnswerOrBasisWithheld||!isNutritionQuestion)return null;
    const availableClaims=Math.max(0,15-displayedClaims.length);
    if(!availableClaims)return null;
    let selectedRows=traceableRows.filter(row=>row.value!==null&&!!row.unit&&['clear','provisional'].includes(row.status));
    const requestedAmount=/\bper\s+(\d+(?:\.\d+)?)\s*(g|grams?|mg|milligrams?|ml|millilit(?:er|re)s?)\b/i.exec(data.question!);
    if(requestedAmount){
      const amount=Number(requestedAmount[1]);
      const unit=/^grams?$/i.test(requestedAmount[2])?'g':/^milligrams?$/i.test(requestedAmount[2])?'mg':/^millilit(?:er|re)s?$/i.test(requestedAmount[2])?'ml':requestedAmount[2].toLocaleLowerCase();
      selectedRows=selectedRows.filter(row=>row.basisAmount===amount&&row.basisUnit?.toLocaleLowerCase()===unit);
    }else if(/\bper\s+(?:the\s+)?serving\b/i.test(data.question!)&&servingBasis){
      selectedRows=selectedRows.filter(row=>row.basisAmount===servingBasis.quantity&&row.basisUnit?.toLocaleLowerCase()===servingBasis.unit.toLocaleLowerCase());
    }else if(/\bper\s+(?:the\s+)?serving\b/i.test(data.question!)){
      selectedRows=selectedRows.filter(row=>/\bservings?\b/i.test(`${row.columnLabel??''} ${row.basisText??''}`));
    }
    selectedRows=selectedRows.slice(0,availableClaims);
    if(!selectedRows.length)return null;
    const basisFor=(row:typeof selectedRows[number])=>row.basisAmount!==null&&row.basisUnit?`per ${row.basisAmount} ${row.basisUnit}`:(row.basisText||row.columnLabel||'printed basis').replace(/\s+/g,' ').trim();
    const labelFor=(row:typeof selectedRows[number])=>{
      const raw=row.nutrient.toLocaleLowerCase()==='other'?row.printedLabel:row.nutrient;
      const normalized=raw.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim();
      return normalized?normalized[0].toLocaleUpperCase()+normalized.slice(1):'Nutrient';
    };
    const rowClaims=selectedRows.map(row=>{
      const text=`The photographed label appears to list ${labelFor(row)} ${row.value} ${row.unit} ${basisFor(row)}.`;
      const evidenceText=interpretationRows.get(row.rowId);
      if(!evidenceText||!numericMentionsAreSupported(text,[evidenceText])||!basisMentionsAreSupported(text,[evidenceText]))return null;
      return {mode:'synthesis' as const,text,observationIds:[],sourceIds:[],calculationIds:[],interpretationRowIds:[row.rowId],packageFactIds:[],profileFieldIds:[],supportingSpans:[]};
    }).filter((claim):claim is NonNullable<typeof claim>=>claim!==null);
    if(!rowClaims.length)return null;
    const rowsByBasis=new Map<string,{label:string;rows:typeof selectedRows}>();
    for(const row of selectedRows){
      if(!rowClaims.some(claim=>claim.interpretationRowIds?.includes(row.rowId)))continue;
      const basis=basisFor(row);
      const isServing=!!servingBasis&&row.basisAmount===servingBasis.quantity&&row.basisUnit?.toLocaleLowerCase()===servingBasis.unit.toLocaleLowerCase();
      const label=isServing?`the ${servingBasis.quantity} ${servingBasis.unit} serving`:basis;
      const key=isServing?`serving:${servingBasis.quantity}:${servingBasis.unit}`:basis.toLocaleLowerCase();
      const group=rowsByBasis.get(key)??{label,rows:[]};
      group.rows.push(row);
      rowsByBasis.set(key,group);
    }
    const descriptions=[...rowsByBasis.values()].map(group=>{
      const label=group.label.startsWith('the ')?`For ${group.label}`:`On the ${group.label} basis`;
      const values=group.rows.map(row=>`${labelFor(row)} ${row.value} ${row.unit}`).join('; ');
      return `${label}, the photographed nutrition panel appears to list ${values}`;
    });
    const answer=`${descriptions.join('. ')}. These are provisional label readings; only rows with a linked value, unit, and basis are included.`;
    const supportingTexts:string[]=[];
    for(const claim of rowClaims)for(const id of claim.interpretationRowIds??[]){
      const evidenceText=interpretationRows.get(id);
      if(evidenceText)supportingTexts.push(evidenceText);
    }
    if(!numericMentionsAreSupported(answer,supportingTexts)||!basisMentionsAreSupported(answer,supportingTexts))return null;
    return {answer,claims:rowClaims};
  })();
  if(structuredNutritionSummary)data.diagnostic?.({stage:'structured-answer',index:0,decision:'accepted',reason:'traceable-nutrition-rows-after-numeric-withholding'});
  // Keep every independently grounded part. A malformed optional answer-part
  // link must not erase a natural answer that passed evidence validation.
  const hasValidatedModelAnswer = validatedAnswerParts.length > 0 || !!validatedNaturalAnswer;
  const hasValidatedAnswer=hasValidatedModelAnswer||!!structuredNutritionSummary;
  const answer = structuredNutritionSummary?.answer ?? validatedNaturalAnswer ?? (validatedAnswerParts.length
    ? validatedAnswerParts.join('\n\n')
    : displayedClaims.length
      ? 'I found relevant package evidence, but could not safely assemble it into a clear answer. You can inspect the supporting details or ask a narrower follow-up.'
    : result.data.inspectImage
      ? 'I need a closer look at one part of the package before I can answer. Review the requested photo area and decide whether to send it.'
      : tentativeCandidates.length
        ? 'I found a few possible readings, but the current evidence does not establish enough to answer reliably. I can take a closer look at the relevant package area.'
          : 'I can’t establish a reliable answer from the package evidence available yet. The photos are still here, so you can try a closer view or ask about a detail that is legible.');

  const answerStatus = hasValidatedModelAnswer ? 'model-answer' as const
    : displayedClaims.length ? 'grounded-claims-answer-unavailable' as const
      : tentativeCandidates.length ? 'tentative-only' as const
        : 'insufficient-evidence' as const;
  data.diagnostic?.({ stage: 'answer-part', index: -1, decision: hasValidatedAnswer ? 'accepted' : 'rejected', reason: structuredNutritionSummary?'structured-package-summary':hasValidatedModelAnswer ? 'answer-ready' : answerStatus });
  return {
    claims: structuredNutritionSummary?[...displayedClaims,...structuredNutritionSummary.claims]:displayedClaims,
    tentativeCandidates,
    uiComponents,
    limitations: ['Generated explanations are not independently verified. Tentative candidates never alter original package observations. The application may use a complete OCR-linked candidate only for explicitly labeled arithmetic after checking its evidence and layout; that reading remains unverified. Image-only text and region references stay outside calculations. No diagnosis, medication advice, or safety assessment is provided.'],
    inspectImage,
    answer,
  };
}

function normalizeEvidenceToken(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/** Word indexes must locate visible OCR text inside an exact quote for that same line. */
function containsOrderedEvidenceTokens(quote: string, words: string[]): boolean {
  const tokens = (quote.normalize('NFKC').match(/[\p{L}\p{N}]+(?:[.,/%'’-][\p{L}\p{N}]+)*/gu) ?? []).map(normalizeEvidenceToken);
  let cursor = 0;
  for (const word of words) {
    const index = tokens.indexOf(word, cursor);
    if (index < 0) return false;
    cursor = index + 1;
  }
  return true;
}

type NumericDimension = 'mass' | 'energy' | 'volume' | 'percent' | 'unitless';
type NumericMention = { value: number; dimension: NumericDimension; rawValue: string; factor: number; decimalPlaces:number; localeAmbiguous: boolean };
const numericMentionPattern = /(?<![\p{L}\p{N}])(-?(?:\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?|\.\d+))(?!\d)\s*(kcal|kilocalories?|kj|kilojoules?|mg|milligrams?|µg|μg|mcg|ug|micrograms?|kg|g|grams?|ml|millilit(?:er|re)s?|l|lit(?:er|re)s?|%|percent)?(?![\p{L}])/giu;

function parseNumericLiteral(value: string): { value: number; localeAmbiguous: boolean } {
  if (value.includes(',') && value.includes('.')) {
    return {
      value: value.lastIndexOf(',') > value.lastIndexOf('.')
        ? Number(value.replaceAll('.', '').replace(',', '.'))
        : Number(value.replaceAll(',', '')),
      localeAmbiguous: false,
    };
  }
  if (value.includes(',')) {
    const [whole, fraction = ''] = value.split(',');
    return {
      value: fraction.length === 3 && whole.length > 0 ? Number(value.replaceAll(',', '')) : Number(value.replace(',', '.')),
      localeAmbiguous: /^-?\d+\,\d{3}$/.test(value),
    };
  }
  return { value: Number(value), localeAmbiguous: /^-?\d+\.\d{3}$/.test(value) };
}

function numericMentions(text: string): NumericMention[] {
  const result: NumericMention[] = [];
  for (const match of text.matchAll(numericMentionPattern)) {
    const parsed = parseNumericLiteral(match[1]);
    if (!Number.isFinite(parsed.value)) continue;
    const unit = (match[2] ?? '').toLocaleLowerCase().replace('μ', 'µ');
    let dimension: NumericDimension = 'unitless';
    let factor = 1;
    if (/^(?:mg|milligrams?)$/.test(unit)) { dimension = 'mass'; factor = 0.001; }
    else if (/^(?:µg|mcg|ug|micrograms?)$/.test(unit)) { dimension = 'mass'; factor = 0.000001; }
    else if (/^(?:kg)$/.test(unit)) { dimension = 'mass'; factor = 1000; }
    else if (/^(?:g|grams?)$/.test(unit)) dimension = 'mass';
    else if (/^(?:kj|kilojoules?)$/.test(unit)) { dimension = 'energy'; factor = 1 / 4.184; }
    else if (/^(?:kcal|kilocalories?)$/.test(unit)) dimension = 'energy';
    else if (/^(?:l|lit(?:er|re)s?)$/.test(unit)) { dimension = 'volume'; factor = 1000; }
    else if (/^(?:ml|millilit(?:er|re)s?)$/.test(unit)) dimension = 'volume';
    else if (/^(?:%|percent)$/.test(unit)) dimension = 'percent';
    const separator=Math.max(match[1].lastIndexOf('.'),match[1].lastIndexOf(','));
    const decimalPlaces=separator<0?0:match[1].length-separator-1;
    result.push({ value: parsed.value * factor, dimension, rawValue: match[1], factor, decimalPlaces, localeAmbiguous: parsed.localeAmbiguous });
  }
  return result;
}

function numericComparisonOperator(text:string,index:number):'<='|'<'|'>='|'>'|null{
  const prefix=text.slice(Math.max(0,index-36),index);
  if(/(?:<=|≤|less than or equal to|at most|no more than|not greater than)\s*$/i.test(prefix))return'<=';
  if(/(?:>=|≥|greater than or equal to|at least|no less than|not less than)\s*$/i.test(prefix))return'>=';
  if(/(?:<|less than|below|under)\s*$/i.test(prefix))return'<';
  if(/(?:>|greater than|above|over)\s*$/i.test(prefix))return'>';
  return null;
}

function numericOccurrences(text:string){
  return [...text.matchAll(numericMentionPattern)].flatMap(match=>{
    const mention=numericMentions(match[0])[0];
    return mention?[{mention,operator:numericComparisonOperator(text,match.index??0),index:match.index??0}]:[];
  });
}

function isApproximateNumericClaim(text:string,index:number){
  return /\b(?:about|around|approximately|approx\.?|nearly|roughly)\s*$/i.test(text.slice(Math.max(0,index-24),index));
}

function basisMentionsAreSupported(text: string, evidenceTexts: string[]): boolean {
  const mentions = [
    ...[...text.matchAll(/\bper\s*\d+(?:[.,]\d+)?\s*(?:g|grams?|mg|milligrams?|kg|ml|millilit(?:er|re)s?)\b/gi)].map(match => match[0]),
    ...[...text.matchAll(/\bper\s*(?:(?:each|a|one)\s+)?(?:servings?|portions?|packs?|packages?|biscuits?|pieces?)\b/gi)].map(match => match[0]),
  ];
  if (!mentions.length) return true;
  const evidence = evidenceTexts.map(normalizeLabelText);
  return mentions.every(mention => {
    const normalized = normalizeLabelText(mention);
    return evidence.some(text => text.includes(normalized));
  });
}

/** Arabic-numeric synthesis must match a quantity in its cited spans, allowing basic unit equivalence. */
function numericMentionsAreSupported(claim: string, citedSpans: string[],calculatedResults:{value:number;unit:string}[]=[]): boolean {
  const claimed = numericOccurrences(claim);
  if (!claimed.length) return true;
  const cited = citedSpans.flatMap(numericOccurrences);
  const calculated=calculatedResults.flatMap(item=>numericMentions(`${item.value} ${item.unit}`));
  return claimed.every(({mention:value,operator,index})=>{
    const approximate=isApproximateNumericClaim(claim,index);
    const matchesEvidence=cited.some(({mention:evidence,operator:evidenceOperator})=>{
      if(value.dimension!==evidence.dimension||operator!==evidenceOperator)return false;
      if(value.localeAmbiguous||evidence.localeAmbiguous)return value.localeAmbiguous&&evidence.localeAmbiguous&&value.rawValue===evidence.rawValue&&value.factor===evidence.factor;
      const tolerance=Number.EPSILON*Math.max(1,Math.abs(value.value),Math.abs(evidence.value))*8;
      if(Math.abs(value.value-evidence.value)<=tolerance)return true;
      if(!approximate||value.value===0||evidence.value===0)return false;
      // Explicit approximation may use conventional rounding at the displayed
      // precision. Exact-looking numbers still require an exact evidence match.
      const roundingTolerance=0.5*10**(-value.decimalPlaces)*value.factor;
      return Math.abs(value.value-evidence.value)<=roundingTolerance+tolerance;
    });
    const matchesCalculation=calculated.some(result=>{
      if(operator!==null||value.dimension!==result.dimension||value.localeAmbiguous||result.localeAmbiguous)return false;
      // Do not let rounding turn a small non-zero amount into an asserted zero.
      if(value.value===0||result.value===0)return value.value===result.value;
      const roundingTolerance=0.5*10**(-value.decimalPlaces)*value.factor;
      const floatingTolerance=Number.EPSILON*Math.max(1,Math.abs(value.value),Math.abs(result.value))*8;
      return Math.abs(value.value-result.value)<=roundingTolerance+floatingTolerance;
    });
    return matchesEvidence||matchesCalculation;
  });
}

function numericValueAppearsInEvidence(value: number, text: string): boolean {
  return numericMentions(text).some(evidence => {
    if (evidence.localeAmbiguous) {
      return evidence.rawValue.replace(/[.,]/g, '') === value.toString().replace(/[.,]/g, '');
    }
    const tolerance = Number.EPSILON * Math.max(1, Math.abs(value), Math.abs(evidence.value)) * 8;
    return Math.abs(value - evidence.value) <= tolerance;
  });
}
