import {packageSchema, type PackageData, type PackageReconstruction} from './contracts';
import { reconstructionNutrientSubject } from './portion';
import { nutrientMassConflict } from './nutrient-mass';

type Row=PackageReconstruction['nutritionRows'][number];
export const correctionUnits=['g','mg','µg','mcg','kcal','kJ'] as const;
export type ReconstructionRowEdit={rowId:string;label:string;value:number;unit:typeof correctionUnits[number];basisAmount:number;basisUnit:'g'|'ml';qualifier:string|null};

function sameSourceRow(row:Row,original:Row){
 return row.rowId===original.rowId || (reconstructionNutrientSubject(row)===reconstructionNutrientSubject(original)&&row.unit===original.unit&&row.basisAmount===original.basisAmount&&row.basisUnit===original.basisUnit);
}

/** User readings are an overlay; the original and rechecked model objects stay immutable. */
export function packageWithRowCorrections(pkg:PackageData):PackageData{
 if(!pkg.reconstruction?.current)return pkg;
 // Some saved model responses use "_" as an empty-field placeholder. Treat it
 // as absent only when the printed value is an unqualified exact number and
 // unit matching the parsed row; preserve all genuine or ambiguous qualifiers.
 let rows=pkg.reconstruction.nutritionRows.map(row=>{
  if(row.qualifier?.trim()!=='_'||row.value===null||!row.unit)return row;
  const printed=row.printedValue?.trim().match(/^(\d+(?:\.\d+)?)\s*([a-zA-Zµμ]+)$/u);
  return printed&&Number(printed[1])===row.value&&printed[2].toLowerCase()===row.unit.toLowerCase()?{...row,qualifier:null}:row;
 });
 for(const correction of pkg.reconstructionCorrections??[]){
  rows=rows.filter(row=>!sameSourceRow(row,correction.original));
  rows.push(correction.reading);
 }
 for(const decision of pkg.clarificationDecisions??[]){
  const standard=pkg.nutrients.find(item=>item.status==='corrected'&&item.key===decision.subject&&item.basis);
  const target=rows.find(row=>row.rowId===decision.preferredRowId);
  if(decision.decision==='confirm'&&standard?.basis&&target&&reconstructionNutrientSubject(target)===decision.subject)rows=rows.map(row=>row.rowId===target.rowId?{...row,value:standard.value,unit:standard.unit,printedValue:`${standard.value} ${standard.unit}`,basisAmount:standard.basis!.amount,basisUnit:standard.basis!.unit,basisText:`per ${standard.basis!.amount} ${standard.basis!.unit}`,qualifier:null,status:'clear' as const,evidence:{observationIds:standard.observationIds,imageRegions:target.evidence.imageRegions}}:row);
  const preferred=decision.decision==='confirm'?rows.find(row=>row.rowId===decision.preferredRowId&&reconstructionNutrientSubject(row)===decision.subject):undefined;
  if(preferred)rows=rows.filter(row=>row.rowId===preferred.rowId||reconstructionNutrientSubject(row)!==decision.subject);
 }
 return{...pkg,reconstruction:{...pkg.reconstruction,nutritionRows:rows}};
}

/** Inspection retains the actual model reading beside the separately displayed user correction. */
export function reconstructionForInspection(pkg:PackageData){
 const effective=packageWithRowCorrections(pkg).reconstruction;
 return effective?{...effective,nutritionRows:effective.nutritionRows.map(row=>pkg.reconstruction?.nutritionRows.find(original=>original.rowId===row.rowId)??row)}:undefined;
}

export function applyReconstructionRowCorrection(pkg:PackageData,edit:ReconstructionRowEdit,exactComponent=false):PackageData{
 const prior=pkg.reconstructionCorrections?.find(item=>item.rowId===edit.rowId);
 const original=prior?.original??pkg.reconstruction?.nutritionRows.find(row=>row.rowId===edit.rowId);
 if(!original||!pkg.reconstruction?.current)throw new Error('Select a current saved nutrition row.');
 const label=edit.label.trim();
 if(!label||label.length>120||!Number.isFinite(edit.value)||edit.value<0||edit.value>100000||!Number.isFinite(edit.basisAmount)||edit.basisAmount<=0||edit.basisAmount>10000||!correctionUnits.includes(edit.unit)||!['g','ml'].includes(edit.basisUnit)||!['','<','<=','>','>='].includes(edit.qualifier??''))throw new Error('Check the value, unit, qualifier and positive printed basis.');
 // Standard-key edits retain their established correction path. Never guess a key for an arbitrary label.
 if(original.nutrientKey&&!exactComponent)throw new Error('Use the standard nutrient correction control.');
 const impossible=nutrientMassConflict({...edit,nutrientKey:original.nutrientKey});
 if(impossible)throw new Error(impossible);
 const observationId=crypto.randomUUID();
 const observation={id:observationId,field:'nutrition-row-correction',origin:'user' as const,side:'text' as const,confidence:null,text:`User correction: ${label}: ${edit.qualifier??''}${edit.value} ${edit.unit} per ${edit.basisAmount} ${edit.basisUnit}; saved row ${edit.rowId}`,value:edit.value,unit:edit.unit,derivedFromObservationIds:original.evidence.observationIds.slice(0,20),...(prior?{supersedesObservationIds:[prior.observationId]}:{})};
 const reading:Row={...original,nutrient:label,nutrientKey:null,printedLabel:label,value:edit.value,unit:edit.unit,printedValue:`${edit.qualifier??''}${edit.value} ${edit.unit}`,basisAmount:edit.basisAmount,basisUnit:edit.basisUnit,basisText:`per ${edit.basisAmount} ${edit.basisUnit}`,qualifier:edit.qualifier||null,status:'clear',evidence:{observationIds:[observationId],imageRegions:original.evidence.imageRegions}};
 const correction={rowId:edit.rowId,revision:(prior?.revision??0)+1,sourceRevision:prior?.sourceRevision??pkg.reconstruction.revision,original,reading,observationId,updatedAt:new Date().toISOString()};
 return packageSchema.parse({...pkg,observations:[...pkg.observations,observation],reconstructionCorrections:[...(pkg.reconstructionCorrections??[]).filter(item=>item.rowId!==edit.rowId),correction]});
}
