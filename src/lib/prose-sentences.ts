/** Presentation boundaries only; this makes no judgment about a claim's meaning. */
export function splitProseSentences(text: string): string[] {
  const result: string[] = [];
  let pending = '';
  for (const segment of text.split(/(?<=[.!?])\s+(?=[\p{L}\p{N}"“])/u).filter(Boolean)) {
    pending += (pending ? ' ' : '') + segment;
    let depth = 0;
    for (const character of pending) {
      if ('([{'.includes(character)) depth += 1;
      else if (')]}'.includes(character)) depth -= 1;
    }
    const strongMarkers = (pending.match(/\*\*|__/g) ?? []).length;
    const codeMarkers = (pending.match(/`/g) ?? []).length;
    // A period can occur inside a parenthetical or Markdown
    // label. Never expose only the opening half after the next half is withheld.
    if (depth !== 0 || strongMarkers % 2 !== 0 || codeMarkers % 2 !== 0) continue;
    if (pending.trim()) result.push(pending.trim());
    pending = '';
  }
  if (pending.trim()) result.push(pending.trim());
  return result;
}
