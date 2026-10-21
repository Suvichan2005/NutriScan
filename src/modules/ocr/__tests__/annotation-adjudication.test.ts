import { describe, expect, it } from 'vitest';
import { adjudicateOcrAnnotationPasses } from '../annotation';
import { ocrAdjudicationInputSchema, ocrAnnotatedDatasetSchema } from '../../../lib/contracts';
import { assertOcrDatasetSemantics } from '../evaluation';

const polygon=(left:number,top:number,right:number,bottom:number):Array<[number,number]>=>[[left,top],[right,top],[right,bottom],[left,bottom]];
const source={url:'https://example.test/product',imageUrl:'https://example.test/label.jpg',publisher:'Example',uploader:'contributor',licenseId:'CC BY 4.0',licenseUrl:'https://example.test/license',retrievedAt:'2026-10-21',redistributionReview:'approved' as const};

function field(fieldId:string,key:string,value:number,printed:string,ids:{label:string;value:string;row:string;unit:string;basis:string}){
  return {fieldId,key,labelText:key==='energy'?'Energy':'Sodium',printedNumericText:printed,numericValue:value,numericOperator:'eq' as const,unit:key==='energy'?'kcal':'mg',basis:{kind:'per-100g' as const,amount:100,unit:'g' as const},basisText:'Per 100 g',labelRegionId:ids.label,valueRegionId:ids.value,rowRegionId:ids.row,unitRegionId:ids.unit,basisRegionId:ids.basis,columnId:'per-100g',status:'clear' as const};
}

function makePass(annotatorCode:'reader-a'|'reader-b',energy:number,sodium:number){
  const prefix=annotatorCode==='reader-a'?'a':'b';
  const regions=[] as Array<{regionId:string;role:'table'|'label'|'value'|'row'|'unit'|'basis';columnId:string|null;polygon:number[][]}>;
  const addRegions=(name:string,top:number)=>{
    const ids={label:`${prefix}-${name}-label`,value:`${prefix}-${name}-value`,row:`${prefix}-${name}-row`,unit:`${prefix}-${name}-unit`,basis:`${prefix}-${name}-basis`};
    regions.push(
      {regionId:ids.label,role:'label',columnId:null,polygon:polygon(.1,top,.3,top+.02)},
      {regionId:ids.value,role:'value',columnId:'per-100g',polygon:polygon(.7,top,.8,top+.02)},
      {regionId:ids.row,role:'row',columnId:null,polygon:polygon(.1,top,.9,top+.03)},
      {regionId:ids.unit,role:'unit',columnId:'per-100g',polygon:polygon(.8,top,.85,top+.02)},
      {regionId:ids.basis,role:'basis',columnId:'per-100g',polygon:polygon(.6,.1,.9,.13)}
    );
    return ids;
  };
  const energyIds=addRegions('energy',.2),sodiumIds=addRegions('sodium',.25);
  regions.unshift({regionId:`${prefix}-table`,role:'table',columnId:null,polygon:polygon(.05,.05,.95,.5)});
  return {
    schemaVersion:1 as const,annotatorCode,createdAt:'2026-10-21T10:00:00.000Z',record:{
      imageId:'photo-1',productGroupId:'product-1',split:'development' as const,
      image:{sha256:'a'.repeat(64),width:1000,height:1200,byteLength:1234},source,
      annotations:{language:'en',tableRegions:regions,nutrients:[
        field(`${prefix}-energy`,'energy',energy,String(energy),energyIds),
        field(`${prefix}-sodium`,'sodium',sodium,String(sodium),sodiumIds)
      ],review:{annotatorCount:1 as const,adjudicated:false as const,agreementMetric:null,referenceStatus:'single-reader' as const,method:'Independent visual transcription.'}}
    }
  };
}

function makeInput(){
  return ocrAdjudicationInputSchema.parse({
    schemaVersion:1,datasetVersion:'adjudication-test-v1',adjudicatorCode:'reviewer-1',adjudicatedAt:'2026-10-22T08:00:00.000Z',method:'Two independent reads followed by direct visual adjudication.',
    decisions:[
      {fieldId:'energy-final',disposition:'manual',readerAFieldId:'a-energy',readerBFieldId:'b-energy',field:field('energy-final','energy',123,'123',{label:'a-energy-label',value:'a-energy-value',row:'a-energy-row',unit:'a-energy-unit',basis:'a-energy-basis'}),regionSource:'reader-a',rationale:'The printed line reads 123 kcal per 100 g on direct review.'},
      {fieldId:'sodium-final',disposition:'ambiguous',readerAFieldId:'a-sodium',readerBFieldId:'b-sodium',field:{...field('sodium-final','sodium',0,'0',{label:'a-sodium-label',value:'a-sodium-value',row:'a-sodium-row',unit:'a-sodium-unit',basis:'a-sodium-basis'}),printedNumericText:null,numericValue:null,numericOperator:null,unit:null,basis:null,basisText:null,status:'ambiguous'},regionSource:'reader-a',rationale:'The two visual reads disagree and the photographed digits remain unclear.'}
    ]
  });
}

describe('offline OCR annotation adjudication',()=>{
  it('emits a traceable record from explicit field links and keeps disagreement unresolved',()=>{
    const readerA=makePass('reader-a',123,5),readerB=makePass('reader-b',123,50),input=makeInput();
    const record=adjudicateOcrAnnotationPasses(readerA,readerB,input,{readerA:'b'.repeat(64),readerB:'c'.repeat(64)});
    expect(record.annotations.review).toMatchObject({annotatorCount:2,adjudicated:true,referenceStatus:'human-verified',agreementMetric:expect.any(Number)});
    expect(record.annotations.review.adjudication?.sourcePasses).toEqual([
      {reader:'reader-a',annotatorCode:'reader-a',sha256:'b'.repeat(64)},
      {reader:'reader-b',annotatorCode:'reader-b',sha256:'c'.repeat(64)}
    ]);
    expect(record.annotations.review.adjudication?.decisions.map(item=>[item.fieldId,item.readerAFieldId,item.readerBFieldId])).toEqual([
      ['energy-final','a-energy','b-energy'],['sodium-final','a-sodium','b-sodium']
    ]);
    expect(record.annotations.review.adjudication?.regionAlignment.find(item=>item.role==='value')).toMatchObject({readerACount:2,readerBCount:2,paired:2,overlapAtLeastHalf:2,meanBoundingBoxIoU:1});
    expect(record.annotations.nutrients[0]).toMatchObject({fieldId:'energy-final',numericValue:123,unit:'kcal',basis:{kind:'per-100g',amount:100,unit:'g'},labelRegionId:'a-2',valueRegionId:'a-3'});
    expect(record.annotations.nutrients[1]).toMatchObject({fieldId:'sodium-final',status:'ambiguous',printedNumericText:null,numericValue:null,numericOperator:null,unit:null,basis:null});
    expect(record.annotations.tableRegions.find(region=>region.regionId==='a-2')?.role).toBe('label');
    expect(readerA.record.annotations.nutrients[0].numericValue).toBe(123);
    expect(record.annotations.review.agreementMetric).toBeLessThan(1);

    const untraced=structuredClone(record);
    delete untraced.annotations.review.adjudication;
    const dataset=ocrAnnotatedDatasetSchema.parse({schemaVersion:2,datasetVersion:'missing-provenance',records:[untraced]});
    expect(()=>assertOcrDatasetSemantics(dataset)).toThrow(/requires source-pass and field-decision provenance/);

    const promoted=structuredClone(record);
    promoted.annotations.nutrients[1].numericValue=50;
    promoted.annotations.nutrients[1].printedNumericText='50';
    const promotedDataset=ocrAnnotatedDatasetSchema.parse({schemaVersion:2,datasetVersion:'promoted-ambiguity',records:[promoted]});
    expect(()=>assertOcrDatasetSemantics(promotedDataset)).toThrow(/promotes numeric content from an unresolved disposition/);
  });

  it('rejects silent omissions, reused source fields and a disputed value promoted as clear',()=>{
    const a=makePass('reader-a',123,5),b=makePass('reader-b',123,50),input=makeInput();
    const omitted=structuredClone(input);omitted.decisions.pop();
    expect(()=>adjudicateOcrAnnotationPasses(a,b,omitted,{readerA:'b'.repeat(64),readerB:'c'.repeat(64)})).toThrow(/must all be mapped explicitly/);

    const reused=structuredClone(input);reused.decisions[1].readerAFieldId='a-energy';
    expect(()=>adjudicateOcrAnnotationPasses(a,b,reused,{readerA:'b'.repeat(64),readerB:'c'.repeat(64)})).toThrow(/mapped more than once/);

    const promoted=structuredClone(input);promoted.decisions[1].field={...promoted.decisions[1].field!,numericValue:50,printedNumericText:'50',numericOperator:'eq',unit:'mg',basis:{kind:'per-100g',amount:100,unit:'g'},basisText:'Per 100 g',status:'ambiguous'};
    expect(()=>adjudicateOcrAnnotationPasses(a,b,promoted,{readerA:'b'.repeat(64),readerB:'c'.repeat(64)})).toThrow(/must preserve unknown numeric text/);
  });

  it('rejects mismatched image or source provenance before constructing a reference record',()=>{
    const a=makePass('reader-a',123,5),b=makePass('reader-b',123,50);
    b.record.image.sha256='d'.repeat(64);
    expect(()=>adjudicateOcrAnnotationPasses(a,b,makeInput(),{readerA:'b'.repeat(64),readerB:'c'.repeat(64)})).toThrow(/same image ID, SHA-256/);
    b.record.image.sha256='a'.repeat(64);b.record.source={...source,licenseId:'unknown'};
    expect(()=>adjudicateOcrAnnotationPasses(a,b,makeInput(),{readerA:'b'.repeat(64),readerB:'c'.repeat(64)})).toThrow(/identical source and license provenance/);
  });
});
