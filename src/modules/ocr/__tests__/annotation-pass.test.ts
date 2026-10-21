import { describe, expect, it } from 'vitest';
import { ocrAnnotationPassSchema } from '../../../lib/contracts';

const pass={
  schemaVersion:1,
  annotatorCode:'reader-a',
  createdAt:'2026-10-21T10:00:00.000Z',
  record:{
    imageId:'photo-1',productGroupId:'product-1',split:'not-assigned',
    image:{sha256:'a'.repeat(64),width:1200,height:1600,byteLength:12345},
    source:{url:'https://example.test/product',imageUrl:'https://example.test/image.jpg',publisher:'Example',uploader:'contributor',licenseId:'CC BY-SA',licenseUrl:'https://example.test/license',retrievedAt:'2026-10-21',redistributionReview:'pending'},
    annotations:{
      language:'en',
      tableRegions:[{regionId:'r1',role:'value',columnId:'per-100g',polygon:[[.1,.2],[.2,.2],[.2,.25],[.1,.25]]}],
      nutrients:[{fieldId:'field-1',key:'energy',labelText:'Energy',printedNumericText:'1,20',numericValue:1.2,numericOperator:'eq',unit:'kcal',basis:{kind:'per-100g',amount:100,unit:'g'},basisText:'Per 100 g',labelRegionId:null,valueRegionId:'r1',rowRegionId:null,unitRegionId:null,basisRegionId:null,columnId:'per-100g',status:'clear'}],
      review:{annotatorCount:1,adjudicated:false,agreementMetric:null,referenceStatus:'single-reader',method:'Independent manual transcription from source pixels.'}
    }
  }
};

describe('independent OCR annotation pass contract',()=>{
  it('retains exact printed numeric text alongside its numeric interpretation and geometry',()=>{
    const parsed=ocrAnnotationPassSchema.parse(pass);
    expect(parsed.record.annotations.nutrients[0].printedNumericText).toBe('1,20');
    expect(parsed.record.annotations.nutrients[0].numericValue).toBe(1.2);
    expect(parsed.record.annotations.tableRegions[0].polygon).toHaveLength(4);
    expect(parsed.record.annotations.review.referenceStatus).toBe('single-reader');
  });

  it('rejects photo bytes, local file paths and unmodeled private fields',()=>{
    expect(ocrAnnotationPassSchema.safeParse({...pass,imageBytes:'base64-photo'}).success).toBe(false);
    expect(ocrAnnotationPassSchema.safeParse({...pass,localPath:'C:\\private\\photo.jpg'}).success).toBe(false);
    const withBytes={...pass,record:{...pass.record,image:{...pass.record.image,bytes:'base64-photo'}}};
    expect(ocrAnnotationPassSchema.safeParse(withBytes).success).toBe(false);
  });

  it('cannot claim two-reader adjudication from a single pass',()=>{
    const invalid=structuredClone(pass);
    invalid.record.annotations.review.annotatorCount=2;
    invalid.record.annotations.review.referenceStatus='human-verified';
    expect(ocrAnnotationPassSchema.safeParse(invalid).success).toBe(false);
  });
});
