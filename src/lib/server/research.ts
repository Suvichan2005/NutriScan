import { z } from 'zod';
import type { ResearchItem } from '../contracts';
import { ApiError, fixedFetch, plain } from './http';
import { extractPdfText } from './pdf-text';

export const researchInput = z.object({ query: z.string().trim().min(3).max(250), topic: z.enum(['science', 'regulation', 'claims', 'brand', 'recalls']) }).strict();
type Entry = { id: string; title: string; url: string; publisher: string; terms: string[]; publishedAt: string | null; category: string; effectiveAt?: string | null; format?: 'html' | 'pdf' };
export const primaryRegistry: Entry[] = [
  { id: 'fssai-regulations-live', title: 'FSSAI food safety and standards regulations index', url: 'https://www.fssai.gov.in/cms/food-safety-and-standards-regulations.php', publisher: 'FSSAI', terms: ['regulation', 'label', 'claim', 'additive', 'india', 'fssai', 'ins'], publishedAt: null, category: 'regulation index' },
  { id: 'fssai-label-amendments-live', title: 'FSSAI labelling and display amendments', url: 'https://fssai.gov.in/food-law/regulations/amendments/labelling-display', publisher: 'FSSAI', terms: ['regulation', 'label', 'display', 'india', 'fssai'], publishedAt: null, category: 'amendment index' },
  { id: 'fssai-label-amendment-2026', title: 'FSSAI Labelling and Display First Amendment Regulations, 2026', url: 'https://www.fssai.gov.in/upload/notifications/2026/04/69cca2b3f3ce9Notification%20dt%2024.03.2026_NRC.pdf', publisher: 'Food Safety and Standards Authority of India', terms: ['infant', 'nutrition', 'rda', 'servings', 'non-retail', 'small package', '100 cm', 'logos', 'label', 'labelling', 'display', 'amendment', '2026'], publishedAt: '2026-03-24', effectiveAt: '2027-07-01', category: 'final Gazette notification; future commencement', format: 'pdf' },
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

function excerptHtml(html: string, query: string) {
  const text = html.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
  const words = query.toLowerCase().split(/\W+/).filter(x => x.length > 3);
  const position = words.map(w => text.toLowerCase().indexOf(w)).find(n => n > 0) ?? 0;
  return text.slice(Math.max(0, position - 80), Math.max(0, position - 80) + 800);
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

export async function research(data: z.infer<typeof researchInput>) {
  if (data.topic === 'science') {
    const url = new URL('https://www.ebi.ac.uk/europepmc/webservices/rest/search');
    // Treat user input as literal search terms, not Europe PMC query operators.
    const query = data.query.replace(/[^\p{L}\p{N}\s-]/gu, ' ').trim().split(/\s+/).slice(0, 24).map(t => `"${t}"`).join(' AND ');
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
  const candidates = primaryRegistry.map(entry => ({ entry, score: registryScore(entry, data.query) })).filter(candidate => candidate.score > 0).sort((a, b) => b.score - a.score).slice(0, 2);
  if (!candidates.length) return {
    status: 'unavailable' as const,
    items: [] as ResearchItem[],
    message: 'No source in NutriScan’s fixed primary-source registry matched the terms in this question. This is not evidence that no relevant rule or guidance exists; refine the query or inspect an authoritative source directly.',
  };
  const results = await Promise.all(candidates.map(async ({ entry }) => {
    try {
      const source = await fixedFetch(new URL(entry.url), entry.format ?? 'html', 1_200_000);
      const pdf = entry.format === 'pdf' ? await extractPdfText(source as Uint8Array) : null;
      const excerpt = pdf ? excerptPlain(pdf.text, data.query) : excerptHtml(source as string, data.query);
      if (excerpt.length < 100 || /access denied|captcha|request rejected/i.test(excerpt)) throw new Error('Unusable source page');
      const pdfDisclosure = pdf ? ` PDF text extracted from ${pdf.pagesRead} of ${pdf.totalPages} pages${pdf.truncated ? ' (bounded extract)' : ''}; scanned-image content is not OCRed.` : '';
      const limitations = entry.publisher.includes('Food Safety and Standards Authority') || entry.publisher === 'FSSAI'
        ? 'This primary-source extract does not establish a consolidated rule, later amendment/order, product category, authorization or package compliance. Verify all applicable Gazette text and effective dates for the relevant product and market.'
        : 'General population guidance, not an additive toxicology limit, individual prescription or legal rule. The excerpt does not independently resolve this package claim.';
      return { ok: true as const, entry, item: { id: entry.id, title: entry.title, url: entry.url, publisher: entry.publisher, publishedAt: entry.publishedAt, ...(entry.effectiveAt ? { effectiveAt: entry.effectiveAt } : {}), retrievedAt: new Date().toISOString(), category: entry.category, summary: `${pdf ? 'Official Gazette PDF text excerpt' : 'Live page excerpt'} (truncated; not interpreted): ${excerpt}${pdfDisclosure}`, limitations } satisfies ResearchItem };
    } catch {
      return { ok: false as const, entry };
    }
  }));
  const retrievedAt = new Date().toISOString();
  const succeeded = results.filter(result => result.ok).length;
  const items = results.map(result => result.ok ? result.item : (() => {
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
      summary: 'NutriScan could not retrieve usable source text. Open this official source directly to inspect its contents; no excerpt or interpretation is available from this request.',
      limitations: 'This link card is source navigation only, not retrieved legal evidence. Verify the exact instrument, publication and effective dates, later amendments or orders, product category and jurisdiction before drawing conclusions.',
    } satisfies ResearchItem;
  })());
  return {
    status: succeeded ? 'ok' : 'unavailable',
    items,
    message: succeeded
      ? `Retrieved ${succeeded} primary-source page(s). Current legal status and package compliance remain unverified.${succeeded < results.length ? ' Other official links remain available for direct review, but no text was retrieved from them.' : ''}`
      : 'Primary sources did not return usable text within the request limits. Official source links are shown for direct review, but no source text or current-law verdict is available.',
  };
}

function excerptPlain(text: string, query: string) {
  const words = [...new Set(query.toLowerCase().split(/\W+/).filter(x => x.length > 3))];
  const candidates = words.flatMap(word => {
    const positions: number[] = [];
    let position = text.toLowerCase().indexOf(word);
    while (position >= 0) { positions.push(position); position = text.toLowerCase().indexOf(word, position + word.length); }
    return positions.map(position => Math.max(0, position - 160));
  });
  const start = candidates.sort((a, b) => {
    const score = (offset: number) => { const window = text.slice(offset, offset + 1200).toLowerCase(); return words.filter(word => window.includes(word)).length; };
    return score(b) - score(a);
  })[0] ?? 0;
  return text.slice(start, start + 1200).trim();
}
