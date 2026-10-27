import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fixedFetchMock } = vi.hoisted(() => ({ fixedFetchMock: vi.fn() }));
vi.mock('./http', () => ({
  ApiError: class ApiError extends Error {},
  fixedFetch: fixedFetchMock,
  plain: (value: unknown, max = 1000) => typeof value === 'string' ? value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '',
}));

import { research } from './research';

function textPdf(text: string) {
  const chunks = text.match(/.{1,80}/g) ?? [];
  const stream = `BT /F1 12 Tf 72 720 Td ${chunks.map((chunk, index) => `${index ? '0 -16 Td ' : ''}(${chunk}) Tj`).join(' ')} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.7\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf, 'binary')); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xrefOffset = Buffer.byteLength(pdf, 'binary');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

describe('official regulation PDF discovery', () => {
  beforeEach(() => fixedFetchMock.mockReset());

  it('returns official notice text and separates publication from future commencement', async () => {
    fixedFetchMock.mockImplementation(async (url: URL, format: string) => format === 'pdf'
      ? textPdf('Food regulations. Infant nutrition products may omit per serve RDA values and servings per pack. This final notification takes effect on 1 July 2027 and updates label requirements.')
      : '<html><body>Official FSSAI food safety and standards regulations index for the current food labelling and display amendments.</body></html>');

    const result = await research({ query: 'infant nutrition RDA servings', topic: 'regulation' });
    const notice = result.items.find(item => item.id === 'fssai-label-amendment-2026');

    expect(result.status).toBe('ok');
    expect(notice).toMatchObject({ publishedAt: '2026-03-24', effectiveAt: '2027-07-01', category: 'final Gazette notification; future commencement' });
    expect(notice?.summary).toContain('Infant nutrition');
    expect(notice?.limitations).toContain('does not establish a consolidated rule');
  });

  it('keeps the official Gazette source on the fixed primary-source allowlist', async () => {
    fixedFetchMock.mockImplementation(async (url: URL, format: string) => format === 'pdf'
      ? textPdf('Food regulations. Infant nutrition products may omit per serve RDA values and servings per pack. This final notification takes effect on 1 July 2027 and updates label requirements.')
      : '<html><body>Official FSSAI food safety and standards regulations index for the current food labelling and display amendments.</body></html>');
    const result = await research({ query: 'infant nutrition RDA FSSAI amendment', topic: 'regulation' });
    const notice = result.items.find(item => item.id === 'fssai-label-amendment-2026');
    expect(notice?.url).toBe('https://www.fssai.gov.in/upload/notifications/2026/04/69cca2b3f3ce9Notification%20dt%2024.03.2026_NRC.pdf');
  });

  it('retrieves the dated ORS order and court history without turning it into a product verdict', async () => {
    fixedFetchMock.mockImplementation(async (url: URL, format: string) => format === 'pdf'
      ? url.hostname === 'delhihighcourt.nic.in'
        ? textPdf('Official ORS case history. The Delhi High Court dismissed this case-specific challenge on 31 October 2025 and left product-specific applicability for further review.')
        : textPdf('')
      : '<html><body>Official FSSAI regulations index for food labeling and claims.</body></html>');

    const result = await research({ query: 'Is this ORS legal in India today?', topic: 'regulation' });
    const history = result.items.filter(item => item.id.startsWith('fssai-ors-') || item.id === 'delhi-hc-ors-2025-dr-reddys');

    expect(result.status).toBe('ok');
    expect(history.map(item => item.id)).toEqual(expect.arrayContaining([
      'fssai-ors-2022-direction', 'fssai-ors-2024-order', 'fssai-ors-2025-withdrawal', 'fssai-ors-2025-clarification', 'delhi-hc-ors-2025-dr-reddys',
    ]));
    expect(history.find(item => item.id === 'fssai-ors-2025-withdrawal')).toMatchObject({ publishedAt: '2025-10-14' });
    expect(history.find(item => item.id === 'fssai-ors-2025-clarification')).toMatchObject({ publishedAt: '2025-10-15' });
    expect(history.find(item => item.id === 'fssai-ors-2024-order')?.category).toMatch(/superseded historical order/i);
    expect(history.find(item => item.id === 'delhi-hc-ors-2025-dr-reddys')?.limitations).toMatch(/case-specific judgment.*does not decide every product/i);
    expect(history.find(item => item.id === 'fssai-ors-2025-withdrawal')?.category).toMatch(/regulatory withdrawal of prior permissions/i);
    expect(history.find(item => item.id === 'fssai-ors-2025-withdrawal')?.limitations).toMatch(/not retrieved source text.*not a product-specific adjudication/i);
    const historicalDirectionCall = fixedFetchMock.mock.calls.find(([url]) => new URL(String(url)).pathname.includes('6253ddfde2161Direction'));
    expect(historicalDirectionCall?.slice(1)).toEqual(['pdf', 2_000_000]);
    expect(fixedFetchMock).toHaveBeenCalledTimes(5);
  });

  it('returns an extractable superseded 2024 ORS order as history when later PDFs are image-only', async () => {
    fixedFetchMock.mockImplementation(async (url: URL, format: string) => {
      if (format !== 'pdf') return '<html><body>Official FSSAI regulations index for food labeling and claims.</body></html>';
      if (url.pathname.includes('65c0d35e786e4Order')) return textPdf('Food Safety and Standards Authority of India. Dated 02nd February, 2024. FSSAI order on usage of the term ORS with brand names. All concerned businesses shall ensure compliance with these directions from 01st April, 2024.');
      return textPdf('');
    });

    const result = await research({ query: 'Is this ORS legal in India today?', topic: 'regulation' });
    const historical = result.items.find(item => item.id === 'fssai-ors-2024-order');

    expect(result.status).toBe('ok');
    expect(historical).toMatchObject({ publishedAt: '2024-02-02', category: 'superseded historical order; prior permissions withdrawn 14 October 2025' });
    expect(historical?.summary).toContain('02nd February, 2024');
    expect(historical?.limitations).toMatch(/does not establish a consolidated rule/i);
    expect(result.items.find(item => item.id === 'fssai-ors-2025-clarification')?.summary).toMatch(/could not retrieve usable source text/i);
    expect(result.message).toMatch(/Current legal status and package compliance remain unverified/);
    expect(fixedFetchMock).toHaveBeenCalledTimes(5);
  });

  it('labels allowlisted scanned FSSAI pages as unverified local OCR excerpts', async () => {
    fixedFetchMock.mockImplementation(async (_url: URL, format: string) => format === 'pdf'
      ? textPdf('')
      : '<html><body>Official FSSAI regulations index for food labeling and claims.</body></html>');
    const ocrSources: string[] = [];
    const extractionOptions: { sourceId: string; allowOcr: boolean; pages: number; characters: number }[] = [];
    const result = await research({ query: 'Is this ORS legal in India today?', topic: 'regulation' }, async (_bytes, options) => {
      extractionOptions.push(options);
      if (options.allowOcr) {
        ocrSources.push(options.sourceId);
        return {
          text: 'Food Safety and Standards Authority of India. This is official regulatory notice text concerning ORS product naming and withdrawal of prior permissions. Verify all wording against the linked original document before relying on it.',
          pagesRead: 2,
          totalPages: 2,
          truncated: false,
          extraction: 'ocr',
          ocrPages: 2,
        };
      }
      return { text: '', pagesRead: 1, totalPages: 1, truncated: false, extraction: 'empty', ocrPages: 0 };
    });
    const clarification = result.items.find(item => item.id === 'fssai-ors-2025-clarification');
    expect(ocrSources).toEqual(expect.arrayContaining(['fssai-ors-2025-withdrawal', 'fssai-ors-2025-clarification']));
    expect(clarification?.category).toMatch(/machine OCR excerpt/i);
    expect(clarification?.summary).toMatch(/Official PDF OCR excerpt \(machine-extracted; unverified; not interpreted\)/i);
    expect(clarification?.summary).toMatch(/Machine OCR was used on 2 pages/i);
    expect(clarification?.limitations).toMatch(/unverified and may contain recognition errors/i);
    expect(result.message).toMatch(/Current legal status and package compliance remain unverified/i);
    expect(extractionOptions).toContainEqual({ sourceId: 'fssai-ors-2025-withdrawal', allowOcr: true, pages: 40, characters: 50_000 });
    expect(extractionOptions).toContainEqual({ sourceId: 'delhi-hc-ors-2025-dr-reddys', allowOcr: false, pages: 40, characters: 50_000 });
  });

  it('keeps primary-source links visible when only a client-rendered shell is retrieved', async () => {
    fixedFetchMock.mockResolvedValue('<html><title>FSSAI</title><div id="root"></div><script src="app.js"></script></html>');
    const result = await research({ query: 'FSSAI labelling', topic: 'regulation' });
    expect(result.status).toBe('unavailable');
    expect(result.items.length).toBeGreaterThan(0);
    const fssaiLinks = result.items.filter(item => item.publisher === 'FSSAI');
    const gazetteSearch = result.items.find(item => item.id === 'egazette-search-navigation');
    expect(fssaiLinks.length).toBeGreaterThan(0);
    expect(fssaiLinks.every(item => /^https:\/\/(www\.)?fssai\.gov\.in\//.test(item.url))).toBe(true);
    expect(fssaiLinks.every(item => /could not retrieve usable source text/i.test(item.summary))).toBe(true);
    expect(fssaiLinks.every(item => /navigation only/i.test(item.limitations))).toBe(true);
    expect(fssaiLinks.every(item => item.supportRole === 'navigation')).toBe(true);
    expect(gazetteSearch).toMatchObject({
      url: 'https://egazette.gov.in/',
      category: 'official Gazette search; navigation only',
    });
    expect(gazetteSearch?.summary).toMatch(/No document text was fetched or excerpted/i);
    expect(gazetteSearch?.limitations).toMatch(/not legal evidence/i);
    expect(gazetteSearch?.supportRole).toBe('navigation');
    expect(fixedFetchMock.mock.calls.every(([url]) => new URL(String(url)).hostname !== 'egazette.gov.in')).toBe(true);
    expect(result.message).toMatch(/no source text or current-law verdict is available/i);
  });

  it('does not return unrelated registry sources or match terms as substrings', async () => {
    const result = await research({ query: 'almond manufacture', topic: 'regulation' });
    expect(fixedFetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'unavailable', items: [] });
    expect(result.message).toMatch(/not evidence that no relevant rule or guidance exists/i);
  });

  it('matches a registered phrase as whole normalized tokens', async () => {
    fixedFetchMock.mockResolvedValue('<html><body>Official guidance for non sugar sweeteners and product labelling. This page contains enough content to inspect safely.</body></html>');
    const result = await research({ query: 'non-sugar sweeteners', topic: 'regulation' });
    expect(result.items.some(item => item.id === 'who-sweeteners-live')).toBe(true);
  });

  it('retrieves Appendix A for additive queries with per-entry PDF bounds and persistent legal caveats', async () => {
    fixedFetchMock.mockImplementation(async (url: URL, format: string) => format === 'pdf'
      ? new Uint8Array([37, 80, 68, 70, 45])
      : '<html><body>Official FSSAI regulations index for food safety and standards. Review original notifications and amendments.</body></html>');
    const extractionCalls: { sourceId: string; allowOcr: boolean; pages: number; characters: number }[] = [];
    const result = await research({ query: 'INS 415 xanthan gum', topic: 'regulation' }, async (_bytes, options) => {
      extractionCalls.push(options);
      return { text: 'Appendix A food additive listing: Xanthan gum INS 415. Exact category and conditions of use must be checked in the original notification.', pagesRead: options.pages, totalPages: 361, truncated: true, extraction: 'selectable-text', ocrPages: 0 };
    });
    const appendix = result.items.find(item => item.id === 'fssai-additive-compendium-appendix-a');
    const amendments = result.items.find(item => item.id === 'fssai-food-additive-amendments-index');
    const request = fixedFetchMock.mock.calls.find(([url]) => new URL(String(url)).pathname.includes('Appendix%20A(4).pdf'));

    expect(request?.slice(1)).toEqual(['pdf', 6_000_000]);
    expect(extractionCalls).toContainEqual({ sourceId: 'fssai-additive-compendium-appendix-a', allowOcr: false, pages: 380, characters: 900_000 });
    expect(appendix?.url).toBe('https://www.fssai.gov.in/docs/food-law/regulations/compendium/food-products-standards/Appendix%20A(4).pdf');
    expect(appendix?.summary).toContain('Xanthan gum INS 415');
    expect(appendix?.summary).toMatch(/navigation aid only/i);
    expect(appendix?.limitations).toMatch(/not a legal document, current-law determination, additive authorization or package-compliance finding/i);
    expect(appendix?.limitations).toMatch(/original notifications prevail/i);
    expect(appendix?.limitations).toMatch(/exact food category and conditions of use/i);
    expect(appendix?.limitations).toMatch(/flattened PDF text may lose table row, column and food-category relationships/i);
    expect(appendix?.summary).toMatch(/flattened text may not preserve table row, column or category relationships/i);
    expect(appendix?.limitations).toMatch(/Gazette notifications and amendments/i);
    expect(amendments?.url).toBe('https://fssai.gov.in/food-law/regulations/amendments/food-products-standards');
    expect(amendments?.category).toMatch(/amendment index; source discovery only/i);
    expect(amendments?.limitations).toMatch(/not a consolidated rule, current additive authorization or package-compliance finding/i);
  });

  it('ranks an exact additive code and rare ingredient above repeated document boilerplate', async () => {
    fixedFetchMock.mockImplementation(async (_url: URL, format: string) => format === 'pdf'
      ? new Uint8Array([37, 80, 68, 70, 45])
      : '<html><body>Official FSSAI index. Food safety and product standards.</body></html>');
    const boilerplate = 'FSSAI Appendix A lists food products and general dairy guidance. '.repeat(80);
    const result = await research({ query: 'What does FSSAI Appendix A list for xanthan gum INS 415 in dairy products?', topic: 'regulation' }, async (_bytes, options) => ({
      text: `${boilerplate}\n01.0 Dairy products — Xanthan gum INS 415; verify exact food category and conditions in the original notification.`,
      pagesRead: options.pages,
      totalPages: 361,
      truncated: true,
      extraction: 'selectable-text',
      ocrPages: 0,
    }));
    const appendix = result.items.find(item => item.id === 'fssai-additive-compendium-appendix-a');

    expect(appendix?.summary).toMatch(/01\.0 Dairy products — Xanthan gum INS 415/);
  });

  it('withholds unrelated additive rows when the exact requested INS code is absent', async () => {
    fixedFetchMock.mockImplementation(async (_url: URL, format: string) => format === 'pdf'
      ? new Uint8Array([37, 80, 68, 70, 45])
      : '<html><body>Official FSSAI food products standards and food additives amendment index. Review applicable notices and dates in the original source.</body></html>');
    const unrelatedRows = 'Food Additive INS No. 150c Caramel III 1,000 mg/kg. '.repeat(20);
    const result = await research({ query: 'INS 319 food additive India', topic: 'regulation' }, async (_bytes, options) => ({
      text: unrelatedRows,
      pagesRead: options.pages,
      totalPages: 361,
      truncated: true,
      extraction: 'selectable-text',
      ocrPages: 0,
    }));
    const appendix = result.items.find(item => item.id === 'fssai-additive-compendium-appendix-a');

    expect(appendix?.summary).toMatch(/exact INS identifier requested was not present/i);
    expect(appendix?.summary).not.toContain('Caramel III');
    expect(appendix?.limitations).toMatch(/navigation only/i);
  });

  it('anchors a requested INS code above earlier table rows and repeated boilerplate', async () => {
    fixedFetchMock.mockImplementation(async (_url: URL, format: string) => format === 'pdf'
      ? new Uint8Array([37, 80, 68, 70, 45])
      : '<html><body>Official FSSAI food products standards index; read original notices.</body></html>');
    const boilerplate = 'Food Additive INS No. 150c Caramel III 1,000 mg/kg. Food category index. '.repeat(18);
    const result = await research({ query: 'INS 319 food additive India', topic: 'regulation' }, async (_bytes, options) => ({
      text: `${boilerplate}\nTertiary butylhydroquinone INS 319 100 mg/kg. Exact food category and conditions are set in the adjacent table headings.`,
      pagesRead: options.pages,
      totalPages: 361,
      truncated: true,
      extraction: 'selectable-text',
      ocrPages: 0,
    }));
    const appendix = result.items.find(item => item.id === 'fssai-additive-compendium-appendix-a');

    expect(appendix?.summary).toContain('Tertiary butylhydroquinone INS 319');
    expect(appendix?.summary.indexOf('INS 319')).toBeGreaterThanOrEqual(0);
    expect(appendix?.summary.indexOf('INS 319')).toBeLessThan(500);
  });

  it('does not fetch Appendix A for unrelated food-labelling or ORS regulation queries', async () => {
    fixedFetchMock.mockResolvedValue('<html><body>Official FSSAI regulations index for food labelling and claims. This page contains enough content for a bounded source excerpt.</body></html>');
    const labelResult = await research({ query: 'FSSAI food labelling regulations', topic: 'regulation' });
    const orsResult = await research({ query: 'Is this ORS legal in India today?', topic: 'regulation' });

    expect(labelResult.items.some(item => item.id === 'fssai-additive-compendium-appendix-a')).toBe(false);
    expect(labelResult.items.some(item => item.id === 'fssai-food-additive-amendments-index')).toBe(false);
    expect(orsResult.items.some(item => item.id === 'fssai-additive-compendium-appendix-a')).toBe(false);
    expect(orsResult.items.some(item => item.id === 'fssai-food-additive-amendments-index')).toBe(false);
    expect(fixedFetchMock.mock.calls.some(([url]) => new URL(String(url)).pathname.includes('food-products-standards'))).toBe(false);
  });
});

