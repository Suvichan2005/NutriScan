const evidenceMarker = /\s*\[(?:observation|source|calculation|profile|image):[^\]\r\n]{1,180}\]/g;
const evidenceLinkExcerpt = /[ \t]*Evidence links:[^\r\n]*/g;

const oldQuantityNotice = 'I omitted one or more numerical statements that the available evidence could not verify.';
const oldProvisionalNotice = 'Some numbers are provisional package readings; confirm them in Package details.';

/** Migrate only the exact application-owned footer in older saved turns; never summarize model prose. */
export function separateLegacyAnswerNotice(answer: string) {
  for (const notice of [`${oldQuantityNotice} ${oldProvisionalNotice}`, oldQuantityNotice, oldProvisionalNotice]) {
    if (answer.endsWith(`\n\n${notice}`)) return {
      answer: answer.slice(0, -notice.length).trimEnd(),
      withheld: notice.includes(oldQuantityNotice), provisional: notice.includes(oldProvisionalNotice),
    };
  }
  return { answer, withheld: false, provisional: false };
}

/** Plain-text layout only: preserve every line and group adjacent list items. */
export function conversationAnswerBlocks(answer: string): Array<{ text: string; kind: 'paragraph' | 'heading' | 'list' }> {
  const blocks: Array<{ text: string; kind: 'paragraph' | 'heading' | 'list' }> = [];
  for (const raw of answer.split(/\r?\n/)) {
    const text = presentConversationAnswer(raw);
    if (!text) continue;
    const kind = /^•\s/.test(text) ? 'list' : /^\s*(?:#{1,6}\s|\*\*[^*]+\*\*\s*$)/.test(raw)
      || (text.length < 72 && !/[.!?]$/.test(text) && !/\d/.test(text)) ? 'heading' : 'paragraph';
    const previous = blocks.at(-1);
    if (kind === 'list' && previous?.kind === 'list') previous.text += `\n${text}`;
    else blocks.push({ text, kind });
  }
  return blocks;
}

/** Keep internal evidence IDs out of the consumer transcript; evidence remains inspectable separately. */
export function presentConversationAnswer(answer: string) {
  const normalized = answer
    .replace(evidenceLinkExcerpt, '')
    .replace(evidenceMarker, '')
    .replace(/\s*\[\s*(?:,\s*)+\]\s*/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*(?:---+|\*\*\*+|___+)\s*$/gm, '')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1')
    // Tolerate an unbalanced emphasis marker around a heading, not arbitrary
    // asterisks in label text (footnotes and multiplication remain intact).
    .replace(/^\s*\*{1,2}([A-Za-z][\w /&()-]{0,70}:)\*{1,2}(?=\s|$)/gm, '$1')
    .replace(/(\*\*|__)(.*?)\1/gs, '$2')
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .split('\n')
    .map(line => /^\s*[-*+]\s+/.test(line) ? `• ${line.replace(/^\s*[-*+]\s+/, '').trim()}` : line.trim())
    .join('\n')
    .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n')
    .trim();
  return normalized;
}
