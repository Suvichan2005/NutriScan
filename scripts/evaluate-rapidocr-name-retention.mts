import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

type Photo = { file: string; hash: string };
type Candidate = { lines: number; expectedBrandObserved: boolean; matchingLineConfidence: number | null };
const photos = [
  { file: 'coca-cola-front-off-5449000000996.jpg', tokens: ['coca', 'cola'], role: 'front' },
  { file: 'nutella-label-off-3017620422003.jpg', tokens: ['nutella'], role: 'front' },
  { file: 'heinz-beans-front-off-5000157024671.jpg', tokens: ['heinz'], role: 'front' },
  { file: 'saffola-veggie-oats-nutrition-off-8901088068758.jpg', tokens: ['saffola'], role: 'nutrition' },
  { file: 'bagrrys-white-oats-nutrition-off-8902710100150.jpg', tokens: ['bagrrys'], role: 'nutrition' },
];
const manifest = JSON.parse(await readFile('data/semantic-photo-manifest.json', 'utf8')) as { records: Photo[] };
const python = process.env.NUTRISCAN_RAPIDOCR_PYTHON ?? path.resolve('docs/evidence/private/rapidocr-venv/Scripts/python.exe');
const requestedModel = process.env.NUTRISCAN_RAPIDOCR_MODEL_TYPE;
const modelTypes = requestedModel ? [requestedModel] : ['small', 'tiny'];
if (modelTypes.some((model) => !['tiny', 'small'].includes(model))) throw new Error('RapidOCR model type must be tiny or small.');

const selected: Array<{ file: string; tokens: string[]; role: string; path: string }> = [];
for (const photo of photos) {
  const record = manifest.records.find((candidate) => candidate.file === photo.file);
  if (!record) throw new Error(`Missing source manifest entry for ${photo.file}.`);
  const filePath = path.resolve('docs/evidence/private', record.file);
  const bytes = await readFile(filePath);
  if (createHash('sha256').update(bytes).digest('hex') !== record.hash.toLowerCase()) throw new Error(`Source hash mismatch for ${record.file}.`);
  selected.push({ ...photo, path: filePath });
}

const pythonProgram = String.raw`
import contextlib, io, json, re, sys, unicodedata
from rapidocr import ModelType, RapidOCR
quiet = io.StringIO()
with contextlib.redirect_stdout(quiet), contextlib.redirect_stderr(quiet):
    engine = RapidOCR(params={"Det.model_type": ModelType(sys.argv[1]), "Rec.model_type": ModelType(sys.argv[1])})
    results = []
    for index in range(2, len(sys.argv), 2):
        filename = sys.argv[index]
        tokens = json.loads(sys.argv[index + 1])
        result = engine(filename)
        lines = [str(value).strip() for value in (result.txts or []) if str(value).strip()]
        normalized = [unicodedata.normalize("NFKD", line).encode("ascii", "ignore").decode("ascii").lower() for line in lines]
        matching = [line for line in normalized if all(token in line for token in tokens)]
        scores = list(result.scores or [])
        indices = [normalized.index(line) for line in matching if line in normalized]
        confidence = max((float(scores[i]) for i in indices if i < len(scores)), default=None)
        joined = " ".join(normalized)
        results.append({"lines": len(lines), "expectedBrandObserved": all(token in joined for token in tokens), "matchingLineConfidence": confidence})
print(json.dumps(results))
`;
async function runModel(model: string) {
  const args = selected.flatMap((photo) => [photo.path, JSON.stringify(photo.tokens)]);
  const candidates = await new Promise<Candidate[]>((resolve, reject) => {
    const child = spawn(python, ['-c', pythonProgram, model, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) return reject(new Error(`RapidOCR name probe failed (${code}): ${Buffer.concat(stderr).toString('utf8').slice(-1200)}`));
      try { resolve(JSON.parse(Buffer.concat(stdout).toString('utf8')) as Candidate[]); }
      catch { reject(new Error('RapidOCR name probe did not return valid aggregate JSON.')); }
    });
  });
  if (candidates.length !== selected.length) throw new Error('RapidOCR returned an unexpected photo count.');
  const results = selected.map((photo, index) => ({ file: photo.file, role: photo.role, hashVerified: true, ...candidates[index] }));
  return {
    engine: `RapidOCR PP-OCRv6 ${model} on local CPU`,
    expectedBrandObserved: results.filter((result) => result.expectedBrandObserved).length,
    lineLevelExpectedBrandMatch: results.filter((result) => result.matchingLineConfidence !== null).length,
    results,
  };
}
const models: Record<string, Awaited<ReturnType<typeof runModel>>> = {};
for (const model of modelTypes) models[model] = await runModel(model);
const receipt = {
  schemaVersion: 1,
  kind: 'rapidocr-product-name-candidate-probe',
  generatedAt: new Date().toISOString(),
  photos: selected.length,
  models,
  limitations: ['Five curated public package photographs only; brand-token matching is not package identity verification.', 'OCR text and image bytes are not stored in this receipt.', 'No phone runtime, formulation, variant or product-record match is established.'],
};
await writeFile('docs/evidence/rapidocr-name-retention.json', `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ result: 'docs/evidence/rapidocr-name-retention.json', photos: receipt.photos, models }, null, 2));
