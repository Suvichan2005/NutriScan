import { describe, expect, it } from 'vitest';
import { compareOcrAnnotationPasses } from '../ocr-annotation';

const makePass=(annotatorCode:string,changes:Record<string,unknown>={})=>({
  schemaVersion:1,
  annotatorCode,
  createdAt:'2026-10-21T10:00:00.000Z',
  record:{
    imageId:'photo-1',productGroupId:'product-1',split:'not-assigned',
    image:{sha256:'a'.repeat(64),width:1000,height:1200,byteLength:1234},
    source:{url:'https://example.test/product',publisher:'Example',uploader:'contributor',licenseId:'CC BY-SA',licenseUrl:'https://example.test/license',retrievedAt:'2026-10-21',redistributionReview:'pending'},
    annotations:{
      language:'en',tableRegions:[{regionId:'r1',role:'table',polygon:[[.1,.1],[.9,.1],[.9,.9],[.1,.9]]}],
      nutrients:[{fieldId:'field-1',key:'energy',labelText:'Energy',printedNumericText:'1,20',numericValue:1.2,numericOperator:'eq',unit:'kcal',basis:{kind:'per-100g',amount:100,unit:'g'},basisText:'Per 100 g',labelRegionId:null,valueRegionId:null,rowRegionId:null,unitRegionId:null,basisRegionId:null,columnId:'per-100g',status:'clear'}],
      review:{annotatorCount:1,adjudicated:false,agreementMetric:null,referenceStatus:'single-reader',method:'Independent manual transcription.'}
    }
  },
  ...changes
});

describe('independent OCR annotation agreement',()=>{
  it('reports exact numeric text separately from normalized number, unit and basis agreement',()=>{
    const a=makePass('reader-a');
    const b=structuredClone(a) as ReturnType<typeof makePass>;
    b.annotatorCode='reader-b';
    b.record.annotations.nutrients[0].printedNumericText='1.20';
    b.record.annotations.nutrients[0].unit='mg';
    b.record.annotations.tableRegions[0].polygon=[[.12,.1],[.88,.1],[.88,.9],[.12,.9]];
    const result=compareOcrAnnotationPasses(a,b);
    expect(result.fields.perDimension.printedNumericText).toMatchObject({agreed:0,compared:1,rate:0});
    expect(result.fields.perDimension.numericValueAndOperator).toMatchObject({agreed:1,compared:1,rate:1});
    expect(result.fields.perDimension.unit).toMatchObject({agreed:0,compared:1,rate:0});
    expect(result.fields.perDimension.basis).toMatchObject({agreed:1,compared:1,rate:1});
    expect(result.regions.find(region=>region.role==='table')?.overlapAtLeastHalf).toBe(1);
    expect(result.limitations).toContain('Agreement is not adjudication or evidence of OCR accuracy.');
  });

  it('keeps missing reader rows outside paired-field denominators and blocks mismatched image hashes',()=>{
    const a=makePass('reader-a');
    const b=makePass('reader-b',{record:{...(makePass('reader-b') as ReturnType<typeof makePass>).record,annotations:{...(makePass('reader-b') as ReturnType<typeof makePass>).record.annotations,nutrients:[]}}});
    const result=compareOcrAnnotationPasses(a,b);
    expect(result.fields).toMatchObject({pairedCount:0,readerAOnly:1,readerBOnly:0});
    expect(result.fields.perDimension.numericValueAndOperator).toMatchObject({agreed:0,compared:0,rate:null});
    const mismatched=structuredClone(b) as typeof b;
    mismatched.record.image.sha256='b'.repeat(64);
    expect(()=>compareOcrAnnotationPasses(a,mismatched)).toThrow(/same image ID, SHA-256 and dimensions/);
    expect(()=>compareOcrAnnotationPasses(a,a)).toThrow(/distinct annotator codes/);
  });
});
