import { mkdir, writeFile, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { evidenceSources, corpusVersion } from '../src/lib/knowledge';
import { embeddingModel, embeddingRevision, embeddingDimensions, modelDirectory, indexFile, documentText, corpusFingerprint, embedLocally, disposeEmbeddingModel } from '../src/lib/semantic';

// Explicit setup only. Application requests cannot initiate these downloads.
const files = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'vocab.txt', 'onnx/model_quantized.onnx'];
const manifest = [];
async function boundedBytes(response: Response) {
  if (!response.body) throw new Error('Empty model response.');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.length;
      if (length > 30_000_000) { await reader.cancel(); throw new Error('Model response exceeds 30MB bound.'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
try {
  for (const name of files) {
    const destination = path.join(modelDirectory, embeddingModel, name);
    await mkdir(path.dirname(destination), { recursive: true });
    let bytes: Uint8Array;
    try { bytes = await readFile(destination); }
    catch {
      const url = `https://huggingface.co/${embeddingModel}/resolve/${embeddingRevision}/${name}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!response.ok || Number(response.headers.get('content-length') ?? 0) > 30_000_000) throw new Error(`Model asset rejected: ${name} HTTP ${response.status}`);
      bytes = await boundedBytes(response);
      if (bytes.length > 30_000_000 || !bytes.length) throw new Error(`Model asset exceeds size bound: ${name}`);
      await writeFile(`${destination}.partial`, bytes);
      await rename(`${destination}.partial`, destination);
    }
    manifest.push({ file: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    console.log(`Prepared ${name} (${bytes.length} bytes)`);
  }
  const vectors = await embedLocally(evidenceSources.map(documentText));
  const index = { model: embeddingModel, revision: embeddingRevision, dimensions: embeddingDimensions, corpusVersion, corpusSha256: corpusFingerprint(), generatedAt: new Date().toISOString(), vectors: evidenceSources.map((s, i) => ({ id: s.id, vector: vectors[i] })) };
  await mkdir(path.dirname(indexFile), { recursive: true });
  await writeFile(indexFile, `${JSON.stringify(index)}\n`);
  await writeFile('data/semantic-model-manifest.json', `${JSON.stringify({ model: embeddingModel, revision: embeddingRevision, license: 'Apache-2.0', source: `https://huggingface.co/${embeddingModel}/tree/${embeddingRevision}`, files: manifest }, null, 2)}\n`);
  console.log(`Embedded ${vectors.length} genuine evidence summaries, ${embeddingDimensions} dimensions. Runtime is local-only.`);
} finally { await disposeEmbeddingModel(); }
