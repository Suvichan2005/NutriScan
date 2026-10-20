import { input, route } from '@/lib/server/http';
import { vision, visionInput } from '@/lib/server/gemini';
export const runtime = 'nodejs';
export const POST = (request: Request) => route(request, 'gemini', async () => vision(await input(request, visionInput, 2_850_000)), 4);
