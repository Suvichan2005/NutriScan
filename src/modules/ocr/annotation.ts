import {
  ocrAdjudicationInputSchema,
  ocrAnnotationPassSchema,
  ocrAnnotatedDatasetSchema,
  ocrDatasetRecordSchema,
  type OcrAnnotationPass,
  type OcrAnnotatedRegion,
  type OcrDatasetField
} from '../../lib/contracts';
import { assertOcrDatasetSemantics } from './evaluation';

const roles:OcrAnnotatedRegion['role'][]=['table','row','label','value','unit','basis','other-text'];
type Agreement = { agreed:number; compared:number; rate:number|null };
type FieldAgreement = {
  ordinal:number;
  readerAFieldId:string|null;
  readerBFieldId:string|null;
  readerAKey:string|null;
  readerBKey:string|null;
  agreement:{labelAndKey:boolean|null;printedNumericText:boolean|null;numericValueAndOperator:boolean|null;unit:boolean|null;basis:boolean|null;column:boolean|null;status:boolean|null};
};
type RegionAgreement = {role:OcrAnnotatedRegion['role'];readerACount:number;readerBCount:number;paired:number;overlapAtLeastHalf:number;meanBoundingBoxIoU:number|null};
export type OcrAnnotationComparison = {
  image:{imageId:string;productGroupId:string;sha256:string};
  readers:{readerA:string;readerB:string};
  alignmentRule:string;
  fields:{readerACount:number;readerBCount:number;pairedCount:number;readerAOnly:number;readerBOnly:number;perDimension:Record<keyof FieldAgreement['agreement'],Agreement>;rows:FieldAgreement[]};
  regions:RegionAgreement[];
  limitations:string[];
};

export function compareOcrAnnotationPasses(first:unknown,second:unknown):OcrAnnotationComparison {
  const readerA=ocrAnnotationPassSchema.parse(first);
  const readerB=ocrAnnotationPassSchema.parse(second);
  const a=readerA.record,b=readerB.record;
  if(a.imageId!==b.imageId||a.image.sha256.toLowerCase()!==b.image.sha256.toLowerCase()||a.image.width!==b.image.width||a.image.height!==b.image.height) throw new Error('Annotation passes must refer to the same image ID, SHA-256 and dimensions');
  if(a.productGroupId!==b.productGroupId) throw new Error('Annotation passes must use the same product-group ID');
  if(a.split!==b.split) throw new Error('Annotation passes must use the same dataset split');
  if(readerA.annotatorCode===readerB.annotatorCode) throw new Error('Annotation passes must use distinct annotator codes');

  const aFields=a.annotations.nutrients,bFields=b.annotations.nutrients;
  const dimensions:Array<keyof FieldAgreement['agreement']>=['labelAndKey','printedNumericText','numericValueAndOperator','unit','basis','column','status'];
  const counts=Object.fromEntries(dimensions.map(key=>[key,{agreed:0,compared:0,rate:null as number|null}])) as Record<keyof FieldAgreement['agreement'],Agreement>;
  const rows:FieldAgreement[]=[];
  const paired=Math.min(aFields.length,bFields.length);
  for(let index=0;index<Math.max(aFields.length,bFields.length);index++){
    const fieldA=aFields[index]??null,fieldB=bFields[index]??null;
    const agreement=fieldA&&fieldB?compareField(fieldA,fieldB):{labelAndKey:null,printedNumericText:null,numericValueAndOperator:null,unit:null,basis:null,column:null,status:null};
    if(fieldA&&fieldB)for(const key of dimensions){counts[key].compared++;if(agreement[key])counts[key].agreed++;}
    rows.push({ordinal:index+1,readerAFieldId:fieldA?.fieldId??null,readerBFieldId:fieldB?.fieldId??null,readerAKey:fieldA?.key??null,readerBKey:fieldB?.key??null,agreement});
  }
  for(const key of dimensions)counts[key].rate=counts[key].compared===0?null:counts[key].agreed/counts[key].compared;

  const regionAgreement=roles.map(role=>{
    const aRegions=a.annotations.tableRegions.filter(region=>region.role===role);
    const bRegions=b.annotations.tableRegions.filter(region=>region.role===role);
    const regionPairs=Math.min(aRegions.length,bRegions.length);
    const ious=Array.from({length:regionPairs},(_,index)=>boundingBoxIoU(aRegions[index].polygon,bRegions[index].polygon));
    return {role,readerACount:aRegions.length,readerBCount:bRegions.length,paired:regionPairs,overlapAtLeastHalf:ious.filter(iou=>iou>=.5).length,meanBoundingBoxIoU:ious.length?ious.reduce((sum,iou)=>sum+iou,0)/ious.length:null};
  });

  return {
    image:{imageId:a.imageId,productGroupId:a.productGroupId,sha256:a.image.sha256.toLowerCase()},
    readers:{readerA:readerA.annotatorCode,readerB:readerB.annotatorCode},
    alignmentRule:'Nutrient rows are paired by their array order; annotate each pass top-to-bottom. Unpaired rows are counted separately and not silently shifted.',
    fields:{readerACount:aFields.length,readerBCount:bFields.length,pairedCount:paired,readerAOnly:Math.max(0,aFields.length-bFields.length),readerBOnly:Math.max(0,bFields.length-aFields.length),perDimension:counts,rows},
    regions:regionAgreement,
    limitations:['Agreement is not adjudication or evidence of OCR accuracy.','Field pairs use array order and can be wrong if readers annotated rows in different orders; review key mismatches before adjudication.','Region overlap compares bounding boxes of the annotated polygons in original-image normalized coordinates. The 0.5 IoU threshold is a descriptive pilot rule, not a universal standard.']
  };
}

type ReaderSide='reader-a'|'reader-b';
type AdjudicationOutput=ReturnType<typeof ocrDatasetRecordSchema.parse>;
const regionFieldRoles=[
  ['labelRegionId','label'],['valueRegionId','value'],['rowRegionId','row'],['unitRegionId','unit'],['basisRegionId','basis']
] as const;
const agreementDimensions:Array<keyof FieldAgreement['agreement']>=['labelAndKey','printedNumericText','numericValueAndOperator','unit','basis','column','status'];

/**
 * Builds an auditable reference record from two blind, single-reader passes.
 * Every source field must be explicitly mapped once; no array-order matching
 * or automatic conflict resolution is performed.
 */
export function adjudicateOcrAnnotationPasses(
  first:unknown,
  second:unknown,
  input:unknown,
  sourcePassSha256s:{readerA:string;readerB:string}
):AdjudicationOutput {
  const readerA=ocrAnnotationPassSchema.parse(first);
  const readerB=ocrAnnotationPassSchema.parse(second);
  const adjudication=ocrAdjudicationInputSchema.parse(input);
  const a=readerA.record,b=readerB.record;
  assertSameAnnotationTarget(readerA,readerB);
  assertPassHashes(sourcePassSha256s);
  assertOcrDatasetSemantics(ocrAnnotatedDatasetSchema.parse({schemaVersion:2,datasetVersion:'reader-a-validation',records:[a]}));
  assertOcrDatasetSemantics(ocrAnnotatedDatasetSchema.parse({schemaVersion:2,datasetVersion:'reader-b-validation',records:[b]}));

  const aFields=new Map(a.annotations.nutrients.map(field=>[field.fieldId,field]));
  const bFields=new Map(b.annotations.nutrients.map(field=>[field.fieldId,field]));
  const regionAlignment=measureFieldRegionAlignment(adjudication,aFields,bFields,a.annotations.tableRegions,b.annotations.tableRegions);
  const usedA=new Set<string>(),usedB=new Set<string>(),finalIds=new Set<string>();
  const regionMaps={
    'reader-a':makeRegionMap(a.annotations.tableRegions,'a'),
    'reader-b':makeRegionMap(b.annotations.tableRegions,'b')
  } satisfies Record<ReaderSide,ReturnType<typeof makeRegionMap>>;
  const canonicalRegions=[
    ...mapRegions(a.annotations.tableRegions,'reader-a',regionMaps['reader-a']),
    ...mapRegions(b.annotations.tableRegions,'reader-b',regionMaps['reader-b'])
  ];
  const regionProvenance=([
    ['reader-a',a.annotations.tableRegions,regionMaps['reader-a']],
    ['reader-b',b.annotations.tableRegions,regionMaps['reader-b']]
  ] as const).flatMap(([reader,regions,map])=>regions.map(region=>({reader,sourceRegionId:region.regionId,canonicalRegionId:map.get(region.regionId)!})));
  const outputFields:OcrDatasetField[]=[];
  let dimensionMatches=0,dimensionComparisons=0,pairedRows=0;
  const provenanceDecisions=[] as Array<{fieldId:string;disposition:typeof adjudication.decisions[number]['disposition'];readerAFieldId:string|null;readerBFieldId:string|null;rationale:string}>;

  for(const decision of adjudication.decisions){
    if(finalIds.has(decision.fieldId))throw new Error(`duplicate adjudication field ID ${decision.fieldId}`);
    finalIds.add(decision.fieldId);
    if(decision.readerAFieldId===null&&decision.readerBFieldId===null)throw new Error(`decision ${decision.fieldId} must link at least one source field`);
    const fieldA=claimSourceField(aFields,usedA,decision.readerAFieldId,'reader-a',decision.fieldId);
    const fieldB=claimSourceField(bFields,usedB,decision.readerBFieldId,'reader-b',decision.fieldId);
    if(fieldA&&fieldB){
      pairedRows++;
      const agreement=compareField(fieldA,fieldB);
      for(const dimension of agreementDimensions){dimensionComparisons++;if(agreement[dimension])dimensionMatches++;}
    }

    let selected:OcrDatasetField;
    let regionSide:ReaderSide;
    if(decision.disposition==='reader-a'||decision.disposition==='reader-b'){
      const side=decision.disposition;
      const sourceField=side==='reader-a'?fieldA:fieldB;
      if(!sourceField)throw new Error(`decision ${decision.fieldId} selects ${side} without linking its field`);
      if(decision.field!==null)throw new Error(`decision ${decision.fieldId} must not override a selected reader field`);
      if(decision.regionSource!==side)throw new Error(`decision ${decision.fieldId} regionSource must match ${side}`);
      selected=sourceField;
      regionSide=side;
    } else {
      if(!decision.field)throw new Error(`decision ${decision.fieldId} requires an explicitly adjudicated field`);
      if(decision.field.fieldId!==decision.fieldId)throw new Error(`decision ${decision.fieldId} must use the same final field ID`);
      if(!decision.regionSource&&hasRegionReference(decision.field))throw new Error(`decision ${decision.fieldId} must identify which reader's regions it uses`);
      if(decision.disposition==='manual'&&decision.field.status!=='clear')throw new Error(`manual decision ${decision.fieldId} must be clear; use ambiguous or not-visible when unresolved`);
      if(decision.disposition==='ambiguous')assertWithheldField(decision.field,'ambiguous',decision.fieldId);
      if(decision.disposition==='not-visible')assertWithheldField(decision.field,'not-visible',decision.fieldId);
      selected=decision.field;
      regionSide=decision.regionSource??'reader-a';
    }

    const mapped=mapFieldRegions(selected,regionSide,regionMaps[regionSide],decision.fieldId);
    outputFields.push({...mapped,fieldId:decision.fieldId});
    provenanceDecisions.push({fieldId:decision.fieldId,disposition:decision.disposition,readerAFieldId:decision.readerAFieldId,readerBFieldId:decision.readerBFieldId,rationale:decision.rationale});
  }

  assertAllSourceFieldsCovered(aFields,usedA,'reader-a');
  assertAllSourceFieldsCovered(bFields,usedB,'reader-b');
  if(pairedRows===0||dimensionComparisons===0)throw new Error('At least one explicitly paired field is required to calculate a descriptive reader agreement metric');
  const agreementMetric=dimensionMatches/dimensionComparisons;
  const record=ocrDatasetRecordSchema.parse({
    ...a,
    annotations:{
      language:a.annotations.language,
      tableRegions:canonicalRegions,
      nutrients:outputFields,
      review:{
        annotatorCount:2,
        adjudicated:true,
        agreementMetric,
        referenceStatus:'human-verified',
        method:adjudication.method,
        adjudication:{
          schemaVersion:1,
          adjudicatorCode:adjudication.adjudicatorCode,
          adjudicatedAt:adjudication.adjudicatedAt,
          method:adjudication.method,
          sourcePasses:[
            {reader:'reader-a',annotatorCode:readerA.annotatorCode,sha256:sourcePassSha256s.readerA.toLowerCase()},
            {reader:'reader-b',annotatorCode:readerB.annotatorCode,sha256:sourcePassSha256s.readerB.toLowerCase()}
          ],
          regions:regionProvenance,
          regionAlignment,
          decisions:provenanceDecisions
        }
      }
    }
  });
  assertOcrDatasetSemantics(ocrAnnotatedDatasetSchema.parse({schemaVersion:2,datasetVersion:'adjudication-output',records:[record]}));
  return record;
}

function assertSameAnnotationTarget(readerA:OcrAnnotationPass,readerB:OcrAnnotationPass):void {
  const a=readerA.record,b=readerB.record;
  if(a.imageId!==b.imageId||a.image.sha256.toLowerCase()!==b.image.sha256.toLowerCase()||a.image.width!==b.image.width||a.image.height!==b.image.height||a.image.byteLength!==b.image.byteLength)throw new Error('Annotation passes must refer to the same image ID, SHA-256, dimensions and byte length');
  if(a.productGroupId!==b.productGroupId)throw new Error('Annotation passes must use the same product-group ID');
  if(a.split!==b.split)throw new Error('Annotation passes must use the same dataset split');
  if(JSON.stringify(a.source)!==JSON.stringify(b.source))throw new Error('Annotation passes must have identical source and license provenance');
  if(a.annotations.language!==b.annotations.language)throw new Error('Annotation passes must use the same language');
  if(readerA.annotatorCode===readerB.annotatorCode)throw new Error('Annotation passes must use distinct annotator codes');
}

function assertPassHashes(hashes:{readerA:string;readerB:string}):void {
  if(!/^[a-fA-F0-9]{64}$/.test(hashes.readerA)||!/^[a-fA-F0-9]{64}$/.test(hashes.readerB))throw new Error('Source annotation pass hashes must be SHA-256 hex digests');
  if(hashes.readerA.toLowerCase()===hashes.readerB.toLowerCase())throw new Error('Independent annotation pass hashes must differ');
}

function measureFieldRegionAlignment(
  adjudication:ReturnType<typeof ocrAdjudicationInputSchema.parse>,
  aFields:Map<string,OcrDatasetField>,
  bFields:Map<string,OcrDatasetField>,
  aRegions:OcrAnnotatedRegion[],
  bRegions:OcrAnnotatedRegion[]
){
  const regionRoles=[
    ['label','labelRegionId'],['value','valueRegionId'],['row','rowRegionId'],['unit','unitRegionId'],['basis','basisRegionId']
  ] as const;
  const aRegionMap=new Map(aRegions.map(region=>[region.regionId,region]));
  const bRegionMap=new Map(bRegions.map(region=>[region.regionId,region]));
  return regionRoles.map(([role,fieldKey])=>{
    let readerACount=0,readerBCount=0,paired=0,overlapAtLeastHalf=0;
    const ious:number[]=[];
    for(const decision of adjudication.decisions){
      if(!decision.readerAFieldId||!decision.readerBFieldId)continue;
      const fieldA=aFields.get(decision.readerAFieldId)!,fieldB=bFields.get(decision.readerBFieldId)!;
      const regionA=fieldA[fieldKey],regionB=fieldB[fieldKey];
      if(regionA)readerACount++;
      if(regionB)readerBCount++;
      if(!regionA||!regionB)continue;
      const aShape=aRegionMap.get(regionA),bShape=bRegionMap.get(regionB);
      if(!aShape||!bShape||aShape.role!==role||bShape.role!==role)continue;
      const iou=boundingBoxIoU(aShape.polygon,bShape.polygon);
      paired++;ious.push(iou);if(iou>=.5)overlapAtLeastHalf++;
    }
    return {role,readerACount,readerBCount,paired,overlapAtLeastHalf,meanBoundingBoxIoU:ious.length?ious.reduce((sum,iou)=>sum+iou,0)/ious.length:null};
  });
}

function claimSourceField(fields:Map<string,OcrDatasetField>,used:Set<string>,fieldId:string|null,reader:ReaderSide,decisionId:string):OcrDatasetField|null {
  if(fieldId===null)return null;
  const field=fields.get(fieldId);
  if(!field)throw new Error(`decision ${decisionId} references unknown ${reader} field ${fieldId}`);
  if(used.has(fieldId))throw new Error(`${reader} field ${fieldId} is mapped more than once`);
  used.add(fieldId);
  return field;
}

function assertAllSourceFieldsCovered(fields:Map<string,OcrDatasetField>,used:Set<string>,reader:ReaderSide):void {
  const missing=[...fields.keys()].filter(fieldId=>!used.has(fieldId));
  if(missing.length)throw new Error(`${reader} fields must all be mapped explicitly; unmapped: ${missing.join(', ')}`);
}

function makeRegionMap(regions:OcrAnnotatedRegion[],prefix:'a'|'b'):Map<string,string> {
  return new Map(regions.map((region,index)=>[region.regionId,`${prefix}-${index+1}`]));
}

function mapRegions(regions:OcrAnnotatedRegion[],reader:ReaderSide,map:Map<string,string>):OcrAnnotatedRegion[] {
  return regions.map(region=>({...region,regionId:map.get(region.regionId)!,columnId:region.columnId??null}));
}

function hasRegionReference(field:OcrDatasetField):boolean {
  return regionFieldRoles.some(([key])=>field[key]!==null);
}

function mapFieldRegions(field:OcrDatasetField,reader:ReaderSide,map:Map<string,string>,decisionId:string):OcrDatasetField {
  const result={...field};
  for(const [key] of regionFieldRoles){
    const sourceId=result[key];
    if(sourceId===null)continue;
    const canonicalId=map.get(sourceId);
    if(!canonicalId)throw new Error(`decision ${decisionId} references missing ${reader} region ${sourceId}`);
    result[key]=canonicalId;
  }
  return result;
}

function assertWithheldField(field:OcrDatasetField,status:'ambiguous'|'not-visible',fieldId:string):void {
  if(field.status!==status||field.printedNumericText!==null||field.numericValue!==null||field.numericOperator!==null||field.unit!==null||field.basis!==null||field.basisText!==null){
    throw new Error(`${status} decision ${fieldId} must preserve unknown numeric text, value, operator, unit and basis as null`);
  }
}

function compareField(a:OcrDatasetField,b:OcrDatasetField):FieldAgreement['agreement'] {
  return {
    labelAndKey:a.key===b.key&&a.labelText===b.labelText,
    printedNumericText:(a.printedNumericText??null)===(b.printedNumericText??null),
    numericValueAndOperator:a.numericValue===b.numericValue&&(a.numericOperator??'eq')===(b.numericOperator??'eq'),
    unit:a.unit===b.unit,
    basis:JSON.stringify(a.basis)===JSON.stringify(b.basis)&&a.basisText===b.basisText,
    column:a.columnId===b.columnId,
    status:a.status===b.status
  };
}

function boundingBoxIoU(a:OcrAnnotatedRegion['polygon'],b:OcrAnnotatedRegion['polygon']):number {
  const bounds=(polygon:OcrAnnotatedRegion['polygon'])=>({x0:Math.min(...polygon.map(point=>point[0])),y0:Math.min(...polygon.map(point=>point[1])),x1:Math.max(...polygon.map(point=>point[0])),y1:Math.max(...polygon.map(point=>point[1]))});
  const left=bounds(a),right=bounds(b);
  const areaA=Math.max(0,left.x1-left.x0)*Math.max(0,left.y1-left.y0);
  const areaB=Math.max(0,right.x1-right.x0)*Math.max(0,right.y1-right.y0);
  const intersection=Math.max(0,Math.min(left.x1,right.x1)-Math.max(left.x0,right.x0))*Math.max(0,Math.min(left.y1,right.y1)-Math.max(left.y0,right.y0));
  const union=areaA+areaB-intersection;
  return union===0?0:intersection/union;
}
