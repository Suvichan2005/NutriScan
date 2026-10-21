import { readFile, writeFile } from 'node:fs/promises';
import { disposeEmbeddingModel, semanticRetrieve } from '../src/lib/semantic';

type Case = { id: string; query: string; relevant: string[] };
type QueryResult = { id: string; relevant: string[]; status: string; topSourceId: string | null; semanticScore: number | null; lexicalScore: number | null; hybridScore: number | null; expectedBehaviorMet: boolean };
const cases = JSON.parse(await readFile('data/semantic-boundary-queries.json', 'utf8')) as Case[];
if (!Array.isArray(cases) || cases.length < 8 || new Set(cases.map(item => item.id)).size !== cases.length) throw new Error('Boundary evaluation cases are missing or duplicated.');
const results: QueryResult[] = [];
try {
  for (const item of cases) {
    const response = await semanticRetrieve(item.query, 1);
    const hit = response.results[0];
    const expectedBehaviorMet = item.relevant.length === 0
      ? response.status === 'no_match' && response.results.length === 0
      : response.results.some(candidate => item.relevant.includes(candidate.source.id));
    results.push({
      id: item.id,
      relevant: item.relevant,
      status: response.status,
      topSourceId: hit?.source.id ?? null,
      semanticScore: hit ? Number(hit.semanticScore.toFixed(5)) : null,
      lexicalScore: hit ? Number(hit.lexicalScore.toFixed(5)) : null,
      hybridScore: hit ? Number(hit.score.toFixed(5)) : null,
      expectedBehaviorMet,
    });
  }
} finally { await disposeEmbeddingModel(); }
const receipt = {
  schemaVersion: 1,
  kind: 'local-semantic-retrieval-boundary-diagnostic',
  generatedAt: new Date().toISOString(),
  queryCount: results.length,
  modelMode: 'pinned local MiniLM embeddings plus lexical ranking',
  results,
  limitations: [
    'Queries are developer-authored probes, not an independent held-out benchmark or user study.',
    'Similarity scores are not probabilities, evidence quality measures or entailment checks.',
    'This diagnostic exercises a conservative development floor and a current-law intent gate; it does not calibrate them on independent user queries.',
  ],
};
await writeFile('docs/evidence/semantic-boundary-diagnostic.json', `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ receipt: 'docs/evidence/semantic-boundary-diagnostic.json', results }, null, 2));
if (results.some(result => !result.expectedBehaviorMet)) process.exitCode = 1;
