export type PortionChoice = { value: number; unit: 'g' | 'ml' };

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
