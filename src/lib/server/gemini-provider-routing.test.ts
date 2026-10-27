import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Type } from '@google/genai';
import { applicationGeminiContext, generateTracked, providerStatus, resetGeminiRoutingForTests, resetGeminiUsageLedgerForTests, safeProviderFailure } from './gemini-provider';

const telemetry = vi.hoisted(() => ({ diagnostic: vi.fn(), evaluation: vi.fn() }));
vi.mock('./gemini-diagnostics', () => ({ recordGeminiDiagnostic: telemetry.diagnostic }));
vi.mock('./gemini-evaluation-recorder', () => ({ recordGeminiEvaluationEvent: telemetry.evaluation }));

const success = (model: string) => JSON.stringify({
  candidates: [{ content: { parts: [{ text: '{"ok":true}' }], role: 'model' }, finishReason: 'STOP', index: 0 }],
  modelVersion: `${model}-test`, usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 4, totalTokenCount: 12 },
});
const quota = (daily = false) => JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: daily ? 'Per day quota exceeded' : 'Rate limit exceeded', details: daily ? [{ quotaId: 'requests_per_day' }] : [] } });

beforeEach(() => {
  resetGeminiUsageLedgerForTests();
  resetGeminiRoutingForTests();
  vi.stubEnv('GEMINI_FREE_ALLOW_ALTERNATIVES','true');
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
  it('gives a single free route 60 seconds while preserving shorter caller deadlines',async()=>{
    vi.stubEnv('GEMINI_FREE_ALLOW_ALTERNATIVES','false');
    vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>new Response(success('gemini-3.8-flash'),{status:200,headers:{'content-type':'application/json'}})));
    const timeout=vi.spyOn(AbortSignal,'timeout');
    try{
      const context=applicationGeminiContext();
      await generateTracked(context,{model:context.model,contents:'synthetic single route',config:{maxOutputTokens:40}});
      expect(timeout.mock.calls.some(([ms])=>ms===60_000)).toBe(true);
      expect(timeout.mock.calls.some(([ms])=>ms===20_000)).toBe(false);
      timeout.mockClear();
      await generateTracked(context,{model:context.model,contents:'synthetic bounded caller',config:{maxOutputTokens:40}},{deadlineAt:Date.now()+3000});
      expect(timeout.mock.calls.some(([ms])=>ms>0&&ms<=3000)).toBe(true);
      expect(timeout.mock.calls.some(([ms])=>ms===60_000)).toBe(false);
    }finally{timeout.mockRestore();}
  });
  it('honors an explicit model choice even when automatic alternatives are disabled',async()=>{
    vi.stubEnv('GEMINI_FREE_ALLOW_ALTERNATIVES','false');
    const fetcher=vi.fn().mockResolvedValue(new Response(success('gemini-3.7-flash'),{status:200,headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetcher);
    expect(providerStatus().modelChoices).toEqual(['gemini-3.8-flash','gemini-3.7-flash']);
    const context=applicationGeminiContext(false,'gemini-3.7-flash');
    await generateTracked(context,{model:context.model,contents:'synthetic model choice check',config:{maxOutputTokens:40}});
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('gemini-3.7-flash');
    expect(context.model).toBe('gemini-3.7-flash');
  });
  it('rejects a model excluded by the server and never substitutes another for a pinned failure',async()=>{
    expect(()=>applicationGeminiContext(false,'gemini-3.6-flash')).toThrow('not enabled');
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({error:{code:503,status:'UNAVAILABLE'}}),{status:503,headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetcher);
    const context=applicationGeminiContext(false,'gemini-3.7-flash');
    await expect(generateTracked(context,{model:context.model,contents:'synthetic pinned failure',config:{maxOutputTokens:40}})).rejects.toMatchObject({code:'free_models_exhausted'});
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('gemini-3.7-flash');
    expect(context.model).toBe('gemini-3.7-flash');
  });
  it('does not change a pinned model even when paid fallback to a different model is authorized',async()=>{
    for(const[key,value]of Object.entries({ENABLE_PAID_GEMINI:'true',ENABLE_PAID_GEMINI_FALLBACK:'true',GEMINI_MODEL:'gemini-3.8-flash',GEMINI_PAID_MODEL:'gemini-3.8-flash',GEMINI_FREE_PROJECT_ID:'free-test-project',GEMINI_PAID_PROJECT_ID:'paid-test-project',GEMINI_PAID_BUDGET_USD:'1',GEMINI_PAID_MAX_CALLS:'3',GEMINI_PAID_MAX_INPUT_TOKENS:'1000',GEMINI_PAID_MAX_OUTPUT_TOKENS:'100',GEMINI_PAID_INPUT_USD_PER_MILLION:'0.75',GEMINI_PAID_OUTPUT_USD_PER_MILLION:'3.75'}))vi.stubEnv(key,value);
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({error:{code:503,status:'UNAVAILABLE'}}),{status:503,headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetcher);
    const context=applicationGeminiContext(true,'gemini-3.7-flash');
    await expect(generateTracked(context,{model:context.model,contents:'synthetic pinned tier check',config:{maxOutputTokens:40}})).rejects.toMatchObject({code:'free_models_exhausted'});
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('x-goog-api-key')).toBe('free-test-key');
    expect(context.tier).toBe('free');
  });
  it('keeps a consumer free request free even when server-side paid fallback is configured',async()=>{
    vi.stubEnv('ENABLE_PAID_GEMINI','true');vi.stubEnv('ENABLE_PAID_GEMINI_FALLBACK','true');
    vi.stubEnv('GEMINI_FREE_PROJECT_ID','free-project');vi.stubEnv('GEMINI_PAID_PROJECT_ID','paid-project');
    const fetcher=vi.fn().mockImplementation(async()=>new Response(quota(true),{status:429,headers:{'content-type':'application/json'}}));vi.stubGlobal('fetch',fetcher);
    const context=applicationGeminiContext();
    await expect(generateTracked(context,{model:context.model,contents:'free consumer request',config:{maxOutputTokens:40}})).rejects.toMatchObject({code:'free_models_exhausted'});
    expect(context.tier).toBe('free');
    for(const [,init]of fetcher.mock.calls as unknown as [unknown,RequestInit][]){const headers=new Headers(init?.headers);expect(headers.get('x-goog-api-key')).not.toBe('paid-must-not-be-used');}
  });
  it('does not silently select an economy model without explicit opt-in',async()=>{
    vi.stubEnv('GEMINI_FREE_ALLOW_ALTERNATIVES','false');
    const fetcher=vi.fn().mockResolvedValue(new Response(quota(true),{status:429,headers:{'content-type':'application/json'}}));vi.stubGlobal('fetch',fetcher);
    const context=applicationGeminiContext();
    await expect(generateTracked(context,{model:context.model,contents:'one primary route',config:{maxOutputTokens:40}})).rejects.toMatchObject({code:'free_models_exhausted'});
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toContain('gemini-3.8-flash');
  });
  it('allows a paid-only extraction a bounded 60-second route while respecting a shorter caller deadline', async () => {
    vi.stubEnv('GEMINI_PROVIDER', 'paid');
    vi.stubEnv('ENABLE_PAID_GEMINI', 'true');
    vi.stubEnv('GEMINI_MODEL', 'gemini-3.8-flash');
    vi.stubEnv('GEMINI_FREE_PROJECT_ID', 'free-project');
    vi.stubEnv('GEMINI_PAID_PROJECT_ID', 'paid-project');
    vi.stubEnv('GEMINI_PAID_BUDGET_USD', '1');
    vi.stubEnv('GEMINI_PAID_MAX_CALLS', '3');
    vi.stubEnv('GEMINI_PAID_MAX_INPUT_TOKENS', '1000');
    vi.stubEnv('GEMINI_PAID_MAX_OUTPUT_TOKENS', '100');
    vi.stubEnv('GEMINI_PAID_INPUT_USD_PER_MILLION', '1');
    vi.stubEnv('GEMINI_PAID_OUTPUT_USD_PER_MILLION', '1');
    vi.stubGlobal('fetch', vi.fn(async (target: RequestInfo | URL) => new Response(
      String(target).includes('countTokens') ? JSON.stringify({ totalTokens: 10 }) : success('gemini-3.8-flash'),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )));
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    try {
      const context = applicationGeminiContext();
      await generateTracked(context, { model: context.model, contents: 'paid extraction', config: { maxOutputTokens: 40 } });
      expect(timeout.mock.calls.some(([ms]) => ms === 60_000)).toBe(true);
      timeout.mockClear();
      await generateTracked(context, { model: context.model, contents: 'short caller deadline', config: { maxOutputTokens: 40 } }, { deadlineAt: Date.now() + 3000 });
      expect(timeout.mock.calls.some(([ms]) => ms > 0 && ms <= 3000)).toBe(true);
      expect(timeout.mock.calls.some(([ms]) => ms === 60_000)).toBe(false);
    } finally { timeout.mockRestore(); }
  });
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
    const finalRoute = telemetry.diagnostic.mock.calls.map(([value]) => value as Record<string, unknown>).find(value => value.event === 'provider_route' && value.actualModel === 'gemini-3.7-flash');
    expect(finalRoute?.attempts).toEqual([
      expect.objectContaining({ model: 'gemini-3.8-flash', outcome: 'failed', reason: 'service-unavailable', failureClass: 'timeout' }),
      expect.objectContaining({ model: 'gemini-3.7-flash', outcome: 'used' }),
    ]);
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

  it('treats an SDK AbortError as a model-attempt timeout and reaches the authorized paid last resort', async () => {
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

    const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
    const alreadyTimedOut = AbortSignal.abort(new DOMException('The model attempt timed out.', 'TimeoutError'));
    let attemptTimeoutCount = 0;
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
      if (milliseconds === 20_000 && attemptTimeoutCount++ === 1) return alreadyTimedOut;
      return originalTimeout(milliseconds);
    });

    let sawPaidCredential = false;
    const fetcher = vi.fn(async (target: RequestInfo | URL, init?: RequestInit) => {
      const url = String(target);
      const key = new Headers(init?.headers).get('x-goog-api-key') ?? new URL(url).searchParams.get('key');
      if (key === 'paid-must-not-be-used') sawPaidCredential = true;
      if (url.includes('countTokens')) {
        return new Response(JSON.stringify({ totalTokens: 10 }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('gemini-3.8-flash') && key === 'free-test-key') {
        return new Response(JSON.stringify({ error: { code: 503, status: 'UNAVAILABLE', message: 'Model temporarily unavailable' } }), { status: 503, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('gemini-3.7-flash') && key === 'free-test-key') {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }
      return new Response(success('gemini-3.8-flash'), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetcher);

    const parent = new AbortController();
    const context = applicationGeminiContext(true);
    const result = await generateTracked(context, {
      model: context.model,
      contents: 'authorized timeout fallback test',
      config: { maxOutputTokens: 40, abortSignal: parent.signal },
    });

    expect(result.modelVersion).toBe('gemini-3.8-flash-test');
    expect(parent.signal.aborted).toBe(false);
    expect(context.tier).toBe('paid');
    expect(sawPaidCredential).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('does not route to another model or paid fallback after the caller cancels the whole request', async () => {
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
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 503, status: 'UNAVAILABLE', message: 'Model temporarily unavailable' } }), { status: 503, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    const parent = AbortSignal.abort(new DOMException('The request was cancelled.', 'AbortError'));
    const context = applicationGeminiContext();

    await expect(generateTracked(context, {
      model: context.model,
      contents: 'cancelled request must not route',
      config: { maxOutputTokens: 40, abortSignal: parent },
    })).rejects.toBeDefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(context.tier).toBe('free');
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

  it('scopes an unsupported tool-plus-schema combination to that capability and does not blacklist the model', async () => {
    const unsupportedFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Tool use with response schema is not supported for model gemini-3.8-flash.' } }), { status: 400, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(success('gemini-3.7-flash'), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(success('gemini-3.8-flash'), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(success('gemini-3.8-flash'), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', unsupportedFetch);
    const context = applicationGeminiContext();
    const responseSchema = { type: Type.OBJECT, properties: { ok: { type: Type.BOOLEAN } }, required: ['ok'] } as const;
    const functionTools = [{ functionDeclarations: [{ name: 'lookup', description: 'Look up evidence', parameters: { type: Type.OBJECT, properties: {} } }] }];
    const result = await generateTracked(context, {
      model: context.model,
      contents: 'combined capability test',
      config: { maxOutputTokens: 40, tools: functionTools, responseMimeType: 'application/json', responseJsonSchema: responseSchema },
    });
    expect(result.modelVersion).toBe('gemini-3.7-flash-test');

    const toolOnly = applicationGeminiContext();
    expect(toolOnly.model).toBe('gemini-3.8-flash');
    await generateTracked(toolOnly, { model: toolOnly.model, contents: 'tool-only capability test', config: { maxOutputTokens: 40, tools: functionTools } });
    const schemaOnly = applicationGeminiContext();
    expect(schemaOnly.model).toBe('gemini-3.8-flash');
    await generateTracked(schemaOnly, { model: schemaOnly.model, contents: 'schema-only capability test', config: { maxOutputTokens: 40, responseMimeType: 'application/json', responseJsonSchema: responseSchema } });
    expect(unsupportedFetch).toHaveBeenCalledTimes(4);
    expect(String(unsupportedFetch.mock.calls[2][0])).toContain('gemini-3.8-flash');
    expect(String(unsupportedFetch.mock.calls[3][0])).toContain('gemini-3.8-flash');

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
    vi.stubEnv('GEMINI_FREE_ALLOW_ALTERNATIVES','false');
    const context = applicationGeminiContext(true);
    const timeout=vi.spyOn(AbortSignal,'timeout');
    try{
      await generateTracked(context, { model: context.model, contents: 'explicit paid fallback test', config: { maxOutputTokens: 40,abortSignal:AbortSignal.timeout(65_000) } });
      expect(timeout.mock.calls.some(([ms])=>ms===20_000)).toBe(true);
      expect(timeout.mock.calls.some(([ms])=>ms===45_000)).toBe(true);
    }finally{timeout.mockRestore();}
    expect(paidWasCalled.value).toBe(true);
    expect(context.tier).toBe('paid');
  });
});
