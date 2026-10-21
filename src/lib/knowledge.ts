import type { EvidenceSource } from './contracts';

/** Curated summaries, not redistributed source documents. Recheck current law live. */
export const corpusVersion = '2026-10-22.2';
// Time the official pages were checked for this seed, not a runtime freshness claim.
const retrievedAt = '2026-10-20T22:07:03.000Z';
const carbohydrateGuidelineRetrievedAt = '2026-10-21T17:14:59.000Z';
const licenseUnverified = 'License terms not independently verified; NutriScan stores an original short summary and source link only.';
const source = (value: Omit<EvidenceSource, 'retrievedAt'|'effectiveAt'> & {retrievedAt?:string}): EvidenceSource => ({ ...value, license: value.license ?? licenseUnverified, retrievedAt: value.retrievedAt ?? retrievedAt, effectiveAt: null });
export const evidenceSources: EvidenceSource[] = [
  source({id:'fssai-advertising-claims-compendium-2022',title:'Food Safety and Standards (Advertising and Claims) Regulations, 2018: Version IV Compendium',publisher:'Food Safety and Standards Authority of India',url:'https://fssai.gov.in/upload/uploadfiles/files/Compendium_Advertising_Claims_Regulations_14_12_2022.pdf',category:'regulation',jurisdiction:'India; dated FSSAI nutrient-content claim reference',publishedAt:'2022-12-14',retrievedAt:'2026-10-22',summary:'The Version IV compendium dated 14 December 2022 lists “rich/high protein” claim criteria as at least 20% of RDA per 100 g for solids, 10% per 100 ml for liquids, 10% per 100 kcal, or 20% per serving. “High/rich fibre” criteria are at least 6 g per 100 g for solids, 3 g per 100 ml for liquids, or 3 g per 100 kcal. “Low sugars” is not more than 5 g per 100 g for solids or 2.5 g per 100 ml for liquids.',limitations:'This is a dated reference for explaining claim wording, not a current legal determination or a product-compliance check. NutriScan does not infer an applicable RDA, classify a product as solid or liquid, validate OCR readings, or determine which basis applies. Exact applicability and current status require review of current official regulations, amendments, directions and product facts.',license:'Official FSSAI compendium; downstream redistribution terms were not independently reviewed. NutriScan stores a concise original summary and links to the source rather than reproducing the PDF.'}),
  source({id:'fssai-advertising-claims-amendment-index',title:'Food Safety and Standards (Advertising and Claims) Regulations: Amendments index',publisher:'Food Safety and Standards Authority of India',url:'https://fssai.gov.in/food-law/regulations/amendments/advertising-claims',category:'regulation',jurisdiction:'India; FSSAI published amendment listing',publishedAt:null,retrievedAt:'2026-10-22',summary:'On 22 October 2026, the FSSAI amendments page listed three amendments to the Advertising and Claims Regulations, dated 9 October 2020, 30 August 2022 and 13 December 2022. The 14 December 2022 Version IV compendium incorporates amendments through the latest listed date.',limitations:'This is a dated snapshot of the published amendment listing, not a consolidated legal text or proof that no later direction, order, enforcement extension or other legal update affects a particular claim. It does not determine current applicability or product compliance.',license:'Official FSSAI index page; terms for downstream redistribution were not independently reviewed. NutriScan stores source metadata and an original short summary with a link.'}),
  source({id:'fssai-labelling-display-2020',title:'Food Safety and Standards (Labelling and Display) Regulations, 2020',publisher:'Food Safety and Standards Authority of India',url:'https://www.fssai.gov.in/upload/notifications/2020/12/5fd87c6a0f6adGazette_Notification_Labelling_Display_14_12_2020.pdf',category:'regulation',jurisdiction:'India; original Gazette notification for packaged-food labelling',publishedAt:'2020-11-17',retrievedAt:'2026-10-21',summary:'Regulation 5(14) provides for a separate “Contains” declaration for specified foods and ingredients known to cause allergy, and states that presence of allergenic ingredients due to cross-contamination may be declared separately as “May Contains”.',limitations:'This is the original Gazette notification, not a current consolidated legal determination. Later amendments, directions, product-specific exceptions and effective dates must be checked live before judging current applicability or compliance. The label wording does not establish a particular package’s contents, allergen amount or exposure, individual risk or safety.',license:'Official Gazette notification; NutriScan stores an original short summary and links to the PDF, without reproducing its text.'}),
  source({id:'fssai-labelling-allergen-faq-2023',title:'FAQ on Food Safety and Standards (Labelling & Display) Regulations, 2020',publisher:'Food Safety and Standards Authority of India',url:'https://fssai.gov.in/upload/uploadfiles/files/FAQ_Labelling_Display_01_11_2023.pdf',category:'regulation',jurisdiction:'India; FSSAI interpretation of packaged-food labelling',publishedAt:'2023-11-01',retrievedAt:'2026-10-21',summary:'FSSAI distinguishes allergenic ingredients declared separately as “Contains [allergen]” from allergen presence due to cross-contamination, which may be declared separately as “May Contains [allergen]”. Its FAQ says the illustrated wording is not exclusive and that wording with a similar meaning may be used, including “May contain traces of [allergen]” or a statement that the product is made in a facility that processes that allergen.',limitations:'This dated FAQ explains label wording; it does not establish that a particular allergen is actually present, its amount or exposure, individual risk or safety, or whether a package complies. Check the current regulation, subsequent amendments or directions, exact product type and circumstances through live official research before making a legal determination.',license:'FSSAI official FAQ; NutriScan stores an original short summary and links to the PDF, without reproducing its text.'}),
  source({id:'who-trans-fat-2024',title:'Trans fat',publisher:'World Health Organization',url:'https://www.who.int/news-room/fact-sheets/detail/trans-fat/',category:'guideline',jurisdiction:'Global; general adult population guidance',publishedAt:'2024-01-24',retrievedAt:'2026-10-22',summary:'WHO describes trans-fatty acids as unsaturated fats from industrial or natural sources. Natural sources include meat and dairy from ruminants; industrial trans fat is often produced by partial hydrogenation. WHO recommends adults limit total trans fat to less than 1% of total energy. Its policy options include a mandatory limit of 2 g industrial trans fat per 100 g total fat in all foods or a mandatory ban on production or use of partially hydrogenated oils.',limitations:'The intake recommendation is population guidance for adults, not an individualized target or package-specific threshold. Label wording or an ingredient mention does not establish trans-fat amount, exposure, or individual suitability. WHO policy options describe general regulatory approaches and do not establish a jurisdiction’s current law or a product’s compliance.',license:'WHO fact sheet; NutriScan stores an original short summary and links to the official page without reproducing its text.'}),
  source({id:'fssai-industrial-trans-fat-2021',title:'Food Safety and Standards (Prohibition and Restrictions on Sales) Second Amendment Regulations, 2021: trans-fat limit',publisher:'Food Safety and Standards Authority of India',url:'https://www.fssai.gov.in/upload/notifications/2021/02/601d00b73657dGazette_Notification_Trans_fat_05_02_2021.pdf',category:'regulation',jurisdiction:'India; dated amendment to the Food Safety and Standards (Prohibition and Restrictions on Sales) Regulations, 2011',publishedAt:'2021-02-02',retrievedAt:'2026-10-22',summary:'The 2021 Gazette amendment addressed food products in which edible oils or fats are used as an ingredient: industrial trans-fatty acids were limited to no more than 2% by mass of the total oils/fats present for products manufactured on or after 1 January 2022. Its definition of industrial trans fatty acids excludes trans fats from dairy, meat, fish and their products.',limitations:'This is a dated amendment, not a current consolidated legal determination. Later amendments or directions, exact product composition and category, jurisdiction, and other applicability conditions must be checked through live official research before judging current law or compliance. It concerns industrial trans fat relative to total oils/fats in the specified product scope; it is not a trans-fat nutrient amount, package-specific result, personal target, or safety finding.',license:'Official Gazette notification; NutriScan stores an original short summary and links to the PDF without reproducing its text.'}),
  source({id:'icmrnin-dgi-2024',title:'Dietary Guidelines for Indians, Revised Edition 2024',publisher:'ICMR-National Institute of Nutrition',url:'https://nin.res.in/dietaryguidelines/pdfjs/locale/DGI_2024.pdf',category:'guideline',jurisdiction:'India; population dietary guidance',publishedAt:'2024-05-08',retrievedAt:'2026-10-21T00:09:42.000Z',summary:'Official ICMR-NIN national dietary-guideline publication. NutriScan stores bibliographic metadata only; consult the linked publication for its recommendations.',limitations:'Population-level dietary guidance, not an individualized prescription, diagnosis, product-specific nutrition finding, or current food-law determination. The publication notice allows personal-use reproduction but requires prior written permission for electronic product use; this app links to the official copy and does not reproduce its contents.',license:'Official publication; reproduction terms require prior written permission for electronic product use.'}),
  source({id:'who-sodium',title:'Sodium reduction',publisher:'World Health Organization',url:'https://www.who.int/news-room/fact-sheets/detail/sodium-reduction',category:'guideline',jurisdiction:'Global; general adult population',publishedAt:'2026-05-11',summary:'WHO recommends adults consume less than 2000 mg sodium daily. One gram of salt corresponds to 400 mg sodium.',limitations:'Population guidance, not an individualized prescription or a product safety threshold. Includes the whole diet.'}),
  source({id:'who-nss',title:'Use of non-sugar sweeteners: WHO guideline',publisher:'World Health Organization',url:'https://www.who.int/publications/i/item/9789240073616',category:'guideline',jurisdiction:'Global; prevention guidance excludes existing diabetes',publishedAt:'2023-05-15',summary:'Conditional recommendation against using non-sugar sweeteners for weight control or prevention of noncommunicable disease. It excludes people with pre-existing diabetes.',limitations:'Not an assessment of additive toxicity, not diabetes treatment guidance, and not a replacement for JECFA intake assessments. No product dose is established.'}),
  source({id:'who-carbohydrate-2023',title:'Carbohydrate intake for adults and children: WHO guideline',publisher:'World Health Organization',url:'https://www.who.int/publications/i/9789240073593',category:'guideline',jurisdiction:'Global; population dietary guidance',publishedAt:'2023-07-17',retrievedAt:carbohydrateGuidelineRetrievedAt,summary:'WHO recommends adults consume at least 25 g/day of naturally occurring dietary fibre and 400 g/day of vegetables and fruits; for children and adolescents it suggests at least 15 g/day at ages 2–5, 21 g/day at ages 6–9, and 25 g/day at ages 10 or older. It recommends that carbohydrate come primarily from whole grains, vegetables, fruits and pulses.',limitations:'Population guidance for whole-diet quality, not a package-specific threshold, individualized prescription, or treatment target. Naturally occurring fibre guidance refers to fibre as consumed in foods and cannot be directly equated with a packaged-food fibre declaration; a single product cannot establish daily diet adequacy.'}),
  source({id:'who-sugars-2015',title:'Guideline: sugars intake for adults and children',publisher:'World Health Organization',url:'https://www.who.int/publications/i/item/9789241549028',category:'guideline',jurisdiction:'Global; population dietary guidance for adults and children',publishedAt:'2015-03-04',retrievedAt:'2026-10-21T11:24:09.000Z',summary:'WHO recommends reducing free sugars to less than 10% of total daily energy for adults and children; 5% or less may provide additional benefit. Free sugars include mono- and disaccharides added by a manufacturer, cook or consumer, and sugars naturally present in honey, syrups, fruit juices and fruit-juice concentrates.',limitations:'This is population guidance for free sugars across the whole diet, not a product threshold, per-serving target or individualized prescription. A package total-sugars reading alone does not establish how much free sugar is in the full diet.',license:'WHO publication; all rights reserved. NutriScan stores an original short summary and links to the official publication; it does not reproduce the source text.'}),
  source({id:'niddk-meals',title:'Healthy Living with Diabetes',publisher:'US National Institute of Diabetes and Digestive and Kidney Diseases',url:'https://www.niddk.nih.gov/health-information/diabetes/overview/healthy-living-with-diabetes',category:'guideline',jurisdiction:'United States; general diabetes education',publishedAt:null,retrievedAt:'2026-10-21',summary:'Carbohydrates can raise blood glucose. Meal amounts and timing depend on medicines, activity and other health conditions. Carb counting and the plate method are planning options; not everyone with diabetes needs to count carbs.',limitations:'General US education, not an Indian dietary composition table, an individualized meal plan, or a fixed carbohydrate allowance. NIDDK says not everyone needs carb counting. Sugar alone does not describe total carbohydrate.'}),
  source({id:'fao-955',title:'GSFA additive identity: Sucralose (955)',publisher:'FAO/WHO Codex Alimentarius',url:'https://www.fao.org/gsfaonline/additives/details.html?id=137',category:'registry',jurisdiction:'International Codex; not national authorization',publishedAt:null,summary:'Sucralose, also called trichlorogalactosucrose, has INS number 955.',limitations:'Identity lookup only. Presence does not establish dose, exposure, safety for an individual, or current Indian permission.'}),
  source({id:'fao-330',title:'JECFA additive specifications: Citric Acid',publisher:'Food and Agriculture Organization',url:'https://www.fao.org/food/food-safety-quality/scientific-advice/jecfa/jecfa-additives/details-simple/en/?ins_id=330',category:'registry',jurisdiction:'International JECFA specifications',publishedAt:null,summary:'Citric acid is identified by INS number 330.',limitations:'Identity and specifications do not establish the amount in a product or national legal status.'}),
  source({id:'fao-621',title:'JECFA additive specifications: Monosodium L-Glutamate',publisher:'Food and Agriculture Organization',url:'https://www.fao.org/food/food-safety-quality/scientific-advice/jecfa/jecfa-additives/detail/pt/c/141/',category:'registry',jurisdiction:'International JECFA specifications',publishedAt:null,summary:'Monosodium L-glutamate has INS number 621; listed synonyms include MSG and sodium glutamate.',limitations:'Identity only. Ingredient occurrence is not a quantitative sodium measurement or an individual safety verdict.'}),
  source({id:'fao-415',title:'Codex GSFA additive index',publisher:'FAO/WHO Codex Alimentarius',url:'https://www.fao.org/gsfaonline/additives/index.html',category:'registry',jurisdiction:'International Codex; not national authorization',publishedAt:null,summary:'Xanthan gum has INS number 415.',limitations:'Identity only. Does not establish product dose or national authorization.'}),
  source({id:'fao-102',title:'Codex GSFA identity: Tartrazine (102)',publisher:'FAO/WHO Codex Alimentarius',url:'https://www.fao.org/gsfaonline/additives/details.html?id=86',category:'registry',jurisdiction:'International Codex; not national authorization',publishedAt:null,retrievedAt:'2026-10-21T16:12:12.000Z',summary:'The current Codex GSFA entry identifies Tartrazine as INS 102, a colour; listed synonyms include FD&C Yellow No. 5.',limitations:'Identity and synonym lookup only. It does not establish national authorization, permitted use in a product category, ingredient presence, amount or individual safety.',license:'FAO/WHO source page; original brief metadata summary only, with no source text reproduced.'}),
  source({id:'fao-202',title:'JECFA additive identity: Potassium Sorbate (202)',publisher:'Food and Agriculture Organization / Joint FAO/WHO Expert Committee on Food Additives',url:'https://www.fao.org/food/food-safety-quality/scientific-advice/jecfa/jecfa-additives/details-simple/en/?ins_id=202',category:'registry',jurisdiction:'International JECFA specifications; not national authorization',publishedAt:null,retrievedAt:'2026-10-21T16:12:12.000Z',summary:'The FAO JECFA entry identifies Potassium Sorbate and links Codex GSFA INS number 202.',limitations:'Identity/specification lookup only. It does not establish ingredient presence, amount, food-category permission in a jurisdiction, current national status or an individual safety conclusion.',license:'FAO/WHO source page; original brief metadata summary only, with no source text reproduced.'}),
  source({id:'fao-211',title:'JECFA additive identity: Sodium Benzoate (211)',publisher:'Food and Agriculture Organization / Joint FAO/WHO Expert Committee on Food Additives',url:'https://www.fao.org/food/food-safety-quality/scientific-advice/jecfa/jecfa-additives/details-simple/en/?ins_id=211',category:'registry',jurisdiction:'International JECFA specifications; not national authorization',publishedAt:null,retrievedAt:'2026-10-21T16:12:12.000Z',summary:'The FAO JECFA entry identifies Sodium Benzoate and links Codex GSFA INS number 211.',limitations:'Identity/specification lookup only. It does not establish ingredient presence, amount, food-category permission in a jurisdiction, current national status or an individual safety conclusion.',license:'FAO/WHO source page; original brief metadata summary only, with no source text reproduced.'}),
  source({id:'fao-385',title:'JECFA additive identity: Calcium Disodium EDTA (385)',publisher:'Food and Agriculture Organization / Joint FAO/WHO Expert Committee on Food Additives',url:'https://www.fao.org/food/food-safety-quality/scientific-advice/jecfa/jecfa-additives/details-simple/en/?ins_id=385',category:'registry',jurisdiction:'International JECFA specifications; not national authorization',publishedAt:null,retrievedAt:'2026-10-21T16:12:12.000Z',summary:'The FAO JECFA entry identifies Calcium Disodium Ethylenediaminetetraacetate and lists calcium disodium edetate and calcium disodium EDTA as synonyms; it links Codex GSFA INS number 385.',limitations:'Identity/specification lookup only. It does not establish ingredient presence, amount, food-category permission in a jurisdiction, current national status or an individual safety conclusion.',license:'FAO/WHO source page; original brief metadata summary only, with no source text reproduced.'}),
];

export const nutrientContentClaimSourceIds=['fssai-advertising-claims-compendium-2022','fssai-advertising-claims-amendment-index'] as const;
export type NutrientContentClaimGuidance = {key:'high-protein'|'high-fibre'|'low-sugars';label:string;criteria:string;pattern:RegExp};
export const nutrientContentClaimGuidance:NutrientContentClaimGuidance[]=[
  {key:'high-protein',label:'rich/high protein',criteria:'at least 20% of RDA per 100 g for solids, 10% per 100 ml for liquids, 10% per 100 kcal, or 20% per serving',pattern:/\b(?:(?:rich\s*\/\s*high|high\s*\/\s*rich|high|rich)(?:[\s/-]+in)?[\s/-]+protein|protein[\s/-]+(?:rich|high))\b/i},
  {key:'high-fibre',label:'high/rich fibre',criteria:'at least 6 g per 100 g for solids, 3 g per 100 ml for liquids, or 3 g per 100 kcal',pattern:/\b(?:(?:high\s+or\s+rich|rich\s*\/\s*high|high\s*\/\s*rich|high|rich)(?:[\s/-]+in)?[\s/-]+(?:dietary[\s/-]+)?fib(?:re|er)|fib(?:re|er)[\s/-]+(?:rich|high))\b/i},
  {key:'low-sugars',label:'low sugars',criteria:'not more than 5 g of sugars per 100 g for solids, or 2.5 g per 100 ml for liquids',pattern:/\blow(?:[\s/-]+in)?[\s/-]+(?:total[\s/-]+)?sugars?\b/i},
];
export function findNutrientContentClaimGuidance(text:string):NutrientContentClaimGuidance[]{
  return nutrientContentClaimGuidance.filter(guidance=>guidance.pattern.test(text));
}

export type AdditiveRecord = { code: string; name: string; aliases: string[]; sourceIds: string[]; note: string };
export const additives: AdditiveRecord[] = [
  {code:'955',name:'Sucralose',aliases:['sucralose','trichlorogalactosucrose'],sourceIds:['fao-955'],note:'Ingredient presence does not reveal dose. The WHO sweetener guideline is prevention guidance and excludes existing diabetes.'},
  {code:'330',name:'Citric acid',aliases:['citric acid'],sourceIds:['fao-330'],note:'Identity resolved; amount and current national permissions are unverified.'},
  {code:'621',name:'Monosodium L-glutamate',aliases:['monosodium l-glutamate','monosodium glutamate','msg','sodium glutamate'],sourceIds:['fao-621'],note:'Identity resolved; do not estimate sodium from its position on the ingredient list.'},
  {code:'415',name:'Xanthan gum',aliases:['xanthan gum'],sourceIds:['fao-415'],note:'Identity resolved; amount and current national permissions are unverified.'},
  {code:'102',name:'Tartrazine',aliases:['tartrazine','fd&c yellow no. 5','fd&c yellow 5'],sourceIds:['fao-102'],note:'Identity and synonym resolved; this is not a finding about local permission, product dose or individual safety.'},
  {code:'202',name:'Potassium Sorbate',aliases:['potassium sorbate'],sourceIds:['fao-202'],note:'Identity resolved; amount and current national permissions are unverified.'},
  {code:'211',name:'Sodium Benzoate',aliases:['sodium benzoate'],sourceIds:['fao-211'],note:'Identity resolved; amount and current national permissions are unverified.'},
  {code:'385',name:'Calcium Disodium EDTA',aliases:['calcium disodium edta','calcium disodium edetate'],sourceIds:['fao-385'],note:'Identity and synonyms resolved; amount and current national permissions are unverified.'},
];
const normal = (s:string) => s.toLowerCase().trim().replace(/[‐–—]/g,'-').replace(/\s+/g,' ');
export function lookupAdditive(query:string): AdditiveRecord | undefined {
  const q = normal(query);
  const code = q.match(/^(?:(?:ins|e)\s*[-:]?\s*)?(\d{3,4}(?:[a-z]|\([ivx]+\))?)$/i)?.[1];
  return additives.find(a => (code && a.code === code) || a.aliases.some(alias=> normal(alias) === q));
}

export type TentativeAdditiveIdentityCandidate = {
  status: 'tentative';
  kind: 'additive-identity-candidate';
  observedText: string;
  code: string;
  name: string;
  matchedAlias: string;
  exactTokens: string[];
  fuzzyTokens: Array<{ observed: string; canonical: string }>;
  sourceIds: string[];
  interpretation: 'possible-identity-only; package-presence-not-established';
  score: number;
  margin: number;
};

const candidateTokens = (value:string):string[] => [...new Set(normal(value).match(/[a-z0-9]{3,}/g) ?? [])];
const canonicalOcrToken = (value:string):string => value.replace(/rn/g,'m');
function withinOneEdit(left:string,right:string):boolean {
  if (Math.abs(left.length-right.length)>1) return false;
  let i=0,j=0,mismatches=0;
  while(i<left.length && j<right.length){
    if(left[i]===right[j]){i++;j++;continue;}
    if(++mismatches>1)return false;
    if(left.length>right.length)i++;
    else if(right.length>left.length)j++;
    else {i++;j++;}
  }
  return mismatches + (i<left.length || j<right.length ? 1 : 0) <= 1;
}

/**
 * Conservatively suggests an additive identity from a noisy multi-token phrase.
 * This is an interpretation candidate only: it never records package presence.
 */
export function resolveTentativeAdditiveIdentity(query:string):TentativeAdditiveIdentityCandidate|undefined {
  if(query.length>160)return undefined;
  const queryTokens=candidateTokens(query);
  if(queryTokens.length<2 || queryTokens.length>8 || lookupAdditive(query))return undefined;

  const sourceIdsAvailable=new Set(evidenceSources.map(item=>item.id));
  const candidates:Array<TentativeAdditiveIdentityCandidate>=[];
  for(const additive of additives){
    const sourceIds=additive.sourceIds.filter(id=>sourceIdsAvailable.has(id));
    if(!sourceIds.length)continue;
    let bestForAdditive:TentativeAdditiveIdentityCandidate|undefined;
    for(const alias of additive.aliases){
      const aliasTokens=candidateTokens(alias);
      if(aliasTokens.length<2)continue;
      const remainingAlias=new Set(aliasTokens);
      const unmatchedQuery=new Set(queryTokens);
      const exactTokens:string[]=[];
      for(const token of queryTokens){
        if(remainingAlias.has(token)){
          exactTokens.push(token);remainingAlias.delete(token);unmatchedQuery.delete(token);
        }
      }
      const fuzzyTokens:Array<{observed:string;canonical:string}>=[];
      if(exactTokens.length<2)continue;
      for(const observed of queryTokens){
        if(!unmatchedQuery.has(observed))continue;
        const normalizedObserved=canonicalOcrToken(observed);
        const match=[...remainingAlias].find(canonical=>{
          if(canonical.length<6 || observed.length<6)return false;
          const normalizedCanonical=canonicalOcrToken(canonical);
          return normalizedObserved===normalizedCanonical || withinOneEdit(normalizedObserved,normalizedCanonical);
        });
        if(match){
          fuzzyTokens.push({observed,canonical:match});
          remainingAlias.delete(match);unmatchedQuery.delete(observed);
          if(fuzzyTokens.length>1)break;
        }
      }
      const matchedCount=exactTokens.length+fuzzyTokens.length;
      const aliasCoverage=matchedCount/aliasTokens.length;
      const queryCoverage=matchedCount/queryTokens.length;
      if(fuzzyTokens.length>1 || aliasCoverage<2/3 || queryCoverage<0.5)continue;
      const score=Number((0.6*aliasCoverage+0.4*queryCoverage-0.15*fuzzyTokens.length).toFixed(4));
      const candidate:TentativeAdditiveIdentityCandidate={
        status:'tentative',kind:'additive-identity-candidate',observedText:query,
        code:additive.code,name:additive.name,matchedAlias:alias,
        exactTokens,fuzzyTokens,sourceIds,
        interpretation:'possible-identity-only; package-presence-not-established',
        score,margin:0,
      };
      if(!bestForAdditive || candidate.score>bestForAdditive.score)bestForAdditive=candidate;
    }
    if(bestForAdditive)candidates.push(bestForAdditive);
  }
  candidates.sort((a,b)=>b.score-a.score);
  const best=candidates[0],runnerUp=candidates[1];
  if(!best || (runnerUp && best.score-runnerUp.score<0.15))return undefined;
  return {...best,margin:Number((best.score-(runnerUp?.score ?? 0)).toFixed(4))};
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
  ['diabetes','diabetic','carbohydrate','carbohydrates','carbs','glucose','sugar','free sugars','added sugars','honey','syrup','fruit juice','meal','dietary intake'],
  ['additive','ins','code','identity','ingredient','ingredients','registry'],
  ['law','legal','regulation','regulatory','india','permission','authorization','ors','current'],
  ['fiber','fibre','whole grain','whole grains','pulses','carbohydrate quality','dietary fiber','dietary fibre','vegetables','fruits'],
  ['allergen','allergens','allergy','allergies','may contain','cross contamination','cross contact','precautionary','contains','fssai'],
  ['trans fat','trans-fat','trans fatty acid','trans-fatty acid','tfa','industrial trans fat','partially hydrogenated','hydrogenated oil','ruminant'],
];
export function embedEvidence(text:string):number[] {
  const t = ` ${normal(text).replace(/[^a-z0-9 -]/g,' ')} `;
  const vector = concepts.map(words=> words.reduce((sum,word)=>sum+(t.includes(` ${word} `)?1:0),0));
  const norm = Math.hypot(...vector) || 1;
  return vector.map(v=>v/norm);
}
const tokens = (s:string) => new Set(normal(s).match(/[a-z0-9]{3,}/g) ?? []);
export type RetrievalHit = {source:EvidenceSource;score:number;semanticScore:number;lexicalScore:number;method:'local-concept-keyword+lexical+exact'|'local-concept-keyword+lexical+exact+tentative-additive-candidate';corpusVersion:string;tentativeAdditiveCandidate?:TentativeAdditiveIdentityCandidate;tentativeCandidateScore?:number};
export function retrieveEvidence(query:string,limit=4):RetrievalHit[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Evidence result limit must be 1–20.');
  if (query.length > 4000) throw new Error('Evidence query is too long.');
  const qv = embedEvidence(query); const qt = tokens(query); const exact = lookupAdditive(query);
  const tentativeAdditive=resolveTentativeAdditiveIdentity(query);
  return evidenceSources.map(s=> {
    const content = `${s.title} ${s.summary} ${s.jurisdiction}`; const sv = embedEvidence(content); const st = tokens(content);
    const semanticScore = qv.reduce((sum,v,i)=>sum+v*sv[i],0);
    const lexicalScore = [...qt].filter(t=>st.has(t)).length / Math.max(1,qt.size);
    const hasTentativeCandidate=tentativeAdditive?.sourceIds.includes(s.id) ?? false;
    const tentativeCandidateScore=hasTentativeCandidate?1:0;
    const score = .55*semanticScore+.45*lexicalScore+(exact?.sourceIds.includes(s.id)?2:0)+tentativeCandidateScore;
    return {source:s,score,semanticScore,lexicalScore,method:hasTentativeCandidate?'local-concept-keyword+lexical+exact+tentative-additive-candidate' as const:'local-concept-keyword+lexical+exact' as const,corpusVersion,...(hasTentativeCandidate?{tentativeAdditiveCandidate:tentativeAdditive,tentativeCandidateScore}:{})};
  }).filter(hit=>hit.score > .05).sort((a,b)=>b.score-a.score).slice(0,limit);
}
