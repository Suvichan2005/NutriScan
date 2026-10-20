import { z } from 'zod';
import type { ResearchItem } from '../contracts';
import { ApiError, fixedFetch, plain } from './http';

export const researchInput = z.object({ query: z.string().trim().min(3).max(250), topic: z.enum(['science', 'regulation', 'claims', 'brand', 'alternatives', 'recalls']) }).strict();
type Entry = { id: string; title: string; url: string; publisher: string; terms: string[]; publishedAt: string | null; category: string };
export const primaryRegistry: Entry[] = [
  { id: 'fssai-regulations-live', title: 'FSSAI food safety and standards regulations index', url: 'https://www.fssai.gov.in/cms/food-safety-and-standards-regulations.php', publisher: 'FSSAI', terms: ['regulation', 'label', 'claim', 'additive', 'india', 'fssai', 'ins'], publishedAt: null, category: 'regulation index' },
  { id: 'fssai-label-amendments-live', title: 'FSSAI labelling and display amendments', url: 'https://fssai.gov.in/food-law/regulations/amendments/labelling-display', publisher: 'FSSAI', terms: ['regulation', 'label', 'display', 'india', 'fssai'], publishedAt: null, category: 'amendment index' },
  { id: 'who-sugars-live', title: 'WHO guideline: sugars intake for adults and children', url: 'https://www.who.int/publications/i/item/9789241549028', publisher: 'World Health Organization', terms: ['sugar', 'sugars', 'sweet', 'carbohydrate'], publishedAt: '2015-03-04', category: 'population guideline' },
  { id: 'who-sweeteners-live', title: 'WHO guideline: use of non-sugar sweeteners', url: 'https://www.who.int/publications/i/item/9789240073616', publisher: 'World Health Organization', terms: ['sweetener', 'sweeteners', 'aspartame', 'sucralose', 'weight'], publishedAt: '2023-05-15', category: 'population guideline' },
];

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
  if (data.topic === 'alternatives') return { status: 'unavailable', items: [], message: 'Use product search for candidates tagged as sold in India. Local stock cannot be verified.' };
  const words = data.query.toLowerCase();
  const candidates = primaryRegistry.map(entry => ({ entry, score: entry.terms.filter(t => words.includes(t)).length + (entry.publisher === 'FSSAI' ? 1 : 0) })).sort((a, b) => b.score - a.score).slice(0, 2);
  const results = await Promise.allSettled(candidates.map(async ({ entry }): Promise<ResearchItem> => {
    const html = await fixedFetch(new URL(entry.url), 'html', 1_200_000) as string;
    const excerpt = excerptHtml(html, data.query);
    if (excerpt.length < 100 || /access denied|captcha|request rejected/i.test(excerpt)) throw new Error('Unusable source page');
    return { id: entry.id, title: entry.title, url: entry.url, publisher: entry.publisher, publishedAt: entry.publishedAt, retrievedAt: new Date().toISOString(), category: entry.category, summary: `Live page excerpt (truncated; not interpreted): ${excerpt}`, limitations: entry.publisher === 'FSSAI' ? 'Discovery index only. The page and amendment links do not establish the consolidated rule, effective date, product category, authorization or compliance. Open the underlying Gazette and verify all applicable amendments; NutriScan cannot establish current law from this retrieval.' : 'General population guidance. It is not an additive toxicology limit, individual prescription or legal rule. The page excerpt does not independently resolve this package claim.' };
  }));
  const items = results.flatMap(r => r.status === 'fulfilled' ? [r.value] : []);
  return { status: items.length ? 'ok' : 'unavailable', items, message: items.length ? `Retrieved ${items.length} primary-source discovery page(s). Current legal status and package compliance remain unverified.${results.some(r => r.status === 'rejected') ? ' Another source did not return usable text; open its official index directly.' : ''}` : 'Primary sources did not return usable text within the request limits. The FSSAI site may require its interactive browser page. Open the official FSSAI regulations index or WHO publication site directly. No current-law verdict is available.' };
}
