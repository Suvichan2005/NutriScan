import { createWorker } from 'tesseract.js';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const privateRoot = path.resolve('docs/evidence/private/regulatory-pdf-ocr');
await mkdir(privateRoot, { recursive: true });
const outputDir = await mkdtemp(path.join(privateRoot, 'run-'));
const sources = [
  {
    id: 'fssai-ors-2025-clarification',
    url: 'https://fssai.gov.in/upload/advisories/2025/10/68ef8cea74223clarification_151025.pdf',
    expectedPages: 2,
    checks: { ors: /\bors\b/i, year: /2025/, remove: /remove.{0,60}ors|ors.{0,60}remove/i },
  },
  {
    id: 'fssai-ors-2025-withdrawal',
    url: 'https://www.fssai.gov.in/upload/advisories/2025/10/68ee3ba06bb7eWithdrawal%20of%20Orders%20regarding%20Usage%20of%20the%20term%20ORS%20along%20with%20brand%20names%20dt%2014.10.2025.pdf',
    expectedPages: 1,
    checks: { ors: /\bors\b/i, year: /2025/, withdrawal: /withdraw.{0,60}order|order.{0,60}withdraw/i },
  },
];
const maxBytes = 1_200_000;
const poppler = process.env.NUTRISCAN_POPPLER_BIN ?? 'pdftoppm';
const worker = await createWorker('eng', 1);
const outcomes: Array<Record<string, unknown>> = [];
try {
  for (const source of sources) {
    const response = await fetch(source.url, { headers: { Accept: 'application/pdf', 'User-Agent': 'NutriScan-LocalResearch/0.1' }, redirect: 'error', signal: AbortSignal.timeout(12_000) });
    if (!response.ok || !/application\/pdf/i.test(response.headers.get('content-type') ?? '')) throw new Error(`${source.id}: expected official PDF response.`);
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    if (!response.body) throw new Error(`${source.id}: response body was empty.`);
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) throw new Error(`${source.id}: PDF exceeded the local size bound.`);
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => undefined); }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    if (bytes.length < 8 || bytes.length > maxBytes || new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw new Error(`${source.id}: PDF bytes were invalid or exceeded the local size bound.`);
    const pdfPath = path.join(outputDir, `${source.id}.pdf`);
    await writeFile(pdfPath, bytes);
    const prefix = path.join(outputDir, source.id);
    await run(poppler, ['-png', '-r', '200', pdfPath, prefix], { timeout: 30_000, windowsHide: true, maxBuffer: 100_000 });
    const pageFiles = (await readdir(outputDir)).filter(file => file.startsWith(`${source.id}-`) && file.endsWith('.png')).sort();
    const pages: Array<{ characters: number; confidence: number; detectedChecks: Record<string, boolean> }> = [];
    for (const file of pageFiles) {
      const { data } = await worker.recognize(await readFile(path.join(outputDir, file)));
      pages.push({
        characters: data.text.length,
        confidence: Math.round(data.confidence),
        detectedChecks: Object.fromEntries(Object.entries(source.checks).map(([key, expression]) => [key, expression.test(data.text)])),
      });
    }
    outcomes.push({ sourceId: source.id, httpStatus: response.status, pdfBytes: bytes.length, expectedPages: source.expectedPages, pageCount: pages.length, pages });
  }
} finally { await worker.terminate(); }

const receipt = {
  schemaVersion: 1,
  kind: 'local-scanned-regulatory-pdf-ocr-diagnostic',
  generatedAt: new Date().toISOString(),
  engines: 'Poppler page rendering at 200 DPI; local Tesseract.js English OCR',
  limits: [
    'OCR outputs are observations from public documents and were not stored; receipt contains page-level character counts, confidence and broad token checks only.',
    'This is a diagnostic, not integrated source retrieval, a manually verified transcription or a legal interpretation.',
    'The 2025 source PDFs were rendered locally; no source text, user image, profile, key or paid provider request was sent to an OCR service.',
  ],
  outcomes,
};
await writeFile('docs/evidence/regulatory-pdf-ocr-diagnostic.json', `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ receipt: 'docs/evidence/regulatory-pdf-ocr-diagnostic.json', outcomes }, null, 2));
if (
  outcomes.length !== 2 ||
  outcomes.some(outcome => {
    const pages = outcome.pages as Array<{ characters: number; confidence: number; detectedChecks: Record<string, boolean> }>;
    return outcome.pageCount !== outcome.expectedPages ||
      !pages.every(page => page.characters >= 300 && page.confidence >= 70 && page.detectedChecks.ors && page.detectedChecks.year) ||
      !pages.some(page => page.detectedChecks.remove || page.detectedChecks.withdrawal);
  })
) process.exitCode = 1;
