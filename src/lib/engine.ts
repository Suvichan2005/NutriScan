import { packageSchema, profileSchema, nutrientKeys, type Audit, type Calculation, type Finding, type Nutrient, type NutrientKey, type PackageData, type Profile } from './contracts';
import { detectAdditives, evidenceSources, lookupAdditive, retrieveEvidence } from './knowledge';
import { findDeclaredFoodMentions } from './ingredient-context';

const display:Record<NutrientKey,string>={energy:'Energy',carbohydrate:'Carbohydrate',sugars:'Total sugars',addedSugars:'Added sugars',protein:'Protein',fat:'Fat',saturatedFat:'Saturated fat',fiber:'Fibre',sodium:'Sodium',salt:'Salt'};
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
const profileText=(p:Profile)=>[p.dietaryPattern&&`Dietary pattern: ${p.dietaryPattern}`,p.allergies&&`User-declared food allergies: ${p.allergies}`,p.intolerances&&`User-declared food intolerances: ${p.intolerances}`,p.healthConsiderations&&`User-declared health considerations: ${p.healthConsiderations}`,p.goals&&`User goals: ${p.goals}`,p.ageGroup&&`Age group: ${p.ageGroup}`,p.sexOrReferenceGroup&&`Reference group: ${p.sexOrReferenceGroup}`,p.country&&`Country: ${p.country}`,p.locality&&`Locality: ${p.locality}`].filter(Boolean).join('\n');
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
  const nextQuestions:string[]=[];
  const userContext=profileText(profile);
  const explicitlyUnder18=isExplicitlyUnder18(profile.ageGroup);
  const askedAdditives=detectAdditives(question);
  const deep=/diet|allerg|intoler|health|daily|safe|reasonable|sucralose|sweetener|ORS|regulat|legal|recall|brand|reviews?|alternativ|sodium|salt|blood pressure|hypertension|diabetes|carbohydrate|\bcarbs\b|sugar claim|ICMR|\bNIN\b/i.test(question)||(/label|mean|audit|suitab/i.test(question)&&!!userContext);
  const trace:Audit['trace']=[{tool:'reuse_package_observations',reason:'Use the current label evidence for this question; no rescan required.',status:`${pkg.observations.length} observations`},{tool:'calculate_portions',reason:'Scale only unambiguous values with compatible explicit bases.',status:'local deterministic calculation'}];
  const finding=(data:Omit<Finding,'id'>)=> {data.sourceIds.forEach(s=>sourceIds.add(s));findings.push({...data,id:`finding-${findings.length+1}`});};
  if(pkg.userDescription){
    const descriptionIds=pkg.observations.filter(o=>o.field==='user-description').map(o=>o.id);
    finding({title:'User-provided product details',detail:`${pkg.userDescription} These details were supplied by the user and have not been verified against the package or an external product record.`,status:'context',observationIds:descriptionIds,sourceIds:[],calculationIds:[]});
    limitations.push('User-provided product details are unverified context, not package-label evidence.');
  }
  const ingredientEvidence=pkg.observations.filter(o=>o.field==='ingredients'||o.field==='allergens').map(o=>o.id);
  for(const mention of findDeclaredFoodMentions(pkg,profile)){
    const labelTextPresent=pkg.ingredients.length>0||pkg.allergens.length>0;
    const kind=mention.kind==='allergy'?'Food allergy':'Food intolerance';
    const detail=mention.matched
      ?`The extracted ingredient/allergen wording contains a literal text match for “${mention.term}”. This is not a medical determination or individual-safety assessment; the label may not show derivatives or cross-contact. Inspect the original package.`
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
    const calc:Calculation={id:`calc-${key}`,label:`${display[key]} in ${portion} ${portionUnit}`,nutrient:key,input:candidate.value,inputUnit:candidate.unit,basisAmount:n.basis!.amount,portion,portionUnit,result,unit:candidate.unit,formula:`${candidate.value} ${candidate.unit} × ${portion} ${portionUnit} ÷ ${n.basis!.amount} ${n.basis!.unit}`,observationIds:candidate.observations,assumptions:['The label reading and its stated basis are correct.','The portion has the same composition as the labelled product.']};
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
  if(pkg.claims.some(c=>/sugar[ -]free|no added sugar/i.test(c))||/sugar[ -]free/i.test(question))finding({title:'Sugar-free does not establish zero carbohydrate',detail:carbs?`The selected portion still has ${amountText(carbs.result)} g total carbohydrate in the label reading. Evaluate that total separately from sugar claims.`:'Total carbohydrate is not established for this portion. A sugar claim alone cannot fill that missing value.',status:carbs?'calculated':'context',observationIds:unique([...pkg.observations.filter(o=>o.field==='claim').map(o=>o.id),...(carbs?.observationIds??[])]),sourceIds:['niddk-meals'],calculationIds:carbs?[carbs.id]:[]});
  const personalSuitability=/\b(safe|suitable|can i eat|should i eat|fit for me|for my|my diet|allerg|intoler|daily)\b/i.test(question);
  const dietRelevant=personalSuitability&&!!userContext;
  if(personalSuitability&&userContext){
    if(profile.allergies)nextQuestions.push('Which exact allergen should I check against the label and its cross-contact wording?');
    if(profile.intolerances)nextQuestions.push('Which ingredient or declared amount should I compare with your stated intolerance?');
    limitations.push('Personal suitability is not established by a label calculation; only the context you chose to provide was considered.');
  }
  if(/\bORS\b|oral rehydration|legal|regulat|recall|banned|fssai|licen[cs]e|current/i.test(`${question} ${pkg.claims.join(' ')}`)){
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
      {id:'niddk-meals',matches:/\b(diabetes|diabetic|blood glucose|carbohydrates?|carbs|meal planning|sugar claim)\b/i.test(question)},
      {id:'icmrnin-dgi-2024',matches:/\b(icmr|nin|indian dietary guidelines?|dietary guidelines? for india)\b/i.test(question)},
    ];
    const candidateIds=new Set(intentSources.filter(x=>x.matches).map(x=>x.id));
    for(const code of askedAdditives){const additive=lookupAdditive(code);for(const id of additive?.sourceIds??[])candidateIds.add(id);}
    const candidates=hits.filter(hit=>candidateIds.has(hit.source.id)).slice(0,3);
    for(const {source} of candidates){
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
  let answer=important.length?`For ${amountText(portion)} ${portionUnit}: ${important.join(', ')} from the readable label values.`:`A reliable ${amountText(portion)} ${portionUnit} calculation needs readable nutrient amounts, units and a matching basis.`;
  let answerIntent='label overview';
  if(/\bORS\b|oral rehydration|legal|regulat|recall|banned|fssai|licen[cs]e|current/i.test(question)){
    answerIntent='current regulatory question';answer='Current legal or regulatory status is unresolved. The next evidence is a dated official notice for the exact product and jurisdiction, checked for later amendments or orders.';
  }else if(/alternativ|stock|available|reviews?|brand|controvers/i.test(question)){
    answerIntent='current product context';answer='This local audit has not checked current alternatives, stock, reviews or brand events. A current source matching the product and your location is the decisive next evidence.';
  }else if(/sugar[ -]free|no added sugar/i.test(question)){
    answerIntent='sugar claim';answer=`A sugar-free or no-added-sugar claim does not establish zero carbohydrate. ${carbs?`The readable label gives ${amountText(carbs.result)} g total carbohydrate in ${amountText(portion)} ${portionUnit}.`:'Total carbohydrate for this portion remains unknown; confirm its amount and basis.'}`;
  }else if(askedAdditives.length||/additive|sweetener|sucralose|ingredient code/i.test(question)){
    answerIntent='additive identity and dose';
    const requested=askedAdditives.length?askedAdditives:pkg.additives;
    const identities=requested.map(code=>{const additive=lookupAdditive(code);return additive?`INS ${code} is ${additive.name}`:`INS ${code} is unresolved in the local identity corpus`;});
    answer=`${identities.length?identities.join('; '):'No specific additive identity is established from this question and label'}. Ingredient presence does not establish dose, exposure or an individually safe amount.`;
    if(requested.some(code=>!pkg.additives.includes(code)))answer+=' A question about an additive does not establish that this package contains it.';
  }else{
    const requested: NutrientKey|undefined=(['addedSugars','saturatedFat',...nutrientKeys] as NutrientKey[]).find(key=>new RegExp(key==='sugars'?'sugars?':key==='addedSugars'?'added sugars?':key==='fiber'?'fib(?:er|re)':key==='fat'?'\\bfat\\b':key==='saturatedFat'?'saturated':key==='carbohydrate'?'carbs?|carbohydrate':key,'i').test(question));
    if(requested&&!dietRelevant){
      answerIntent='specific nutrient quantity';const result=calculations.find(c=>c.nutrient===requested);
      answer=result?`For ${amountText(portion)} ${portionUnit}, the readable label gives ${amountText(result.result)} ${result.unit} ${display[requested].toLowerCase()}.`:`${display[requested]} for this portion is unknown. Confirm the printed amount, unit and serving basis; missing is not zero.`;
    }else if(!/label|portion|packet|nutrition|mean|audit|analyse|analyze|how much|how many|daily|diet|safe|suitable|reasonable|eat|allerg|intoler/i.test(question)){
      answerIntent='unsupported local question';answer='The package alone does not establish an answer to that question. This local rule engine can explain label amounts, additive identities and portion scenarios; a question-specific authoritative source or more context is needed.';
    }
  }
  trace.push({tool:'local_rule_answer',reason:`Select a transparent template for ${answerIntent}.`,status:'deterministic local response; no language model invoked'});
  if(conflict)answer+=' Some readings conflict and need checking before a dietary decision.';
  if(personalSuitability)answer+=userContext?' I considered the context you chose to share, but this label review cannot establish individual suitability.':' No personal context was provided, so this is a label reading rather than an assessment of individual suitability.';
  return {answer,findings,calculations,sources:evidenceSources.filter(s=>sourceIds.has(s.id)),limitations:unique(limitations),nextQuestions:unique(nextQuestions),trace};
}
