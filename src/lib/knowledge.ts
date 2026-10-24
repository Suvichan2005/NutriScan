/** Compatibility facade. New knowledge-module code should live under src/modules/knowledge. */
export {
  lookupDeclaredFoodLabelAlias,
  corpusVersion,
  evidenceSources,
  indianStapleIdentitySources,
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
export type { DeclaredFoodKind, DeclaredFoodLabelAlias, NutrientContentClaimGuidance, AdditiveRecord, TentativeAdditiveIdentityCandidate, RetrievalHit } from '../modules/knowledge/index';
