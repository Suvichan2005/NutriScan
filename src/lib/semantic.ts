/** Compatibility facade for the Node.js-only local retrieval implementation. */
export {
  embeddingModel,
  embeddingRevision,
  embeddingDimensions,
  localEvidenceScoreFloor,
  modelDirectory,
  indexFile,
  documentText,
  corpusFingerprint,
  embedLocally,
  disposeEmbeddingModel,
  lexicalRanking,
  cosineSimilarity,
  isCurrentLawOrRegulatoryQuery,
  clearsLocalEvidenceFloor,
  semanticRetrieve,
} from '../modules/knowledge/server';
export type { SemanticHit } from '../modules/knowledge/server';
