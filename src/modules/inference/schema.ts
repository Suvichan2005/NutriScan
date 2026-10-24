import { z } from 'zod';
import { assistantUiComponentSchema, evidenceSpanSchema, normalizedCropSchema, packageReconstructionContentSchema, tentativeStructuredCandidateSchema, visualEvidenceReferenceSchema } from '../../lib/contracts';

const profileFieldIdSchema = z.enum([
  'dietaryPattern', 'avoidedIngredients', 'allergies', 'intolerances', 'healthConsiderations',
  'goals', 'portionPreferences', 'ageGroup', 'sexOrReferenceGroup', 'country', 'locality',
]);

const claimSchema = z.object({
  mode: z.enum(['direct-quote', 'synthesis']),
  text: z.string().min(1).max(1800),
  observationIds: z.array(z.string().max(160)).max(30),
  sourceIds: z.array(z.string().max(160)).max(20),
  calculationIds: z.array(z.string().max(120)).max(20).optional(),
  interpretationRowIds: z.array(z.string().max(100)).max(30).optional(),
  packageFactIds: z.array(z.string().max(120)).max(30).optional(),
  profileFieldIds: z.array(profileFieldIdSchema).max(9).optional(),
  // Evidence identifiers are the stable contract. Exact OCR quotations are
  // optional review aids; they must not gate natural-language answers.
  supportingSpans: z.array(evidenceSpanSchema).max(10).optional(),
  visualEvidence: z.array(visualEvidenceReferenceSchema).max(10).optional(),
}).strict();

const answerPartSchema = z.object({
  text: z.string().trim().min(1).max(1200),
  // Referential integrity is checked against the accepted claim list in core.
  // Keeping an out-of-range model reference parseable lets validation withhold
  // only that optional segment while retaining independently supported parts.
  claimIndexes: z.array(z.number().int()).min(1).max(6),
}).strict();

/** Structured provider response contract for evidence-bounded assist. */
export const assistOutput = z.object({
  answer: z.string().max(7000),
  answerParts: z.array(answerPartSchema).max(6).optional(),
  // No grounded claims is a valid model outcome; the caller classifies the
  // answer as unsupported rather than treating an empty set as malformed JSON.
  claims: z.array(claimSchema).max(15).default([]),
  tentativeCandidates: z.array(tentativeStructuredCandidateSchema).max(20).optional(),
  packageReconstruction: packageReconstructionContentSchema.optional(),
  uiComponents: z.array(assistantUiComponentSchema).max(6).optional(),
  limitations: z.array(z.string().max(500)).max(15).default([]),
  inspectImage: z.object({
    handle: z.string().max(100),
    reason: z.string().min(1).max(300),
    crop: normalizedCropSchema.optional(),
  }).strict().nullable().default(null),
}).strict();

/** Optional model-authored evidence map; when present it must cover the answer exactly. */
export const providerAssistOutput = assistOutput.extend({
  // This map is the only permitted bridge from model prose to validated
  // findings. Require the field, while allowing an empty array when the model
  // has no answer it can support. That is an evidence outcome, not a schema
  // failure.
  answerParts: z.array(answerPartSchema).max(6),
  // An explicit empty claim set is valid; an omitted claim set is a malformed
  // provider response and should be repaired/classified separately.
  claims: z.array(claimSchema).max(15),
});

/** First package analysis must return a reusable reconstruction alongside its answer. */
export const initialPackageAssistOutput = providerAssistOutput.extend({
  packageReconstruction: packageReconstructionContentSchema,
});

export type AssistOutput = z.infer<typeof assistOutput>;
