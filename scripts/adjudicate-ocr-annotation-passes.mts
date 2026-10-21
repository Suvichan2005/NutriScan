import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ocrAnnotatedDatasetSchema, ocrAdjudicationInputSchema } from '../src/lib/contracts';
import { adjudicateOcrAnnotationPasses } from '../src/lib/ocr-annotation';

const [readerAPath,readerBPath,decisionsPath,...extra]=process.argv.slice(2);
if(!readerAPath||!readerBPath||!decisionsPath||extra.length){
  throw new Error('Usage: npm run ocr:adjudicate-annotations -- <reader-a.json> <reader-b.json> <decisions.json>');
}

const [readerABytes,readerBBytes,decisionBytes]=await Promise.all([
  readFile(readerAPath),readFile(readerBPath),readFile(decisionsPath)
]);
const readerA=JSON.parse(readerABytes.toString('utf8')) as unknown;
const readerB=JSON.parse(readerBBytes.toString('utf8')) as unknown;
const decisions=ocrAdjudicationInputSchema.parse(JSON.parse(decisionBytes.toString('utf8')));
const record=adjudicateOcrAnnotationPasses(readerA,readerB,decisions,{
  readerA:createHash('sha256').update(readerABytes).digest('hex'),
  readerB:createHash('sha256').update(readerBBytes).digest('hex')
});
const dataset=ocrAnnotatedDatasetSchema.parse({schemaVersion:2,datasetVersion:decisions.datasetVersion,records:[record]});
process.stdout.write(`${JSON.stringify(dataset,null,2)}\n`);
