import { evidenceQuerySchema } from '@/lib/contracts';
import { semanticRetrieve } from '@/lib/semantic';
import { ApiError, input, route } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return route(request, 'evidence', async () => {
    const body = await input(request, evidenceQuerySchema, 6000);
    try { return await semanticRetrieve(body.query, body.limit ?? 4); }
    catch { throw new ApiError(503, 'local_model_unavailable', 'Local evidence retrieval is unavailable or busy. Prepare the model with npm run embeddings:prepare, then retry. The local label audit still works.'); }
  }, 12);
}
