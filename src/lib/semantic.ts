import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FeatureExtractionPipeline } from '@huggingface/transformers';
import { corpusVersion, evidenceSources, lookupAdditive } from './knowledge';
import type { EvidenceSource } from './contracts';

export const embeddingModel = 'Xenova/all-MiniLM-L6-v2';
export const embeddingRevision = '751bff37182d3f1213fa05d7196b954e230abad9';
export const embeddingDimensions = 384;
export const modelDirectory = path.join(process.cwd(), '.data', 'models');
export const indexFile = path.join(process.cwd(), 'data', 'semantic-index.json');
export const documentText = (source: EvidenceSource) => `${source.title}. ${source.summary}`;
export const corpusFingerprint = () => createHash('sha256').update(JSON.stringify(evidenceSources.map(s => ({ id: s.id, text: documentText(s), url: s.url })))).digest('hex');

type Index = { model: string; revision: string; dimensions: number; corpusVersion: string; corpusSha256: string; generatedAt: string; vectors: { id: string; vector: number[] }[] };
export type SemanticHit = { source: EvidenceSource; semanticScore: number; lexicalScore: number; score: number; exactIdentity: boolean };

let extractorPromise: Promise<FeatureExtractionPipeline> | undefined;
async function extractor() {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers');
      // Runtime never downloads models or sends query text to a remote service.
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      env.localModelPath = `${modelDirectory}${path.sep}`;
      env.useFSCache = false;
      return pipeline('feature-extraction', embeddingModel, { dtype: 'q8', device: 'cpu', session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 } });
    })();
    extractorPromise.catch(() => { extractorPromise = undefined; });
  }
  return extractorPromise;
}

export async function embedLocally(texts: string[]): Promise<number[][]> {
  if (!texts.length || texts.length > 32 || texts.some(t => !t.trim() || t.length > 2000)) throw new Error('Embedding input exceeds local limits.');
  const pipe = await extractor();
  const tensor = await pipe(texts, { pooling: 'mean', normalize: true });
  const result = tensor.tolist() as number[][];
  if (result.length !== texts.length || result.some(v => v.length !== embeddingDimensions || v.some(n => !Number.isFinite(n)))) throw new Error('Invalid local embedding output.');
  return result;
}

export async function disposeEmbeddingModel() {
  if (extractorPromise) { const current = extractorPromise; extractorPromise = undefined; await (await current).dispose(); }
}

const stop = new Set('a an the is are of to for and or in on with it this that i my can do does how what me as at from by should'.split(' '));
const tokens = (text: string) => (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(t => !stop.has(t));

/** BM25 lexical baseline, without hand-built synonym lists. */
export function lexicalRanking(query: string): { source: EvidenceSource; lexicalScore: number }[] {
  const documents = evidenceSources.map(s => tokens(documentText(s)));
  const averageLength = documents.reduce((n, d) => n + d.length, 0) / documents.length;
  const terms = [...new Set(tokens(query))];
  const scores = documents.map(document => terms.reduce((score, term) => {
    const frequency = document.filter(t => t === term).length;
    const containing = documents.filter(d => d.includes(term)).length;
    const idf = Math.log(1 + (documents.length - containing + .5) / (containing + .5));
    return score + idf * frequency * 2.2 / (frequency + 1.2 * (.25 + .75 * document.length / averageLength));
  }, 0));
  const maximum = Math.max(...scores, 1e-9);
  return evidenceSources.map((source, i) => ({ source, lexicalScore: scores[i] / maximum })).sort((a, b) => b.lexicalScore - a.lexicalScore);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length || a.some(n => !Number.isFinite(n)) || b.some(n => !Number.isFinite(n))) throw new Error('Invalid vector dimensions or coordinates.');
  const denominator = Math.hypot(...a) * Math.hypot(...b);
  if (!denominator) throw new Error('Zero vectors cannot establish cosine similarity.');
  return a.reduce((sum, n, i) => sum + n * b[i], 0) / denominator;
}

async function loadIndex(): Promise<Index> {
  const index = JSON.parse(await readFile(indexFile, 'utf8')) as Index;
  if (index.model !== embeddingModel || index.revision !== embeddingRevision || index.dimensions !== embeddingDimensions || index.corpusSha256 !== corpusFingerprint() || index.corpusVersion !== corpusVersion || index.vectors.length !== evidenceSources.length) throw new Error('Local evidence index is stale. Run npm run embeddings:prepare.');
  if (new Set(index.vectors.map(v => v.id)).size !== evidenceSources.length || evidenceSources.some(s => !index.vectors.some(v => v.id === s.id && v.vector.length === embeddingDimensions && v.vector.every(Number.isFinite)))) throw new Error('Invalid evidence index.');
  return index;
}

let active = false;
export async function semanticRetrieve(query: string, limit = 4) {
  if (!query.trim() || query.length > 1200 || !Number.isInteger(limit) || limit < 1 || limit > 5) throw new Error('Invalid evidence query.');
  if (active) throw new Error('Local embedding model is busy. Try again shortly.');
  active = true;
  try {
    const started = performance.now();
    const index = await loadIndex();
    const [vector] = await embedLocally([query]);
    const lexical = lexicalRanking(query);
    const exact = lookupAdditive(query);
    const results: SemanticHit[] = evidenceSources.map(source => {
      const semanticScore = cosineSimilarity(vector, index.vectors.find(v => v.id === source.id)!.vector);
      const lexicalScore = lexical.find(v => v.source.id === source.id)!.lexicalScore;
      const exactIdentity = exact?.sourceIds.includes(source.id) ?? false;
      return { source, semanticScore, lexicalScore, exactIdentity, score: .9 * semanticScore + .1 * lexicalScore + (exactIdentity ? 1 : 0) };
    }).sort((a, b) => b.score - a.score).slice(0, limit);
    return { status: 'ok' as const, mode: 'hybrid-local-embedding' as const, model: embeddingModel, revision: embeddingRevision, corpusVersion, corpusSha256: index.corpusSha256, retrievedAt: new Date().toISOString(), latencyMs: Math.round(performance.now() - started), results, limitations: ['Eight curated source summaries and records; retrieval similarity is not medical clearance, evidence quality, or probability of truth.', 'This dated index does not verify current law, product dose, a personal nutrient target, or local stock.', 'Queries are processed on this local server without remote inference. No relevance threshold has been clinically validated.'] };
  } finally { active = false; }
}
