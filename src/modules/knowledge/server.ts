import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FeatureExtractionPipeline } from '@huggingface/transformers';
import { z } from 'zod';
import { corpusVersion, evidenceSources, lookupAdditive, lookupExplicitAdditiveMention } from './index';
import type { EvidenceSource } from '../../lib/contracts';
export { readOpenFoodToxRecords, openFoodToxDetailInput } from './openfoodtox-records';

/** Node.js-only entry point. Client modules must import the static `index.ts` entry instead. */

export const embeddingModel = 'Xenova/all-MiniLM-L6-v2';
export const embeddingRevision = '751bff37182d3f1213fa05d7196b954e230abad9';
export const embeddingDimensions = 384;
export const localEvidenceScoreFloor = 0.4;
export const modelDirectory = path.join(process.cwd(), '.data', 'models');
export const indexFile = path.join(process.cwd(), 'data', 'semantic-index.json');
export const openFoodToxIndexFile = path.join(process.cwd(), '.data', 'knowledge', 'openfoodtox-3.0.json');
export const openFoodToxSourceSha256 = '5181661e921651d4087b544981e1e5a63b99532844eac0112732806a00a85eda';
export const foodOnIndexFile = path.join(process.cwd(), 'data', 'foodon-index.json');
export const foodOnVersion = '2026-09-20';
export const foodOnRepositoryCommit = 'cd73540243a84bcd511a500d9a497d12d7dc02f6';
export const foodOnOntologySha256 = 'b897bf64c1b265c422db9ee01e1235c10c0b809e7f02326ef810a52068347edf';
export const foodOnSynonymExportSha256 = '1900fb2c80d834287cfdd0b52a98957b18269e86c197617711bc3a5d8541deb2';
export const documentText = (source: EvidenceSource) => `${source.title}. ${source.summary}`;
export const corpusFingerprint = () => createHash('sha256').update(JSON.stringify(evidenceSources.map(s => ({ id: s.id, text: documentText(s), url: s.url })))).digest('hex');

type Index = { model: string; revision: string; dimensions: number; corpusVersion: string; corpusSha256: string; generatedAt: string; vectors: { id: string; vector: number[] }[] };
export type SemanticHit = { source: EvidenceSource; semanticScore: number; lexicalScore: number; score: number; exactIdentity: boolean };

export type OpenFoodToxReference = {
  dossierId: string;
  title?: string | null;
  date?: string | null;
  persistentId?: string | null;
  foodDomain?: string | null;
  expertGroup?: string | null;
  regulation?: string | null;
};
export type OpenFoodToxAssessment = {
  assessmentId: string;
  adi: Record<string, string | number | boolean> | null;
  acuteReferenceDose: Record<string, string | number | boolean> | null;
};
export type OpenFoodToxSubstance = {
  substanceId: string;
  name: string;
  referenceSubstanceId: string | null;
  aliases: string[];
  identifiers: Record<string, string | number>;
  type: string[];
  references: OpenFoodToxReference[];
  assessments: OpenFoodToxAssessment[];
};
type OpenFoodToxSnapshot = {
  schemaVersion: 1;
  dataset: { version: '3.0'; sourceSha256: string; sourceUrl: string; releaseDate: string; license: string; licenseUrl: string; attribution: string };
  statistics: Record<string, number>;
  substances: OpenFoodToxSubstance[];
};
export type OpenFoodToxHit = { substance: OpenFoodToxSubstance; score: number; matchedBy: 'exact-identifier' | 'exact-name' | 'name-token-overlap' };
export type OpenFoodToxSearch =
  | { status: 'ok'; source: OpenFoodToxSnapshot['dataset']; statistics: OpenFoodToxSnapshot['statistics']; results: OpenFoodToxHit[] }
  | { status: 'no_match'; source: OpenFoodToxSnapshot['dataset']; results: [] }
  | { status: 'unavailable'; reason: 'not-imported' | 'invalid-index'; results: [] };

const foodOnAliasSchema = z.object({ text: z.string().min(1).max(4000), kind: z.enum(['exact', 'synonym', 'narrow', 'broad', 'alternative-label']) }).strict();
const foodOnTermSchema = z.object({
  id: z.string().regex(/^FOODON_[0-9]{8}$/),
  label: z.string().min(1).max(180),
  aliases: z.array(foodOnAliasSchema).max(200),
  parents: z.array(z.string().regex(/^FOODON_[0-9]{8}$/)).max(100),
}).strict();
const foodOnSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.object({
    name: z.literal('FoodOn Food Ontology'), version: z.string(), versionIri: z.string().url(), repositoryCommit: z.string(),
    ontologyUrl: z.string().url(), synonymExportUrl: z.string().url(), license: z.literal('CC BY 4.0'), licenseUrl: z.string().url(),
    ontologySha256: z.string().regex(/^[a-f0-9]{64}$/), synonymExportSha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
  terms: z.array(foodOnTermSchema).min(20_000).max(35_000),
}).strict();
export type FoodOnTerm = z.infer<typeof foodOnTermSchema>;
type FoodOnSnapshot = z.infer<typeof foodOnSnapshotSchema>;
export type FoodOnHit = { term: FoodOnTerm; matchedBy: 'exact-label' | 'exact-synonym' | 'exact-alias' | 'partial-token-overlap'; matchedText: string; parents: Array<{ id: string; label: string }> };
export type FoodOnSearch =
  | { status: 'ok'; source: FoodOnSnapshot['source']; results: FoodOnHit[] }
  | { status: 'no_match'; source: FoodOnSnapshot['source']; results: [] }
  | { status: 'unavailable'; reason: 'invalid-index'; results: [] };

let foodOnSnapshotPromise: Promise<FoodOnSnapshot> | undefined;

async function loadFoodOnSnapshot(): Promise<FoodOnSnapshot> {
  if (!foodOnSnapshotPromise) {
    foodOnSnapshotPromise = (async () => {
      const text = await readFile(foodOnIndexFile, 'utf8');
      if (Buffer.byteLength(text) > 12_000_000) throw new Error('Local FoodOn index exceeds its size limit.');
      const parsed = foodOnSnapshotSchema.safeParse(JSON.parse(text) as unknown);
      if (!parsed.success) throw new Error('Local FoodOn index does not match its documented schema.');
      const { source, terms } = parsed.data;
      if (source.version !== foodOnVersion || source.repositoryCommit !== foodOnRepositoryCommit
        || source.ontologySha256 !== foodOnOntologySha256 || source.synonymExportSha256 !== foodOnSynonymExportSha256
        || terms.length !== 25_143) throw new Error('Local FoodOn index does not match the pinned release.');
      return parsed.data;
    })();
    foodOnSnapshotPromise.catch(() => { foodOnSnapshotPromise = undefined; });
  }
  try { return await foodOnSnapshotPromise; }
  catch (error) { foodOnSnapshotPromise = undefined; throw error; }
}

function normalizeFoodOnTerm(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('en-IN').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

export function rankFoodOnTerms(query: string, terms: FoodOnTerm[], limit = 5): FoodOnHit[] {
  if (typeof query !== 'string' || query.trim().length < 2 || query.length > 180 || !Number.isInteger(limit) || limit < 1 || limit > 5) {
    throw new Error('Invalid FoodOn ingredient lookup request.');
  }
  const normalizedQuery = normalizeFoodOnTerm(query);
  const queryTokens = [...new Set(normalizedQuery.split(' ').filter(token => token.length > 1))];
  if (!queryTokens.length) return [];
  const termById = new Map(terms.map(term => [term.id, term]));
  const ranked: Array<FoodOnHit & { rank: number }> = [];
  for (const term of terms) {
    const names = [
      { text: term.label, kind: 'label' as const },
      ...term.aliases.map(alias => ({ text: alias.text, kind: alias.kind })),
    ];
    let best: (FoodOnHit & { rank: number }) | undefined;
    for (const name of names) {
      const normalizedName = normalizeFoodOnTerm(name.text);
      if (!normalizedName) continue;
      const matchedBy = name.kind === 'label' ? 'exact-label' : name.kind === 'exact' || name.kind === 'synonym' ? 'exact-synonym' : 'exact-alias';
      let rank = 0;
      let match: FoodOnHit['matchedBy'] = 'partial-token-overlap';
      if (normalizedName === normalizedQuery) {
        rank = name.kind === 'label' ? 3 : name.kind === 'exact' || name.kind === 'synonym' ? 2.9 : 2.7;
        match = matchedBy;
      } else {
        const nameTokens = new Set(normalizedName.split(' ').filter(token => token.length > 1));
        const overlap = queryTokens.filter(token => nameTokens.has(token)).length;
        const queryCoverage = overlap / queryTokens.length;
        const nameCoverage = overlap / Math.max(1, nameTokens.size);
        if (queryCoverage < (queryTokens.length === 1 ? 1 : 0.67) || nameCoverage < 0.5) continue;
        if (queryTokens.length > 1 && !normalizedName.includes(queryTokens.join(' '))) continue;
        rank = 1 + queryCoverage * 0.7 + nameCoverage * 0.3 - (name.kind === 'label' ? 0 : 0.02);
      }
      const parents = term.parents.flatMap(parentId => {
        const parent = termById.get(parentId);
        return parent ? [{ id: parent.id, label: parent.label }] : [];
      }).slice(0, 4);
      const candidate = { term, matchedBy: match, matchedText: name.text, parents, rank };
      if (!best || candidate.rank > best.rank || (candidate.rank === best.rank && candidate.matchedText.length < best.matchedText.length)) best = candidate;
    }
    if (best) ranked.push(best);
  }
  return ranked.sort((left, right) => right.rank - left.rank || left.term.id.localeCompare(right.term.id)).slice(0, limit)
    .map(hit => ({ term: hit.term, matchedBy: hit.matchedBy, matchedText: hit.matchedText, parents: hit.parents }));
}

export async function searchFoodOn(query: string, limit = 5): Promise<FoodOnSearch> {
  if (typeof query !== 'string' || query.trim().length < 2 || query.length > 180 || !Number.isInteger(limit) || limit < 1 || limit > 5) {
    throw new Error('Invalid FoodOn ingredient lookup request.');
  }
  let snapshot: FoodOnSnapshot;
  try { snapshot = await loadFoodOnSnapshot(); }
  catch { return { status: 'unavailable', reason: 'invalid-index', results: [] }; }
  const results = rankFoodOnTerms(query, snapshot.terms, limit);
  return results.length ? { status: 'ok', source: snapshot.source, results } : { status: 'no_match', source: snapshot.source, results: [] };
}

export const foodOnConceptInput=z.object({id:z.string().regex(/^FOODON_[0-9]{8}$/),relation:z.enum(['parents','children','ancestors']).default('parents'),offset:z.number().int().min(0).max(35000).default(0),limit:z.number().int().min(1).max(20).default(10)}).strict();

/** Asserted FoodOn taxonomy only. Ancestors retain paths; no allergy or health inference. */
export async function readFoodOnConcept(input:z.input<typeof foodOnConceptInput>){
  const args=foodOnConceptInput.parse(input);
  let snapshot:FoodOnSnapshot;
  try{snapshot=await loadFoodOnSnapshot();}catch{return{status:'unavailable' as const,reason:'invalid-index',results:[]};}
  const byId=new Map(snapshot.terms.map(term=>[term.id,term]));
  const term=byId.get(args.id);
  if(!term)return{status:'no_match' as const,source:snapshot.source,results:[]};
  const related:Array<{id:string;label:string;path:string[]}>=[];
  if(args.relation==='children'){
    for(const child of snapshot.terms)if(child.parents.includes(term.id))related.push({id:child.id,label:child.label,path:[child.id,term.id]});
  }else{
    const pending=term.parents.map(id=>({id,path:[term.id,id]})),seen=new Set([term.id]);
    for(let cursor=0;cursor<pending.length&&cursor<35000;cursor++){
      const next=pending[cursor];if(seen.has(next.id))continue;seen.add(next.id);
      const parent=byId.get(next.id);if(!parent)continue;
      related.push({id:parent.id,label:parent.label,path:next.path});
      if(args.relation==='ancestors')for(const id of parent.parents)if(!seen.has(id))pending.push({id,path:[...next.path,id]});
    }
  }
  return{status:'ok' as const,source:snapshot.source,concept:term,relation:args.relation,total:related.length,offset:args.offset,nextOffset:args.offset+args.limit<related.length?args.offset+args.limit:null,results:related.slice(args.offset,args.offset+args.limit),limitations:'Asserted active FoodOn class taxonomy and English synonyms only; imported ontologies, OWL restrictions and non-taxonomic relationships are outside this declared projection. Taxonomy does not establish package presence, nutrient content, allergen cross-contact, clinical suitability or legal authorization.'};
}

let openFoodToxSnapshotPromise: Promise<OpenFoodToxSnapshot | null> | undefined;

async function loadOpenFoodToxSnapshot(): Promise<OpenFoodToxSnapshot | null> {
  if (!openFoodToxSnapshotPromise) {
    openFoodToxSnapshotPromise = (async () => {
      let text: string;
      try { text = await readFile(openFoodToxIndexFile, 'utf8'); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
      if (Buffer.byteLength(text) > 50_000_000) throw new Error('Local OpenFoodTox index exceeds its size limit.');
      const value = JSON.parse(text) as OpenFoodToxSnapshot;
      if (value.schemaVersion !== 1 || value.dataset?.version !== '3.0' || value.dataset.sourceSha256 !== openFoodToxSourceSha256 || !Array.isArray(value.substances) || value.substances.length < 7000 || value.substances.length > 9000) throw new Error('Local OpenFoodTox index does not match the pinned release.');
      for (const substance of value.substances) {
        if (!substance || typeof substance.substanceId !== 'string' || typeof substance.name !== 'string' || !Array.isArray(substance.aliases) || !Array.isArray(substance.assessments) || !Array.isArray(substance.references)) throw new Error('Local OpenFoodTox index contains an invalid substance record.');
      }
      return value;
    })();
    openFoodToxSnapshotPromise.catch(() => { openFoodToxSnapshotPromise = undefined; });
  }
  try { return await openFoodToxSnapshotPromise; }
  catch (error) { openFoodToxSnapshotPromise = undefined; throw error; }
}

function normalizedOftName(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

function scoreOpenFoodToxSubstance(query: string, substance: OpenFoodToxSubstance): OpenFoodToxHit | null {
  const normalizedQuery = normalizedOftName(query);
  const compactQuery = normalizedQuery.replace(/\s/g, '');
  const identifiers = Object.values(substance.identifiers).map(value => String(value).trim().toLocaleLowerCase('en'));
  if (identifiers.some(identifier => identifier === query.trim().toLocaleLowerCase('en') || normalizedOftName(identifier).replace(/\s/g, '') === compactQuery)) return { substance, score: 100, matchedBy: 'exact-identifier' };
  const aliases = [substance.name, ...substance.aliases];
  const normalizedAliases = aliases.map(normalizedOftName).filter(Boolean);
  if (normalizedAliases.some(alias => alias === normalizedQuery || alias.replace(/\s/g, '') === compactQuery)) return { substance, score: 95, matchedBy: 'exact-name' };
  if (compactQuery.length >= 12 && normalizedAliases.some(alias => alias.replace(/\s/g, '').startsWith(compactQuery) && alias.replace(/\s/g, '').length - compactQuery.length <= 5)) return { substance, score: 90, matchedBy: 'exact-name' };
  if (normalizedQuery.length >= 4 && !normalizedQuery.includes(' ') && normalizedAliases.some(alias => alias.split(' ').includes(normalizedQuery))) return { substance, score: 90, matchedBy: 'exact-name' };

  const queryTokens = [...new Set(normalizedQuery.split(' ').filter(token => token.length >= 3))];
  if (!queryTokens.length) return null;
  const best = normalizedAliases.reduce((maximum, alias) => {
    const aliasTokens = new Set(alias.split(' ').filter(token => token.length >= 3));
    const overlap = queryTokens.filter(token => aliasTokens.has(token)).length;
    const queryCoverage = overlap / queryTokens.length;
    const aliasCoverage = overlap / Math.max(1, aliasTokens.size);
    return Math.max(maximum, Math.min(queryCoverage, aliasCoverage));
  }, 0);
  if (best < (queryTokens.length === 1 ? 1 : 0.67)) return null;
  return { substance, score: Math.round(best * 70), matchedBy: 'name-token-overlap' };
}

export function rankOpenFoodToxSubstances(query: string, substances: OpenFoodToxSubstance[], limit = 3): OpenFoodToxHit[] {
  if (typeof query !== 'string' || query.trim().length < 2 || query.length > 120 || !Number.isInteger(limit) || limit < 1 || limit > 5) throw new Error('Invalid OpenFoodTox search request.');
  return substances
    .map(substance => scoreOpenFoodToxSubstance(query, substance))
    .filter((hit): hit is OpenFoodToxHit => Boolean(hit))
    .sort((a, b) => b.score - a.score || Number(b.substance.assessments.length > 0) - Number(a.substance.assessments.length > 0) || a.substance.name.localeCompare(b.substance.name))
    .slice(0, limit);
}

/**
 * Search the locally imported EFSA source snapshot by substance name or exact
 * registry identifier. This is identity retrieval only; it does not infer that
 * a substance is present in a package or that the package contains an exposure.
 */
export async function searchOpenFoodTox(query: string, limit = 3): Promise<OpenFoodToxSearch> {
  if (typeof query !== 'string' || query.trim().length < 2 || query.length > 120 || !Number.isInteger(limit) || limit < 1 || limit > 5) throw new Error('Invalid OpenFoodTox search request.');
  let snapshot: OpenFoodToxSnapshot | null;
  try { snapshot = await loadOpenFoodToxSnapshot(); }
  catch { return { status: 'unavailable', reason: 'invalid-index', results: [] }; }
  if (!snapshot) return { status: 'unavailable', reason: 'not-imported', results: [] };
  const results = rankOpenFoodToxSubstances(lookupAdditive(query)?.name ?? query, snapshot.substances, limit);
  if (!results.length) return { status: 'no_match', source: snapshot.dataset, results: [] };
  return { status: 'ok', source: snapshot.dataset, statistics: snapshot.statistics, results };
}

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

export function isCurrentLawOrRegulatoryQuery(query: string): boolean {
  return /\b(?:ors|fssai|egazette|gazette|notification|directive|legal|law|regulatory|regulation|permission|authorization|compliance|recall|recalled|banned|allowed)\b/i.test(query);
}

export function clearsLocalEvidenceFloor(score: number): boolean {
  return Number.isFinite(score) && score >= localEvidenceScoreFloor;
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
  const currentRegulatoryIntent = isCurrentLawOrRegulatoryQuery(query);
  const limitations = [
    `${evidenceSources.length} curated source summaries and records; retrieval similarity is not medical clearance, evidence quality, or probability of truth.`,
    'This dated index does not verify current law, product dose, a personal nutrient target, or local stock.',
    'Queries are processed on this local server without remote inference.',
    `A conservative development score floor of ${localEvidenceScoreFloor} suppresses weak local matches; it has not been calibrated on an independent user-query set.`,
  ];
  if (currentRegulatoryIntent) return {
    status: 'no_match' as const,
    mode: 'hybrid-local-embedding' as const,
    model: embeddingModel,
    revision: embeddingRevision,
    corpusVersion,
    corpusSha256: corpusFingerprint(),
    retrievedAt: new Date().toISOString(),
    latencyMs: 0,
    results: [],
    message: 'The curated local evidence library is not a current-law source. Use dated regulatory research; its results still require review for the exact product and jurisdiction.',
    limitations,
  };
  if (active) throw new Error('Local embedding model is busy. Try again shortly.');
  active = true;
  try {
    const started = performance.now();
    const index = await loadIndex();
    const [vector] = await embedLocally([query]);
    const lexical = lexicalRanking(query);
    const exact = lookupAdditive(query) ?? lookupExplicitAdditiveMention(query);
    const ranked: SemanticHit[] = evidenceSources.map(source => {
      const semanticScore = cosineSimilarity(vector, index.vectors.find(v => v.id === source.id)!.vector);
      const lexicalScore = lexical.find(v => v.source.id === source.id)!.lexicalScore;
      const exactIdentity = exact?.sourceIds.includes(source.id) ?? false;
      return { source, semanticScore, lexicalScore, exactIdentity, score: .9 * semanticScore + .1 * lexicalScore + (exactIdentity ? 1 : 0) };
    }).sort((a, b) => b.score - a.score);
    const results = ranked.filter(hit => clearsLocalEvidenceFloor(hit.score)).slice(0, limit);
    return {
      status: results.length ? 'ok' as const : 'no_match' as const,
      mode: 'hybrid-local-embedding' as const,
      model: embeddingModel,
      revision: embeddingRevision,
      corpusVersion,
      corpusSha256: index.corpusSha256,
      retrievedAt: new Date().toISOString(),
      latencyMs: Math.round(performance.now() - started),
      results,
      ...(!results.length ? { message: 'No local source candidate cleared the conservative relevance floor. Refine the question or use an appropriate live source search.' } : {}),
      limitations,
    };
  } finally { active = false; }
}
