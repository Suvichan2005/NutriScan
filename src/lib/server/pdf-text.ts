import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export type PdfText = { text: string; pagesRead: number; totalPages: number; truncated: boolean };

/** Extract bounded selectable text only; this does not OCR scanned pages or interpret the document. */
export async function extractPdfText(data: Uint8Array, limits = { pages: 40, characters: 50_000 }): Promise<PdfText> {
  const loadingTask = getDocument({ data, verbosity: 0, stopAtErrors: true });
  try {
    const document = await loadingTask.promise;
    const pageLimit = Math.min(document.numPages, limits.pages);
    const fragments: string[] = [];
    let characters = 0;
    let pagesRead = 0;
    let truncated = document.numPages > pageLimit;
    for (let pageNumber = 1; pageNumber <= pageLimit && characters < limits.characters; pageNumber++) {
      const page = await document.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const pageText = content.items.flatMap(item => 'str' in item ? [item.str] : []).join(' ').replace(/\s+/g, ' ').trim();
        if (pageText) {
          const remaining = limits.characters - characters;
          const clipped = pageText.slice(0, remaining);
          fragments.push(clipped);
          characters += clipped.length;
          if (clipped.length < pageText.length) truncated = true;
        }
        pagesRead++;
      } finally { page.cleanup(); }
    }
    if (pagesRead < Math.min(document.numPages, limits.pages)) truncated = true;
    return { text: fragments.join('\n\n'), pagesRead, totalPages: document.numPages, truncated };
  } finally { await loadingTask.destroy(); }
}
