import { input, route } from '@/lib/server/http';
import { research, researchInput } from '@/lib/server/research';
export const runtime = 'nodejs';
export const POST = (request: Request) => route(request, 'research', async () => research(await input(request, researchInput, 3000)), 10);
