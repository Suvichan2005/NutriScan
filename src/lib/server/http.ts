import { z } from 'zod';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

const budgets = new Map<string, { started: number; used: number; active: number }>();
export function localGate(request: Request, group: string, limit = 10) {
  const url = new URL(request.url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new ApiError(403, 'local_only', 'This development API is restricted to localhost.');
  // Next's Node adapter may normalize Request.url to localhost even when the
  // browser addressed 127.0.0.1. Host is accepted only as an exact loopback
  // authority on the already-bound local request port; never trust forwarded hosts.
  const host = request.headers.get('host') || url.host;
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host)) throw new ApiError(403, 'host_rejected', 'Use the local NutriScan hostname.');
  const browserUrl = new URL(`${url.protocol}//${host}`);
  if (browserUrl.port !== url.port) throw new ApiError(403, 'host_rejected', 'Use the local NutriScan port.');
  const origin = request.headers.get('origin');
  if (!origin || origin !== browserUrl.origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new ApiError(403, 'origin_rejected', 'Use the NutriScan page on the same local origin.');
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new ApiError(415, 'json_required', 'Send application/json.');
  const now = Date.now();
  for (const [key, value] of budgets) if (now - value.started > 120_000 && !value.active) budgets.delete(key);
  let budget = budgets.get(group);
  if (!budget || now - budget.started > 60_000) { budget = { started: now, used: 0, active: budget?.active ?? 0 }; budgets.set(group, budget); }
  if (budget.used >= limit || budget.active >= 2) throw new ApiError(429, 'rate_limited', 'Request limit reached. Wait one minute before trying again.');
  budget.used++; budget.active++;
  return () => { budget!.active = Math.max(0, budget!.active - 1); };
}

export async function readBounded(stream: ReadableStream<Uint8Array> | null, max: number, signal?: AbortSignal): Promise<string> {
  if (!stream) return '';
  const reader = stream.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  const cancel = () => { void reader.cancel(); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      if (signal?.aborted) throw new ApiError(504, 'timeout', 'The remote service timed out.');
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); throw new ApiError(413, 'too_large', 'The response or request exceeds the size limit.'); }
      chunks.push(value);
    }
  } finally { signal?.removeEventListener('abort', cancel); reader.releaseLock(); }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(result);
}

export async function input<T extends z.ZodType>(request: Request, schema: T, max = 80_000): Promise<z.infer<T>> {
  if (Number(request.headers.get('content-length') || 0) > max) throw new ApiError(413, 'too_large', 'The request exceeds the size limit.');
  const body = await readBounded(request.body, max, AbortSignal.timeout(10_000));
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { throw new ApiError(400, 'invalid_json', 'Send a valid JSON object.'); }
  const result = schema.safeParse(parsed);
  if (!result.success) throw new ApiError(400, 'invalid_input', 'Input did not match the documented request contract.');
  return result.data;
}

export async function fixedFetch(url: URL, type: 'json' | 'html' = 'json', max = 900_000, searchBody?: object) {
  const allowed = ['world.openfoodfacts.org', 'search.openfoodfacts.org', 'www.ebi.ac.uk', 'www.who.int', 'fssai.gov.in', 'www.fssai.gov.in', 'api.fda.gov'];
  if (url.protocol !== 'https:' || !allowed.includes(url.hostname) || url.username || url.password || url.port) throw new ApiError(400, 'url_rejected', 'Remote destination is not allowed.');
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    if (searchBody && (url.hostname !== 'search.openfoodfacts.org' || url.pathname !== '/search')) throw new ApiError(400, 'url_rejected', 'POST is limited to the fixed public search endpoint.');
    const response = await fetch(url, { method: searchBody ? 'POST' : 'GET', ...(searchBody ? { body: JSON.stringify(searchBody) } : {}), redirect: 'error', signal: controller.signal, headers: { Accept: type === 'json' ? 'application/json' : 'text/html', ...(searchBody ? { 'Content-Type': 'application/json' } : {}), 'User-Agent': 'NutriScan-LocalResearch/0.1 (educational label review)' }, cache: 'no-store' });
    if (!response.ok) {
      // openFDA documents a NOT_FOUND 404 for a valid search with zero matches.
      // Accept only that exact bounded error shape from this fixed endpoint.
      if (response.status === 404 && url.hostname === 'api.fda.gov' && url.pathname === '/food/enforcement.json') {
        const errorBody = await readBounded(response.body, 8000, controller.signal);
        try { if (JSON.parse(errorBody)?.error?.code === 'NOT_FOUND') return { results: [] }; } catch { /* A nonconforming error remains unavailable. */ }
      }
      throw new ApiError(502, 'upstream_failure', `The public source returned HTTP ${response.status}. Try its linked page directly.`);
    }
    const ct = response.headers.get('content-type') || '';
    if (!(type === 'json' ? /json/i : /html/i).test(ct)) throw new ApiError(502, 'unexpected_content', 'The source did not return the expected content type.');
    if (Number(response.headers.get('content-length') || 0) > max) throw new ApiError(502, 'upstream_too_large', 'The source response exceeded the size limit.');
    const body = await readBounded(response.body, max, controller.signal);
    if (type === 'html') return body;
    try { return JSON.parse(body) as unknown; } catch { throw new ApiError(502, 'upstream_invalid', 'The source returned invalid JSON.'); }
  } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(502, 'source_unavailable', 'The public source could not be reached within the bounded request. Retry later or open the source directly.'); }
  finally { clearTimeout(timer); }
}

export async function route(request: Request, group: string, work: () => Promise<unknown>, limit = 10) {
  let release: (() => void) | undefined;
  const requestId = crypto.randomUUID();
  try { release = localGate(request, group, limit); return reply({ ...await work() as object, requestId }); }
  catch (error) {
    if (error instanceof ApiError) return reply({ status: error.code === 'provider_disabled' ? 'disabled' : 'unavailable', code: error.code, message: error.message, requestId }, error.status);
    // Never serialize provider errors: those may contain prompts, images, or credentials.
    return reply({ status: 'unavailable', code: 'request_failed', message: 'The request could not be completed safely. Local analysis remains available.', requestId }, 502);
  } finally { release?.(); }
}

export function plain(value: unknown, max = 1000) { return typeof value === 'string' ? value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : ''; }
