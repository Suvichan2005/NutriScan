export type PortionChoice = { value: number; unit: 'g' | 'ml' };

/** Choose a neutral calculation reference from the label, never a user-specific serving guess. */
export function defaultPortion(pkg: { serving?: PortionChoice; netWeight?: PortionChoice; nutrients: { status: string; basis: { amount: number; unit: 'g' | 'ml' } | null }[] }): PortionChoice {
  const declaredBasis = pkg.nutrients.find(n => n.status !== 'conflict' && n.basis)?.basis;
  if (pkg.serving && (!declaredBasis || declaredBasis.unit === pkg.serving.unit)) return pkg.serving;
  if (declaredBasis) return { value: declaredBasis.amount, unit: declaredBasis.unit };
  if (pkg.serving) return pkg.serving;
  return { value: 100, unit: pkg.netWeight?.unit ?? 'g' };
}

/** Use an amount the user typed in their question, falling back to the current portion. */
export function resolveQuestionPortion(question: string, fallback: PortionChoice, netWeight?: PortionChoice): PortionChoice {
  const amount = question.match(/\b(\d+(?:\.\d+)?)\s*(g|grams?|ml)\b/i);
  if (amount) {
    const value = Number(amount[1]);
    if (value > 0 && value <= 2000) return { value, unit: amount[2].toLowerCase() === 'ml' ? 'ml' : 'g' };
  }
  if (/\bhalf (?:a |the )?(?:pack|packet)\b/i.test(question) && netWeight) {
    return { value: netWeight.value / 2, unit: netWeight.unit };
  }
  return fallback;
}
