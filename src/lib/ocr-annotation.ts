import { ocrAnnotationPassSchema, type OcrAnnotationPass, type OcrAnnotatedRegion, type OcrDatasetField } from './contracts';

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
