import { sourceSchema, type EvidenceSource, type PackageData, type ResearchItem } from './contracts';

type LocalSearchEvidence = EvidenceSource & { score: number };
type AssistEvidenceInputs = {
  auditSources: EvidenceSource[];
  localSearch: LocalSearchEvidence[];
  research: ResearchItem[];
};

const maxAssistSources = 15;
const maxSummaryCharacters = 1600;
const additionalPhotoMarker = /^--- Additional photo evidence ---$/;

/**
 * Avoid sending OCR-only label text twice. The raw OCR observations are the
 * richer record (line order, image/run link, boxes and recognition metadata),
 * so clear the duplicate text only when every non-empty line is represented
 * by those observations in the same order. Mixed or ambiguous text is kept.
 */
export function packageForAssist(pkg: PackageData): PackageData {
  const rawOcrLines = pkg.observations.filter(observation => observation.origin === 'ocr' && observation.field === 'ocr-line');
  if (!rawOcrLines.length) return pkg;

  const sourceLines = pkg.rawText.replace(/\r/g, '').split('\n')
    .map(line => line.trim())
    .filter(line => line && !additionalPhotoMarker.test(line));
  if (sourceLines.length !== rawOcrLines.length || sourceLines.some((line, index) => line !== rawOcrLines[index].text)) return pkg;
  return { ...pkg, rawText: '' };
}

function researchCategory(category: string): EvidenceSource['category'] {
  const value = category.toLowerCase();
  if (/guideline|guidance|public health/.test(value)) return 'guideline';
  if (/recall|enforcement|registry|register|candidate match/.test(value)) return 'registry';
  if (/regulation|gazette|amendment|food standard|court|judgment|direction|withdrawal|legal/.test(value)) return 'regulation';
  if (/literature|publication|study|trial|journal|review|cohort|preprint/.test(value)) return 'literature';
  if (/product|catalog|market/.test(value)) return 'product';
  return 'method';
}

function boundedSummary(summary: string): string {
  const value = summary.trim();
  return value.length <= maxSummaryCharacters ? value : `${value.slice(0, maxSummaryCharacters - 1).trimEnd()}…`;
}

/** Build the bounded, cited evidence context shown in the user's investigation. */
export function assistEvidenceContext({ auditSources, localSearch, research }: AssistEvidenceInputs): EvidenceSource[] {
  const result: EvidenceSource[] = [];
  const seen = new Set<string>();
  const add = (source: EvidenceSource) => {
    if (seen.has(source.id) || result.length >= maxAssistSources) return;
    try {
      const url = new URL(source.url);
      if (url.protocol !== 'https:' || url.username || url.password || /^(localhost|127\.|\[::)/.test(url.hostname)) return;
    } catch { return; }
    const parsed = sourceSchema.safeParse({ ...source, summary: boundedSummary(source.summary), limitations: source.limitations.slice(0, 500) });
    if (!parsed.success) return;
    seen.add(parsed.data.id);
    result.push(parsed.data);
  };

  for (const source of auditSources.slice(0, 6)) add(source);
  for (const { score: _score, ...source } of localSearch.slice(0, 3)) add(source);
  for (const item of research.slice(0, 6)) {
    const categoryContext = item.category.trim() ? `Search classification: ${item.category.trim()}\n` : '';
    add({
      id: item.id,
      title: item.title,
      publisher: item.publisher,
      url: item.url,
      category: researchCategory(item.category),
      jurisdiction: 'Not specified by the search result',
      publishedAt: item.publishedAt,
      effectiveAt: item.effectiveAt ?? null,
      retrievedAt: item.retrievedAt,
      summary: `${categoryContext}${item.summary}`,
      limitations: item.limitations
    });
  }
  return result;
}
