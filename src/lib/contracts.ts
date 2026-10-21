import { z } from 'zod';
export const nutrientKeys = ['energy','carbohydrate','sugars','addedSugars','protein','fat','saturatedFat','fiber','sodium','salt'] as const;
export type NutrientKey = typeof nutrientKeys[number];
export const basisSchema = z.object({amount:z.number().positive().max(10000),unit:z.enum(['g','ml']),description:z.string().max(150)});
export const observationSchema = z.object({id:z.string(),field:z.string(),text:z.string(),side:z.enum(['front','back','extra','text']),confidence:z.number().min(0).max(100).nullable(),bbox:z.object({x0:z.number(),y0:z.number(),x1:z.number(),y1:z.number()}).optional(),origin:z.enum(['ocr','barcode','user','vision','fixture']),imageId:z.string().optional(),value:z.number().optional(),unit:z.string().optional()});
export type Observation = z.infer<typeof observationSchema>;
export const nutrientSchema = z.object({key:z.enum(nutrientKeys),value:z.number().finite().nonnegative().max(100000),unit:z.enum(['g','mg','kcal','kJ']),basis:basisSchema.nullable(),observationIds:z.array(z.string()),status:z.enum(['observed','corrected','conflict'])});
export type Nutrient = z.infer<typeof nutrientSchema>;
export const packageSchema = z.object({id:z.string(),name:z.string().max(200),brand:z.string().max(120).optional(),barcode:z.string().optional(),identityConflict:z.boolean().optional(),userDescription:z.string().max(4000).optional(),netWeight:z.object({value:z.number().positive(),unit:z.enum(['g','ml'])}).optional(),serving:z.object({value:z.number().positive(),unit:z.enum(['g','ml'])}).optional(),ingredients:z.array(z.string()),additives:z.array(z.string()),allergens:z.array(z.string()),claims:z.array(z.string()),license:z.string().optional(),nutrients:z.array(nutrientSchema),observations:z.array(observationSchema),rawText:z.string().max(40000),warnings:z.array(z.string()),synthetic:z.boolean(),createdAt:z.string()});
export type PackageData = z.infer<typeof packageSchema>;
export const sourceSchema = z.object({id:z.string(),title:z.string(),publisher:z.string(),url:z.string().url(),category:z.enum(['guideline','assessment','regulation','product','literature','registry','method']),jurisdiction:z.string(),publishedAt:z.string().nullable(),effectiveAt:z.string().nullable(),retrievedAt:z.string(),summary:z.string(),limitations:z.string(),license:z.string().optional()});
export type EvidenceSource = z.infer<typeof sourceSchema>;
export type Calculation = {id:string;label:string;nutrient:NutrientKey;input:number;inputUnit:string;basisAmount:number;portion:number;portionUnit:'g'|'ml';result:number;unit:string;formula:string;observationIds:string[];assumptions:string[]};
export type Finding = {id:string;title:string;detail:string;status:'observed'|'calculated'|'context'|'uncertain'|'conflict';observationIds:string[];sourceIds:string[];calculationIds:string[]};
export type Audit = {answer:string;findings:Finding[];calculations:Calculation[];sources:EvidenceSource[];limitations:string[];nextQuestions:string[];trace:{tool:string;reason:string;status:string}[]};
export const profileSchema = z.object({dietaryPattern:z.string().max(500),allergies:z.string().max(1000),intolerances:z.string().max(1000),healthConsiderations:z.string().max(1500),goals:z.string().max(1000),ageGroup:z.string().max(80),sexOrReferenceGroup:z.string().max(100),country:z.string().max(80),locality:z.string().max(100)}).strict();
export type Profile = z.infer<typeof profileSchema>;
export const defaultProfile:Profile = {dietaryPattern:'',allergies:'',intolerances:'',healthConsiderations:'',goals:'',ageGroup:'',sexOrReferenceGroup:'',country:'',locality:''};
export const hasUserContext = (profile:Profile):boolean => Object.values(profile).some(value=>value.trim().length>0);
export type ProductRecord = {id:string;name:string;brand:string;barcode:string;quantity:string;countries:string[];url:string;retrievedAt:string;lastModified:string|null;nutrients:{key:NutrientKey;value:number;unit:string;basis:{amount:100;unit:'g'|'ml'}|null}[];ingredients:string;allergens:string[];match:'barcode'|'candidate';availability:'local stock unverified';imageUrl?:string;confidence?:string;warnings?:string[]};
export type ResearchItem = {id:string;title:string;url:string;publisher:string;publishedAt:string|null;effectiveAt?:string|null;retrievedAt:string;category:string;summary:string;limitations:string;doi?:string};
export type ImageAsset = {id:string;side:'front'|'back'|'extra';role?:'unknown'|'front'|'nutrition'|'ingredients'|'other';description?:string;rotation?:number;blob:Blob;url:string;width:number;height:number;name:string};
export const evidenceQuerySchema=z.object({query:z.string().trim().min(2).max(1200),limit:z.number().int().min(1).max(5).optional()}).strict();

// OCR research contracts are separate from the product's package schema. They
// describe observations and measurements; they never make a package reading
// authoritative. Raw recognized text is permitted only in the short-lived
// engine result and must be removed before a tracked evaluation receipt is made.
export const ocrEvaluationSplitSchema = z.enum(['development','held-out','not-assigned']);
export const ocrEngineModeSchema = z.enum(['browser','local','server','remote','hybrid']);
export const ocrBasisKindSchema = z.enum(['per-100g','per-100ml','per-serving','per-package','per-unit','other','unknown']);
export const ocrBasisSchema = z.object({
  kind:ocrBasisKindSchema,
  amount:z.number().positive().max(10000).nullable(),
  unit:z.enum(['g','ml','piece']).nullable()
}).strict();
export type OcrBasis = z.infer<typeof ocrBasisSchema>;

export const ocrPolygonSchema = z.array(z.tuple([z.number().min(0).max(1),z.number().min(0).max(1)])).min(4).max(32);
export const ocrRegionRoleSchema = z.enum(['table','row','label','value','unit','basis','other-text']);
export const ocrAnnotatedRegionSchema = z.object({
  regionId:z.string().min(1).max(100),
  role:ocrRegionRoleSchema,
  columnId:z.string().min(1).max(100).nullable().optional(),
  polygon:ocrPolygonSchema
}).strict();
export type OcrAnnotatedRegion = z.infer<typeof ocrAnnotatedRegionSchema>;
export const ocrReferenceStatusSchema = z.enum(['human-verified','model-assisted','single-reader']);
export const ocrDatasetFieldSchema = z.object({
  fieldId:z.string().min(1).max(120),
  key:z.string().min(1).max(80),
  labelText:z.string().min(1).max(120),
  // Keep the literal printed digits for auditability alongside the normalized
  // numeric value used by exact-value scoring. Older datasets may omit it.
  printedNumericText:z.string().max(40).nullable().optional(),
  numericValue:z.number().finite().nonnegative().nullable(),
  numericOperator:z.enum(['eq','lt','lte','gt','gte']).nullable().default('eq'),
  unit:z.string().min(1).max(24).nullable(),
  basis:ocrBasisSchema.nullable(),
  basisText:z.string().min(1).max(160).nullable(),
  labelRegionId:z.string().min(1).max(100).nullable(),
  valueRegionId:z.string().min(1).max(100).nullable(),
  rowRegionId:z.string().min(1).max(100).nullable(),
  unitRegionId:z.string().min(1).max(100).nullable(),
  basisRegionId:z.string().min(1).max(100).nullable(),
  columnId:z.string().min(1).max(100).nullable(),
  status:z.enum(['clear','ambiguous','not-visible'])
}).strict();
export type OcrDatasetField = z.infer<typeof ocrDatasetFieldSchema>;
export const ocrDatasetRecordSchema = z.object({
  imageId:z.string().min(1).max(160),
  productGroupId:z.string().min(1).max(160),
  split:ocrEvaluationSplitSchema,
  image:z.object({
    sha256:z.string().regex(/^[a-fA-F0-9]{64}$/),
    width:z.number().int().positive(),
    height:z.number().int().positive(),
    byteLength:z.number().int().nonnegative()
  }).strict(),
  source:z.object({
    url:z.string().url(),
    imageUrl:z.string().url().nullable().optional(),
    publisher:z.string().min(1).max(160),
    uploader:z.string().min(1).max(160),
    licenseId:z.string().min(1).max(80),
    licenseUrl:z.string().url(),
    retrievedAt:z.iso.date(),
    redistributionReview:z.enum(['pending','approved','not-approved','unknown'])
  }).strict(),
  annotations:z.object({
    language:z.string().min(2).max(80),
    tableRegions:z.array(ocrAnnotatedRegionSchema),
    nutrients:z.array(ocrDatasetFieldSchema),
    review:z.object({
      annotatorCount:z.number().int().positive(),
      adjudicated:z.boolean(),
      agreementMetric:z.number().min(0).max(1).nullable(),
      referenceStatus:ocrReferenceStatusSchema,
      method:z.string().min(1).max(1000)
    }).strict()
  }).strict()
}).strict();
export type OcrDatasetRecord = z.infer<typeof ocrDatasetRecordSchema>;
const ocrAnnotationPassReviewSchema = z.object({
  annotatorCount:z.literal(1),
  adjudicated:z.literal(false),
  agreementMetric:z.null(),
  referenceStatus:z.literal('single-reader'),
  method:z.string().min(1).max(1000)
}).strict();
export const ocrAnnotationPassRecordSchema = ocrDatasetRecordSchema.extend({
  annotations:ocrDatasetRecordSchema.shape.annotations.extend({review:ocrAnnotationPassReviewSchema})
}).strict();
export const ocrAnnotationPassSchema = z.object({
  schemaVersion:z.literal(1),
  annotatorCode:z.string().trim().min(1).max(80),
  createdAt:z.iso.datetime(),
  record:ocrAnnotationPassRecordSchema
}).strict();
export type OcrAnnotationPass = z.infer<typeof ocrAnnotationPassSchema>;
export const ocrAnnotatedDatasetSchema = z.object({
  schemaVersion:z.literal(2),
  datasetVersion:z.string().min(1).max(80),
  records:z.array(ocrDatasetRecordSchema)
}).strict();
export type OcrAnnotatedDataset = z.infer<typeof ocrAnnotatedDatasetSchema>;

export const ocrStageSchema = z.object({
  textRegionDetected:z.boolean().nullable(),
  labelRecognized:z.boolean().nullable(),
  valueRecognized:z.boolean().nullable(),
  rowColumnAssociated:z.boolean().nullable(),
  unitRecognized:z.boolean().nullable(),
  basisRecognized:z.boolean().nullable(),
  parserAccepted:z.boolean().nullable()
}).strict();
export type OcrStage = z.infer<typeof ocrStageSchema>;
export const ocrParserRejectionCodeSchema = z.enum(['low-confidence','unparsed-format','unsupported-nutrient','missing-value','missing-unit','missing-basis','conflicting-candidates','invalid-number','other']);
export const ocrEngineConfigurationSchema = z.record(
  z.string().min(1).max(120).regex(/^(?!.*(?:api[-_]?key|auth|credential|cookie|access[-_]?token|secret|password|prompt|raw[-_]?(?:text|ocr)|recognized[-_]?text|image[-_]?(?:bytes|data)|request[-_]?body|conversation)).*$/i),
  z.union([z.string().max(200),z.number().finite(),z.boolean(),z.null()])
);
export const ocrModelProvenanceSchema = z.object({
  name:z.string().min(1).max(160),
  version:z.string().min(1).max(120),
  artifactUrls:z.array(z.string().url()).max(32),
  artifactSha256:z.array(z.string().regex(/^[a-fA-F0-9]{64}$/)).max(32),
  licenseId:z.string().max(120).nullable(),
  licenseUrl:z.string().url().nullable(),
  sizeBytes:z.number().int().nonnegative().nullable()
}).strict();
export const ocrRecognizedRegionSchema = z.object({
  regionId:z.string().min(1).max(100),
  role:ocrRegionRoleSchema,
  polygon:ocrPolygonSchema,
  confidence:z.number().min(0).max(1).nullable(),
  text:z.string().max(2000)
}).strict();
export const ocrExtractionCandidateSchema = z.object({
  candidateId:z.string().min(1).max(120),
  key:z.string().min(1).max(80),
  numericValue:z.number().finite().nonnegative().nullable(),
  numericOperator:z.enum(['eq','lt','lte','gt','gte']).nullable(),
  unit:z.string().min(1).max(24).nullable(),
  basis:ocrBasisSchema.nullable(),
  sourceRegionIds:z.array(z.string().min(1).max(100)).max(100),
  confidence:z.number().min(0).max(1).nullable()
}).strict();
export type OcrExtractionCandidate = z.infer<typeof ocrExtractionCandidateSchema>;
export const ocrExtractionSchema = z.object({
  schemaVersion:z.literal(1),
  input:z.object({
    imageId:z.string().min(1).max(160),
    productGroupId:z.string().min(1).max(160).optional(),
    sha256:z.string().regex(/^[a-fA-F0-9]{64}$/),
    width:z.number().int().positive(),
    height:z.number().int().positive()
  }).strict(),
  engine:z.object({
    name:z.string().min(1).max(120),
    version:z.string().min(1).max(120),
    mode:ocrEngineModeSchema,
    codeRevision:z.string().min(1).max(120),
    configuration:ocrEngineConfigurationSchema,
    model:ocrModelProvenanceSchema.nullable()
  }).strict(),
  recognizedRegions:z.array(ocrRecognizedRegionSchema).max(10000),
  candidates:z.array(ocrExtractionCandidateSchema).max(1000),
  abstentions:z.array(z.object({key:z.string().min(1).max(80),basis:ocrBasisSchema.nullable(),reason:z.string().min(1).max(240)}).strict()).max(1000),
  fieldDiagnostics:z.array(z.object({key:z.string().min(1).max(80),basis:ocrBasisSchema.nullable(),parserRejectionCode:ocrParserRejectionCodeSchema.nullable()}).strict()).max(1000),
  measurements:z.object({
    coldStartMs:z.number().nonnegative().nullable(),
    inferenceMs:z.number().nonnegative().nullable(),
    warmRunCount:z.number().int().nonnegative().nullable(),
    warmMedianMs:z.number().nonnegative().nullable(),
    warmP95Ms:z.number().nonnegative().nullable(),
    networkBytes:z.number().int().nonnegative().nullable(),
    imageTransferBytes:z.number().int().nonnegative().nullable(),
    modelBytes:z.number().int().nonnegative().nullable(),
    memory:z.object({valueBytes:z.number().int().nonnegative().nullable(),scope:z.enum(['browser-js-heap','browser-process-rss','wasm-linear-memory','process-rss','unavailable']),measurement:z.enum(['peak','sample','unavailable'])}).strict(),
    estimatedCostPer1000Images:z.number().nonnegative().nullable(),
    costCurrency:z.string().length(3).nullable(),
    costAssumptions:z.string().max(2000).nullable(),
    costSourceUrl:z.string().url().nullable(),
    costAssumptionDate:z.iso.date().nullable()
  }).strict(),
  environment:z.object({
    runtime:z.string().max(160).nullable(),
    browser:z.string().max(160).nullable(),
    operatingSystem:z.string().max(160).nullable(),
    architecture:z.string().max(80).nullable(),
    cpu:z.string().max(160).nullable(),
    gpu:z.string().max(160).nullable(),
    deviceClass:z.string().max(120).nullable(),
    threadCount:z.number().int().positive().nullable(),
    networkProfile:z.string().max(120).nullable(),
    cacheState:z.enum(['cold','warm','mixed','unknown']),
    powerProfile:z.string().max(120).nullable(),
    thermalState:z.string().max(120).nullable()
  }).strict()
}).strict();
export type OcrExtraction = z.infer<typeof ocrExtractionSchema>;

export const ocrEvaluationReceiptSchema = z.object({
  schemaVersion:z.literal(2),
  experimentId:z.string().min(1).max(160),
  datasetVersion:z.string().min(1).max(80),
  runAt:z.iso.datetime(),
  split:ocrEvaluationSplitSchema,
  referenceStatus:ocrReferenceStatusSchema,
  input:z.object({
    imageId:z.string().min(1).max(160),
    productGroupId:z.string().min(1).max(160),
    sha256:z.string().regex(/^[a-fA-F0-9]{64}$/),
    width:z.number().int().positive(),
    height:z.number().int().positive(),
    preprocessing:z.string().max(300)
  }).strict(),
  engine:z.object({
    name:z.string().min(1).max(120),
    version:z.string().min(1).max(120),
    mode:ocrEngineModeSchema,
    codeRevision:z.string().min(1).max(120),
    configuration:ocrEngineConfigurationSchema,
    model:ocrModelProvenanceSchema.nullable()
  }).strict(),
  environment:z.object({
    runtime:z.string().max(160).nullable(),
    browser:z.string().max(160).nullable(),
    operatingSystem:z.string().max(160).nullable(),
    architecture:z.string().max(80).nullable(),
    cpu:z.string().max(160).nullable(),
    gpu:z.string().max(160).nullable(),
    deviceClass:z.string().max(120).nullable(),
    threadCount:z.number().int().positive().nullable(),
    networkProfile:z.string().max(120).nullable(),
    cacheState:z.enum(['cold','warm','mixed','unknown']),
    powerProfile:z.string().max(120).nullable(),
    thermalState:z.string().max(120).nullable()
  }).strict(),
  metrics:z.object({
    coldStartMs:z.number().nonnegative().nullable(),
    inferenceMs:z.number().nonnegative().nullable(),
    warmRunCount:z.number().int().nonnegative().nullable(),
    warmMedianMs:z.number().nonnegative().nullable(),
    warmP95Ms:z.number().nonnegative().nullable(),
    networkBytes:z.number().int().nonnegative().nullable(),
    imageTransferBytes:z.number().int().nonnegative().nullable(),
    modelBytes:z.number().int().nonnegative().nullable(),
    memory:z.object({valueBytes:z.number().int().nonnegative().nullable(),scope:z.enum(['browser-js-heap','browser-process-rss','wasm-linear-memory','process-rss','unavailable']),measurement:z.enum(['peak','sample','unavailable'])}).strict(),
    estimatedCostPer1000Images:z.number().nonnegative().nullable(),
    costCurrency:z.string().length(3).nullable(),
    costAssumptions:z.string().max(2000).nullable(),
    costSourceUrl:z.string().url().nullable(),
    costAssumptionDate:z.iso.date().nullable(),
    fieldScoring:z.object({
      expected:z.number().int().nonnegative(),
      expectedClear:z.number().int().nonnegative(),
      emitted:z.number().int().nonnegative(),
      scoredEmitted:z.number().int().nonnegative(),
      matched:z.number().int().nonnegative(),
      exact:z.number().int().nonnegative(),
      incorrect:z.number().int().nonnegative(),
      omitted:z.number().int().nonnegative(),
      abstained:z.number().int().nonnegative(),
      unscorable:z.number().int().nonnegative(),
      unscorableEmitted:z.number().int().nonnegative(),
      falsePositives:z.number().int().nonnegative(),
      exactFieldPrecision:z.number().min(0).max(1).nullable(),
      exactFieldRecall:z.number().min(0).max(1).nullable(),
      fieldCoverage:z.number().min(0).max(1).nullable(),
      numericCorrect:z.number().int().nonnegative(),
      numericScored:z.number().int().nonnegative(),
      numericAccuracy:z.number().min(0).max(1).nullable(),
      unitCorrect:z.number().int().nonnegative(),
      unitScored:z.number().int().nonnegative(),
      unitAccuracy:z.number().min(0).max(1).nullable(),
      basisCorrect:z.number().int().nonnegative(),
      basisScored:z.number().int().nonnegative(),
      basisAccuracy:z.number().min(0).max(1).nullable()
    }).strict()
  }).strict(),
  fields:z.array(z.object({
    fieldId:z.string().min(1).max(120).nullable(),
    candidateId:z.string().min(1).max(120).nullable(),
    emitted:z.object({key:z.string().min(1).max(80),numericValue:z.number().finite().nonnegative().nullable(),numericOperator:z.enum(['eq','lt','lte','gt','gte']).nullable(),unit:z.string().min(1).max(24).nullable(),basis:ocrBasisSchema.nullable()}).strict().nullable(),
    outcome:z.enum(['exact','incorrect','omitted','abstained','unscorable','false-positive']),
    numericExact:z.boolean().nullable(),
    unitExact:z.boolean().nullable(),
    basisExact:z.boolean().nullable(),
    stage:ocrStageSchema,
    parserRejectionCode:ocrParserRejectionCodeSchema.nullable()
  }).strict()).max(2000)
}).strict();
export type OcrEvaluationReceipt = z.infer<typeof ocrEvaluationReceiptSchema>;
