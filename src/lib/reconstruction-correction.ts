import {packageSchema, type PackageData, type PackageReconstruction} from './contracts';

type Row=PackageReconstruction['nutritionRows'][number];
export const correctionUnits=['g','mg','µg','mcg','kcal','kJ'] as const;
export type ReconstructionRowEdit={rowId:string;label:string;value:number;unit:typeof correctionUnits[number];basisAmount:number;basisUnit:'g'|'ml';qualifier:string|null};

function sameSourceRow(row:Row,original:Row){
 return row.rowId===original.rowId || (row.nutrient.trim().toLocaleLowerCase()===original.nutrient.trim().toLocaleLowerCase()&&row.unit===original.unit&&row.basisAmount===original.basisAmount&&row.basisUnit===original.basisUnit);
}

/** User readings are an overlay; the original and rechecked model objects stay immutable. */
export function packageWithRowCorrections(pkg:PackageData):PackageData{
 if(!pkg.reconstruction?.current||!pkg.reconstructionCorrections?.length)return pkg;
 let rows=[...pkg.reconstruction.nutritionRows];
 for(const correction of pkg.reconstructionCorrections){
  rows=rows.filter(row=>!sameSourceRow(row,correction.original));
  rows.push(correction.reading);
 }
 return{...pkg,reconstruction:{...pkg.reconstruction,nutritionRows:rows}};
}

export function applyReconstructionRowCorrection(pkg:PackageData,edit:ReconstructionRowEdit):PackageData{
 const prior=pkg.reconstructionCorrections?.find(item=>item.rowId===edit.rowId);
 const original=prior?.original??pkg.reconstruction?.nutritionRows.find(row=>row.rowId===edit.rowId);
 if(!original||!pkg.reconstruction?.current)throw new Error('Select a current saved nutrition row.');
 const label=edit.label.trim();
 if(!label||label.length>120||!Number.isFinite(edit.value)||edit.value<0||edit.value>100000||!Number.isFinite(edit.basisAmount)||edit.basisAmount<=0||edit.basisAmount>10000||!correctionUnits.includes(edit.unit)||!['g','ml'].includes(edit.basisUnit)||!['','<','<=','>','>='].includes(edit.qualifier??''))throw new Error('Check the value, unit, qualifier and positive printed basis.');
 // Standard-key edits retain their established correction path. Never guess a key for an arbitrary label.
 if(original.nutrientKey)throw new Error('Use the standard nutrient correction control.');
 const observationId=crypto.randomUUID();
 const observation={id:observationId,field:'nutrition-row-correction',origin:'user' as const,side:'text' as const,confidence:null,text:`User correction: ${label}: ${edit.qualifier??''}${edit.value} ${edit.unit} per ${edit.basisAmount} ${edit.basisUnit}; saved row ${edit.rowId}`,value:edit.value,unit:edit.unit,derivedFromObservationIds:original.evidence.observationIds.slice(0,20),...(prior?{supersedesObservationIds:[prior.observationId]}:{})};
 const reading:Row={...original,nutrient:label,nutrientKey:null,printedLabel:label,value:edit.value,unit:edit.unit,printedValue:`${edit.qualifier??''}${edit.value} ${edit.unit}`,basisAmount:edit.basisAmount,basisUnit:edit.basisUnit,basisText:`per ${edit.basisAmount} ${edit.basisUnit}`,qualifier:edit.qualifier||null,status:'clear',evidence:{observationIds:[observationId],imageRegions:original.evidence.imageRegions}};
 const correction={rowId:edit.rowId,revision:(prior?.revision??0)+1,sourceRevision:prior?.sourceRevision??pkg.reconstruction.revision,original,reading,observationId,updatedAt:new Date().toISOString()};
 return packageSchema.parse({...pkg,observations:[...pkg.observations,observation],reconstructionCorrections:[...(pkg.reconstructionCorrections??[]).filter(item=>item.rowId!==edit.rowId),correction]});
}
