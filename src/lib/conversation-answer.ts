const evidenceMarker = /\s*\[(?:observation|source|calculation|profile|image):[^\]\r\n]{1,180}\]/g;
const evidenceLinkExcerpt = /[ \t]*Evidence links:[^\r\n]*/g;

/** Keep internal evidence IDs out of the consumer transcript; evidence remains inspectable separately. */
export function presentConversationAnswer(answer: string) {
  return answer
    .replace(evidenceLinkExcerpt, '')
    .replace(evidenceMarker, '')
    .replace(/\s*\[\s*(?:,\s*)+\]\s*/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n')
    .trim();
}
