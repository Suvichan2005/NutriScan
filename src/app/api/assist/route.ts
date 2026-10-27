import { input, route } from '@/lib/server/http';
import { assist, assistInput } from '@/lib/server/gemini';
export const runtime = 'nodejs';
export const maxDuration = 120;
export const POST = async (request: Request) => {
  const started = performance.now();
  // A scan and a few normal follow-ups can exceed four requests in a minute.
  // Keep the independent two-active-request and provider/spending guards.
  const response = await route(request, 'gemini', async () => assist(await input(request, assistInput, 4_300_000)), 12);
  response.headers.set('Server-Timing', `nutriscan-assist;dur=${(performance.now() - started).toFixed(1)}`);
  return response;
};
