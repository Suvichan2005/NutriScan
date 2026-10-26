import type { Calculation, PackageData, TentativeStructuredCandidate, NutrientKey } from './contracts';
import { calculationRespectsCorrections } from './correction';

function numericFieldMatches(value: number, expected: number): boolean {
  return Math.abs(value - expected) <= Number.EPSILON * Math.max(1, Math.abs(value), Math.abs(expected)) * 16;
}

const calculationNutrientPatterns:Record<NutrientKey,RegExp>={
  energy:/\b(?:energy|calorific value|calories?|kcal|kj)\b/i,
  carbohydrate:/\b(?:carbohydrate|carbohydrates|carbs?)\b/i,
  sugars:/\b(?:total\s+)?sugars?\b/i,
  addedSugars:/\badded\s+sugars?\b/i,
  protein:/\bprotein\b/i,
  fat:/\b(?:total\s+)?fat\b/i,
  saturatedFat:/\bsaturated\s+fat\b/i,
  fiber:/\b(?:dietary\s+)?(?:fiber|fibre)s?\b/i,
  sodium:/\bsodium\b/i,
  salt:/\bsalt\b/i,
};

function calculationLabelMatches(nutrient:NutrientKey,label:string):boolean{
  const normalized=label.normalize('NFKC').replace(/[_-]+/g,' ');
  if(nutrient==='sugars'&&/\badded\s+sugars?\b/i.test(normalized))return false;
  if(nutrient==='fat'&&/\bsaturated\s+fat\b/i.test(normalized))return false;
  return calculationNutrientPatterns[nutrient].test(normalized);
}

export function calculationHasPackageEvidence(calculation:Calculation,data:{package:PackageData;interpretedCandidates?:TentativeStructuredCandidate[]}):boolean{
  if(!calculationRespectsCorrections(data.package,calculation))return false;
  const observationIds=new Set(calculation.observationIds);
  const imageIds=new Set(calculation.imageIds??[]);
  const provenanceMatches=(sourceObservations:string[],sourceImages:string[])=>
    sourceObservations.some(id=>observationIds.has(id))||sourceImages.some(id=>imageIds.has(id));
  if(calculation.countedPortion){
    const count=calculation.countedPortion;
    const serving=data.package.reconstruction?.current?data.package.reconstruction.serving:null;
    if(!serving||!['clear','provisional'].includes(serving.status)||!numericFieldMatches(count.servingQuantity,serving.quantity??Number.NaN)
      ||count.servingUnit!==serving.unit||(count.unit==='pieces'&&!numericFieldMatches(count.piecesPerServing!,serving.pieceCount??Number.NaN))
      ||!provenanceMatches(serving.evidence.observationIds,serving.evidence.imageRegions.map(region=>region.imageId))
      ||(data.package.serving&&(!numericFieldMatches(data.package.serving.value,count.servingQuantity)||data.package.serving.unit!==count.servingUnit)))return false;
  }
  if(calculation.packagePortion){
    const reconstruction=data.package.reconstruction?.current?data.package.reconstruction:null;
    const declarations=(reconstruction?.quantityDeclarations??[]).filter(item=>item.kind==='net-content');
    if(declarations.length!==1)return false;
    const declaration=declarations[0];
    if(!['clear','provisional'].includes(declaration.status)
      ||declaration.quantity===null||declaration.unit===null
      ||!numericFieldMatches(calculation.packagePortion.netContentPerPackage,declaration.quantity)
      ||calculation.packagePortion.unit!==declaration.unit
      ||calculation.packagePortion.printedText!==declaration.printedText
      ||calculation.portionUnit!==declaration.unit
      ||!provenanceMatches(declaration.evidence.observationIds,declaration.evidence.imageRegions.map(region=>region.imageId)))return false;
  }
  const hasMatchingInterpretation=(data.package.reconstruction?.current?data.package.reconstruction.nutritionRows:[]).some(row=>
    (!(calculation.interpretationIds?.length)||calculation.interpretationIds.includes(row.rowId))
    &&['clear','provisional'].includes(row.status)&&!row.qualifier
    &&(calculation.nutrient===null
      ?row.nutrientKey==null&&calculation.interpretationIds?.length===1&&calculation.nutrientLabel===row.nutrient
      :row.nutrientKey===undefined?calculationLabelMatches(calculation.nutrient,`${row.nutrient} ${row.printedLabel}`):row.nutrientKey===calculation.nutrient)
    &&row.value!==null&&numericFieldMatches(calculation.input,row.value)
    &&row.unit===calculation.inputUnit&&numericFieldMatches(calculation.basisAmount,row.basisAmount??Number.NaN)
    &&row.basisUnit===calculation.portionUnit&&calculation.unit===calculation.inputUnit
    &&provenanceMatches(row.evidence.observationIds,row.evidence.imageRegions.map(region=>region.imageId)));
  if(hasMatchingInterpretation)return true;

  const hasMatchingCandidate=(data.interpretedCandidates??[]).some(candidate=>
    (calculation.interpretationIds??[]).includes(candidate.candidateId)
    &&candidate.kind==='nutrient'&&calculation.nutrient!==null&&calculationLabelMatches(calculation.nutrient,candidate.field)
    &&candidate.numericValue!==null&&numericFieldMatches(calculation.input,candidate.numericValue)
    &&candidate.unit===calculation.inputUnit&&candidate.basis?.unit===calculation.portionUnit
    &&!!candidate.basis&&numericFieldMatches(calculation.basisAmount,candidate.basis.amount)
    &&calculation.unit===calculation.inputUnit
    &&provenanceMatches(candidate.observationIds,candidate.visualEvidence?.map(item=>item.imageId)??[]));
  if(hasMatchingCandidate)return true;

  const observationImages=new Map(data.package.observations.flatMap(observation=>observation.imageId?[[observation.id,observation.imageId] as const]:[]));
  return data.package.nutrients.some(nutrient=>{
    const sourceImages=nutrient.observationIds.flatMap(id=>{const imageId=observationImages.get(id);return imageId?[imageId]:[];});
    return nutrient.key===calculation.nutrient&&nutrient.status!=='conflict'&&(!data.package.reconstruction?.current||nutrient.status==='corrected')
      &&numericFieldMatches(calculation.input,nutrient.value)&&calculation.inputUnit===nutrient.unit
      &&!!nutrient.basis&&numericFieldMatches(calculation.basisAmount,nutrient.basis.amount)
      &&calculation.portionUnit===nutrient.basis.unit&&calculation.unit===nutrient.unit
      &&provenanceMatches(nutrient.observationIds,sourceImages);
  });
}

