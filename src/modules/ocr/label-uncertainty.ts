import type { ParserDiagnostic } from '../../lib/contracts';

/** Summarize unresolved package readings without hiding their original notes. */
export function summarizeLabelUncertainty(diagnostics: readonly ParserDiagnostic[], warnings: readonly string[]): string[] {
  const reasons = new Set<ParserDiagnostic['reasonCodes'][number]>(diagnostics.flatMap(diagnostic => diagnostic.reasonCodes));
  const warningText = warnings.join(' ').toLowerCase();
  const summaries: string[] = [];

  const hasNutritionIssues = diagnostics.some(diagnostic => diagnostic.decision !== 'accepted' || diagnostic.reasonCodes.length > 0)
    || /nutrition columns|numeric values|conflicting readings|intended column|unit missing|no unit was guessed|incompatible unit|basis.*missing|mass or volume basis|serving basis is stated|invalid value|no readable numerical|approximate value|exact calculation withheld|ambiguous signed|no usable nutrition values/.test(warningText);
  if (hasNutritionIssues) summaries.push('Some nutrition entries need checking. NutriScan left unclear amounts out of calculations rather than guessing.');
  if (/product name was not established/.test(warningText)) {
    summaries.push('The product name was not established from the readable package text.');
  }

  if (summaries.length) return summaries;
  if (warnings.length) return ['Some package details still need checking against the original label.'];
  return ['No unresolved label-reading issues were reported. OCR can still be imperfect, so inspect the original package before relying on it.'];
}
