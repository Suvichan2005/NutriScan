/** Evaluation-only adapter to the existing scorer; no inference or network access. */
import {readFile} from 'node:fs/promises';
import {ocrAnnotatedDatasetSchema,ocrExtractionSchema} from '../../src/lib/contracts';
import {assertOcrDatasetSemantics,scoreOcrExtraction} from '../../src/modules/ocr/evaluation';

const [referenceFile,predictionFile,experimentId,...extra]=process.argv.slice(2);
if(!referenceFile||!predictionFile||!experimentId||extra.length)throw new Error('Usage: npm exec -- tsx scripts/evaluation/score-reconstruction.mts <reference.json> <OcrExtraction.json> <experiment-id>');
const dataset=ocrAnnotatedDatasetSchema.parse(JSON.parse(await readFile(referenceFile,'utf8')));
const extraction=ocrExtractionSchema.parse(JSON.parse(await readFile(predictionFile,'utf8')));
assertOcrDatasetSemantics(dataset);
const image=dataset.records.find(row=>row.imageId===extraction.input.imageId);
if(!image)throw new Error('Predicted image does not belong to reference collection');
const receipt=scoreOcrExtraction(dataset,image,extraction,{experimentId,datasetVersion:dataset.datasetVersion,runAt:new Date().toISOString(),preprocessing:'adapter-specified; see frozen experiment job'});
process.stdout.write(JSON.stringify({receipt,referenceStatus:image.annotations.review.referenceStatus,claimScope:image.annotations.review.referenceStatus==='human-verified'?'human-reference-scored':'development-reference-only'},null,2)+'\n');
