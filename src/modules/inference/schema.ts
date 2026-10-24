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
  claimIndexes: z.array(z.number().int().min(0).max(14)).min(1).max(6),
}).strict();

/** Structured provider response contract for evidence-bounded assist. */
export const assistOutput = z.object({
  answer: z.string().max(7000),
  answerParts: z.array(answerPartSchema).max(6).optional(),
  claims: z.array(claimSchema).max(15),
  tentativeCandidates: z.array(tentativeStructuredCandidateSchema).max(20).optional(),
  packageReconstruction: packageReconstructionContentSchema.optional(),
  uiComponents: z.array(assistantUiComponentSchema).max(6).optional(),
  limitations: z.array(z.string().max(500)).max(15),
  inspectImage: z.object({
    handle: z.string().max(100),
    reason: z.string().min(1).max(300),
    crop: normalizedCropSchema.optional(),
  }).strict().nullable(),
}).strict();

/** Provider output may include linked answer fragments, but the natural answer is primary. */
export const providerAssistOutput = assistOutput.extend({
  answerParts: z.array(answerPartSchema).max(3).optional(),
});

/** First package analysis must return a reusable reconstruction alongside its answer. */
export const initialPackageAssistOutput = providerAssistOutput.extend({
  packageReconstruction: packageReconstructionContentSchema,
});

export type AssistOutput = z.infer<typeof assistOutput>;
