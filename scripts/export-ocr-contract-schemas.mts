import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  ocrAnnotatedDatasetSchema,
  ocrEvaluationReceiptSchema,
  ocrExtractionSchema
} from '../src/lib/contracts';

const schemas = [
  {
    path:'data/ocr-dataset.schema.json',
    id:'urn:nutriscan:ocr-annotated-dataset:2',
    title:'NutriScan annotated package-photo record',
    description:'Metadata and reference annotations for local OCR research. The schema contains no image bytes. A held-out accuracy result requires human-verified reference labels.'
  },
  {
    path:'data/ocr-extraction.schema.json',
    id:'urn:nutriscan:ocr-extraction:1',
    title:'NutriScan transient OCR extraction',
    description:'Common in-memory output contract for browser, local, server, remote, and hybrid OCR adapters. Recognized text is transient and must not be persisted in tracked receipts.'
  },
  {
    path:'data/ocr-evaluation-receipt.schema.json',
    id:'urn:nutriscan:ocr-evaluation-receipt:2',
    title:'NutriScan OCR evaluation receipt',
    description:'Sanitized common per-image result contract. It retains normalized candidate values and per-field stage outcomes but no image bytes or raw OCR text.'
  }
] as const;

const values = [ocrAnnotatedDatasetSchema,ocrExtractionSchema,ocrEvaluationReceiptSchema];
for (const [index, definition] of schemas.entries()) {
  const generated = z.toJSONSchema(values[index],{target:'draft-2020-12'}) as Record<string,unknown>;
  const json = {
    $schema:'https://json-schema.org/draft/2020-12/schema',
    $id:definition.id,
    title:definition.title,
    description:definition.description,
    ...generated
  };
  await writeFile(resolve(definition.path),`${JSON.stringify(json,null,2)}\n`,'utf8');
}
