import type { EvidenceSource } from './contracts';

type EvidencePreviewInput = Pick<EvidenceSource, 'category' | 'summary'>;

/** Keep provider grounding metadata visibly distinct from text reviewed from a source page. */
export function evidenceSourcePreview(source: EvidencePreviewInput): { label: string; text: string } {
  if (source.category === 'web-search') {
    return {
      label: 'GOOGLE SEARCH LINK · PAGE CONTENT NOT REVIEWED',
      text: 'Google linked this page to a generated response segment. NutriScan has not fetched or checked the page text.',
    };
  }
  return { label: 'NUTRISCAN SUMMARY · CHECK ORIGINAL SOURCE', text: source.summary };
}
