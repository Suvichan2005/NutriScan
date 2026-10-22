import {
  observationSchema,
  packageSchema,
  visionCaptureSchema,
  type Observation,
  type PackageData,
  type VisionCapture,
} from './contracts';

const visionWarning = 'Gemini image observations are unverified. They remain evidence and are not promoted to package facts or calculations.';

/**
 * Attach image-model output to the evidence record without parsing it into
 * package fields. Vision observations can inform a later interpretation, but
 * they are not OCR text and are not verified label readings.
 */
export function appendVisionEvidence(
  original: PackageData,
  capture: VisionCapture,
  observations: Observation[],
): PackageData {
  const validatedCapture = visionCaptureSchema.parse(capture);
  const validatedObservations = observations.map((observation) => observationSchema.parse(observation));

  return packageSchema.parse({
    ...original,
    observations: [...original.observations, ...validatedObservations],
    visionCaptures: [...(original.visionCaptures ?? []), validatedCapture],
    warnings: original.warnings.includes(visionWarning)
      ? original.warnings
      : [...original.warnings, visionWarning],
  });
}
