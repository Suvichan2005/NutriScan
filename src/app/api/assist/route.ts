import { input, route } from '@/lib/server/http';
import { assist, assistInput } from '@/lib/server/gemini';
export const runtime = 'nodejs';
export const maxDuration = 120;
export const POST = async (request: Request) => {
  const started = performance.now();
  const response = await route(request, 'gemini', async () => assist(await input(request, assistInput, 4_300_000)), 4);
  response.headers.set('Server-Timing', `nutriscan-assist;dur=${(performance.now() - started).toFixed(1)}`);
  return response;
};
