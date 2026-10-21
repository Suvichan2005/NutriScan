import { readFile } from 'node:fs/promises';
import { compareOcrAnnotationPasses } from '../src/lib/ocr-annotation';

const [firstPath,secondPath,...extra]=process.argv.slice(2);
if(!firstPath||!secondPath||extra.length) throw new Error('Usage: npm run ocr:compare-annotations -- <reader-a.json> <reader-b.json>');
const [firstText,secondText]=await Promise.all([readFile(firstPath,'utf8'),readFile(secondPath,'utf8')]);
const result=compareOcrAnnotationPasses(JSON.parse(firstText),JSON.parse(secondText));
process.stdout.write(`${JSON.stringify({schemaVersion:1,kind:'local-ocr-annotation-agreement',generatedAt:new Date().toISOString(),result},null,2)}\n`);
