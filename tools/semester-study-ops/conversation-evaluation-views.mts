import {portionNutrientGroups} from '../../src/lib/portion-nutrients';
import {portionView} from '../../src/lib/portion-view';
import type {PackageData, Calculation, EvidenceSource, Profile, SavedConversationTurn} from '../../src/lib/contracts';
import {savedConversationTurnSchema} from '../../src/lib/contracts';
import {conversationCalculationsForAssist,conversationContextForAssist,conversationEvidenceForAssist,answerEvidenceForConversation} from '../../src/lib/conversation-context';
import {filterAnswerBySourceScope,selectCitedEvidence,renderAnswerEvidenceReferences} from '../../src/lib/answer-evidence';
import {validateNaturalAnswerText} from '../../src/modules/inference';

export {conversationCalculationsForAssist,conversationContextForAssist,conversationEvidenceForAssist};

/** Read-only view. No source digits, units, qualifiers or correction arithmetic are invented. */
export function localPackageView(pkg:PackageData){
 const r=pkg.reconstruction;
 const corrections=pkg.nutrients.filter(n=>n.status==='corrected');
 const overridden=new Set(corrections.map(n=>n.key));
 return {
  evidenceClass:'AI package readings, not independently verified. User corrections are separate user statements.',
  coverage:'Partial representation of available evidence. Omitted or unreconstructed fields do not establish absence.',
  identity:r?{brand:r.identity.brand,name:r.identity.name,variant:r.identity.variant,readability:r.identity.status}:pkg.name,
  serving:r?.serving?{printed:r.serving.printedText,quantity:r.serving.quantity,unit:r.serving.unit,pieces:r.serving.pieceCount,pieceName:r.serving.pieceDescription,readability:r.serving.status}:null,
  netAndUnitDeclarations:r?.quantityDeclarations?.map(q=>({kind:q.kind,printed:q.printedText,quantity:q.quantity,unit:q.unit,readability:q.status})),
  nutrition:r?.nutritionRows.filter(n=>!n.nutrientKey||!overridden.has(n.nutrientKey)).map(n=>({id:n.nutrientKey?undefined:n.rowId,nutrient:n.nutrient,key:n.nutrientKey,printed:n.printedValue,value:n.value,unit:n.unit,qualifier:n.qualifier,basis:{printed:n.basisText,amount:n.basisAmount,unit:n.basisUnit},readability:n.status})),
  userCorrections:corrections.map(n=>({nutrient:n.key,value:n.value,unit:n.unit,basis:n.basis,authority:'current user correction; original reading retained in app'})),
  ingredients:{state:r?.ingredients.length?'readings available':'not reconstructed',items:r?.ingredients.map(i=>({name:i.name,printed:i.printedText,percent:i.printedPercentage,readability:i.status}))},
  additives:r?.additives.map(a=>({printed:a.printedName,interpretation:a.normalizedName,code:a.code,readability:a.status})),
  statements:r?.statements.map(s=>({kind:s.kind,text:s.text,readability:s.status})),
  unresolved:r?.unresolved,
 };
}

export function calculationView(c:Calculation){
 return {id:c.id,nutrient:c.nutrientLabel??c.nutrient,
  resultForRequestedPortion:{value:c.result,unit:c.unit,requestedAmount:c.countedPortion?.amount??c.portion,requestedUnit:c.countedPortion?.unit??c.portionUnit,normalizedAmount:c.portion,normalizedUnit:c.portionUnit},
  inputReading:{value:c.input,unit:c.inputUnit,per:c.basisAmount,basisUnit:c.portionUnit,origin:c.inputOrigin},
  assumptions:c.assumptions};
}

export function localToolView(result:any,pkg?:PackageData){
 const ids=new Set((result.calculations??[]).map((c:any)=>c.id));
 const sourceIds=new Set((result.evidence??[]).map((e:any)=>e.id));
 const reference=(v:any):any=>Array.isArray(v)?v.map(reference):v&&typeof v==='object'?(ids.has(v.id)?{calculationId:v.id}:sourceIds.has(v.id)?{sourceId:v.id}:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,reference(x)]))):v;
 const details=Object.fromEntries(Object.entries(result.output).filter(([k])=>!['calculations','calculation','fullGuidelineAccess'].includes(k)).map(([k,v])=>[k,reference(v)]));
 return {status:result.status,resultCount:result.resultCount,calculatedPortionTables:pkg?portionTables(pkg,result.calculations??[]):undefined,sources:result.evidence,details};
}

/** Same production validation/citation order; never construct semantic answer text here. */
export function normalizeLocalAnswer(raw:string,context:{pkg:PackageData;question:string;history:SavedConversationTurn[];calculations:Calculation[];evidence:EvidenceSource[];aliases:Map<string,string>;currentEvidenceIds:Set<string>;profile:Profile}){
 const sourceScope=filterAnswerBySourceScope(raw,context.evidence,context.aliases,[context.question,...Object.values(context.profile)].join(' '),context.profile.country,context.history.map(t=>t.question),context.currentEvidenceIds);
 const withheldSpans:any[]=[];
 const validation=validateNaturalAnswerText(sourceScope.answer,{
  package:context.pkg,question:context.question,profile:context.profile,calculations:context.calculations,evidence:context.evidence,
  sourceIdsForSentence:sentence=>{
   const ids=new Set(selectCitedEvidence(sentence,context.evidence).map(s=>s.id));
   for(const [handle,id] of context.aliases){
    const escaped=handle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    if(new RegExp(`\\b${escaped}\\b`,'i').test(sentence))ids.add(id);
   }
   return [...ids];
  },onWithheldSentence:span=>withheldSpans.push(span),
 });
 const notices=[
  ...(!validation.answer&&validation.withheldUnsupportedQuantitySentenceCount?['I could not verify the precise quantities in that response, so I have not used them. The reconstructed package remains available to inspect.']:[]),
  ...(sourceScope.withheldSentenceCount?['I left out one or more statements because their cited record was unavailable, unrelated to this question, or outside the stated scope.']:[]),
 ];
 const renderedAnswer=[...(validation.answer?[renderAnswerEvidenceReferences(validation.answer,context.aliases,context.evidence,context.calculations)]:[]),...notices].join('\n\n');
 const cited=selectCitedEvidence(renderedAnswer,context.evidence);
 const savedTurn=savedConversationTurnSchema.parse({question:context.question,answer:renderedAnswer,at:new Date().toISOString(),
  evidence:answerEvidenceForConversation(renderedAnswer,context.evidence),
  retrievedEvidence:context.evidence.slice(0,8),calculations:context.calculations.slice(-20)});
 return {sourceScope,validation,renderedAnswer,withheldSpans,citedSourceIds:cited.map(s=>s.id),uncitedSourceIds:context.evidence.filter(s=>!cited.some(c=>c.id===s.id)).map(s=>s.id),savedTurn};
}

/** Same nutrient-identity grouping as the UI, scoped separately for each physical operation. */
export function portionTables(pkg:PackageData,calculations:Calculation[]){
 const operations=new Map<string,Calculation[]>();
 for(const c of calculations){const key=JSON.stringify([c.portion,c.portionUnit,c.countedPortion?.amount,c.countedPortion?.unit,c.packagePortion?.packageCount]);operations.set(key,[...(operations.get(key)??[]),c]);}
 return [...operations.values()].map(rows=>{
  const ids=new Set(rows.map(c=>c.id));
  const rounded=(x:number)=>{const n=Math.round(x*100)/100;return n===0&&x!==0?x:n;};
  const nutrients=portionNutrientGroups(pkg,rows).filter(g=>g.initial).flatMap(g=>{
   const available=g.alternatives.flatMap(a=>a.calculation&&ids.has(a.calculation.id)?[a.calculation]:[]);
   if(!available.length)return [];
   const preferred=available.find(c=>c.id===g.calculation?.id)??available[0];
   return [{nutrient:g.label,valueForThisPortion:rounded(preferred.result),unit:preferred.unit,calculationId:preferred.id,
    ...(g.conflicted?{conditional:true,alternativeValues:available.map(c=>({value:rounded(c.result),unit:c.unit,calculationId:c.id}))}:{}),
    provenance:preferred.inputOrigin??'recorded package evidence'}];
  });
  const view=portionView(rows[0],pkg);
  return {requestedPortion:view.initial,physicalEquivalent:{amount:rows[0].portion,unit:rows[0].portionUnit},nutrients,
   labelCaution:'Approximate when based on unconfirmed package readings; printed serving is not a personal recommendation.'};
 });
}

