import { z } from 'zod';

export const geminiModelChoiceSchema=z.enum(['gemini-3.8-flash','gemini-3.7-flash','gemini-3.6-flash','gemini-3.5-flash-lite']);
export type GeminiModelChoice=z.infer<typeof geminiModelChoiceSchema>;
export const analysisMethodSchema=z.enum(['tesseract-text','paddle-text','vision','tesseract-vision','paddle-vision']);
export type AnalysisMethod=z.infer<typeof analysisMethodSchema>;
export const nutrientKeys = ['energy','carbohydrate','sugars','addedSugars','protein','fat','saturatedFat','fiber','sodium','salt'] as const;
export type NutrientKey = typeof nutrientKeys[number];
export const calculableNutrientUnits = ['g','mg','µg','μg','mcg','ug','kcal','kJ','IU'] as const;
export const basisSchema = z.object({amount:z.number().positive().max(10000),unit:z.enum(['g','ml']),description:z.string().max(150)});
export const imageBboxSchema=z.object({x0:z.number().finite().nonnegative(),y0:z.number().finite().nonnegative(),x1:z.number().finite().nonnegative(),y1:z.number().finite().nonnegative()}).strict().refine(box=>box.x1>=box.x0&&box.y1>=box.y0);
export const normalizedCropSchema=z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),width:z.number().positive().max(1),height:z.number().positive().max(1)}).strict().refine(crop=>crop.x+crop.width<=1.000001&&crop.y+crop.height<=1.000001);
export const ocrWordSchema=z.object({wordIndex:z.number().int().nonnegative(),text:z.string().max(500),confidence:z.number().finite().min(0).max(100).nullable(),bbox:imageBboxSchema}).strict();
export const readingOrderSchema=z.object({runId:z.string().min(1).max(100),blockIndex:z.number().int().nonnegative(),paragraphIndex:z.number().int().nonnegative(),lineIndex:z.number().int().nonnegative()}).strict();
export const observationSchema = z.object({id:z.string().min(1).max(160),field:z.string().min(1).max(80),text:z.string().max(40000),side:z.enum(['front','back','extra','text']),confidence:z.number().finite().min(0).max(100).nullable(),bbox:imageBboxSchema.optional(),ocrWords:z.array(ocrWordSchema).max(1000).optional(),origin:z.enum(['ocr','barcode','user','vision','fixture']),imageId:z.string().min(1).max(160).optional(),readingOrder:readingOrderSchema.optional(),visionRunId:z.string().min(1).max(100).optional(),derivedFromObservationIds:z.array(z.string().min(1).max(160)).max(20).optional(),supersedesObservationIds:z.array(z.string().min(1).max(160)).max(4000).optional(),value:z.number().finite().optional(),unit:z.string().max(24).optional()}).strict();
export type Observation = z.infer<typeof observationSchema>;
export const ocrCaptureSchema=z.object({
  runId:z.string().min(1).max(100),imageId:z.string().min(1).max(160),side:z.enum(['front','back','extra']),
  sourceImage:z.object({width:z.number().int().positive().max(40000),height:z.number().int().positive().max(40000)}).strict(),
  preparedImage:z.object({width:z.number().int().positive().max(40000),height:z.number().int().positive().max(40000)}).strict(),
  bboxCoordinateSpace:z.literal('prepared-image-pixels'),
  engine:z.object({name:z.string().min(1).max(80),version:z.string().min(1).max(40),language:z.string().min(2).max(20),confidenceScale:z.literal('0-100'),segmentationMode:z.enum(['auto','single-block'])}).strict(),
  processing:z.object({rotation:z.union([z.literal(0),z.literal(90),z.literal(180),z.literal(270)]),contrast:z.boolean(),invert:z.boolean(),cropPercent:z.object({x:z.number().min(0).max(100),y:z.number().min(0).max(100),width:z.number().positive().max(100),height:z.number().positive().max(100)}).strict().nullable()}).strict()
}).strict();
export type OcrCapture=z.infer<typeof ocrCaptureSchema>;
export const visionCaptureSchema=z.object({
  runId:z.string().min(1).max(100),imageId:z.string().min(1).max(160),side:z.enum(['front','back','extra']),
  sourceImage:z.object({width:z.number().int().positive().max(40000),height:z.number().int().positive().max(40000)}).strict(),
  processing:z.object({rotation:z.union([z.literal(0),z.literal(90),z.literal(180),z.literal(270)]),contrast:z.boolean(),invert:z.boolean(),crop:normalizedCropSchema.nullable()}).strict(),
  model:z.string().min(1).max(120)
}).strict();
export type VisionCapture=z.infer<typeof visionCaptureSchema>;
export const parserDiagnosticSchema=z.object({
  field:z.enum(nutrientKeys),decision:z.enum(['accepted','conflict','rejected']),
  reasonCodes:z.array(z.enum(['approximate-or-bounded','signed-or-ambiguous','no-numeric-value','multiple-values','ambiguous-basis','invalid-value','missing-unit','incompatible-unit','missing-basis','cross-reading-conflict'])).max(10),
  sourceObservationIds:z.array(z.string().min(1).max(160)).min(1).max(20),
  numericEvidenceObservationIds:z.array(z.string().min(1).max(160)).max(20).optional(),
  basisEvidenceObservationIds:z.array(z.string().min(1).max(160)).max(20).optional(),
  numericCandidates:z.array(z.object({rawValueText:z.string().max(40),value:z.number().finite().nullable(),unit:z.string().max(24).nullable()}).strict()).max(20),
  basisCandidates:z.array(basisSchema).max(20)
}).strict();
export type ParserDiagnostic=z.infer<typeof parserDiagnosticSchema>;
export const nutrientSchema = z.object({key:z.enum(nutrientKeys),value:z.number().finite().nonnegative().max(100000),unit:z.enum(['g','mg','kcal','kJ']),basis:basisSchema.nullable(),observationIds:z.array(z.string()),status:z.enum(['observed','corrected','conflict'])});
export type Nutrient = z.infer<typeof nutrientSchema>;
export const reconstructionStatusSchema=z.enum(['clear','provisional','ambiguous','conflict','unreadable']);
export const reconstructionEvidenceSchema=z.object({
  observationIds:z.array(z.string().min(1).max(160)).max(32),
  imageRegions:z.array(z.object({imageId:z.string().min(1).max(160),region:normalizedCropSchema.nullable()}).strict()).max(12)
}).strict();
const reconstructedIdentitySchema=z.object({brand:z.string().max(160).nullable(),name:z.string().max(240).nullable(),variant:z.string().max(240).nullable(),status:reconstructionStatusSchema,evidence:reconstructionEvidenceSchema}).strict();
export const reconstructedServingSchema=z.object({printedText:z.string().max(300).nullable(),quantity:z.number().positive().max(10000).nullable(),unit:z.enum(['g','ml']).nullable(),pieceCount:z.number().positive().max(10000).nullable(),pieceDescription:z.string().max(100).nullable(),status:reconstructionStatusSchema,evidence:reconstructionEvidenceSchema}).strict();
export const reconstructedQuantityDeclarationSchema=z.object({kind:z.enum(['net-content','unit-count','servings-per-package']),printedText:z.string().max(300).nullable(),quantity:z.number().positive().max(1000000).nullable(),unit:z.enum(['g','ml','pieces','servings']).nullable(),status:reconstructionStatusSchema,evidence:reconstructionEvidenceSchema}).strict().superRefine((declaration,context)=>{
  const allowedUnits=declaration.kind==='net-content'?['g','ml']:declaration.kind==='unit-count'?['pieces']:['servings'];
  if(declaration.unit&&!allowedUnits.includes(declaration.unit))context.addIssue({code:'custom',path:['unit'],message:`${declaration.kind} must use ${allowedUnits.join(' or ')}.`});
});
export const reconstructedNutritionRowSchema=z.object({
  rowId:z.string().min(1).max(100),nutrient:z.string().min(1).max(120),nutrientKey:z.enum(nutrientKeys).nullable().optional(),printedLabel:z.string().max(160),
  printedValue:z.string().max(80).nullable(),value:z.number().finite().nonnegative().max(100000).nullable(),unit:z.string().max(24).nullable(),
  columnLabel:z.string().max(160).nullable(),basisText:z.string().max(160).nullable(),basisAmount:z.number().positive().max(10000).nullable(),basisUnit:z.enum(['g','ml']).nullable(),qualifier:z.string().max(300).nullable(),
  status:reconstructionStatusSchema,evidence:reconstructionEvidenceSchema
}).strict();
export const reconstructedIngredientSchema=z.object({position:z.number().int().nonnegative().max(1000),name:z.string().min(1).max(300),printedText:z.string().max(600),printedPercentage:z.number().min(0).max(100).nullable(),normalizedName:z.string().max(300).nullable(),status:reconstructionStatusSchema,evidence:reconstructionEvidenceSchema}).strict();
export const reconstructedAdditiveSchema=z.object({printedName:z.string().min(1).max(240),code:z.string().max(40).nullable(),normalizedName:z.string().max(240).nullable(),status:reconstructionStatusSchema,evidence:reconstructionEvidenceSchema}).strict();
export const reconstructedStatementSchema=z.object({kind:z.enum(['contains','may-contain','precaution','claim','warning','manufacturer','regulatory-mark','instruction','other']),label:z.string().max(180).nullable(),text:z.string().min(1).max(1000),status:reconstructionStatusSchema,evidence:reconstructionEvidenceSchema}).strict();
// A dense package side can legitimately contain more than 32 OCR lines in one
// visual region. Keep the full source map rather than rejecting an otherwise
// useful reconstruction because the table links to every observed line.
export const reconstructedRegionSchema=z.object({imageId:z.string().min(1).max(160),role:z.enum(['front','nutrition-table','ingredients','allergens','serving','claims','identity','other']),region:normalizedCropSchema,observationIds:z.array(z.string().min(1).max(160)).max(100)}).strict();
export const packageReconstructionContentSchema=z.object({
  identity:reconstructedIdentitySchema,
  serving:reconstructedServingSchema.nullable(),
  // Optional for old saved revisions; new reconstructions can retain explicit
  // pack quantities without conflating them with the printed serving size.
  quantityDeclarations:z.array(reconstructedQuantityDeclarationSchema).max(12).optional(),
  nutritionRows:z.array(reconstructedNutritionRowSchema).max(100),
  ingredients:z.array(reconstructedIngredientSchema).max(250),
  additives:z.array(reconstructedAdditiveSchema).max(100),
  statements:z.array(reconstructedStatementSchema).max(100),
  regions:z.array(reconstructedRegionSchema).max(40),
  unresolved:z.array(z.object({field:z.string().min(1).max(120),reason:z.string().min(1).max(500),evidence:reconstructionEvidenceSchema}).strict()).max(100),
  interpretationNote:z.string().max(1000)
}).strict();
export const packageReconstructionSchema=packageReconstructionContentSchema.extend({revision:z.number().int().positive().max(100000),updatedAt:z.iso.datetime(),model:z.string().min(1).max(120),current:z.boolean(),analysisMethod:analysisMethodSchema.optional()}).strict();
export const packageReconstructionHistoryEntrySchema=packageReconstructionSchema.extend({current:z.literal(false)}).strict();
export type PackageReconstructionContent=z.infer<typeof packageReconstructionContentSchema>;
export type PackageReconstruction=z.infer<typeof packageReconstructionSchema>;
export const reconstructionCorrectionSchema=z.object({rowId:z.string().min(1).max(100),revision:z.number().int().positive(),sourceRevision:z.number().int().positive(),original:packageReconstructionContentSchema.shape.nutritionRows.element,reading:packageReconstructionContentSchema.shape.nutritionRows.element,observationId:z.string().min(1).max(160),updatedAt:z.iso.datetime()}).strict();
export type ReconstructionCorrection=z.infer<typeof reconstructionCorrectionSchema>;
export const packageClarificationDecisionSchema=z.object({id:z.string().min(1).max(100),subject:z.string().min(1).max(180),decision:z.enum(['skip','confirm']),preferredRowId:z.string().min(1).max(100).optional(),updatedAt:z.iso.datetime()}).strict().refine(item=>item.decision==='confirm'?!!item.preferredRowId:item.preferredRowId===undefined,{message:'Only confirmation selects a retained reading.'});
export type PackageClarificationDecision=z.infer<typeof packageClarificationDecisionSchema>;
const packageBaseSchema=z.object({id:z.string().min(1).max(160),name:z.string().max(200),brand:z.string().max(120).optional(),barcode:z.string().max(32).optional(),identityConflict:z.boolean().optional(),userDescription:z.string().max(4000).optional(),netWeight:z.object({value:z.number().positive(),unit:z.enum(['g','ml'])}).optional(),serving:z.object({value:z.number().positive(),unit:z.enum(['g','ml'])}).optional(),ingredients:z.array(z.string().max(4000)).max(1000),additives:z.array(z.string().max(120)).max(300),allergens:z.array(z.string().max(1000)).max(100),claims:z.array(z.string().max(1000)).max(100),license:z.string().max(40).optional(),nutrients:z.array(nutrientSchema).max(1000),reconstruction:packageReconstructionSchema.optional(),reconstructionCorrections:z.array(reconstructionCorrectionSchema).max(100).optional(),clarificationDecisions:z.array(packageClarificationDecisionSchema).max(60).optional(),reconstructionHistory:z.array(packageReconstructionHistoryEntrySchema).max(5).optional(),observations:z.array(observationSchema).max(4000),ocrCaptures:z.array(ocrCaptureSchema).max(50).optional(),visionCaptures:z.array(visionCaptureSchema).max(50).optional(),parserDiagnostics:z.array(parserDiagnosticSchema).max(2000).optional(),rawText:z.string().max(40000),warnings:z.array(z.string().max(500)).max(1000),synthetic:z.boolean(),createdAt:z.string().max(80)}).strict();
export const packageSchema=packageBaseSchema.superRefine((pkg,context)=>{
  for(const decision of pkg.clarificationDecisions??[])if(decision.decision==='confirm'&&!pkg.reconstructionCorrections?.some(item=>item.rowId===decision.preferredRowId)&&!pkg.nutrients.some(item=>item.status==='corrected'&&item.key===decision.subject))context.addIssue({code:'custom',path:['clarificationDecisions'],message:'A preferred reading must have a retained user correction.'});
  const observationIds=new Set(pkg.observations.map(observation=>observation.id));
  const correctedRows=new Set<string>();
  for(const [index,correction] of (pkg.reconstructionCorrections??[]).entries()){
    const observation=pkg.observations.find(item=>item.id===correction.observationId);
    if(correctedRows.has(correction.rowId)||correction.rowId!==correction.original.rowId||correction.rowId!==correction.reading.rowId||!observation||observation.origin!=='user'||observation.field!=='nutrition-row-correction'||observation.value!==correction.reading.value||observation.unit!==correction.reading.unit||correction.reading.evidence.observationIds.length!==1||correction.reading.evidence.observationIds[0]!==correction.observationId)context.addIssue({code:'custom',path:['reconstructionCorrections',index],message:'A row correction must retain its original identity and exact user observation.'});
    for(const id of correction.original.evidence.observationIds)if(!observationIds.has(id))context.addIssue({code:'custom',path:['reconstructionCorrections',index],message:'Original correction evidence must remain in the package.'});
    correctedRows.add(correction.rowId);
  }

  if(observationIds.size!==pkg.observations.length)context.addIssue({code:'custom',path:['observations'],message:'Observation identifiers must be unique.'});
  const captureRunIds=new Set(pkg.ocrCaptures?.map(capture=>capture.runId)??[]);
  if(captureRunIds.size!==(pkg.ocrCaptures?.length??0))context.addIssue({code:'custom',path:['ocrCaptures'],message:'Each OCR capture run identifier must be unique.'});
  const visionRunIds=new Set(pkg.visionCaptures?.map(capture=>capture.runId)??[]);
  if(visionRunIds.size!==(pkg.visionCaptures?.length??0))context.addIssue({code:'custom',path:['visionCaptures'],message:'Each vision capture run identifier must be unique.'});
  for(const [index,nutrient] of pkg.nutrients.entries())for(const id of nutrient.observationIds)if(!observationIds.has(id))context.addIssue({code:'custom',path:['nutrients',index,'observationIds'],message:'Nutrient readings must point to existing package observations.'});
  const reconstructions=[...(pkg.reconstruction?[{path:['reconstruction'] as (string|number)[],value:pkg.reconstruction}]:[]),...(pkg.reconstructionHistory??[]).map((value,index)=>({path:['reconstructionHistory',index] as (string|number)[],value}))];
  if(new Set((pkg.reconstructionHistory??[]).map(item=>item.revision)).size!==(pkg.reconstructionHistory?.length??0))context.addIssue({code:'custom',path:['reconstructionHistory'],message:'Archived reconstruction revisions must be unique.'});
  for(const {path,value:reconstruction} of reconstructions){
    const imageIds=new Set([...pkg.observations.flatMap(observation=>observation.imageId?[observation.imageId]:[]),...(pkg.ocrCaptures??[]).map(capture=>capture.imageId),...(pkg.visionCaptures??[]).map(capture=>capture.imageId)]);
    const evidenceGroups=[reconstruction.identity.evidence,...(reconstruction.serving?[reconstruction.serving.evidence]:[]),...(reconstruction.quantityDeclarations??[]).map(item=>item.evidence),...reconstruction.nutritionRows.map(row=>row.evidence),...reconstruction.ingredients.map(item=>item.evidence),...reconstruction.additives.map(item=>item.evidence),...reconstruction.statements.map(item=>item.evidence),...reconstruction.unresolved.map(item=>item.evidence)];
    for(const [index,evidence] of evidenceGroups.entries())for(const id of evidence.observationIds)if(!observationIds.has(id))context.addIssue({code:'custom',path:[...path,index,'observationIds'],message:'Reconstruction evidence must reference observations in this package.'});
    for(const [index,region] of reconstruction.regions.entries()){
      if(!imageIds.has(region.imageId))context.addIssue({code:'custom',path:[...path,'regions',index,'imageId'],message:'Reconstruction regions must point to an image retained in the package evidence lineage.'});
      for(const id of region.observationIds)if(!observationIds.has(id))context.addIssue({code:'custom',path:[...path,'regions',index,'observationIds'],message:'Reconstruction regions must reference observations in this package.'});
    }
    for(const evidence of evidenceGroups)for(const reference of evidence.imageRegions)if(!imageIds.has(reference.imageId))context.addIssue({code:'custom',path:[...path,'imageRegions'],message:'Reconstruction evidence must point to an image retained in the package evidence lineage.'});
  }
  for(const [index,observation] of pkg.observations.entries()){
    for(const sourceId of observation.derivedFromObservationIds??[])if(sourceId===observation.id||!observationIds.has(sourceId))context.addIssue({code:'custom',path:['observations',index,'derivedFromObservationIds'],message:'Derived observations must point to a different existing source observation.'});
    const supersededIds=observation.supersedesObservationIds??[];
    if(supersededIds.length&&observation.origin!=='user')context.addIssue({code:'custom',path:['observations',index,'supersedesObservationIds'],message:'Only a user-originated correction may supersede earlier package observations.'});
    if(new Set(supersededIds).size!==supersededIds.length)context.addIssue({code:'custom',path:['observations',index,'supersedesObservationIds'],message:'Superseded observation identifiers must be unique.'});
    for(const sourceId of supersededIds)if(sourceId===observation.id||!observationIds.has(sourceId))context.addIssue({code:'custom',path:['observations',index,'supersedesObservationIds'],message:'Superseded observations must point to a different existing package observation.'});
    if(observation.visionRunId){
      const capture=pkg.visionCaptures?.find(item=>item.runId===observation.visionRunId);
      if(!capture||observation.origin!=='vision'||observation.imageId!==capture.imageId||observation.side!==capture.side)context.addIssue({code:'custom',path:['observations',index,'visionRunId'],message:'Vision observations must link to the matching selected-image capture.'});
    }
    if(observation.readingOrder){
      const capture=pkg.ocrCaptures?.find(item=>item.runId===observation.readingOrder!.runId&&item.imageId===observation.imageId);
      if(!capture||observation.origin!=='ocr')context.addIssue({code:'custom',path:['observations',index,'readingOrder'],message:'OCR reading order must link to an OCR capture for the same image.'});
      else if(observation.side!==capture.side||observation.bbox&&(observation.bbox.x1>capture.preparedImage.width||observation.bbox.y1>capture.preparedImage.height)||observation.ocrWords?.some(word=>word.bbox.x1>capture.preparedImage.width||word.bbox.y1>capture.preparedImage.height))context.addIssue({code:'custom',path:['observations',index,'bbox'],message:'OCR geometry must fit its recorded prepared-image coordinate space.'});
    }
    if(observation.ocrWords&&(!observation.readingOrder||!['ocr-line','nutrition-row-candidate'].includes(observation.field)||observation.origin!=='ocr'))context.addIssue({code:'custom',path:['observations',index,'ocrWords'],message:'Word-level OCR geometry must remain attached to an ordered OCR observation.'});
    if(observation.field==='nutrition-row-candidate'&&(observation.origin!=='ocr'||!observation.imageId||!observation.readingOrder||!observation.derivedFromObservationIds?.length||observation.confidence!==null))context.addIssue({code:'custom',path:['observations',index,'derivedFromObservationIds'],message:'Reconstructed nutrition rows must remain tentative, ordered, image-linked and derived from OCR observations.'});
    if(observation.ocrWords&&observation.ocrWords.some((word,wordIndex)=>word.wordIndex!==wordIndex))context.addIssue({code:'custom',path:['observations',index,'ocrWords'],message:'Word indexes must match their order within the OCR line.'});
  }
  for(const [index,diagnostic] of (pkg.parserDiagnostics??[]).entries()){
    for(const id of [...diagnostic.sourceObservationIds,...(diagnostic.numericEvidenceObservationIds??[]),...(diagnostic.basisEvidenceObservationIds??[])])if(!observationIds.has(id))context.addIssue({code:'custom',path:['parserDiagnostics',index,'sourceObservationIds'],message:'Parser diagnostics must point to recorded observations.'});
    for(const id of [...(diagnostic.numericEvidenceObservationIds??[]),...(diagnostic.basisEvidenceObservationIds??[])])if(!diagnostic.sourceObservationIds.includes(id))context.addIssue({code:'custom',path:['parserDiagnostics',index,'sourceObservationIds'],message:'Candidate evidence must also be listed among the parser diagnostic source observations.'});
  }
});
export type PackageData = z.infer<typeof packageSchema>;
export const sourceSchema = z.object({id:z.string(),title:z.string(),publisher:z.string(),url:z.string().url(),category:z.enum(['guideline','assessment','regulation','product','literature','registry','method','food-composition','web-search']),jurisdiction:z.string(),publishedAt:z.string().nullable(),effectiveAt:z.string().nullable(),retrievedAt:z.string(),summary:z.string(),limitations:z.string(),license:z.string().optional(),supportRole:z.enum(['content','navigation']).optional()});
export type EvidenceSource = z.infer<typeof sourceSchema>;
export const conversationEvidenceSourceSchema=sourceSchema.extend({
  id:z.string().min(1).max(160),title:z.string().min(1).max(300),publisher:z.string().min(1).max(240),
  url:z.string().url().max(2000),jurisdiction:z.string().max(240),publishedAt:z.string().max(80).nullable(),
  effectiveAt:z.string().max(80).nullable(),retrievedAt:z.string().min(1).max(80),summary:z.string().max(1600),
  limitations:z.string().max(600),license:z.string().max(500).optional()
}).strict();
export type ConversationEvidenceSource=z.infer<typeof conversationEvidenceSourceSchema>;
export const localEvidenceHitSchema=z.object({
  source:conversationEvidenceSourceSchema,semanticScore:z.number().finite(),lexicalScore:z.number().finite(),
  score:z.number().finite(),exactIdentity:z.boolean()
}).strict();
export const localEvidenceResponseSchema=z.object({
  status:z.enum(['ok','no_match']),mode:z.literal('hybrid-local-embedding'),model:z.string().min(1).max(120),
  revision:z.string().min(1).max(120),corpusVersion:z.string().min(1).max(100),
  corpusSha256:z.string().regex(/^[a-f0-9]{64}$/),retrievedAt:z.string().min(1).max(80),
  latencyMs:z.number().int().nonnegative(),results:z.array(localEvidenceHitSchema).max(5),
  message:z.string().max(1200).optional(),limitations:z.array(z.string().max(500)).max(10),
  requestId:z.string().uuid().optional()
}).strict();
const countedPortionSchema=z.object({amount:z.number().finite().positive().max(10000),unit:z.enum(['pieces','servings']),servingQuantity:z.number().finite().positive().max(10000),servingUnit:z.enum(['g','ml']),piecesPerServing:z.number().finite().positive().max(10000).optional()}).strict().refine(value=>value.unit==='pieces'?value.piecesPerServing!==undefined:value.piecesPerServing===undefined,{message:'Piece conversion requires a printed count per serving.'});
const packagePortionSchema=z.object({packageCount:z.number().finite().positive().max(10000),netContentPerPackage:z.number().finite().positive().max(1000000),unit:z.enum(['g','ml']),printedText:z.string().max(300).nullable()}).strict();
export const calculationSchema=z.object({inputOrigin:z.enum(['user-correction','model-interpretation']).optional(),countedPortion:countedPortionSchema.optional(),packagePortion:packagePortionSchema.optional(),id:z.string().min(1).max(120),label:z.string().min(1).max(300),nutrient:z.enum(nutrientKeys).nullable(),nutrientLabel:z.string().min(1).max(160).optional(),input:z.number().finite().nonnegative(),inputUnit:z.string().min(1).max(24),basisAmount:z.number().finite().positive().max(10000),portion:z.number().finite().positive().max(10000),portionUnit:z.enum(['g','ml']),result:z.number().finite().nonnegative(),unit:z.string().min(1).max(24),formula:z.string().min(1).max(1000),evidenceText:z.string().min(1).max(1600).optional(),observationIds:z.array(z.string().min(1).max(160)).max(20),imageIds:z.array(z.string().min(1).max(160)).max(10).optional(),interpretationIds:z.array(z.string().min(1).max(120)).max(20).optional(),assumptions:z.array(z.string().max(300)).max(10)}).strict()
  .refine(calculation=>calculation.nutrient!==null?calculation.nutrientLabel===undefined:(!!calculation.nutrientLabel&&calculation.interpretationIds?.length===1),{message:'An unmapped nutrient calculation needs its saved row identity and label.'})
  .refine(calculation=>calculation.nutrient!==null||(calculation.unit===calculation.inputUnit&&calculableNutrientUnits.some(unit=>unit===calculation.unit)),{message:'An unmapped nutrient calculation must retain a supported absolute nutrient unit.'})
  .refine(calculation=>calculation.observationIds.length>0||(!!calculation.imageIds?.length&&!!calculation.interpretationIds?.length),{message:'A calculation needs retained observations or an image-linked model interpretation.'})
  .refine(calculation=>{
    const expected=calculation.input*calculation.portion/calculation.basisAmount;
    return Number.isFinite(expected)&&Math.abs(calculation.result-expected)<=Number.EPSILON*Math.max(1,Math.abs(calculation.result),Math.abs(expected))*16;
  },{message:'A calculation result must match deterministic input × portion ÷ basis arithmetic.'})
  .refine(calculation=>{
    const count=calculation.countedPortion;if(!count)return true;
    const expected=count.amount*count.servingQuantity/(count.unit==='pieces'?count.piecesPerServing!:1);
    return calculation.portionUnit===count.servingUnit&&Math.abs(calculation.portion-expected)<=Number.EPSILON*Math.max(1,expected,calculation.portion)*16;
  },{message:'Counted portion must match the declared serving conversion.'})
  .refine(calculation=>{
    const pack=calculation.packagePortion;if(!pack)return true;
    if(calculation.countedPortion||calculation.portionUnit!==pack.unit)return false;
    const expected=pack.packageCount*pack.netContentPerPackage;
    return Number.isFinite(expected)&&Math.abs(calculation.portion-expected)<=Number.EPSILON*Math.max(1,expected,calculation.portion)*16;
  },{message:'Package portion must match the explicit printed net contents multiplied by the requested package count.'});
export type Calculation=z.infer<typeof calculationSchema>;
/** Workspace state is conversational context, not a printed serving or a dietary target. */
export const workspacePortionSchema=z.object({amount:z.number().finite().positive().max(10000),unit:z.enum(['g','ml'])}).strict();
export const calculationEvidenceText=(calculation:Pick<Calculation,'nutrient'|'nutrientLabel'|'input'|'inputUnit'|'basisAmount'|'portion'|'portionUnit'|'result'|'unit'|'interpretationIds'|'imageIds'|'countedPortion'|'packagePortion'|'inputOrigin'>):string=>`Calculation evidence: ${calculation.nutrientLabel??calculation.nutrient} ${calculation.input} ${calculation.inputUnit} per ${calculation.basisAmount} ${calculation.portionUnit}${calculation.countedPortion?`; requested ${calculation.countedPortion.amount} ${calculation.countedPortion.unit}, using ${calculation.countedPortion.servingQuantity} ${calculation.countedPortion.servingUnit} per ${calculation.countedPortion.piecesPerServing??1} ${calculation.countedPortion.unit}`:''}${calculation.packagePortion?`; requested ${calculation.packagePortion.packageCount} package(s), using ${calculation.packagePortion.netContentPerPackage} ${calculation.packagePortion.unit} net contents per package${calculation.packagePortion.printedText?` (${calculation.packagePortion.printedText})`:''}`:''}; for ${calculation.portion} ${calculation.portionUnit}, deterministic result ${calculation.result} ${calculation.unit}${calculation.inputOrigin==='user-correction'?'; derived from an explicitly recorded user correction, not independently verified':calculation.interpretationIds?.length?'; derived from a provisional package interpretation':''}.`;
export type Finding = {id:string;title:string;detail:string;status:'observed'|'calculated'|'context'|'uncertain'|'conflict';observationIds:string[];sourceIds:string[];calculationIds:string[]};
export type Audit = {answer:string;findings:Finding[];calculations:Calculation[];sources:EvidenceSource[];limitations:string[];nextQuestions:string[];trace:{tool:string;reason:string;status:string}[]};
export const evidenceSpanSchema=z.object({kind:z.enum(['observation','source','calculation','profile']),id:z.string().min(1).max(160),quote:z.string().min(1).max(1600)}).strict();
// A visual reference locates model-reported text in an image that the user
// explicitly attached. It is traceable, but the transcript and region are not
// independently verified and must remain tentative.
export const visualEvidenceReferenceSchema=z.object({imageId:z.string().min(1).max(160),visibleText:z.string().min(1).max(500),region:normalizedCropSchema.nullable()}).strict();
export const tentativeOcrWordEvidenceSchema=z.object({
  observationId:z.string().min(1).max(160),role:z.enum(['label','value','unit','basis','identity']),wordIndexes:z.array(z.number().int().nonnegative()).min(1).max(32)
}).strict();
export const tentativeStructuredCandidateSchema=z.object({
  candidateId:z.string().min(1).max(120),kind:z.enum(['nutrient','ingredient','additive','product-identity','serving-basis','allergen','warning','package-claim']),field:z.string().min(1).max(80),
  proposedValue:z.string().min(1).max(300),numericValue:z.number().finite().nonnegative().max(100000).nullable(),unit:z.string().max(24).nullable(),basis:basisSchema.nullable(),normalizedEntity:z.string().max(200).nullable(),
  status:z.literal('tentative'),observationIds:z.array(z.string().min(1).max(160)).max(20),sourceIds:z.array(z.string().min(1).max(160)).max(20),supportingSpans:z.array(evidenceSpanSchema.extend({kind:z.enum(['observation','source'])})).max(10),visualEvidence:z.array(visualEvidenceReferenceSchema).max(10).optional(),ocrWordEvidence:z.array(tentativeOcrWordEvidenceSchema).max(20).optional(),uncertainty:z.string().min(1).max(500)
}).strict();
export type TentativeStructuredCandidate=z.infer<typeof tentativeStructuredCandidateSchema>;
export const profileSchema = z.object({dietaryPattern:z.string().max(500),avoidedIngredients:z.string().max(1000).default(''),allergies:z.string().max(1000),intolerances:z.string().max(1000),healthConsiderations:z.string().max(1500),goals:z.string().max(1000),portionPreferences:z.string().max(500).default(''),ageGroup:z.string().max(80),sexOrReferenceGroup:z.string().max(100),country:z.string().max(80),locality:z.string().max(100)}).strict();
export type Profile = z.infer<typeof profileSchema>;
export const defaultProfile:Profile = {dietaryPattern:'',avoidedIngredients:'',allergies:'',intolerances:'',healthConsiderations:'',goals:'',portionPreferences:'',ageGroup:'',sexOrReferenceGroup:'',country:'',locality:''};
export const hasUserContext = (profile:Profile):boolean => Object.values(profile).some(value=>value.trim().length>0);
export const assistantUiComponentTypeSchema=z.enum(['nutrition-table','portion-calculator','ingredient-explorer','allergen-explanation','product-comparison','package-evidence','source-reference-cards','personalized-finding','package-details','package-clarification']);
export const assistantUiComponentSchema=z.object({type:assistantUiComponentTypeSchema,observationIds:z.array(z.string().min(1).max(160)).max(20),sourceIds:z.array(z.string().min(1).max(160)).max(10),calculationIds:z.array(z.string().min(1).max(120)).max(20),clarificationIds:z.array(z.string().min(1).max(100)).max(3).optional(),nutritionRowIds:z.array(z.string().min(1).max(100)).max(30).optional(),calculatorAmount:z.number().finite().positive().max(10000).optional(),calculatorUnit:z.enum(['g','ml']).optional(),packageRevision:z.number().int().positive().max(100000).optional()}).strict()
  .refine(component=>(component.calculatorAmount===undefined)===(component.calculatorUnit===undefined),{message:'Calculator amount and unit must be provided together.'})
  .refine(component=>component.calculatorAmount===undefined||component.type==='portion-calculator',{message:'Only a portion calculator can specify an initial amount.'});
export type AssistantUiComponent=z.infer<typeof assistantUiComponentSchema>;
export const savedAnswerNotesSchema=z.object({withheldQuantitySentences:z.number().int().min(0).max(1000),withheldSourceScopeSentences:z.number().int().min(0).max(1000).optional(),provisionalReconstructionQuantitySentences:z.number().int().min(0).max(1000).optional()}).strict();
export const savedConversationTurnSchema=z.object({question:z.string().trim().min(1).max(1000),answer:z.string().max(8000),at:z.iso.datetime(),answerOrigin:z.enum(['local','gemini']).optional(),answerModel:z.string().min(1).max(200).optional(),outdated:z.boolean().optional(),answerNotes:savedAnswerNotesSchema.optional(),evidence:z.array(conversationEvidenceSourceSchema).max(8).optional(),retrievedEvidence:z.array(conversationEvidenceSourceSchema).max(8).optional(),uiComponents:z.array(assistantUiComponentSchema).max(6).optional(),calculations:z.array(calculationSchema).max(20).optional()}).strict();
export type SavedConversationTurn=z.infer<typeof savedConversationTurnSchema>;
export const savedScanSchema=z.object({id:z.string().min(1).max(160),name:z.string().max(200),createdAt:z.string().min(1).max(80),package:packageSchema,portion:z.number().finite().positive().max(10000),unit:z.enum(['g','ml']),conversation:z.array(savedConversationTurnSchema).max(30).optional()}).strict();
export type SavedScanRecord=z.infer<typeof savedScanSchema>;
export type ProductRecord = {id:string;name:string;brand:string;barcode:string;quantity:string;countries:string[];url:string;retrievedAt:string;lastModified:string|null;nutrients:{key:NutrientKey;value:number;unit:string;basis:{amount:100;unit:'g'|'ml'}|null}[];ingredients:string;allergens:string[];allergenTraces?:string[];match:'barcode'|'candidate';availability:'local stock unverified';imageUrl?:string;confidence?:string;warnings?:string[]};
export type ResearchItem = {id:string;title:string;url:string;publisher:string;publishedAt:string|null;effectiveAt?:string|null;retrievedAt:string;category:string;summary:string;limitations:string;doi?:string;supportRole?:'content'|'navigation'};
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
export const ocrAdjudicationDispositionSchema = z.enum(['reader-a','reader-b','manual','ambiguous','not-visible']);
export const ocrAdjudicationDecisionSchema = z.object({
  fieldId:z.string().min(1).max(120),
  disposition:ocrAdjudicationDispositionSchema,
  readerAFieldId:z.string().min(1).max(120).nullable(),
  readerBFieldId:z.string().min(1).max(120).nullable(),
  field:ocrDatasetFieldSchema.nullable(),
  // For explicit manual decisions, identifies which blind pass supplied the
  // region IDs. The adjudication tool remaps them into a collision-free union.
  regionSource:z.enum(['reader-a','reader-b']).nullable(),
  rationale:z.string().trim().min(1).max(1000)
}).strict();
export type OcrAdjudicationDecision = z.infer<typeof ocrAdjudicationDecisionSchema>;
export const ocrAdjudicationInputSchema = z.object({
  schemaVersion:z.literal(1),
  datasetVersion:z.string().trim().min(1).max(80),
  adjudicatorCode:z.string().trim().min(1).max(80),
  adjudicatedAt:z.iso.datetime(),
  method:z.string().trim().min(1).max(1000),
  decisions:z.array(ocrAdjudicationDecisionSchema).min(1).max(1000)
}).strict();
export type OcrAdjudicationInput = z.infer<typeof ocrAdjudicationInputSchema>;
export const ocrAdjudicationProvenanceSchema = z.object({
  schemaVersion:z.literal(1),
  adjudicatorCode:z.string().min(1).max(80),
  adjudicatedAt:z.iso.datetime(),
  method:z.string().min(1).max(1000),
  sourcePasses:z.array(z.object({reader:z.enum(['reader-a','reader-b']),annotatorCode:z.string().min(1).max(80),sha256:z.string().regex(/^[a-fA-F0-9]{64}$/)}).strict()).length(2),
  regions:z.array(z.object({reader:z.enum(['reader-a','reader-b']),sourceRegionId:z.string().min(1).max(100),canonicalRegionId:z.string().min(1).max(100)}).strict()).max(20000),
  regionAlignment:z.array(z.object({role:z.enum(['label','value','row','unit','basis']),readerACount:z.number().int().nonnegative(),readerBCount:z.number().int().nonnegative(),paired:z.number().int().nonnegative(),overlapAtLeastHalf:z.number().int().nonnegative(),meanBoundingBoxIoU:z.number().min(0).max(1).nullable()}).strict()).max(5),
  decisions:z.array(z.object({fieldId:z.string().min(1).max(120),disposition:ocrAdjudicationDispositionSchema,readerAFieldId:z.string().min(1).max(120).nullable(),readerBFieldId:z.string().min(1).max(120).nullable(),rationale:z.string().min(1).max(1000)}).strict()).min(1).max(1000)
}).strict();
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
      method:z.string().min(1).max(1000),
      adjudication:ocrAdjudicationProvenanceSchema.optional()
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
