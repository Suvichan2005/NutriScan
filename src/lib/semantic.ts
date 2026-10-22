/** Compatibility facade for the Node.js-only local retrieval implementation. */
export {
  embeddingModel,
  embeddingRevision,
  embeddingDimensions,
  localEvidenceScoreFloor,
  modelDirectory,
  indexFile,
  openFoodToxIndexFile,
  openFoodToxSourceSha256,
  documentText,
  corpusFingerprint,
  embedLocally,
  disposeEmbeddingModel,
  lexicalRanking,
  cosineSimilarity,
  isCurrentLawOrRegulatoryQuery,
  clearsLocalEvidenceFloor,
  semanticRetrieve,
  rankOpenFoodToxSubstances,
  searchOpenFoodTox,
} from '../modules/knowledge/server';
export type { SemanticHit, OpenFoodToxHit, OpenFoodToxSearch, OpenFoodToxSubstance, OpenFoodToxAssessment, OpenFoodToxReference } from '../modules/knowledge/server';
