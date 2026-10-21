/** Compatibility facade. New knowledge-module code should live under src/modules/knowledge. */
export {
  corpusVersion,
  evidenceSources,
  nutrientContentClaimSourceIds,
  nutrientContentClaimGuidance,
  findNutrientContentClaimGuidance,
  additives,
  lookupAdditive,
  resolveTentativeAdditiveIdentity,
  detectAdditives,
  embedEvidence,
  retrieveEvidence,
} from '../modules/knowledge/index';
export type { NutrientContentClaimGuidance, AdditiveRecord, TentativeAdditiveIdentityCandidate, RetrievalHit } from '../modules/knowledge/index';
