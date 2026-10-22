import { packageSchema, profileSchema, nutrientKeys, type Audit, type Calculation, type Finding, type Nutrient, type NutrientKey, type PackageData, type Profile } from './contracts';
import { detectAdditives, evidenceSources, findNutrientContentClaimGuidance, lookupAdditive, nutrientContentClaimSourceIds, resolveTentativeAdditiveIdentity, retrieveEvidence } from './knowledge';
import { findDeclaredFoodMentions } from './ingredient-context';

const display:Record<NutrientKey,string>={energy:'Energy',carbohydrate:'Carbohydrate',sugars:'Total sugars',addedSugars:'Added sugars',protein:'Protein',fat:'Fat',saturatedFat:'Saturated fat',fiber:'Fibre',sodium:'Sodium',salt:'Salt'};
const uncertaintyQuestionPattern=/\b(?:what remains uncertain|what(?:'s| is) still uncertain|what is uncertain|what remains unclear|what is unclear|what(?:'s| is) still unclear|what is unknown|what remains unknown|what is not known|what don't we know|what do we not know|what needs checking|what should be checked|what remains to be checked|any uncertainties|what are the uncertainties)\b/i;
const nutrientQuestionPatterns:Record<NutrientKey,RegExp>={
  energy:/\b(?:energy|calories?|kilocalories?|kcal)\b/i,
  carbohydrate:/\b(?:carbohydrates?|carbs?)\b/i,
  sugars:/\b(?<!added\s)(?:total\s+)?sugars?\b/i,
  addedSugars:/\badded\s+sugars?\b/i,
  protein:/\bprotein\b/i,
  fat:/\b(?<!saturated\s)fat\b/i,
  saturatedFat:/\bsaturated(?:\s+fat)?\b/i,
  fiber:/\b(?:fiber|fibre)\b/i,
  sodium:/\bsodium\b/i,
  salt:/\bsalt\b/i,
};
const rounded=(n:number)=>Math.round((n+Number.EPSILON)*10000)/10000;
const amountText=(n:number)=>n!==0&&Math.abs(n)<.0001?'<0.0001':String(rounded(n));
const unique=<T,>(values:T[])=>[...new Set(values)];
function isExplicitlyUnder18(ageGroup:string){
  if(/\b(child(?:ren)?|adolescent|teen(?:ager)?s?|pediatric|paediatric|minor|under\s*18)\b/i.test(ageGroup))return true;
  const range=ageGroup.match(/^\s*(?:age\s*)?(\d{1,2})\s*[-–]\s*(\d{1,2})(?:\s*(?:years?|y\/o|old))?\s*$/i);
  if(range)return Number(range[1])<18;
  const single=ageGroup.match(/^\s*(?:age\s*)?(\d{1,2})(?:\s*(?:years?|y\/o|old))?\s*$/i);
  return !!single&&Number(single[1])<18;
}
const profileText=(p:Profile)=>[p.dietaryPattern&&`Dietary pattern: ${p.dietaryPattern}`,p.avoidedIngredients&&`User-declared ingredients or foods to avoid: ${p.avoidedIngredients}`,p.allergies&&`User-declared food allergies: ${p.allergies}`,p.intolerances&&`User-declared food intolerances: ${p.intolerances}`,p.portionPreferences&&`User portion preferences: ${p.portionPreferences}`,p.healthConsiderations&&`User-declared health considerations: ${p.healthConsiderations}`,p.goals&&`User goals: ${p.goals}`,p.ageGroup&&`Age group: ${p.ageGroup}`,p.sexOrReferenceGroup&&`Reference group: ${p.sexOrReferenceGroup}`,p.country&&`Country: ${p.country}`,p.locality&&`Locality: ${p.locality}`].filter(Boolean).join('\n');
function normalized(n:Nutrient):{value:number;unit:string} {
  if(n.key==='energy')return {value:n.unit==='kJ'?n.value/4.184:n.value,unit:'kcal'};
  if(n.key==='sodium')return {value:n.unit==='g'?n.value*1000:n.value,unit:'mg'};
  return {value:n.unit==='mg'?n.value/1000:n.value,unit:'g'};
}
type Usable = {nutrient:Nutrient;value:number;unit:string;observations:string[]};
function usable(pkg:PackageData,key:NutrientKey,unit:'g'|'ml'):Usable|undefined {
  const rows=pkg.nutrients.filter(n=>n.key===key);
  if(!rows.length||rows.some(n=>n.status==='conflict'||!n.basis||n.basis.unit!==unit))return;
  const first=rows[0]; const norm=normalized(first); const perUnit=norm.value/first.basis!.amount;
  // Differently based declarations must agree after normalization, not by voting.
  if(rows.some(n=>Math.abs(normalized(n).value/n.basis!.amount-perUnit)>Math.max(.000001,Math.abs(perUnit)*.02)))return;
  return {nutrient:first,value:norm.value,unit:norm.unit,observations:unique(rows.flatMap(n=>n.observationIds))};
}

/** Reuses the same package for follow-ups. Pure and local: no hidden network call. */
export function buildAudit(pkgInput:PackageData,portion:number,portionUnit:'g'|'ml',profileInput:Profile,question='What does this label mean for this portion?'):Audit {
  const pkg=packageSchema.parse(pkgInput);const profile=profileSchema.parse(profileInput);
  const observationIds=new Set(pkg.observations.map(o=>o.id));
  if(observationIds.size!==pkg.observations.length)throw new Error('Observation identifiers must be unique.');
  if(pkg.nutrients.some(n=>!n.observationIds.length||n.observationIds.some(id=>!observationIds.has(id))))throw new Error('Every nutrient must point to existing package observations.');
  if(!Number.isFinite(portion)||portion<=0||portion>10000)throw new Error('Choose a portion greater than zero and at most 10,000.');
  if(portionUnit!=='g'&&portionUnit!=='ml')throw new Error('Portion unit must be g or ml.');
  if(typeof question!=='string'||question.length>4000)throw new Error('Question must be at most 4,000 characters.');
  question=question.trim()||'What does this label mean for this portion?';
  const findings:Finding[]=[];const calculations:Calculation[]=[];const sourceIds=new Set<string>();
  const limitations=unique([...pkg.warnings,'Package readings are observations and can contain OCR errors.','This answer uses local rules and calculations; it is not a general conversational model.','No live product, regulator or clinical source was contacted by this local audit.']);
  const packageMarksNutritionValuesApproximate=pkg.warnings.some(warning=>/labels its nutrition values as approximate/i.test(warning));
  const nextQuestions:string[]=[];
  const userContext=profileText(profile);
  const explicitlyUnder18=isExplicitlyUnder18(profile.ageGroup);
  const askedAdditives=detectAdditives(question);
  const asksUncertainty=uncertaintyQuestionPattern.test(question);
  const asksAllergenLabelMeaning=/\b(?:may\s+contain|cross[- ]?(?:contamination|contact)|precautionary allergen)\b/i.test(question)&&/\b(?:mean|meaning|explain|interpret|why|difference|different|according|FSSAI|label|warning)\b/i.test(question);
  const questionClaimGuidance=findNutrientContentClaimGuidance(question);
  const recordedClaimObservations=pkg.observations.filter(observation=>['claim','raw-text-line','ocr-line'].includes(observation.field)&&findNutrientContentClaimGuidance(observation.text).length>0);
  const recordedClaimGuidance=[...new Map(recordedClaimObservations.flatMap(observation=>findNutrientContentClaimGuidance(observation.text)).map(guidance=>[guidance.key,guidance])).values()];
  const genericClaimQuestion=/\b(?:this|shown|package|label|food|nutrient[- ]content)\s+claim\b|\bclaim\b.{0,50}\b(?:mean|meaning|explain|interpret)\b/i.test(question);
  const asksClaimDefinition=/\b(?:mean(?:ing)?|explain|interpret|threshold|criteria|require(?:ment|ments)?|definition|defined)\b|\bwhat\s+(?:is|are)\b/i.test(question);
  const asksNutrientContentClaimMeaning=asksClaimDefinition&&(questionClaimGuidance.length>0||(genericClaimQuestion&&recordedClaimGuidance.length>0));
  const relevantClaimGuidance=[...new Map([...(questionClaimGuidance.length?questionClaimGuidance:[]),...(genericClaimQuestion?recordedClaimGuidance:[])].map(guidance=>[guidance.key,guidance])).values()];
  const asksNutrientClaimCompliance=relevantClaimGuidance.length>0&&/\b(?:compliance|compliant|meet|meets|satisfy|satisfies|pass|passes|comply|complies|legal|permitted|allowed)\b/i.test(question);
  const transFatTopic=/\btrans[\s-]?fats?(?:ty)?(?:[\s-]+acids?)?\b|\bTFAs?\b|\bpartially[\s-]+hydrogenated\b/i.test(question);
  const asksCurrentRegulatoryStatus=/\b(?:today|current(?:ly)?|compliance|compliant|legally required|mandatory|must|enforc|is it legal|legal to|lawful|permitted|allowed)\b/i.test(question);
  const mentionsCurrentRegulatoryTopic=/\bORS\b|oral rehydration|legal|regulat|recall|banned|licen[cs]e|current/i.test(question);
  const asksCurrentTransFatLaw=/\bcurrent(?:ly)?\s+(?:(?:fssai|indian|food)\s+)?(?:law|rules?|regulations?|legal|compliance|applicability|limits?)\b|\b(?:fssai|law|rules?|regulations?|compliance|applicab\w*|permitted|allowed)\b.{0,80}\b(?:current|currently|today|now|still)\b|\b(?:current|currently|today|now|still)\b.{0,100}\b(?:law|rules?|regulations?|legal|lawful|compliant|comply|compliance|applicab\w*|permitted|allowed|limit)\b|\b(?:is|are|does|do|can)\b.{0,100}\b(?:legal|lawful|compliant|comply|permitted|allowed|applicable|applies?)\b/i.test(question);
  const currentClaimQuestion=asksCurrentRegulatoryStatus||(relevantClaimGuidance.length>0&&/\b(?:current(?:ly)?|today|now|still)\b/i.test(question));
  const currentRegulatoryQuestion=transFatTopic?asksCurrentTransFatLaw:(mentionsCurrentRegulatoryTopic||/\bfssai\b/i.test(question))&&(!asksAllergenLabelMeaning||asksCurrentRegulatoryStatus)&&(!asksNutrientContentClaimMeaning||currentClaimQuestion);
  const wholeDietCarbohydrateTopic=/\b(?:fib(?:er|re)|whole[- ]grains?|pulses?|legumes?|carbohydrate quality|quality of carbohydrates?)\b/i.test(question);
  const wholeDietCarbohydrateGuidance=wholeDietCarbohydrateTopic&&/\b(?:recommend\w*|guidelines?|guidance|whole[- ]diet|daily|per day|intake|quality)\b/i.test(question);
  const deep=/diet|allerg|intoler|may\s+contain|cross[- ]?(?:contamination|contact)|precautionary|health|daily|safe|reasonable|sucralose|sweetener|ORS|regulat|legal|recall|brand|reviews?|alternativ|sodium|salt|blood pressure|hypertension|diabetes|carbohydrate|\bcarbs\b|sugar claim|\bfree sugars?\b|\badded sugars?\b|ICMR|\bNIN\b/i.test(question)||transFatTopic||wholeDietCarbohydrateGuidance||(/label|mean|audit|suitab/i.test(question)&&!!userContext);
  const trace:Audit['trace']=[{tool:'reuse_package_observations',reason:'Use the current label evidence for this question; no rescan required.',status:`${pkg.observations.length} observations`},{tool:'calculate_portions',reason:'Scale only unambiguous values with compatible explicit bases.',status:'local deterministic calculation'}];
  const finding=(data:Omit<Finding,'id'>)=> {data.sourceIds.forEach(s=>sourceIds.add(s));findings.push({...data,id:`finding-${findings.length+1}`});};
  const nutrientClaimEvidence=(topics:typeof questionClaimGuidance)=>{
    const keys=new Set(topics.map(topic=>topic.key));
    const rows=recordedClaimObservations.filter(observation=>findNutrientContentClaimGuidance(observation.text).some(topic=>keys.has(topic.key)));
    const literalContext=rows.length
      ?` The package record contains ${unique(rows.slice(0,4).map(observation=>`“${observation.text.slice(0,200)}${observation.text.length>200?'…':''}” (${observation.origin==='ocr'?'OCR observation':observation.origin==='user'?'user-entered observation':'recorded observation'})`)).join('; ')}. These are unverified observations and may be misread or transcribed incorrectly.`
      :' No matching claim wording is retained in the package observations; this is a general explanation and does not establish that this package makes the claim.';
    const criteria=topics.map(topic=>`${topic.label}: ${topic.criteria}.`).join(' ');
    const rdaContext=topics.some(topic=>topic.key==='high-protein')?' The protein criteria use RDA percentages; this audit does not infer an applicable RDA or reference group.':'';
    const detail=`FSSAI’s Version IV Advertising and Claims compendium, dated 14 December 2022, lists these generic nutrient-content claim criteria: ${criteria}${literalContext}${rdaContext} The FSSAI amendment index checked on 22 October 2026 lists three amendments, with the latest dated 13 December 2022. This dated reference does not establish current legal status. It also does not determine which product basis applies, classify the food, verify OCR accuracy, or establish whether the product makes or meets the claim.`;
    return {rows,detail};
  };
  const addNutrientClaimFinding=(topics:typeof questionClaimGuidance,title='FSSAI nutrient-content claim wording (dated reference)')=>{
    const evidence=nutrientClaimEvidence(topics);
    finding({title,detail:evidence.detail,status:evidence.rows.length?'uncertain':'context',observationIds:unique(evidence.rows.map(observation=>observation.id)),sourceIds:[...nutrientContentClaimSourceIds],calculationIds:[]});
    return evidence;
  };
  let examinedRawOcrLines=0;let tentativeAdditiveCount=0;
  for(const observation of pkg.observations){
    if(observation.field!=='ocr-line'||observation.origin!=='ocr')continue;
    if(examinedRawOcrLines>=32)break;
    examinedRawOcrLines++;
    // Evaluate the complete, bounded raw line; never truncate a longer line
    // into a misleading prefix that could look like an exact identity phrase.
    if(observation.text.length>160||/[\r\n]/.test(observation.text))continue;
    const candidate=resolveTentativeAdditiveIdentity(observation.text);
    if(!candidate)continue;
    const lineTokenCount=new Set(observation.text.toLowerCase().match(/[a-z0-9]{3,}/g)??[]).size;
    const matchedTokenCount=candidate.exactTokens.length+candidate.fuzzyTokens.length;
    // Reject matches embedded in unrelated line prefixes/suffixes. The
    // resolver's own phrase threshold remains useful for direct queries;
    // package observations require near-complete coverage of the OCR line.
    if(lineTokenCount<2||matchedTokenCount/lineTokenCount<0.8)continue;
    const sourceIds=candidate.sourceIds.filter(id=>evidenceSources.some(item=>item.id===id&&item.category==='registry'));
    if(!sourceIds.length)continue;
    tentativeAdditiveCount++;
    finding({
      title:`Tentative additive identity candidate: INS ${candidate.code} ${candidate.name}`,
      detail:`The original OCR line ${JSON.stringify(observation.text)} may be a noisy reading of ${candidate.name} (INS ${candidate.code}), based on the token match and linked identity source. This is a tentative identity only; it does not confirm that this ingredient or code is present on the package. Check the original label before relying on it.`,
      status:'uncertain',observationIds:[observation.id],sourceIds,calculationIds:[],
    });
  }
  if(examinedRawOcrLines)trace.push({tool:'resolve_tentative_additive_identity',reason:'Inspect only the first 32 raw OCR-line observations, evaluating complete lines up to 160 characters; candidate identity never changes package facts.',status:`${tentativeAdditiveCount} source-backed tentative candidate(s) from ${examinedRawOcrLines} bounded OCR line(s)`});
  if(pkg.userDescription){
    const descriptionIds=pkg.observations.filter(o=>o.field==='user-description').map(o=>o.id);
    finding({title:'User-provided product details',detail:`${pkg.userDescription} These details were supplied by the user and have not been verified against the package or an external product record.`,status:'context',observationIds:descriptionIds,sourceIds:[],calculationIds:[]});
    limitations.push('User-provided product details are unverified context, not package-label evidence.');
  }
  const ingredientEvidence=pkg.observations.filter(o=>o.field==='ingredients'||o.field==='allergens').map(o=>o.id);
  for(const mention of findDeclaredFoodMentions(pkg,profile)){
    const labelTextPresent=pkg.ingredients.length>0||pkg.allergens.length>0;
    const kind=mention.kind==='allergy'?'Food allergy':mention.kind==='intolerance'?'Food intolerance':'Avoided ingredient';
    const evidenceLabels={
      'ingredient-list':'ingredient-list wording',
      'contains-declaration':'a Contains declaration',
      'precautionary-cross-contact':'May-contain precautionary wording',
      'other-allergen-statement':'other allergen-statement wording',
    } as const;
    const matchingEvidence=mention.evidence.map(item=>`${evidenceLabels[item.type]}: ${JSON.stringify(item.text)}`);
    const categories=unique(mention.evidence.map(item=>evidenceLabels[item.type]));
    const hasPrecautionaryWording=mention.evidence.some(item=>item.type==='precautionary-cross-contact');
    const detail=mention.matched
      ?`A literal match for “${mention.term}” appears in ${categories.join(' and ')}. Exact recorded line${matchingEvidence.length===1?'':'s'}: ${matchingEvidence.join('; ')}. ${hasPrecautionaryWording?'The “May contain” category describes precautionary cross-contact wording only; it does not confirm that an allergen is present.':'No matching “May contain” line for this term appears among these retained observations, which does not rule out cross-contact.'} These are unverified package-reading observations, not verified composition. This is not a medical determination or individual-safety assessment and does not establish actual allergen presence, amount or exposure, individual risk or safety; inspect the original label.`
      :labelTextPresent
        ?`No direct text match for “${mention.term}” was found in the extracted ingredient/allergen wording. Synonyms, derivatives, OCR omissions and cross-contact are not checked; this is not a safety clearance.`
        :'No readable ingredient/allergen wording is available to compare with “'+mention.term+'”. Its absence from the extraction is not evidence that it is absent from the product.';
    finding({title:`${kind}: ${mention.matched?'literal mention':'not established'}`,detail,status:'uncertain',observationIds:mention.observationIds.length?mention.observationIds:ingredientEvidence,sourceIds:[],calculationIds:[]});
  }
  const candidates=new Map<NutrientKey,Usable>();
  for(const key of nutrientKeys){const candidate=usable(pkg,key,portionUnit);if(candidate)candidates.set(key,candidate);}
  const salt=candidates.get('salt');const sodium=candidates.get('sodium');
  if(salt&&sodium){
    const saltPerUnit=salt.value/salt.nutrient.basis!.amount;
    const sodiumPerUnit=sodium.value/sodium.nutrient.basis!.amount;
    if(Math.abs(saltPerUnit*400-sodiumPerUnit)>Math.max(.1,sodiumPerUnit*.05)){
      candidates.delete('salt');candidates.delete('sodium');
      finding({title:'Salt and sodium disagree',detail:'The declared salt and sodium values do not agree using 1 g salt ≈ 400 mg sodium. Both are preserved and withheld from portion calculations until checked.',status:'conflict',observationIds:unique([...salt.observations,...sodium.observations]),sourceIds:['who-sodium'],calculationIds:[]});
    }
  }
  // Validate the reported hierarchy before exposing any scaled sugar totals.
  const sugarRow=candidates.get('sugars');const carbRow=candidates.get('carbohydrate');const addedRow=candidates.get('addedSugars');
  const sugarConflict=(sugarRow&&carbRow&&sugarRow.value/sugarRow.nutrient.basis!.amount>carbRow.value/carbRow.nutrient.basis!.amount+.001)||(addedRow&&sugarRow&&addedRow.value/addedRow.nutrient.basis!.amount>sugarRow.value/sugarRow.nutrient.basis!.amount+.001);
  if(sugarConflict){
    const conflictingRows=[sugarRow,carbRow,addedRow].filter((r):r is Usable=>!!r);
    for(const row of conflictingRows)candidates.delete(row.nutrient.key);
    finding({title:'Nutrition totals disagree',detail:'The declared sugar/carbohydrate hierarchy is inconsistent on a common basis. The affected values remain in the label evidence, but their calculations are withheld pending a visual check.',status:'conflict',observationIds:unique(conflictingRows.flatMap(r=>r.observations)),sourceIds:[],calculationIds:[]});
  }
  for(const [key,candidate] of candidates){
    if(candidate.nutrient.basis!.unit==='g'&&key!=='energy'&&candidate.value/(key==='sodium'?1000:1)>candidate.nutrient.basis!.amount+.001){
      candidates.delete(key);
      finding({title:`${display[key]} exceeds the labelled food mass`,detail:'This reading is physically inconsistent with the stated gram basis. The value is preserved and its portion calculation is withheld.',status:'conflict',observationIds:candidate.observations,sourceIds:[],calculationIds:[]});
    }
  }
  for(const key of nutrientKeys){
    const rows=pkg.nutrients.filter(n=>n.key===key);const candidate=candidates.get(key);
    if(!candidate){
      if(rows.length&&!findings.some(f=>f.status==='conflict'&&rows.some(n=>n.observationIds.some(id=>f.observationIds.includes(id)))))finding({title:`${display[key]} needs confirmation`,detail:'A conflict, missing basis or incompatible mass/volume unit prevents a reliable portion calculation. All original readings remain in the label evidence.',status:rows.some(n=>n.status==='conflict')?'conflict':'uncertain',observationIds:unique(rows.flatMap(n=>n.observationIds)),sourceIds:[],calculationIds:[]});
      continue;
    }
    const n=candidate.nutrient;
    const result=candidate.value*portion/n.basis!.amount;
    const readingAssumption=packageMarksNutritionValuesApproximate
      ?'The package labels its nutrition values as approximate; this calculation scales the printed reading as an estimate. NutriScan has not independently verified the reading or basis.'
      :'This calculation assumes the displayed reading and basis are accurate; NutriScan has not independently verified either.';
    const calc:Calculation={id:`calc-${key}`,label:`${display[key]} in ${portion} ${portionUnit}`,nutrient:key,input:candidate.value,inputUnit:candidate.unit,basisAmount:n.basis!.amount,portion,portionUnit,result,unit:candidate.unit,formula:`${candidate.value} ${candidate.unit} × ${portion} ${portionUnit} ÷ ${n.basis!.amount} ${n.basis!.unit}`,observationIds:candidate.observations,assumptions:[readingAssumption,'The portion is assumed to have the same composition as the labelled product.']};
    calculations.push(calc);
    finding({title:calc.label,detail:`${rounded(result)} ${candidate.unit}, calculated from the printed ${n.basis!.description}.`,status:'calculated',observationIds:calc.observationIds,sourceIds:[],calculationIds:[calc.id]});
  }
  // Convert rather than double-counting when only one of salt/sodium is declared.
  if(!candidates.has('sodium')&&candidates.has('salt')&&!pkg.nutrients.some(n=>n.key==='sodium')){
    const saltCalc=calculations.find(c=>c.nutrient==='salt')!;
    const converted:Calculation={...saltCalc,id:'calc-sodium-from-salt',label:'Sodium equivalent from declared salt',nutrient:'sodium',input:saltCalc.input*400,inputUnit:'mg',result:saltCalc.result*400,unit:'mg',formula:`${saltCalc.input} g salt × ${portion} ÷ ${saltCalc.basisAmount} × 400 mg sodium per g salt`,assumptions:[...saltCalc.assumptions,'Salt-to-sodium conversion is approximate.']};
    calculations.push(converted);
    finding({title:converted.label,detail:`Approximately ${amountText(converted.result)} mg sodium for this portion. Derived from salt, not a separate measured sodium value.`,status:'calculated',observationIds:converted.observationIds,sourceIds:['who-sodium'],calculationIds:[saltCalc.id,converted.id]});
  }
  const asksSaltAmount=/\bsalt\b/i.test(question)&&/\b(?:how much|amount|equivalent|convert|compare|contain|in this|per serving|per portion)\b/i.test(question);
  if(asksSaltAmount&&!pkg.nutrients.some(n=>n.key==='salt')&&candidates.has('sodium')){
    const sodiumCalc=calculations.find(c=>c.nutrient==='sodium');
    if(sodiumCalc){
      const converted:Calculation={...sodiumCalc,id:'calc-salt-from-sodium',label:`Approximate salt equivalent in ${portion} ${portionUnit}`,nutrient:'salt',input:sodiumCalc.input,inputUnit:'mg',result:sodiumCalc.result/400,unit:'g',formula:`${sodiumCalc.input} mg sodium × ${portion} ${portionUnit} ÷ ${sodiumCalc.basisAmount} ${sodiumCalc.portionUnit} ÷ 400 mg sodium per g salt`,assumptions:[...sodiumCalc.assumptions,'WHO reports approximately 400 mg sodium per gram of salt; this is an approximate salt equivalent, not a declared salt amount.']};
      calculations.push(converted);
      finding({title:'Approximate salt equivalent from declared sodium',detail:`Approximately ${amountText(converted.result)} g salt equivalent for this portion, calculated from the declared sodium value. This is not a printed salt declaration.`,status:'calculated',observationIds:converted.observationIds,sourceIds:['who-sodium'],calculationIds:[sodiumCalc.id,converted.id]});
    }
  }
  const sodiumCalc=calculations.find(c=>c.nutrient==='sodium');
  if(sodiumCalc&&deep&&explicitlyUnder18){
    finding({title:'Adult sodium reference not applied',detail:'The profile identifies an under-18 age group, so this audit does not apply a general-adult sodium reference. The package-derived amount remains available; age-appropriate guidance requires a source for the relevant age and jurisdiction.',status:'context',observationIds:sodiumCalc.observationIds,sourceIds:['who-sodium'],calculationIds:[sodiumCalc.id]});
    limitations.push('A general-adult population reference was withheld because the declared age group is under 18; no pediatric sodium target was inferred.');
    nextQuestions.push('Which age-specific official guidance or clinician-provided target should be used for this context?');
  }else if(sodiumCalc&&deep){
    finding({title:'Put sodium in a whole-day context',detail:`This portion supplies ${amountText(sodiumCalc.result)} mg sodium, approximately ${amountText(sodiumCalc.result/2000*100)}% of the WHO general adult reference of 2,000 mg/day. WHO recommends less than that amount. This is not a personal sodium allowance or a product safety cutoff.`,status:'context',observationIds:sodiumCalc.observationIds,sourceIds:['who-sodium'],calculationIds:[sodiumCalc.id]});
  }
  const sugars=calculations.find(c=>c.nutrient==='sugars'); const carbs=calculations.find(c=>c.nutrient==='carbohydrate');
  for(const code of unique([...pkg.additives,...askedAdditives])){
    const additive=lookupAdditive(code);const obs=pkg.observations.filter(o=>o.field===`additive:${code}`).map(o=>o.id);
    if(additive)finding({title:`INS ${code}: ${additive.name}`,detail:additive.note,status:'context',observationIds:obs,sourceIds:additive.sourceIds,calculationIds:[]});
    else if(obs.length)finding({title:`INS ${code}: identity unresolved`,detail:'This code is outside the small local identity corpus. It requires an exact authoritative lookup; no risk classification has been assigned.',status:'uncertain',observationIds:obs,sourceIds:[],calculationIds:[]});
  }
  if(pkg.additives.length)trace.push({tool:'lookup_additive',reason:'Resolve exact INS codes and aliases before considering evidence applicability.',status:`${pkg.additives.length} declarations examined locally`});
  if(pkg.additives.includes('955')||/sweetener|sucralose/i.test(question))finding({title:'Sweetener guidance has a defined scope',detail:'WHO’s conditional 2023 recommendation concerns weight control and prevention of noncommunicable disease. It excludes people with existing diabetes and is not a toxicological safety assessment. Ingredient presence provides no dose for an exposure calculation.',status:'context',observationIds:pkg.observations.filter(o=>o.field==='additive:955').map(o=>o.id),sourceIds:['who-nss'],calculationIds:[]});
  if(/sugar[ -]free|no added sugar|sugar claim/i.test(question))finding({title:'Sugar-free does not establish zero carbohydrate',detail:carbs?`The selected portion still has ${amountText(carbs.result)} g total carbohydrate in the label reading. Evaluate that total separately from sugar claims.`:'Total carbohydrate is not established for this portion. A sugar claim alone cannot fill that missing value.',status:carbs?'calculated':'context',observationIds:unique([...pkg.observations.filter(o=>o.field==='claim').map(o=>o.id),...(carbs?.observationIds??[])]),sourceIds:['niddk-meals'],calculationIds:carbs?[carbs.id]:[]});
  const personalSuitability=/\b(safe|suitable|can i eat|should i eat|fit for me|for my|my diet|allerg|intoler)\b/i.test(question);
  const dietRelevant=personalSuitability&&!!userContext;
  if(personalSuitability&&userContext){
    if(profile.allergies)nextQuestions.push('Which exact allergen should I check against the label and its cross-contact wording?');
    if(profile.intolerances)nextQuestions.push('Which ingredient or declared amount should I compare with your stated intolerance?');
    limitations.push('Personal suitability is not established by a label calculation; only the context you chose to provide was considered.');
  }
  if(currentRegulatoryQuestion||/\bORS\b|oral rehydration|legal|regulat|recall|banned|licen[cs]e|current/i.test(pkg.claims.join(' '))){
    limitations.push('Current regulatory status requires dated official documents, exact product/jurisdiction matching, and checks for later orders. Static corpus entries do not establish current law.');
    nextQuestions.push('Which exact product/variant and jurisdiction should be checked against current official notices?');
    trace.push({tool:'check_regulatory_updates',reason:'The question depends on current official documents and later orders.',status:'live research required; not performed locally'});
  }
  if(/alternativ|stock|available|reviews?|brand|controvers/i.test(question)){
    limitations.push('Local stock, reviews and brand events were not researched; no alternatives or universal brand score have been invented.');
    trace.push({tool:'research_product_context',reason:'Current product identity and location-qualified evidence are needed.',status:'live research required; not performed locally'});
  }
  if(deep){
    const hits=retrieveEvidence(`${question} ${pkg.additives.join(' ')}`,5);
    const intentSources = [
      {id:'who-sodium',matches:/\b(sodium|salt|salty|hypertension|blood pressure)\b/i.test(question)},
      {id:'who-nss',matches:/\b(sweeteners?|sucralose|aspartame|non[- ]sugar|nss)\b/i.test(question)},
      {id:'who-sugars-2015',matches:/\b(?:free|added) sugars?\b|\bsugars?\b.{0,30}\bfree\b|\b(?:honey|syrups?|fruit juice|fruit juice concentrate)\b|\bWHO\b.{0,40}\bsugars?\b/i.test(question)},
      {id:'who-carbohydrate-2023',matches:wholeDietCarbohydrateGuidance},
      {id:'niddk-meals',matches:/\b(diabetes|diabetic|blood[- ]glucose)\b/i.test(question)},
      {id:'icmrnin-dgi-2024',matches:/\b(icmr|nin|indian dietary guidelines?|dietary guidelines? for india)\b/i.test(question)},
      {id:'fssai-labelling-display-2020',matches:asksAllergenLabelMeaning||(/\bfssai\b/i.test(question)&&/allerg|may\s+contain|cross[- ]?(?:contamination|contact)/i.test(question))},
      {id:'fssai-labelling-allergen-faq-2023',matches:asksAllergenLabelMeaning||(/\bfssai\b/i.test(question)&&/allerg|may\s+contain|cross[- ]?(?:contamination|contact)/i.test(question))},
      {id:'who-trans-fat-2024',matches:transFatTopic},
      {id:'fssai-industrial-trans-fat-2021',matches:transFatTopic},
    ];
    const candidateIds=new Set(intentSources.filter(x=>x.matches).map(x=>x.id));
    for(const code of askedAdditives){const additive=lookupAdditive(code);for(const id of additive?.sourceIds??[])candidateIds.add(id);}
    const candidates=hits.filter(hit=>candidateIds.has(hit.source.id)).slice(0,3);
    for(const {source} of candidates){
      if(transFatTopic&&(source.id==='who-trans-fat-2024'||source.id==='fssai-industrial-trans-fat-2021'))continue;
      if(sourceIds.has(source.id))continue;
      finding({title:`Reference to inspect: ${source.title}`,detail:`${source.summary} The local match is a navigation aid, not proof that this source applies to your question. ${source.limitations}`,status:'context',observationIds:[],sourceIds:[source.id],calculationIds:[]});
    }
    trace.push({tool:'retrieve_evidence',reason:'Select locally stored source context relevant to the question.',status:`${hits.length} local keyword baseline hits; applicability checked by explicit rules. Learned MiniLM retrieval is available separately.`});
  }else trace.push({tool:'intent_router',reason:'A simple quantity question is answerable from label arithmetic.',status:'quick path; no external research selected'});
  if(findings.some(f=>f.status==='conflict'||f.status==='uncertain')||!calculations.length)trace.push({tool:'inspect_image',reason:'A decisive label value or basis is unresolved; the image or a targeted crop can clarify it.',status:'suggested; remote vision requires explicit disclosure and consent'});
  if(pkg.synthetic)limitations.unshift('Synthetic example data: this audit does not demonstrate real-photo OCR or provider acceptance.');
  const primary=[carbs,sugars,sodiumCalc].filter((c):c is Calculation=>!!c);
  const overview=primary.length?primary:calculations.slice(0,3);
  const important=overview.map(c=>`${amountText(c.result)} ${c.unit} ${display[c.nutrient].toLowerCase()}`);
  const conflict=findings.some(f=>f.status==='conflict');
  const asksDiabetesCarbohydrateAmount=/\b(diabetes|diabetic|blood glucose)\b/i.test(question)&&/\b(carbs?|carbohydrates?)\b/i.test(question)&&/\b(daily|day|amount|how many|how much|allowance|target)\b/i.test(question);
  let answer=important.length?`For ${amountText(portion)} ${portionUnit}: ${important.join(', ')} from the readable label values.`:`A reliable ${amountText(portion)} ${portionUnit} calculation needs readable nutrient amounts, units and a matching basis.`;
  let answerIntent='label overview';
  if(currentRegulatoryQuestion){
    answerIntent='current regulatory question';answer='Current legal or regulatory status is unresolved. The next evidence is a dated official notice for the exact product and jurisdiction, checked for later amendments or orders.';
    if(relevantClaimGuidance.length){
      addNutrientClaimFinding(relevantClaimGuidance);
      answer+=' A dated FSSAI claim reference is linked below, but it does not establish current applicability or compliance.';
      trace.push({tool:'explain_nutrient_content_claim',reason:'Attach dated FSSAI claim context without treating the local corpus as current law.',status:'current applicability unresolved; live official research required'});
    }
  }else if(transFatTopic){
    answerIntent='trans-fat evidence and label observation';
    const transFatLinePattern=/\btrans[\s-]?fats?(?:ty)?(?:[\s-]+acids?)?\b|\bTFAs?\b|\bpartially[\s-]+hydrogenated\b|\bhydrogenated[\s-]+(?:vegetable[\s-]+)?oils?\b/i;
    const labelRows=pkg.observations.filter(observation=>(observation.origin==='ocr'||observation.origin==='user')&&transFatLinePattern.test(observation.text));
    const shownRows=labelRows.slice(0,3);
    const recordedText=shownRows.map(observation=>{
      const provenance=observation.origin==='user'?'user-entered observation':`OCR observation${observation.confidence===null?'':` (${amountText(observation.confidence)}% recognition confidence)`}`;
      return `“${observation.text.slice(0,240)}${observation.text.length>240?'…':''}” (${provenance})`;
    });
    const omittedLabelRows=labelRows.length>shownRows.length;
    const observationContext=recordedText.length
      ?` Recorded label text: ${recordedText.join('; ')}.${omittedLabelRows?' Additional matching observations are linked in the finding.':''} These are literal package-reading observations, not verified facts. Trans fat is not a supported structured nutrient in this local parser, so the text does not establish a numeric amount, zero, or a portion calculation.`
      :' No literal trans-fat-related line is retained in this scan’s OCR or user observations. That does not establish absence or zero. Trans fat is not a supported structured nutrient in this local parser, so no numeric amount or portion calculation is available.';
    const historicalContext='WHO describes trans-fatty acids as coming from industrial or natural sources, including naturally occurring trans fat in ruminant meat and dairy. Its recommendation that adults keep total trans fat below 1% of total energy is population guidance, not a personal target; its policy options include a limit of 2 g industrial trans fat per 100 g total fat or a ban on partially hydrogenated oils. FSSAI’s 2021 Gazette amendment addressed products using edible oils or fats as ingredients: no more than 2% industrial trans fat by mass of total oils/fats for products manufactured on or after 1 January 2022, with dairy, meat, fish and their products excluded from its industrial-TFA definition. This dated rule summary does not determine current law or this product’s compliance.';
    answer=`${historicalContext}${observationContext}`;
    const sourceIdsForTopic=['who-trans-fat-2024','fssai-industrial-trans-fat-2021'];
    finding({title:'Trans-fat context and recorded label text',detail:`${historicalContext}${observationContext}`,status:labelRows.length?'uncertain':'context',observationIds:unique(labelRows.map(observation=>observation.id)),sourceIds:sourceIdsForTopic,calculationIds:[]});
    limitations.push('Trans fat is not a supported structured nutrient in this local parser; a literal OCR or user-entered line remains an unverified observation and is not converted into an amount or portion calculation.');
    limitations.push('The FSSAI summary is the dated 2021 Gazette amendment, not a determination of current law, exact product applicability, or compliance.');
  }else if(/alternativ|stock|available|reviews?|brand|controvers/i.test(question)){
    answerIntent='current product context';answer='This local audit has not checked current alternatives, stock, reviews or brand events. A current source matching the product and your location is the decisive next evidence.';
  }else if(asksAllergenLabelMeaning){
    answerIntent='precautionary allergen label wording';answer='FSSAI distinguishes a separate “Contains [allergen]” declaration for specified allergenic ingredients from a separate “May Contains [allergen]” declaration for allergen presence due to cross-contamination. Its FAQ says similar-meaning wording may also be used, such as “May contain traces of [allergen]” or a statement that the product is made in a facility that processes it. This explains label wording only: it does not establish actual allergen presence, amount or exposure, individual risk or safety, or package compliance. Current applicability to an exact package requires live checking of official regulations and later directions.';
  }else if(asksNutrientClaimCompliance){
    answerIntent='nutrient-content claim applicability';
    const evidence=addNutrientClaimFinding(relevantClaimGuidance);
    answer=`This local audit does not determine whether the package qualifies for or complies with the claim. ${relevantClaimGuidance.map(topic=>`${topic.label}: ${topic.criteria}.`).join(' ')}${evidence.rows.length?' The linked package text is an unverified reading, not a verified nutrient value or compliance result.':' No matching claim line is retained in this package record.'} The applicable basis, product facts and current regulatory status require independent official review.`;
    limitations.push('Nutrient-content claim explanations do not determine whether a package meets claim criteria or current legal requirements.');
    trace.push({tool:'explain_nutrient_content_claim',reason:'Provide generic criteria while withholding a package-compliance decision.',status:'no product-compliance classification'});
  }else if(asksNutrientContentClaimMeaning){
    answerIntent='nutrient-content claim wording';
    const evidence=addNutrientClaimFinding(relevantClaimGuidance);
    const criteria=relevantClaimGuidance.map(topic=>`${topic.label}: ${topic.criteria}.`).join(' ');
    const rdaContext=relevantClaimGuidance.some(topic=>topic.key==='high-protein')?' The protein criteria use RDA percentages; no RDA or reference group is inferred here.':'';
    answer=`FSSAI’s Version IV Advertising and Claims compendium (14 December 2022) lists these generic criteria: ${criteria}${evidence.rows.length?` The recorded package line is ${evidence.rows.slice(0,3).map(observation=>`“${observation.text.slice(0,200)}${observation.text.length>200?'…':''}” (${observation.origin==='ocr'?'OCR observation':observation.origin==='user'?'user-entered observation':'recorded observation'})`).join('; ')}; it may be misread or transcribed incorrectly.`:' No matching claim wording is retained in this package record, so this is a general explanation.'}${rdaContext} The FSSAI amendment index checked on 22 October 2026 lists three amendments, latest dated 13 December 2022. This dated explanation does not determine which product basis applies, classify the food, verify any OCR value, or establish whether the product makes or meets the claim. It does not establish current legal status.`;
    limitations.push('Dated FSSAI nutrient-content claim criteria explain wording only; they do not validate package values, infer an RDA or determine current compliance.');
    trace.push({tool:'explain_nutrient_content_claim',reason:'Match supported claim wording to dated FSSAI criteria; retain any package line as unverified evidence.',status:'source-backed deterministic explanation; no compliance classifier'});
  }else if(wholeDietCarbohydrateGuidance){
    answerIntent='whole-diet carbohydrate guidance';
    const fibreGuidance=/\bfib(?:er|re)\b/i.test(question);
    const childFibreGuidance=fibreGuidance&&/\b(?:child(?:ren)?|kids?|adolescents?|teens?)\b|\b(?:[2-9]|1\d)\s*(?:-|–|to)\s*(?:[2-9]|1\d)\s*(?:years?|yrs?)\b|\b(?:[2-9]|1\d)-year-old\b/i.test(question);
    const recommendation='WHO’s 2023 guideline recommends that carbohydrates come primarily from whole grains, vegetables, fruits and pulses.';
    const fibreRecommendation=fibreGuidance
      ?childFibreGuidance?' For children and adolescents, WHO suggests at least 15 g/day of naturally occurring dietary fibre from foods at ages 2–5, 21 g/day at ages 6–9, and 25 g/day at ages 10 or older.'
        :' For adults, it recommends at least 25 g/day of naturally occurring dietary fibre; WHO suggests age-specific amounts for children and adolescents.'
      :'';
    const fibreCalculation=calculations.find(calculation=>calculation.nutrient==='fiber');
    const packageContext=fibreGuidance
      ?fibreCalculation?` The recorded package reading calculates to ${amountText(fibreCalculation.result)} ${fibreCalculation.unit} fibre in ${amountText(portion)} ${portionUnit}, if the printed value was read correctly. This is one package portion, not a measure of whole-day intake.`:' No usable package fibre reading with a matching basis is available here, so the portion amount remains unknown.'
      :'';
    answer=`${recommendation}${fibreRecommendation} This is population guidance for the whole diet, not a product-specific threshold or individual prescription.${packageContext}`;
  }else if(asksDiabetesCarbohydrateAmount){
    answerIntent='diabetes carbohydrate context';
    const labelCarbs=calculations.find(c=>c.nutrient==='carbohydrate');
    answer=labelCarbs
      ?`The readable label gives ${amountText(labelCarbs.result)} g total carbohydrate in ${amountText(portion)} ${portionUnit}. This is a package amount, not a personal daily target. NIDDK describes carb counting and the plate method as planning options and says not everyone with diabetes needs to count carbs. A personal plan can depend on medication, activity and other conditions, so discuss what fits with your health care team. NIDDK provides general education, not an individual allowance.`
      :`This scan does not establish total carbohydrate for the selected portion, so it cannot calculate a package amount or a daily target. NIDDK describes carb counting and the plate method as planning options and says not everyone with diabetes needs to count carbs. A personal plan can depend on medication, activity and other conditions, so discuss what fits with your health care team. NIDDK provides general education, not an individual allowance.`;
    nextQuestions.push('Do you have a carbohydrate amount from your health care team that you want compared with this label?');
  }else if(/sugar[ -]free|no added sugar/i.test(question)){
    answerIntent='sugar claim';answer=`A sugar-free or no-added-sugar claim does not establish zero carbohydrate. ${carbs?`The readable label gives ${amountText(carbs.result)} g total carbohydrate in ${amountText(portion)} ${portionUnit}.`:'Total carbohydrate for this portion remains unknown; confirm its amount and basis.'}`;
  }else if(askedAdditives.length||/additive|sweetener|sucralose|ingredient code/i.test(question)){
    answerIntent='additive identity and dose';
    const requested=askedAdditives.length?askedAdditives:pkg.additives;
    const identities=requested.map(code=>{const additive=lookupAdditive(code);return additive?`INS ${code} is ${additive.name}`:`INS ${code} is unresolved in the local identity corpus`;});
    answer=`${identities.length?identities.join('; '):'No specific additive identity is established from this question and label'}. Ingredient presence does not establish dose, exposure or an individually safe amount.`;
    if(requested.some(code=>!pkg.additives.includes(code)))answer+=' A question about an additive does not establish that this package contains it.';
  }else{
    const textIntent=[
      {field:'ingredients',label:'ingredient text',matches:/\b(ingredients?|ingredient list|what is it made of)\b/i},
      {field:'allergens',label:'allergen statement',matches:/\b(allergens?|allergen statement|may contain|contains)\b/i},
      {field:'claim',label:'package claims',matches:/\b(claims?|marketing claims|what does it claim)\b/i},
    ].find(intent=>intent.matches.test(question));
    if(textIntent){
      answerIntent=`observed ${textIntent.label}`;
      const rows=pkg.observations.filter(observation=>observation.field===textIntent.field&&observation.text.trim());
      const text=unique(rows.map(observation=>observation.text.trim()));
      if(text.length){
        const shown=text.slice(0,8).map(line=>line.slice(0,240));
        const omitted=text.length>shown.length||text.some(line=>line.length>240);
        answer=`The recorded label text says: ${shown.join(' | ')}${omitted?' | Additional text is omitted or truncated.':''} These are package-reading observations, not independently verified product facts; OCR or transcription may be wrong.`;
        finding({title:`Recorded ${textIntent.label}`,detail:`Literal text retained from the label-reading record. OCR or transcription may be wrong; inspect the package before relying on it.`,status:'observed',observationIds:unique(rows.map(observation=>observation.id)),sourceIds:[],calculationIds:[]});
      }else{
        answer=`No readable ${textIntent.label} is recorded for this package. That does not establish that the package has none; add or check a clear photo of the relevant panel.`;
      }
    }else{
      const asksPackageCarbohydrateAmount=/\b(?:how much|how many|amount|quantity|content)\b/i.test(question)&&(/\b(?:package|label|portion|serving|product|bar|snack)\b/i.test(question)||/\bper\s+\d+(?:\.\d+)?\s*(?:g|ml)\b/i.test(question));
      const requested=nutrientKeys.filter(key=>nutrientQuestionPatterns[key].test(question)&&!(key==='carbohydrate'&&wholeDietCarbohydrateGuidance&&!asksPackageCarbohydrateAmount));
      if(requested.length&&!dietRelevant){
        answerIntent='specific nutrient quantity';
        const requestedAmounts=requested.map(key=>{
          const result=calculations.find(c=>c.nutrient===key);
          if(result?.id==='calc-salt-from-sodium')return `approximately ${amountText(result.result)} g salt equivalent, calculated from declared sodium; this is not a printed salt declaration`;
          return result?`${amountText(result.result)} ${result.unit} ${display[key].toLowerCase()}`:`${display[key]} for this portion is unknown; confirm the printed amount, unit and serving basis. Missing is not zero`;
        });
        answer=`For ${amountText(portion)} ${portionUnit}: ${requestedAmounts.join('; ')}.`;
      }else if(!/label|portion|packet|nutrition|mean|audit|analyse|analyze|how much|how many|daily|diet|safe|suitable|reasonable|eat|allerg|intoler/i.test(question)){
        answerIntent='unsupported local question';answer='The package alone does not establish an answer to that question. This local rule engine can explain label amounts, additive identities and portion scenarios; a question-specific authoritative source or more context is needed.';
      }
    }
  }
  if(asksUncertainty&&!transFatTopic){
    answerIntent='package uncertainty review';
    const unresolved=findings.filter(item=>item.status==='uncertain'||item.status==='conflict');
    const summaryObservationIds=new Set<string>();
    const coveredObservationIds=new Set<string>();
    for(const item of unresolved){
      for(const id of item.observationIds){summaryObservationIds.add(id);coveredObservationIds.add(id);}
    }
    for(const diagnostic of pkg.parserDiagnostics??[]){
      if(diagnostic.decision==='accepted'||diagnostic.sourceObservationIds.every(id=>coveredObservationIds.has(id)))continue;
      diagnostic.sourceObservationIds.forEach(id=>summaryObservationIds.add(id));
    }
    if(pkg.identityConflict){
      const identityIds=pkg.observations.filter(observation=>observation.field==='barcode'||observation.field==='name').map(observation=>observation.id);
      identityIds.forEach(id=>summaryObservationIds.add(id));
    }else if(pkg.name==='Unidentified package'){
      const nameIds=pkg.observations.filter(observation=>observation.field==='name'||observation.field==='ocr-line').slice(0,4).map(observation=>observation.id);
      nameIds.forEach(id=>summaryObservationIds.add(id));
    }
    if(pkg.ingredients.length===0||pkg.allergens.length===0){
      // When available, cite the OCR lines that were retained for this package;
      // their presence does not imply that the relevant panel was captured.
      pkg.observations.filter(observation=>observation.field==='ocr-line').slice(0,4).forEach(observation=>summaryObservationIds.add(observation.id));
    }
    const flaggedNutrients=unique([
      ...(pkg.parserDiagnostics??[]).filter(diagnostic=>diagnostic.decision!=='accepted'||diagnostic.reasonCodes.length>0).map(diagnostic=>display[diagnostic.field]),
      ...pkg.nutrients.filter(nutrient=>nutrient.status==='conflict').map(nutrient=>display[nutrient.key]),
    ]);
    const conflictingNutrients=new Set([
      ...(pkg.parserDiagnostics??[]).filter(diagnostic=>diagnostic.decision==='conflict').map(diagnostic=>display[diagnostic.field]),
      ...pkg.nutrients.filter(nutrient=>nutrient.status==='conflict').map(nutrient=>display[nutrient.key]),
    ]);
    const visibleNutrients=flaggedNutrients.slice(0,3);
    const nutrientList=visibleNutrients.length<2?visibleNutrients[0]??'':`${visibleNutrients.slice(0,-1).join(', ')} and ${visibleNutrients[visibleNutrients.length-1]}`;
    const nutrientSummary=flaggedNutrients.length===1
      ?conflictingNutrients.has(nutrientList)?`The ${nutrientList} readings need a closer look.`:`The ${nutrientList} reading needs a closer look.`
      :flaggedNutrients.length>1
        ?`The ${nutrientList} readings${flaggedNutrients.length>visibleNutrients.length?`, plus ${flaggedNutrients.length-visibleNutrients.length} more,`:''} need a closer look.`
        :'';
    const detailLines=[
      nutrientSummary,
      pkg.identityConflict?'The product identity is unresolved.':pkg.name==='Unidentified package'?'The product name could not be established from this scan.':'',
      pkg.ingredients.length===0&&pkg.allergens.length===0?'No readable ingredient or allergen statement was recorded.':pkg.ingredients.length===0?'No readable ingredient list was recorded.':pkg.allergens.length===0?'No allergen statement was recorded.':'',
      unresolved.length&&!flaggedNutrients.length&&pkg.name!=='Unidentified package'&&pkg.ingredients.length>0&&pkg.allergens.length>0?'Some evidence remains uncertain; review the findings below.':'',
    ].filter(Boolean);
    answer=detailLines.length
      ?`${detailLines.join(' ')} See label-reading notes and original observations. OCR is unverified; unclear values are not zero, and panels outside these photos remain unknown.`
      :'I do not see a recorded nutrient conflict, rejected nutrition row, missing nutrient basis, or identity/ingredient gap in the current package record. This is only an internal consistency check: OCR can still misread text, and any panel not captured remains unknown.';
    if(summaryObservationIds.size){
      const ids=[...summaryObservationIds];
      finding({title:'Unresolved package evidence',detail:'This summary points to the original package observations associated with the displayed unresolved items. Parser rejection describes the local parser decision, not whether the printed text itself is correct.',status:unresolved.some(item=>item.status==='conflict')||(pkg.parserDiagnostics??[]).some(diagnostic=>diagnostic.decision==='conflict')?'conflict':'uncertain',observationIds:ids,sourceIds:[],calculationIds:[]});
    }
  }
  trace.push({tool:'local_rule_answer',reason:`Select a transparent template for ${answerIntent}.`,status:'deterministic local response; no language model invoked'});
  if(conflict&&!asksUncertainty)answer+=' Some readings conflict and need checking before a dietary decision.';
  if(personalSuitability)answer+=userContext?' I considered the context you chose to share, but this label review cannot establish individual suitability.':' No personal context was provided, so this is a label reading rather than an assessment of individual suitability.';
  return {answer,findings,calculations,sources:evidenceSources.filter(s=>sourceIds.has(s.id)),limitations:unique(limitations),nextQuestions:unique(nextQuestions),trace};
}
