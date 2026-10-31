import { input, route } from '@/lib/server/http';
import { ingredientContext, ingredientContextInput } from '@/lib/server/ingredient-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return route(request, 'ingredient-context', async () => ingredientContext(await input(request, ingredientContextInput, 16000)), 20);
}
