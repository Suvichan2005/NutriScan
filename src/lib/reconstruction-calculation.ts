import { calculationEvidenceText, calculationSchema, calculableNutrientUnits, type Calculation, type NutrientKey, type PackageData } from './contracts';
import { nutrientMassConflict } from './nutrient-mass';
import { calculationRespectsCorrections } from './correction';

export type RowCalculationResult={status:'ok'|'withheld';resultCount:number;calculations?:Calculation[];output:{status:'ok'|'withheld';message?:string;calculation?:Calculation;note?:string}};

/** Shared exact-row arithmetic for native tools and local portion exploration. */
export function calculateReconstructedRow(row:NonNullable<PackageData['reconstruction']>['nutritionRows'][number],nutrient:NutrientKey|null,args:{amount:number;unit:'g'|'ml'},pkg:PackageData):RowCalculationResult{
  const withheld=(message:string):RowCalculationResult=>({status:'withheld',resultCount:0,output:{status:'withheld',message}});
  const retainedObservations=new Set(pkg.observations.map(item=>item.id));
  const retainedImages=new Set([...pkg.observations.flatMap(item=>item.imageId?[item.imageId]:[]),...(pkg.ocrCaptures??[]).map(item=>item.imageId),...(pkg.visionCaptures??[]).map(item=>item.imageId)]);
  const observationIds=row.evidence.observationIds.filter(id=>retainedObservations.has(id));
  const imageIds=[...new Set(row.evidence.imageRegions.map(item=>item.imageId).filter(id=>retainedImages.has(id)))];
  if(!pkg.reconstruction?.current||!['clear','provisional'].includes(row.status)||row.qualifier||row.value===null||!row.unit||!row.basisAmount||!row.basisUnit||row.basisUnit!==args.unit||(!observationIds.length&&!imageIds.length))return withheld('The saved row needs an exact, current, evidence-linked value, unqualified unit and matching mass or volume basis.');
  if(!calculableNutrientUnits.some(unit=>unit===row.unit))return withheld('The saved row does not use a supported absolute nutrient unit. Percentages and reference-intake percentages are not nutrient quantities.');
  const massConflict=nutrientMassConflict({...row,nutrientKey:row.nutrientKey??nutrient});
  if(massConflict)return withheld(massConflict);
  const corrected=pkg.reconstructionCorrections?.some(item=>item.rowId===row.rowId&&row.evidence.observationIds.includes(item.observationId))||pkg.nutrients.some(item=>item.status==='corrected'&&item.key===nutrient&&item.value===row.value&&item.unit===row.unit&&item.basis?.amount===row.basisAmount&&item.basis?.unit===row.basisUnit&&item.observationIds.some(id=>observationIds.includes(id)));
  const result=row.value*args.amount/row.basisAmount;
  if(!Number.isFinite(result)||result>100000)return withheld('The requested calculation exceeds validated numeric limits.');
  const calculation=calculationSchema.parse({
    inputOrigin:corrected?'user-correction':'model-interpretation',
    id:`reconcalc-r${pkg.reconstruction.revision}-${row.rowId.replace(/[^a-z0-9_-]/gi,'').slice(0,42)}-${args.amount}-${args.unit}`,
    label:`${row.nutrient} in ${args.amount} ${args.unit} (${corrected?'your correction':'provisional package reading'})`,nutrient,...(nutrient===null?{nutrientLabel:row.nutrient}:{}),
    input:row.value,inputUnit:row.unit,basisAmount:row.basisAmount,portion:args.amount,portionUnit:args.unit,result,unit:row.unit,
    formula:`${row.value} ${row.unit} × ${args.amount} ${args.unit} ÷ ${row.basisAmount} ${row.basisUnit}`,
    observationIds,...(imageIds.length?{imageIds}:{}),interpretationIds:[row.rowId],
    assumptions:[corrected?'Deterministic arithmetic from the current user correction. This is not an independently verified label reading.':'Deterministic arithmetic from the saved Gemini package interpretation. The printed value and basis remain provisional and are not independently verified.'],
  });
  if(!calculationRespectsCorrections(pkg,calculation))return withheld('A user correction supersedes the evidence for this saved row. Recheck the current reading before calculating.');
  const linked={...calculation,evidenceText:calculationEvidenceText(calculation)};
  return{status:'ok',resultCount:1,calculations:[linked],output:{status:'ok',calculation:linked,note:'Calculated from the exact saved nutrition row. This estimate remains provisional; it does not confirm or overwrite the package reading.'}};
}
