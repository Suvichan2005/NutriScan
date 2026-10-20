import { input, route } from '@/lib/server/http';
import { assist, assistInput } from '@/lib/server/gemini';
export const runtime = 'nodejs';
export const POST = (request: Request) => route(request, 'gemini', async () => assist(await input(request, assistInput, 100_000)), 4);
