import { input, route } from '@/lib/server/http';
import { research, researchInput } from '@/lib/server/research';
import { extractPdfText } from '@/lib/server/pdf-text';
export const runtime = 'nodejs';
export const POST = (request: Request) => route(request, 'research', async () => research(await input(request, researchInput, 3000), (bytes, options) => extractPdfText(bytes, { pages: options.pages, characters: options.characters }, { ocr: options.allowOcr, maxOcrPages: options.allowOcr ? 2 : 0 })), 10);
