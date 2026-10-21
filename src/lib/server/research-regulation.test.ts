import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fixedFetchMock } = vi.hoisted(() => ({ fixedFetchMock: vi.fn() }));
vi.mock('./http', () => ({
  ApiError: class ApiError extends Error {},
  fixedFetch: fixedFetchMock,
  plain: (value: unknown, max = 1000) => typeof value === 'string' ? value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '',
}));

import { research } from './research';

function textPdf(text: string) {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
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
      'fssai-ors-2022-direction', 'fssai-ors-2025-withdrawal', 'fssai-ors-2025-clarification', 'delhi-hc-ors-2025-dr-reddys',
    ]));
    expect(history.find(item => item.id === 'fssai-ors-2025-withdrawal')).toMatchObject({ publishedAt: '2025-10-14' });
    expect(history.find(item => item.id === 'fssai-ors-2025-clarification')).toMatchObject({ publishedAt: '2025-10-15' });
    expect(history.find(item => item.id === 'delhi-hc-ors-2025-dr-reddys')?.limitations).toMatch(/case-specific judgment.*does not decide every product/i);
    expect(history.find(item => item.id === 'fssai-ors-2025-withdrawal')?.category).toMatch(/regulatory withdrawal of prior permissions/i);
    expect(history.find(item => item.id === 'fssai-ors-2025-withdrawal')?.limitations).toMatch(/not retrieved source text.*not a product-specific adjudication/i);
    expect(fixedFetchMock).toHaveBeenCalledTimes(4);
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
    expect(gazetteSearch).toMatchObject({
      url: 'https://egazette.gov.in/',
      category: 'official Gazette search; navigation only',
    });
    expect(gazetteSearch?.summary).toMatch(/No document text was fetched or excerpted/i);
    expect(gazetteSearch?.limitations).toMatch(/not legal evidence/i);
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
});

