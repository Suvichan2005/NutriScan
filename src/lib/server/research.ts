import { z } from 'zod';
import type { ResearchItem } from '../contracts';
import { ApiError, fixedFetch, plain } from './http';
import { extractPdfText, type PdfText } from './pdf-text';

export const researchInput = z.object({ query: z.string().trim().min(3).max(250), topic: z.enum(['science', 'regulation', 'claims', 'brand', 'recalls']) }).strict();
type Entry = { id: string; title: string; url: string; publisher: string; terms: string[]; publishedAt: string | null; category: string; supportRole?: 'content' | 'navigation'; effectiveAt?: string | null; format?: 'html' | 'pdf'; allowOcr?: boolean; maxBytes?: number; maxPages?: number; maxCharacters?: number; maxExcerpt?: number };
export type ResearchPdfExtractor = (bytes: Uint8Array, options: {sourceId:string;allowOcr:boolean;pages:number;characters:number}) => Promise<PdfText>;
export const primaryRegistry: Entry[] = [
  { id: 'fssai-additive-compendium-appendix-a', title: 'FSSAI Food Products Standards and Food Additives Compendium, Appendix A', url: 'https://www.fssai.gov.in/docs/food-law/regulations/compendium/food-products-standards/Appendix%20A(4).pdf', publisher: 'Food Safety and Standards Authority of India', terms: ['additive', 'additives', 'food additive', 'food additives', 'appendix', 'appendix a', 'compendium', 'ins', '415', 'xanthan', 'xanthan gum'], publishedAt: null, category: 'food standards and additives compendium; navigation aid only', supportRole: 'navigation', format: 'pdf', maxBytes: 6_000_000, maxPages: 380, maxCharacters: 900_000, maxExcerpt: 900 },
  { id: 'fssai-food-additive-amendments-index', title: 'FSSAI Food Products Standards and Food Additives amendments index', url: 'https://fssai.gov.in/food-law/regulations/amendments/food-products-standards', publisher: 'Food Safety and Standards Authority of India', terms: ['additive', 'additives', 'food additive', 'food additives', 'appendix', 'appendix a', 'ins', '415', 'xanthan', 'xanthan gum'], publishedAt: null, category: 'amendment index; source discovery only', supportRole: 'navigation' },
  { id: 'fssai-advertising-claims-live-2022', title: 'FSSAI Advertising and Claims Regulations, Version IV Compendium', url: 'https://fssai.gov.in/upload/uploadfiles/files/Compendium_Advertising_Claims_Regulations_14_12_2022.pdf', publisher: 'Food Safety and Standards Authority of India', terms: ['advertising', 'claim', 'claims', 'health claim', 'oat', 'oats', 'beta glucan', 'soluble dietary fibre', 'cholesterol'], publishedAt: '2022-12-14', category: 'dated FSSAI Advertising and Claims compendium; not current-law determination', format: 'pdf', maxBytes: 6_000_000, maxPages: 20, maxCharacters: 180_000, maxExcerpt: 2_200 },
  { id: 'fssai-regulations-live', title: 'FSSAI food safety and standards regulations index', url: 'https://www.fssai.gov.in/cms/food-safety-and-standards-regulations.php', publisher: 'FSSAI', terms: ['regulation', 'label', 'claim', 'additive', 'india', 'fssai', 'ins'], publishedAt: null, category: 'regulation index', supportRole: 'navigation' },
  { id: 'fssai-label-amendments-live', title: 'FSSAI labelling and display amendments', url: 'https://fssai.gov.in/food-law/regulations/amendments/labelling-display', publisher: 'FSSAI', terms: ['regulation', 'label', 'display', 'india', 'fssai'], publishedAt: null, category: 'amendment index', supportRole: 'navigation' },
  { id: 'fssai-label-amendment-2026', title: 'FSSAI Labelling and Display First Amendment Regulations, 2026', url: 'https://www.fssai.gov.in/upload/notifications/2026/04/69cca2b3f3ce9Notification%20dt%2024.03.2026_NRC.pdf', publisher: 'Food Safety and Standards Authority of India', terms: ['infant', 'nutrition', 'rda', 'servings', 'non-retail', 'small package', '100 cm', 'logos', 'label', 'labelling', 'display', 'amendment', '2026'], publishedAt: '2026-03-24', effectiveAt: '2027-07-01', category: 'final Gazette notification; future commencement', format: 'pdf' },
  { id: 'fssai-ors-2022-direction', title: 'FSSAI direction on ORS-substitute advertising and marketing', url: 'https://www.fssai.gov.in/upload/advisories/2022/04/6253ddfde2161Direction_advertisement_ORS_11_04_2022.pdf', publisher: 'Food Safety and Standards Authority of India', terms: ['ors', 'oral rehydration', 'substitute', 'beverage', 'drug', 'direction', 'brand', 'india'], publishedAt: '2022-04-08', category: 'historical Section 16(5) direction; referenced as remaining in effect in 2025', format: 'pdf' },
  { id: 'fssai-ors-2024-order', title: 'FSSAI order on ORS use with brand names (historical; later withdrawn)', url: 'https://www.fssai.gov.in/upload/advisories/2024/02/65c0d35e786e4Order%20dated%2002nd%20Feb%202024_Use%20of%20term%20ORS.pdf', publisher: 'Food Safety and Standards Authority of India', terms: ['ors', 'oral rehydration', 'trademark', 'brand', 'permission', 'legal', 'india', '2024'], publishedAt: '2024-02-02', category: 'superseded historical order; prior permissions withdrawn 14 October 2025', format: 'pdf' },
  { id: 'fssai-ors-2025-withdrawal', title: 'FSSAI withdrawal of prior ORS brand-name permissions', url: 'https://www.fssai.gov.in/upload/advisories/2025/10/68ee3ba06bb7eWithdrawal%20of%20Orders%20regarding%20Usage%20of%20the%20term%20ORS%20along%20with%20brand%20names%20dt%2014.10.2025.pdf', publisher: 'Food Safety and Standards Authority of India', terms: ['ors', 'oral rehydration', 'withdrawal', 'brand', 'orders', 'legal', 'india', '2025'], publishedAt: '2025-10-14', category: 'regulatory withdrawal of prior permissions', format: 'pdf', allowOcr: true },
  { id: 'fssai-ors-2025-clarification', title: 'FSSAI clarification on ORS in food-product names', url: 'https://fssai.gov.in/upload/advisories/2025/10/68ef8cea74223clarification_151025.pdf', publisher: 'Food Safety and Standards Authority of India', terms: ['ors', 'oral rehydration', 'clarification', 'brand', 'names', 'legal', 'india', '2025', 'remove'], publishedAt: '2025-10-15', category: 'regulatory clarification and removal direction', format: 'pdf', allowOcr: true },
  { id: 'delhi-hc-ors-2025-dr-reddys', title: 'Delhi High Court: Dr Reddy’s Laboratories v Union of India, W.P.(C) 16303/2025', url: 'https://delhihighcourt.nic.in/app/showFileJudgment/58731102025CW163032025_193432.pdf', publisher: 'High Court of Delhi', terms: ['ors', 'oral rehydration', 'legal', 'india', 'court', 'judgment', 'fssai', 'brand', 'dismissed', '2025'], publishedAt: '2025-10-31', category: 'High Court judgment; case-specific disposition', format: 'pdf' },
  { id: 'who-sugars-live', title: 'WHO guideline: sugars intake for adults and children', url: 'https://www.who.int/publications/i/item/9789241549028', publisher: 'World Health Organization', terms: ['sugar', 'sugars', 'sweet', 'carbohydrate'], publishedAt: '2015-03-04', category: 'population guideline' },
  { id: 'who-sweeteners-live', title: 'WHO guideline: use of non-sugar sweeteners', url: 'https://www.who.int/publications/i/item/9789240073616', publisher: 'World Health Organization', terms: ['sweetener', 'sweeteners', 'aspartame', 'sucralose', 'weight'], publishedAt: '2023-05-15', category: 'population guideline' },
];

function registryScore(entry: Entry, query: string) {
  const queryTokens = query.toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? [];
  const searchable = ` ${queryTokens.join(' ')} `;
  return entry.terms.filter(term => {
    const normalized = term.toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+/gu)?.join(' ');
    return normalized && searchable.includes(` ${normalized} `);
  }).length;
}

function sourceLimitations(entry: Entry) {
  if (entry.id === 'fssai-additive-compendium-appendix-a') return 'Navigation aid only, not a legal document, current-law determination, additive authorization or package-compliance finding. Flattened PDF text may lose table row, column and food-category relationships; do not assign a numeric limit to a nearby category by proximity alone without checking the original page layout. FSSAI states the compendium includes notified amendments but the original notifications prevail. Verify the exact food category and conditions of use, and review applicable Gazette notifications and amendments before drawing any conclusion.';
  if (entry.id === 'fssai-advertising-claims-live-2022') return 'Dated Version IV compendium published 14 December 2022; this extract is not a consolidated current-law determination or product-compliance finding. Flattened schedule text may lose table relationships. Check the exact row, underlying Gazette notifications, later directions/amendments, product facts and current applicability before drawing a conclusion.';
  if (entry.id === 'fssai-food-additive-amendments-index') return 'Amendment discovery index only, not a consolidated rule, current additive authorization or package-compliance finding. Open and verify the relevant Gazette notification, commencement date, exact food category and later amendments before drawing any conclusion.';
  const orsCaseLimit = entry.id === 'delhi-hc-ors-2025-dr-reddys'
    ? ' This is a case-specific judgment dated 31 October 2025: the Delhi High Court dismissed this petitioner’s challenge to the FSSAI measures and directed FSSAI to consider a representation about existing stock. It does not decide every product, party, proceeding or later order.'
    : entry.id === 'fssai-ors-2022-direction'
      ? ' FSSAI’s 15 October 2025 clarification states that this 8 April 2022 Section 16(5) direction remains in effect; the 2022/2024 brand-name permissions were separately withdrawn. Later case-specific orders and current product applicability still require review.'
        : entry.id === 'fssai-ors-2024-order'
          ? ' This is historical context only: FSSAI’s 14 October 2025 withdrawal postdates this order and withdrew the prior ORS brand-name permissions. Do not apply the 2024 order as current permission.'
      : entry.id.startsWith('fssai-ors-2025-')
        ? ' This is a dated agency instrument, not a product-specific adjudication. Check subsequent court orders, exact product category and current applicability.'
        : '';
  const primary = entry.publisher.includes('Food Safety and Standards Authority') || entry.publisher === 'FSSAI' || entry.publisher === 'High Court of Delhi';
  const ocrLimit = entry.allowOcr ? ' If a machine-OCR excerpt is shown, it is unverified and may contain recognition errors; compare it with the linked original before relying on any wording.' : '';
  return primary
    ? `This primary-source extract does not establish a consolidated rule, later amendment/order, product category, authorization or package compliance. Verify all applicable Gazette text and effective dates for the relevant product and market.${orsCaseLimit}${ocrLimit}`
    : 'General population guidance, not an additive toxicology limit, individual prescription or legal rule. The excerpt does not independently resolve this package claim.';
}

function excerptHtml(html: string, query: string) {
  const text = html.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
  const words = query.toLowerCase().split(/\W+/).filter(x => x.length > 3);
  const position = words.map(w => text.toLowerCase().indexOf(w)).find(n => n > 0) ?? 0;
  return text.slice(Math.max(0, position - 80), Math.max(0, position - 80) + 800);
}

const europePmcStopWords = new Set(['a', 'an', 'and', 'are', 'about', 'as', 'at', 'be', 'been', 'being', 'but', 'by', 'can', 'could', 'did', 'do', 'does', 'for', 'from', 'how', 'in', 'into', 'is', 'it', 'of', 'on', 'or', 'the', 'to', 'was', 'were', 'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with', 'would', 'ins', 'e', 'no', 'number']);

function europePmcScienceQuery(input: string) {
  // Scope free-text topic terms to metadata that describes the paper, rather
  // than incidental mentions anywhere in Europe PMC's indexed full text.
  // Token-only clauses keep user-supplied query operators inert.
  const terms = (input.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter(term => /\p{L}/u.test(term) && term.length >= 3 && !europePmcStopWords.has(term))
    .slice(0, 24);
  if (!terms.length) throw new ApiError(400, 'invalid_input', 'Include a food, ingredient, nutrient, outcome, or other specific science topic.');
  return terms.map(term => `TITLE_ABS:"${term}"`).join(' AND ');
}

const enforcementSchema = z.object({ recall_number: z.string().regex(/^[A-Za-z0-9-]{1,40}$/), product_description: z.string(), recalling_firm: z.string(), reason_for_recall: z.string().optional(), classification: z.string().optional(), status: z.string().optional(), distribution_pattern: z.string().optional(), report_date: z.string().optional(), recall_initiation_date: z.string().optional(), code_info: z.string().optional() }).passthrough();
function fdaDate(value?: string) {
  if (!value || !/^\d{8}$/.test(value)) return null;
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso ? null : iso;
}
export async function researchRecalls(query: string) {
  const terms = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(t => t && !['and', 'or', 'not', 'to'].includes(t)).slice(0, 12);
  if (!terms.length) throw new ApiError(400, 'invalid_input', 'Enter a product or firm name for the United States enforcement search.');
  const literal = terms.join(' ');
  const url = new URL('https://api.fda.gov/food/enforcement.json');
  url.searchParams.set('search', `recalling_firm:"${literal}" OR product_description:"${literal}"`);
  url.searchParams.set('limit', '4'); url.searchParams.set('sort', 'report_date:desc');
  const raw = await fixedFetch(url) as { results?: unknown[]; meta?: { last_updated?: string } };
  const items: ResearchItem[] = [];
  for (const candidate of raw.results ?? []) {
    const parsed = enforcementSchema.safeParse(candidate); if (!parsed.success) continue; const r = parsed.data;
    const link = new URL('https://api.fda.gov/food/enforcement.json'); link.searchParams.set('search', `recall_number.exact:"${r.recall_number}"`); link.searchParams.set('limit', '1');
    items.push({ id: `fda-${r.recall_number}`, title: `US FDA ${r.recall_number}: ${plain(r.product_description, 250)}`, url: link.toString(), publisher: 'United States Food and Drug Administration / openFDA', publishedAt: fdaDate(r.report_date), retrievedAt: new Date().toISOString(), category: 'United States food enforcement report; candidate match', summary: `Recalling firm: ${plain(r.recalling_firm, 200)}. Recorded reason: ${plain(r.reason_for_recall, 900) || 'not provided'}. Recorded classification: ${plain(r.classification, 80) || 'not provided'}. Recorded status: ${plain(r.status, 80) || 'not provided'} (not a live recall-state assessment). Initiation date: ${fdaDate(r.recall_initiation_date) ?? 'not provided'}. Distribution: ${plain(r.distribution_pattern, 400) || 'not provided'}. Lot/code details: ${plain(r.code_info, 600) || 'not provided'}.`, limitations: `US-jurisdiction historical candidate report, not an Indian recall or a universal brand verdict. Match exact product, country, date and lot before drawing conclusions. FDA says this dataset is not a public-alert or recall-lifecycle service; recorded status may not be updated. Absence of results does not demonstrate safety. Dataset last updated: ${plain(raw.meta?.last_updated, 40) || 'not provided'}.` });
  }
  return { status: items.length ? 'ok' : 'empty', items, message: items.length ? 'Historical US FDA food-enforcement candidates only. Match the precise product, firm, market and lot. This cannot determine brand-wide safety, current recall status or Indian regulatory compliance.' : 'No matching reports were returned by this bounded US FDA search. This does not prove absence of recalls, product safety, brand credibility or Indian compliance.' };
}

export async function research(data: z.infer<typeof researchInput>, pdfExtractor: ResearchPdfExtractor = (bytes, options) => extractPdfText(
  bytes,
  { pages: options.pages, characters: options.characters },
  { ocr: options.allowOcr, maxOcrPages: options.allowOcr ? 2 : 0 },
)) {
  if (data.topic === 'science') {
    const url = new URL('https://www.ebi.ac.uk/europepmc/webservices/rest/search');
    const query = europePmcScienceQuery(data.query);
    url.searchParams.set('query', query); url.searchParams.set('format', 'json'); url.searchParams.set('pageSize', '6'); url.searchParams.set('resultType', 'core');
    const raw = await fixedFetch(url) as { resultList?: { result?: unknown[] } };
    const paper = z.object({ id: z.string(), source: z.string(), title: z.string(), firstPublicationDate: z.string().optional(), pubYear: z.string().optional(), abstractText: z.string().optional(), doi: z.string().optional(), journalInfo: z.object({ journal: z.object({ title: z.string().optional() }).optional() }).optional(), pubTypeList: z.object({ pubType: z.array(z.string()).optional() }).optional() }).passthrough();
    const items: ResearchItem[] = [];
    for (const candidate of raw.resultList?.result ?? []) {
      const p = paper.safeParse(candidate); if (!p.success) continue; const v = p.data;
      if (!/^[A-Za-z0-9]+$/.test(v.source) || !/^[A-Za-z0-9._-]+$/.test(v.id)) continue;
      items.push({ id: `epmc-${v.source}-${v.id}`, title: plain(v.title, 500), url: `https://europepmc.org/article/${encodeURIComponent(v.source)}/${encodeURIComponent(v.id)}`, publisher: plain(v.journalInfo?.journal?.title || 'Europe PMC indexed publication', 200), publishedAt: v.firstPublicationDate || v.pubYear || null, retrievedAt: new Date().toISOString(), category: plain(v.pubTypeList?.pubType?.join(', ') || 'literature result', 200), summary: plain(v.abstractText, 1800) || 'No abstract was returned. Read the publication before drawing conclusions.', limitations: 'Search match only; study quality, dose, population, conflicts, retraction status and applicability have not been assessed. May include preprints, animal or laboratory studies. Publication date is not proof of current consensus. Abstract text can be truncated.', ...(v.doi && /^10\.\d{4,9}\/[\S]+$/.test(v.doi) ? { doi: v.doi.slice(0, 300) } : {}) });
    }
    return { status: items.length ? 'ok' : 'empty', items, message: 'Live Europe PMC discovery, ordered by search relevance. These are candidate publications, not an evidence synthesis or personalized advice.' };
  }
  if (data.topic === 'brand' || data.topic === 'recalls') return researchRecalls(data.query);
  const sourceLimit = /\b(?:ors|oral rehydration)\b/i.test(data.query) ? 5 : 2;
  const candidates = primaryRegistry.map(entry => ({ entry, score: registryScore(entry, data.query) })).filter(candidate => candidate.score > 0).sort((a, b) => b.score - a.score).slice(0, sourceLimit);
  if (!candidates.length) return {
    status: 'unavailable' as const,
    items: [] as ResearchItem[],
    message: 'No source in NutriScan’s fixed primary-source registry matched the terms in this question. This is not evidence that no relevant rule or guidance exists; refine the query or inspect an authoritative source directly.',
  };
  const results = await Promise.all(candidates.map(async ({ entry }) => {
    let failureReason = 'source request failed';
    let stage: 'fetch' | 'pdf-extraction' | 'pdf-ocr' | 'excerpt' = 'fetch';
    try {
      const source = await fixedFetch(new URL(entry.url), entry.format ?? 'html', entry.maxBytes ?? 2_000_000);
      stage = entry.format === 'pdf' ? entry.allowOcr ? 'pdf-ocr' : 'pdf-extraction' : 'excerpt';
      const pdf = entry.format === 'pdf' ? await pdfExtractor(source as Uint8Array, { sourceId: entry.id, allowOcr: !!entry.allowOcr, pages: entry.maxPages ?? 40, characters: entry.maxCharacters ?? 50_000 }) : null;
      stage = 'excerpt';
      if (pdf && !pdf.text.trim()) {
        failureReason = 'the PDF has no extractable text, including any permitted local OCR';
        throw new Error('No selectable PDF text');
      }
      const excerpt = pdf ? excerptPlain(pdf.text, data.query, entry.maxExcerpt) : excerptHtml(source as string, data.query);
      if (excerpt === null) {
        return { ok: false as const, entry, failureReason: 'the exact INS identifier requested was not present in the retrieved text' };
      }
      if (excerpt.length < 100 || /access denied|captcha|request rejected/i.test(excerpt)) {
        failureReason = 'the source text was too short or blocked for a reliable excerpt';
        throw new Error('Unusable source page');
      }
      const pdfDisclosure = pdf ? pdf.ocrPages
        ? ` Machine OCR was used on ${pdf.ocrPages} page${pdf.ocrPages === 1 ? '' : 's'}; the text is unverified and may contain recognition errors.`
        : ` Selectable PDF text extracted from ${pdf.pagesRead} of ${pdf.totalPages} pages${pdf.truncated ? ' (bounded extract)' : ''}; image-only page content was not OCRed.` : '';
      const sourceKind = pdf
        ? pdf.ocrPages ? 'Official PDF OCR excerpt (machine-extracted; unverified; not interpreted)' : entry.category.includes('Gazette') ? 'Official Gazette PDF text excerpt' : 'Official PDF text excerpt'
        : 'Live page excerpt';
      const category = entry.allowOcr && pdf?.ocrPages ? `${entry.category}; machine OCR excerpt` : entry.category;
      const sourceCaveat = entry.id === 'fssai-additive-compendium-appendix-a' ? ' This excerpt is a navigation aid only; flattened text may not preserve table row, column or category relationships, and the original legal notifications prevail.' : '';
      const supportRole = entry.supportRole ?? 'content';
      return { ok: true as const, entry, item: { id: entry.id, title: entry.title, url: entry.url, publisher: entry.publisher, publishedAt: entry.publishedAt, ...(entry.effectiveAt ? { effectiveAt: entry.effectiveAt } : {}), retrievedAt: new Date().toISOString(), category, summary: `${sourceKind} (truncated; not interpreted): ${excerpt}${pdfDisclosure}${sourceCaveat}`, limitations: sourceLimitations(entry), supportRole } satisfies ResearchItem };
    } catch (error) {
      if (error instanceof ApiError) {
        failureReason = error.code === 'upstream_too_large' ? 'the source response exceeded its configured retrieval limit'
          : error.code === 'unexpected_content' ? 'the source returned a different content type than expected'
            : error.code === 'upstream_failure' ? 'the source returned an unsuccessful HTTP response'
              : 'the source could not be reached within the request limits';
      } else if (stage === 'pdf-extraction') {
        failureReason = 'the downloaded PDF could not be parsed';
      } else if (stage === 'pdf-ocr') {
        failureReason = 'the bounded local OCR process could not extract usable text';
      } else if (stage === 'excerpt') {
        failureReason = 'the source text could not produce a sufficiently clear excerpt';
      }
      return { ok: false as const, entry, failureReason };
    }
  }));
  const retrievedAt = new Date().toISOString();
  const succeeded = results.filter(result => result.ok).length;
  const items: ResearchItem[] = results.map(result => result.ok ? result.item : (() => {
    const { entry } = result;
    return {
      id: entry.id,
      title: entry.title,
      url: entry.url,
      publisher: entry.publisher,
      publishedAt: entry.publishedAt,
      ...(entry.effectiveAt ? { effectiveAt: entry.effectiveAt } : {}),
      retrievedAt,
      category: `${entry.category}; direct source link`,
      summary: `NutriScan could not retrieve usable source text: ${result.failureReason}. Open this official source directly; no excerpt or interpretation is available from this request.`,
      limitations: `This link card is source navigation only, not retrieved source text. ${sourceLimitations(entry)}`,
      supportRole: 'navigation',
    } satisfies ResearchItem;
  })());
  const failedFssaiLookup = succeeded === 0 && results.some(result => result.entry.publisher === 'FSSAI' || result.entry.publisher.includes('Food Safety and Standards Authority'));
  if (failedFssaiLookup) items.push({
    id: 'egazette-search-navigation',
    title: 'Government of India eGazette search',
    url: 'https://egazette.gov.in/',
    publisher: 'Government of India, Department of Publication',
    publishedAt: null,
    retrievedAt,
    category: 'official Gazette search; navigation only',
    summary: 'Use the official eGazette search to locate the relevant notification by Gazette ID or date. No document text was fetched or excerpted by this request.',
    limitations: 'Navigation only, not legal evidence. Confirm the Gazette number, part and section, exact document, commencement date and later amendments or orders before applying any rule to a product.',
    supportRole: 'navigation',
  });
  return {
    status: succeeded ? 'ok' : 'unavailable',
    items,
    message: succeeded
      ? `Retrieved ${succeeded} primary-source page(s). Current legal status and package compliance remain unverified.${succeeded < results.length ? ' Other official links remain available for direct review, but no text was retrieved from them.' : ''}`
      : 'Primary sources did not return usable text within the request limits. Official source links are shown for direct review, but no source text or current-law verdict is available.',
  };
}

function excerptPlain(text: string, query: string, max = 1200): string | null {
  const stopWords = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'does', 'for', 'from', 'how', 'in', 'is', 'it', 'of', 'on', 'or', 'the', 'to', 'was', 'what', 'when', 'where', 'which', 'who', 'why', 'with']);
  const words = [...new Set(query.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])]
    .filter(word => word.length >= 3 && !stopWords.has(word));
  const requestedIns = query.normalize('NFKC').match(/\bINS\s*(?:No\.?\s*)?(\d{3,4}[A-Z]?)\b/i)?.[1];
  const requestedInsPattern = requestedIns ? new RegExp(`\\b${requestedIns}\\b`, 'i') : null;
  const normalizedText = text.toLowerCase();
  if (requestedInsPattern) {
    const codePosition = normalizedText.search(requestedInsPattern);
    if (codePosition < 0) return null;
    const start = Math.max(0, codePosition - Math.floor(max * 0.3));
    return text.slice(start, start + max).trim();
  }
  if (!words.length) return text.slice(0, max).trim();
  const weights = new Map(words.map(word => {
    let count = 0;
    let position = normalizedText.indexOf(word);
    while (position >= 0) { count++; position = normalizedText.indexOf(word, position + word.length); }
    const numericIdentifier = /^\d{3,}$/.test(word);
    return [word, (numericIdentifier ? 3 : 1) + Math.log((normalizedText.length + 1) / (count + 1))] as const;
  }));
  const phrases = words.slice(0, -1).flatMap((word, index) => {
    const next = words[index + 1];
    return word.length >= 3 && next.length >= 3 ? [`${word} ${next}`] : [];
  });
  const candidates = words.flatMap(word => {
    const positions: number[] = [];
    let position = normalizedText.indexOf(word);
    while (position >= 0) { positions.push(position); position = normalizedText.indexOf(word, position + word.length); }
    return positions.map(position => Math.max(0, position - 160));
  });
  const start = candidates.sort((a, b) => {
    const score = (offset: number) => {
      const window = normalizedText.slice(offset, offset + max);
      const termScore = words.reduce((total, word) => total + (window.includes(word) ? weights.get(word)! : 0), 0);
      const phraseScore = phrases.reduce((total, phrase) => total + (window.includes(phrase) ? 4 : 0), 0);
      return termScore + phraseScore;
    };
    return score(b) - score(a);
  })[0] ?? 0;
  return text.slice(start, start + max).trim();
}
