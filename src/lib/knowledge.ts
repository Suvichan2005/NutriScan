import type { EvidenceSource } from './contracts';

/** Curated summaries, not redistributed source documents. Recheck current law live. */
export const corpusVersion = '2026-10-21.4';
// Time the official pages were checked for this seed, not a runtime freshness claim.
const retrievedAt = '2026-10-20T22:07:03.000Z';
const carbohydrateGuidelineRetrievedAt = '2026-10-21T05:27:30.000Z';
const source = (value: Omit<EvidenceSource, 'retrievedAt'|'effectiveAt'> & {retrievedAt?:string}): EvidenceSource => ({ ...value, retrievedAt: value.retrievedAt ?? retrievedAt, effectiveAt: null });
export const evidenceSources: EvidenceSource[] = [
  source({id:'icmrnin-dgi-2024',title:'Dietary Guidelines for Indians, Revised Edition 2024',publisher:'ICMR-National Institute of Nutrition',url:'https://nin.res.in/dietaryguidelines/pdfjs/locale/DGI_2024.pdf',category:'guideline',jurisdiction:'India; population dietary guidance',publishedAt:'2024-05-08',retrievedAt:'2026-10-21T00:09:42.000Z',summary:'Official ICMR-NIN national dietary-guideline publication. NutriScan stores bibliographic metadata only; consult the linked publication for its recommendations.',limitations:'Population-level dietary guidance, not an individualized prescription, diagnosis, product-specific nutrition finding, or current food-law determination. The publication notice allows personal-use reproduction but requires prior written permission for electronic product use; this app links to the official copy and does not reproduce its contents.',license:'Official publication; reproduction terms require prior written permission for electronic product use.'}),
  source({id:'who-sodium',title:'Sodium reduction',publisher:'World Health Organization',url:'https://www.who.int/news-room/fact-sheets/detail/sodium-reduction',category:'guideline',jurisdiction:'Global; general adult population',publishedAt:'2026-05-11',summary:'WHO recommends adults consume less than 2000 mg sodium daily. One gram of salt corresponds to 400 mg sodium.',limitations:'Population guidance, not an individualized prescription or a product safety threshold. Includes the whole diet.'}),
  source({id:'who-nss',title:'Use of non-sugar sweeteners: WHO guideline',publisher:'World Health Organization',url:'https://www.who.int/publications/i/item/9789240073616',category:'guideline',jurisdiction:'Global; prevention guidance excludes existing diabetes',publishedAt:'2023-05-15',summary:'Conditional recommendation against using non-sugar sweeteners for weight control or prevention of noncommunicable disease. It excludes people with pre-existing diabetes.',limitations:'Not an assessment of additive toxicity, not diabetes treatment guidance, and not a replacement for JECFA intake assessments. No product dose is established.'}),
  source({id:'who-carbohydrate-2023',title:'Carbohydrate intake for adults and children: WHO guideline',publisher:'World Health Organization',url:'https://www.who.int/publications/i/9789240073593',category:'guideline',jurisdiction:'Global; population dietary guidance',publishedAt:'2023-07-17',retrievedAt:carbohydrateGuidelineRetrievedAt,summary:'WHO recommends adults consume at least 25 g/day of naturally occurring dietary fibre and 400 g/day of vegetables and fruits; for children it suggests age-group amounts. It recommends that carbohydrate come primarily from whole grains, vegetables, fruits and pulses.',limitations:'Population guidance for whole-diet quality, not a package-specific threshold, individualized prescription, or treatment target. Naturally occurring fibre guidance cannot be directly equated with a packaged-food fibre declaration; a single product cannot establish daily diet adequacy.'}),
  source({id:'niddk-meals',title:'Healthy Living with Diabetes',publisher:'US National Institute of Diabetes and Digestive and Kidney Diseases',url:'https://www.niddk.nih.gov/health-information/diabetes/overview/healthy-living-with-diabetes',category:'guideline',jurisdiction:'United States; general diabetes education',publishedAt:null,retrievedAt:'2026-10-21',summary:'Carbohydrates can raise blood glucose. Meal amounts and timing depend on medicines, activity and other health conditions. Carb counting and the plate method are planning options; not everyone with diabetes needs to count carbs.',limitations:'General US education, not an Indian dietary composition table, an individualized meal plan, or a fixed carbohydrate allowance. NIDDK says not everyone needs carb counting. Sugar alone does not describe total carbohydrate.'}),
  source({id:'fao-955',title:'GSFA additive identity: Sucralose (955)',publisher:'FAO/WHO Codex Alimentarius',url:'https://www.fao.org/gsfaonline/additives/details.html?id=137',category:'registry',jurisdiction:'International Codex; not national authorization',publishedAt:null,summary:'Sucralose, also called trichlorogalactosucrose, has INS number 955.',limitations:'Identity lookup only. Presence does not establish dose, exposure, safety for an individual, or current Indian permission.'}),
  source({id:'fao-330',title:'JECFA additive specifications: Citric Acid',publisher:'Food and Agriculture Organization',url:'https://www.fao.org/food/food-safety-quality/scientific-advice/jecfa/jecfa-additives/details-simple/en/?ins_id=330',category:'registry',jurisdiction:'International JECFA specifications',publishedAt:null,summary:'Citric acid is identified by INS number 330.',limitations:'Identity and specifications do not establish the amount in a product or national legal status.'}),
  source({id:'fao-621',title:'JECFA additive specifications: Monosodium L-Glutamate',publisher:'Food and Agriculture Organization',url:'https://www.fao.org/food/food-safety-quality/scientific-advice/jecfa/jecfa-additives/detail/pt/c/141/',category:'registry',jurisdiction:'International JECFA specifications',publishedAt:null,summary:'Monosodium L-glutamate has INS number 621; listed synonyms include MSG and sodium glutamate.',limitations:'Identity only. Ingredient occurrence is not a quantitative sodium measurement or an individual safety verdict.'}),
  source({id:'fao-415',title:'Codex GSFA additive index',publisher:'FAO/WHO Codex Alimentarius',url:'https://www.fao.org/gsfaonline/additives/index.html',category:'registry',jurisdiction:'International Codex; not national authorization',publishedAt:null,summary:'Xanthan gum has INS number 415.',limitations:'Identity only. Does not establish product dose or national authorization.'}),
];

export type AdditiveRecord = { code: string; name: string; aliases: string[]; sourceIds: string[]; note: string };
export const additives: AdditiveRecord[] = [
  {code:'955',name:'Sucralose',aliases:['sucralose','trichlorogalactosucrose'],sourceIds:['fao-955'],note:'Ingredient presence does not reveal dose. The WHO sweetener guideline is prevention guidance and excludes existing diabetes.'},
  {code:'330',name:'Citric acid',aliases:['citric acid'],sourceIds:['fao-330'],note:'Identity resolved; amount and current national permissions are unverified.'},
  {code:'621',name:'Monosodium L-glutamate',aliases:['monosodium l-glutamate','monosodium glutamate','msg','sodium glutamate'],sourceIds:['fao-621'],note:'Identity resolved; do not estimate sodium from its position on the ingredient list.'},
  {code:'415',name:'Xanthan gum',aliases:['xanthan gum'],sourceIds:['fao-415'],note:'Identity resolved; amount and current national permissions are unverified.'},
];
const normal = (s:string) => s.toLowerCase().trim().replace(/[‐–—]/g,'-').replace(/\s+/g,' ');
export function lookupAdditive(query:string): AdditiveRecord | undefined {
  const q = normal(query);
  const code = q.match(/^(?:(?:ins|e)\s*[-:]?\s*)?(\d{3,4}(?:[a-z]|\([ivx]+\))?)$/i)?.[1];
  return additives.find(a => (code && a.code === code) || a.aliases.some(alias=> normal(alias) === q));
}
export function detectAdditives(text:string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\b(?:INS\s*[-:]?\s*|E\s*[-:]?\s*)(\d{3,4}(?:[a-z]|\([ivx]+\))?)(?![\w])/gi)) found.add(m[1].toLowerCase());
  for (const a of additives) for (const alias of a.aliases) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    if (new RegExp(`\\b${escaped}\\b`,'i').test(text)) found.add(a.code);
  }
  // Bare bracketed codes are accepted only in a declared ingredient section.
  const ingredients = text.match(/ingredients?\s*[:：]([^\n]*(?:\n(?!.*(?:nutrition|allergen|contains|per\s+100|net\s+weight)).*)*)/i)?.[1] ?? '';
  for (const m of ingredients.matchAll(/\((\d{3,4}(?:[a-z]|\([ivx]+\))?)\)/gi)) found.add(m[1].toLowerCase());
  return [...found];
}

// Inspectable, rule-based concept-keyword baseline. These hand-coded keyword
// counts are not learned semantic embeddings. The separate MiniLM index provides
// actual model embeddings; this synchronous baseline keeps local audits usable.
const concepts = [
  ['salt','sodium','hypertension','pressure','salty','blood pressure'],
  ['sweetener','sweeteners','sucralose','nss','955','aspartame','weight','sweetness'],
  ['diabetes','diabetic','carbohydrate','carbohydrates','carbs','glucose','sugar','meal','dietary intake'],
  ['additive','ins','code','identity','ingredient','ingredients','registry'],
  ['law','legal','regulation','regulatory','india','permission','authorization','ors','current'],
  ['fiber','fibre','whole grain','whole grains','pulses','carbohydrate quality','dietary fiber','dietary fibre','vegetables','fruits'],
];
export function embedEvidence(text:string):number[] {
  const t = ` ${normal(text).replace(/[^a-z0-9 -]/g,' ')} `;
  const vector = concepts.map(words=> words.reduce((sum,word)=>sum+(t.includes(` ${word} `)?1:0),0));
  const norm = Math.hypot(...vector) || 1;
  return vector.map(v=>v/norm);
}
const tokens = (s:string) => new Set(normal(s).match(/[a-z0-9]{3,}/g) ?? []);
export type RetrievalHit = {source:EvidenceSource;score:number;semanticScore:number;lexicalScore:number;method:'local-concept-keyword+lexical+exact';corpusVersion:string};
export function retrieveEvidence(query:string,limit=4):RetrievalHit[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Evidence result limit must be 1–20.');
  if (query.length > 4000) throw new Error('Evidence query is too long.');
  const qv = embedEvidence(query); const qt = tokens(query); const exact = lookupAdditive(query);
  return evidenceSources.map(s=> {
    const content = `${s.title} ${s.summary} ${s.jurisdiction}`; const sv = embedEvidence(content); const st = tokens(content);
    const semanticScore = qv.reduce((sum,v,i)=>sum+v*sv[i],0);
    const lexicalScore = [...qt].filter(t=>st.has(t)).length / Math.max(1,qt.size);
    const score = .55*semanticScore+.45*lexicalScore+(exact?.sourceIds.includes(s.id)?2:0);
    return {source:s,score,semanticScore,lexicalScore,method:'local-concept-keyword+lexical+exact' as const,corpusVersion};
  }).filter(hit=>hit.score > .05).sort((a,b)=>b.score-a.score).slice(0,limit);
}
