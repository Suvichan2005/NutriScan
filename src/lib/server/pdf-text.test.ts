import { describe, expect, it } from 'vitest';
import { extractPdfText } from './pdf-text';

function textPdf(pages: string[]) {
  const fontId = 3 + pages.length * 2;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${3 + index * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    ...pages.flatMap((text, index) => {
      const pageId = 3 + index * 2;
      const contentId = pageId + 1;
      const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
      return [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
      ];
    }),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.7\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'binary'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'binary');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

describe('bounded PDF text extraction', () => {
  it('extracts selectable text from the document pages', async () => {
    const result = await extractPdfText(textPdf(['Final notification effective 1 July 2027']), { pages: 4, characters: 500 });
    expect(result).toMatchObject({ pagesRead: 1, totalPages: 1, truncated: false });
    expect(result.text).toContain('Final notification effective 1 July 2027');
  });

  it('caps page reads and extracted characters', async () => {
    const result = await extractPdfText(textPdf(['First page nutrition rules', 'Second page label rules']), { pages: 1, characters: 12 });
    expect(result).toMatchObject({ pagesRead: 1, totalPages: 2, truncated: true });
    expect(result.text.length).toBeLessThanOrEqual(12);
  });
});
