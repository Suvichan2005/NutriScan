const evidenceMarker = /\s*\[(?:observation|source|calculation|profile|image):[^\]\r\n]{1,180}\]/g;
const evidenceLinkExcerpt = /[ \t]*Evidence links:[^\r\n]*/g;

/** Keep internal evidence IDs out of the consumer transcript; evidence remains inspectable separately. */
export function presentConversationAnswer(answer: string) {
  const normalized = answer
    .replace(evidenceLinkExcerpt, '')
    .replace(evidenceMarker, '')
    .replace(/\s*\[\s*(?:,\s*)+\]\s*/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*(?:---+|\*\*\*+|___+)\s*$/gm, '')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1')
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
