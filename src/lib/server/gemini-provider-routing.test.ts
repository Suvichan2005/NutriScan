import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applicationGeminiContext, generateTracked, providerStatus, resetGeminiRoutingForTests, resetGeminiUsageLedgerForTests, safeProviderFailure } from './gemini-provider';

const success = (model: string) => JSON.stringify({
  candidates: [{ content: { parts: [{ text: '{"ok":true}' }], role: 'model' }, finishReason: 'STOP', index: 0 }],
  modelVersion: `${model}-test`, usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 4, totalTokenCount: 12 },
});
const quota = (daily = false) => JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: daily ? 'Per day quota exceeded' : 'Rate limit exceeded', details: daily ? [{ quotaId: 'requests_per_day' }] : [] } });

beforeEach(() => {
  resetGeminiUsageLedgerForTests();
  resetGeminiRoutingForTests();
  vi.stubEnv('ENABLE_GEMINI', 'true');
  vi.stubEnv('GEMINI_PROVIDER', 'free');
  vi.stubEnv('GEMINI_FREE_MODEL_ORDER', 'gemini-3.8-flash,gemini-3.7-flash');
  vi.stubEnv('FREE_GEMINI_API_KEY', 'free-test-key');
  vi.stubEnv('GEMINI_API_KEY', 'paid-must-not-be-used');
  vi.stubEnv('ENABLE_PAID_GEMINI', 'false');
  vi.stubEnv('ENABLE_PAID_GEMINI_FALLBACK', 'false');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('free-tier Gemini model routing', () => {
  it('does not describe paid access as authorized merely because a free key is configured', () => {
    expect(providerStatus()).toMatchObject({ tier: 'free', enabled: true, paidAuthorized: false, paidProjectIdentity: 'unknown', paidFallbackEnabled: false });
  });

  it('falls forward after a free-model 429 and honors the retry header without retrying a daily quota', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(quota(), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '30' } }))
      .mockResolvedValueOnce(new Response(success('gemini-3.7-flash'), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    const context = applicationGeminiContext();
    const result = await generateTracked(context, { model: context.model, contents: 'bounded routing test', config: { maxOutputTokens: 40 } });
    expect(result.modelVersion).toBe('gemini-3.7-flash-test');
    expect(context.model).toBe('gemini-3.7-flash');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[0][0])).toContain('gemini-3.8-flash');
    expect(String(fetcher.mock.calls[1][0])).toContain('gemini-3.7-flash');
    expect(JSON.stringify(fetcher.mock.calls).includes('paid-must-not-be-used')).toBe(false);
  });

  it('records each free HTTP attempt and routes around one transient unavailable model', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 503, status: 'UNAVAILABLE', message: 'Model temporarily unavailable' } }), { status: 503, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(success('gemini-3.7-flash'), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(success('gemini-3.7-flash'), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    const context = applicationGeminiContext();
    const result = await generateTracked(context, { model: context.model, contents: 'temporary provider availability test', config: { maxOutputTokens: 40 } });
    expect(result.modelVersion).toBe('gemini-3.7-flash-test');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[0][0])).toContain('gemini-3.8-flash');
    expect(String(fetcher.mock.calls[1][0])).toContain('gemini-3.7-flash');
    const nextTurn = applicationGeminiContext();
    expect(nextTurn.model).toBe('gemini-3.7-flash');
    await generateTracked(nextTurn, { model: nextTurn.model, contents: 'next turn after temporary outage', config: { maxOutputTokens: 40 } });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(String(fetcher.mock.calls[2][0])).toContain('gemini-3.7-flash');
  });

  it('routes a model-attempt timeout to another free model while agent deadline remains', async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new DOMException('The provider request timed out.', 'TimeoutError'))
      .mockResolvedValueOnce(new Response(success('gemini-3.7-flash'), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    const context = applicationGeminiContext();
    const result = await generateTracked(context, { model: context.model, contents: 'bounded timeout fallback test', config: { maxOutputTokens: 40 } }, { deadlineAt: Date.now() + 10_000 });
    expect(result.modelVersion).toBe('gemini-3.7-flash-test');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('recognizes an SDK-wrapped timeout and routes to the next free model', async () => {
    const wrappedTimeout = new TypeError('fetch failed', { cause: new DOMException('The request timed out.', 'TimeoutError') });
    expect(safeProviderFailure(wrappedTimeout).failureClass).toBe('timeout');
    const fetcher = vi.fn()
      .mockRejectedValueOnce(wrappedTimeout)
      .mockResolvedValueOnce(new Response(success('gemini-3.7-flash'), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    const context = applicationGeminiContext();
    const result = await generateTracked(context, { model: context.model, contents: 'wrapped timeout fallback test', config: { maxOutputTokens: 40 } }, { deadlineAt: Date.now() + 10_000 });
    expect(result.modelVersion).toBe('gemini-3.7-flash-test');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('records a timed-out provider attempt as timeout when the SDK drops its abort cause', () => {
    const timedOutSignal = AbortSignal.abort();
    expect(safeProviderFailure(new TypeError('fetch failed'), timedOutSignal)).toMatchObject({ status: null, failureClass: 'timeout' });
  });

  it('persists daily quota exhaustion and skips that model on the next request', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(quota(true), { status: 429, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(success('gemini-3.7-flash'), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(success('gemini-3.7-flash'), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    const first = applicationGeminiContext();
    await generateTracked(first, { model: first.model, contents: 'first request', config: { maxOutputTokens: 40 } });
    const next = applicationGeminiContext();
    expect(next.model).toBe('gemini-3.7-flash');
    await generateTracked(next, { model: next.model, contents: 'second request', config: { maxOutputTokens: 40 } });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(String(fetcher.mock.calls[2][0])).toContain('gemini-3.7-flash');
  });

  it('skips a model with an explicit unsupported tool/schema capability but not malformed requests', async () => {
    const unsupportedFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Tool use is not supported for model gemini-3.8-flash.' } }), { status: 400, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(success('gemini-3.7-flash'), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', unsupportedFetch);
    const context = applicationGeminiContext();
    const result = await generateTracked(context, { model: context.model, contents: 'tool capability test', config: { maxOutputTokens: 40 } });
    expect(result.modelVersion).toBe('gemini-3.7-flash-test');

    resetGeminiRoutingForTests();
    const malformedFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Invalid JSON schema field' } }), { status: 400, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', malformedFetch);
    const malformedContext = applicationGeminiContext();
    await expect(generateTracked(malformedContext, { model: malformedContext.model, contents: 'bad request test', config: { maxOutputTokens: 40 } })).rejects.toMatchObject({ status: 400 });
    expect(malformedFetch).toHaveBeenCalledTimes(1);
  });

  it('does not route around authentication failures', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 401, status: 'UNAUTHENTICATED', message: 'invalid key' } }), { status: 401, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    const context = applicationGeminiContext();
    await expect(generateTracked(context, { model: context.model, contents: 'auth test', config: { maxOutputTokens: 40 } })).rejects.toMatchObject({ status: 401 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('returns a temporary free-route error when every configured free model is exhausted', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(quota(), { status: 429, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(quota(), { status: 429, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    const context = applicationGeminiContext();
    await expect(generateTracked(context, { model: context.model, contents: 'exhaustion test', config: { maxOutputTokens: 40 } })).rejects.toMatchObject({ code: 'free_models_exhausted' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('keeps paid credentials isolated unless the explicitly configured final fallback is enabled for distinct projects', async () => {
    vi.stubEnv('ENABLE_PAID_GEMINI', 'true');
    vi.stubEnv('ENABLE_PAID_GEMINI_FALLBACK', 'true');
    vi.stubEnv('GEMINI_MODEL', 'gemini-3.8-flash');
    vi.stubEnv('GEMINI_FREE_PROJECT_ID', 'free-project');
    vi.stubEnv('GEMINI_PAID_PROJECT_ID', 'paid-project');
    vi.stubEnv('GEMINI_PAID_BUDGET_USD', '1');
    vi.stubEnv('GEMINI_PAID_MAX_CALLS', '3');
    vi.stubEnv('GEMINI_PAID_MAX_INPUT_TOKENS', '1000');
    vi.stubEnv('GEMINI_PAID_MAX_OUTPUT_TOKENS', '100');
    vi.stubEnv('GEMINI_PAID_INPUT_USD_PER_MILLION', '1');
    vi.stubEnv('GEMINI_PAID_OUTPUT_USD_PER_MILLION', '1');
    const paidWasCalled = { value: false };
    const fetcher = vi.fn().mockImplementation(async (target: RequestInfo | URL, init?: RequestInit) => {
      const url = String(target);
      const headers = new Headers(init?.headers);
      const key = headers.get('x-goog-api-key') ?? new URL(url).searchParams.get('key');
      if (key === 'paid-must-not-be-used') paidWasCalled.value = true;
      if (url.includes('countTokens')) return new Response(JSON.stringify({ totalTokens: 10 }), { status: 200, headers: { 'content-type': 'application/json' } });
      if (key === 'free-test-key') return new Response(quota(), { status: 429, headers: { 'content-type': 'application/json' } });
      return new Response(success('gemini-3.8-flash'), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetcher);
    const context = applicationGeminiContext();
    await generateTracked(context, { model: context.model, contents: 'explicit paid fallback test', config: { maxOutputTokens: 40 } });
    expect(paidWasCalled.value).toBe(true);
    expect(context.tier).toBe('paid');
  });
});
