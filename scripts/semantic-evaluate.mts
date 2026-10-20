import { readFile, writeFile } from 'node:fs/promises';
import { semanticRetrieve, lexicalRanking, disposeEmbeddingModel, embeddingModel, embeddingRevision, corpusFingerprint, indexFile, embedLocally, cosineSimilarity } from '../src/lib/semantic';
import { corpusVersion, evidenceSources } from '../src/lib/knowledge';

const queries = JSON.parse(await readFile('data/semantic-evaluation-queries.json', 'utf8')) as {id: string; query: string; relevant: string[]}[];
const rows = [];
try {
  const index = JSON.parse(await readFile(indexFile, 'utf8')) as {vectors:{id:string;vector:number[]}[]};
  for (const item of queries) {
    const result = await semanticRetrieve(item.query, 5);
    const lexical = lexicalRanking(item.query);
    const [queryVector] = await embedLocally([item.query]);
    const semantic = index.vectors.map(row => ({id:row.id, score:cosineSimilarity(queryVector,row.vector)})).sort((a,b)=>b.score-a.score);
    const rank = (ids: string[]) => { const found = ids.findIndex(id => item.relevant.includes(id)); return found < 0 ? null : found + 1; };
    rows.push({ id: item.id, query: item.query, relevant: item.relevant, lexicalRank: rank(lexical.map(h => h.source.id)), semanticRank: rank(semantic.map(h => h.id)), hybridRank: rank(result.results.map(h => h.source.id)), hybridTop3: result.results.slice(0, 3).map(h => ({id:h.source.id, semanticScore:h.semanticScore, lexicalScore:h.lexicalScore})), latencyMs:result.latencyMs });
  }
  const metrics = (key: 'lexicalRank'|'semanticRank'|'hybridRank') => ({ top1: rows.filter(r => r[key] === 1).length / rows.length, recallAt3: rows.filter(r => r[key] !== null && r[key]! <= 3).length / rows.length, mrrAt5: rows.reduce((sum, r) => sum + (r[key] !== null && r[key]! <= 5 ? 1/r[key]! : 0), 0) / rows.length });
  const runtimeVersion = (JSON.parse(await readFile('node_modules/@huggingface/transformers/package.json', 'utf8')) as {version:string}).version;
  const report = { evaluatedAt:new Date().toISOString(), model:embeddingModel, revision:embeddingRevision, runtimeVersion, dtype:'q8', pooling:'mean', normalized:true, hybridRecipe:'0.9*cosine + 0.1*max-normalized BM25 + 1 for exact additive identity', corpusVersion, corpusSha256:corpusFingerprint(), documents:evidenceSources.length, queryCount:rows.length, scope:'Developer-authored relevance cases; not independent clinical or open-domain evaluation. Queries versioned before measurement. Lexical and semantic rank over the entire corpus; hybrid top five.', metrics:{lexical:metrics('lexicalRank'),semantic:metrics('semanticRank'),hybrid:metrics('hybridRank')}, rows };
  await writeFile('data/semantic-evaluation-results.json', `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({queries:rows.length,documents:report.documents,metrics:report.metrics},null,2));
} finally { await disposeEmbeddingModel(); }
