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
});

