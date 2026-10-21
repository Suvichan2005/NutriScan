import { describe, expect, it } from 'vitest';
import {
  ocrAnnotatedDatasetSchema,
  ocrEvaluationReceiptSchema,
  ocrExtractionSchema,
  type OcrAnnotatedDataset,
  type OcrEvaluationReceipt
} from '../../../lib/contracts';
import { assertOcrDatasetSemantics, scoreOcrExtraction } from '../evaluation';

function makeDataset() {
  return ocrAnnotatedDatasetSchema.parse({
    schemaVersion:2,
    datasetVersion:'test-dataset-1',
    records:[{
      imageId:'photo-1',
      productGroupId:'product-1',
      split:'held-out',
      image:{sha256:'a'.repeat(64),width:1000,height:1200,byteLength:1234},
      source:{url:'https://example.test/product/1',publisher:'Example',uploader:'annotator',licenseId:'CC BY-SA',licenseUrl:'https://example.test/license',retrievedAt:'2026-10-21',redistributionReview:'pending'},
      annotations:{
        language:'en',
        tableRegions:[],
        nutrients:[
          {fieldId:'sodium-100g',key:'sodium',labelText:'Sodium',numericValue:0,numericOperator:'eq',unit:'mg',basis:{kind:'per-100g',amount:100,unit:'g'},basisText:'Per 100 g',labelRegionId:null,valueRegionId:null,rowRegionId:null,unitRegionId:null,basisRegionId:null,columnId:'100g',status:'clear'},
          {fieldId:'sugars-serving',key:'sugars',labelText:'Sugars',numericValue:12,numericOperator:'eq',unit:'g',basis:{kind:'per-serving',amount:30,unit:'g'},basisText:'Per serving (30 g)',labelRegionId:null,valueRegionId:null,rowRegionId:null,unitRegionId:null,basisRegionId:null,columnId:'serving',status:'clear'},
          {fieldId:'fiber-unclear',key:'fiber',labelText:'Dietary fiber',numericValue:null,numericOperator:'lt',unit:'g',basis:{kind:'per-serving',amount:30,unit:'g'},basisText:'Per serving (30 g)',labelRegionId:null,valueRegionId:null,rowRegionId:null,unitRegionId:null,basisRegionId:null,columnId:'serving',status:'ambiguous'}
        ],
        review:{annotatorCount:2,adjudicated:false,agreementMetric:null,referenceStatus:'model-assisted',method:'Test contract record only'}
      }
    }]
  });
}

function makeExtraction(candidates: unknown[], abstentions: unknown[] = [], recognizedRegions: unknown[] = [], fieldDiagnostics?: unknown[]) {
  return ocrExtractionSchema.parse({
    schemaVersion:1,
    input:{imageId:'photo-1',productGroupId:'product-1',sha256:'a'.repeat(64),width:1000,height:1200},
    engine:{name:'test-reader',version:'1.0',mode:'local',codeRevision:'test',configuration:{},model:null},
    recognizedRegions,
    candidates,
    abstentions,
    fieldDiagnostics:fieldDiagnostics ?? [{key:'fiber',basis:{kind:'per-serving',amount:30,unit:'g'},parserRejectionCode:'unparsed-format'}],
    measurements:{coldStartMs:null,inferenceMs:100,warmRunCount:0,warmMedianMs:null,warmP95Ms:null,networkBytes:0,imageTransferBytes:0,modelBytes:0,memory:{valueBytes:null,scope:'unavailable',measurement:'unavailable'},estimatedCostPer1000Images:null,costCurrency:null,costAssumptions:null,costSourceUrl:null,costAssumptionDate:null},
    environment:{runtime:'node',browser:null,operatingSystem:'test',architecture:'x64',cpu:'test-cpu',gpu:null,deviceClass:'server',threadCount:1,networkProfile:'loopback',cacheState:'unknown',powerProfile:null,thermalState:null}
  });
}

const candidate = (candidateId: string, key: string, numericValue: number, unit: string, basis: unknown, sourceRegionIds: string[] = []) => ({
  candidateId,key,numericValue,numericOperator:'eq',unit,basis,sourceRegionIds,confidence:null
});

function score(candidates: unknown[], abstentions: unknown[] = []): OcrEvaluationReceipt {
  const dataset = makeDataset();
  const extraction = makeExtraction(candidates,abstentions);
  return scoreOcrExtraction(dataset,dataset.records[0],extraction,{
    experimentId:'test-run',datasetVersion:dataset.datasetVersion,runAt:'2026-10-21T12:00:00.000Z',preprocessing:'original bytes'
  });
}

describe('common OCR research evaluation', () => {
  it('keeps printed zero distinct from a missing field and reports its exact unit and basis', () => {
    const receipt = score([candidate('c1','sodium',0,'mg',{kind:'per-100g',amount:100,unit:'g'})]);
    expect(receipt.metrics.fieldScoring.exact).toBe(1);
    expect(receipt.metrics.fieldScoring.omitted).toBe(1);
    expect(receipt.fields.find(field => field.fieldId === 'sodium-100g')?.emitted?.numericValue).toBe(0);
    expect(receipt.fields.find(field => field.fieldId === 'sodium-100g')?.outcome).toBe('exact');
    expect(receipt.referenceStatus).toBe('model-assisted');
  });

  it('counts a basis mismatch as incorrect even when the printed number and unit match', () => {
    const receipt = score([candidate('c1','sugars',12,'g',{kind:'per-100g',amount:100,unit:'g'})]);
    const field = receipt.fields.find(item => item.fieldId === 'sugars-serving');
    expect(field?.outcome).toBe('incorrect');
    expect(field?.numericExact).toBe(true);
    expect(field?.unitExact).toBe(true);
    expect(field?.basisExact).toBe(false);
    expect(receipt.metrics.fieldScoring.basisAccuracy).toBe(0);
  });

  it('separates explicit abstention from silence and retains parser-stage evidence', () => {
    const receipt = score([], [{key:'sugars',basis:{kind:'per-serving',amount:30,unit:'g'},reason:'ambiguous column'}]);
    expect(receipt.metrics.fieldScoring.abstained).toBe(1);
    expect(receipt.metrics.fieldScoring.omitted).toBe(1);
    expect(receipt.fields.find(field => field.fieldId === 'fiber-unclear')?.stage.parserAccepted).toBe(false);
    expect(receipt.fields.find(field => field.fieldId === 'fiber-unclear')?.parserRejectionCode).toBe('unparsed-format');
  });

  it('preserves duplicate conflicting candidates and scores the unmatched one as a false positive', () => {
    const receipt = score([
      candidate('c1','sodium',0,'mg',{kind:'per-100g',amount:100,unit:'g'}),
      candidate('c2','sodium',8,'mg',{kind:'per-100g',amount:100,unit:'g'})
    ]);
    expect(receipt.fields.filter(field => field.emitted?.key === 'sodium')).toHaveLength(2);
    expect(receipt.metrics.fieldScoring.exact).toBe(1);
    expect(receipt.metrics.fieldScoring.falsePositives).toBe(1);
    expect(receipt.metrics.fieldScoring.exactFieldPrecision).toBe(0.5);
  });

  it('excludes predictions matched to unscorable references from precision while counting them separately', () => {
    const receipt = score([
      candidate('c1','sodium',0,'mg',{kind:'per-100g',amount:100,unit:'g'}),
      candidate('c2','fiber',1,'g',{kind:'per-serving',amount:30,unit:'g'})
    ]);
    expect(receipt.metrics.fieldScoring.emitted).toBe(2);
    expect(receipt.metrics.fieldScoring.scoredEmitted).toBe(1);
    expect(receipt.metrics.fieldScoring.unscorableEmitted).toBe(1);
    expect(receipt.metrics.fieldScoring.exactFieldPrecision).toBe(1);
  });

  it('rejects source text in the sanitized tracked receipt', () => {
    const receipt = score([candidate('c1','sodium',0,'mg',{kind:'per-100g',amount:100,unit:'g'})]);
    const withRawText = {...receipt,rawOcrText:'private recognized package text'};
    expect(ocrEvaluationReceiptSchema.safeParse(withRawText).success).toBe(false);
  });

  it('rejects secret or raw-text keys in engine configuration', () => {
    const extraction = makeExtraction([]);
    const unsafe = {...extraction,engine:{...extraction.engine,configuration:{apiKey:'never-store-this'}}};
    expect(ocrExtractionSchema.safeParse(unsafe).success).toBe(false);
  });

  it('rejects an extraction scored against a different image hash', () => {
    const dataset = makeDataset();
    const extraction = makeExtraction([]);
    expect(() => scoreOcrExtraction(dataset,dataset.records[0],{...extraction,input:{...extraction.input,sha256:'b'.repeat(64)}},{
      experimentId:'test-run',datasetVersion:dataset.datasetVersion,runAt:'2026-10-21T12:00:00.000Z',preprocessing:'original bytes'
    })).toThrow(/hash does not match/);
  });

  it('rejects product-family leakage across development and held-out splits', () => {
    const dataset = makeDataset();
    const second = {...dataset.records[0],imageId:'photo-2',split:'development' as const};
    const leaked = {...dataset,records:[...dataset.records,second]} as OcrAnnotatedDataset;
    expect(() => assertOcrDatasetSemantics(leaked)).toThrow(/crosses dataset splits/);
  });

  it('scores text detection, label/value recognition, row-column association, basis and parser stages separately', () => {
    const base = makeDataset();
    const polygon = (left:number,top:number,right:number,bottom:number) => [[left,top],[right,top],[right,bottom],[left,bottom]];
    const sodiumRegions = [
      {regionId:'sodium-label',role:'label',polygon:polygon(0.1,0.1,0.3,0.14)},
      {regionId:'sodium-value',role:'value',columnId:'100g',polygon:polygon(0.7,0.1,0.85,0.14)},
      {regionId:'sodium-row',role:'row',polygon:polygon(0.1,0.1,0.9,0.14)},
      {regionId:'sodium-unit',role:'unit',columnId:'100g',polygon:polygon(0.82,0.1,0.85,0.14)},
      {regionId:'sodium-basis',role:'basis',columnId:'100g',polygon:polygon(0.68,0.04,0.9,0.08)}
    ];
    const dataset = ocrAnnotatedDatasetSchema.parse({...base,records:[{
      ...base.records[0],
      annotations:{...base.records[0].annotations,tableRegions:sodiumRegions,nutrients:base.records[0].annotations.nutrients.map(field => field.fieldId === 'sodium-100g' ? {
        ...field,labelRegionId:'sodium-label',valueRegionId:'sodium-value',rowRegionId:'sodium-row',unitRegionId:'sodium-unit',basisRegionId:'sodium-basis'
      } : field)}
    }]});
    const extraction = makeExtraction([
      candidate('c1','sodium',0,'mg',{kind:'per-100g',amount:100,unit:'g'},['line-sodium'])
    ],[],[
      {regionId:'line-sodium',role:'other-text',polygon:polygon(0.1,0.1,0.9,0.14),confidence:0.99,text:'Sodium 0 mg'},
      {regionId:'line-sodium-label',role:'other-text',polygon:polygon(0.1,0.1,0.3,0.14),confidence:0.99,text:'Sodium'},
      {regionId:'line-sodium-basis',role:'other-text',polygon:polygon(0.68,0.04,0.9,0.08),confidence:0.99,text:'Per 100 g'}
    ]);
    const receipt = scoreOcrExtraction(dataset,dataset.records[0],extraction,{
      experimentId:'stage-probe',datasetVersion:dataset.datasetVersion,runAt:'2026-10-21T12:00:00.000Z',preprocessing:'original bytes'
    });
    const scored = receipt.fields.find(field => field.fieldId === 'sodium-100g')?.stage;
    expect(scored).toEqual({textRegionDetected:true,labelRecognized:true,valueRecognized:true,rowColumnAssociated:true,unitRecognized:true,basisRecognized:true,parserAccepted:true});
  });

  it('reports a detection miss separately from downstream recognition and parser stages', () => {
    const base = makeDataset();
    const polygon = [[0.1,0.1],[0.9,0.1],[0.9,0.14],[0.1,0.14]];
    const dataset = ocrAnnotatedDatasetSchema.parse({...base,records:[{
      ...base.records[0],
      annotations:{...base.records[0].annotations,tableRegions:[
        {regionId:'sodium-label',role:'label',polygon},
        {regionId:'sodium-value',role:'value',columnId:'100g',polygon},
        {regionId:'sodium-row',role:'row',polygon}
      ],nutrients:base.records[0].annotations.nutrients.map(field => field.fieldId === 'sodium-100g' ? {
        ...field,labelRegionId:'sodium-label',valueRegionId:'sodium-value',rowRegionId:'sodium-row'
      } : field)}
    }]});
    const extraction = makeExtraction([],[],[],[{key:'sodium',basis:{kind:'per-100g',amount:100,unit:'g'},parserRejectionCode:'missing-value'}]);
    const receipt = scoreOcrExtraction(dataset,dataset.records[0],extraction,{
      experimentId:'detection-probe',datasetVersion:dataset.datasetVersion,runAt:'2026-10-21T12:00:00.000Z',preprocessing:'original bytes'
    });
    const scored = receipt.fields.find(field => field.fieldId === 'sodium-100g');
    expect(scored?.stage.textRegionDetected).toBe(false);
    expect(scored?.stage.labelRecognized).toBeNull();
    expect(scored?.stage.valueRecognized).toBeNull();
    expect(scored?.stage.parserAccepted).toBe(false);
    expect(scored?.parserRejectionCode).toBe('missing-value');
  });
});
