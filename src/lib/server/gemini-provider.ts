import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { GoogleGenAI, type Content, type CountTokensParameters, type GenerateContentParameters, type GenerateContentResponse, type Part, type Tool, type ToolListUnion } from '@google/genai';
import { ApiError, readBounded } from './http';
import { recordGeminiDiagnostic } from './gemini-diagnostics';
import { recordGeminiEvaluationEvent } from './gemini-evaluation-recorder';
import { geminiModelChoiceSchema, type GeminiModelChoice } from '../contracts';

export type GeminiTier = 'free' | 'paid';
export type GeminiPurpose = 'application' | 'synthetic-smoke';

export type GeminiContext = {
  tier: GeminiTier;
  model: string;
  purpose: GeminiPurpose;
  client: GoogleGenAI;
  allowPaidFallback?:boolean;
  modelPinned?:boolean;
};

export const FREE_GEMINI_MODEL_PREFERENCE = geminiModelChoiceSchema.options;

type ModelCooldown = { until: number; kind: 'short-quota' | 'daily-quota' | 'model-unavailable' | 'unsupported-feature' | 'service-unavailable'; retryAfterMs: number | null };
type ModelRouteAttempt = { model: string; outcome: 'used' | 'failed' | 'skipped'; reason?: string; failureClass?: string; retryAfterMs?: number | null; cooldownUntil?: number | null };
type GenerateDiagnosticContext = { analysisId?: string; stage?: string; round?: number; profileIncluded?: boolean; deadlineAt?: number };
const cooldownPath = path.join(process.cwd(), '.data', 'gemini-routing-cooldowns.json');
const modelCooldowns = new Map<string, ModelCooldown>();
const capabilityCooldowns = new Map<string, ModelCooldown>();
let cooldownsLoaded = false;

function loadCooldowns() {
  if (cooldownsLoaded || isTestRuntime()) return;
  cooldownsLoaded = true;
  try {
    const raw = readFileSync(cooldownPath, 'utf8');
    if (Buffer.byteLength(raw) > 32_000) return;
    const parsed = JSON.parse(raw) as Record<string, ModelCooldown>;
    for (const [key, state] of Object.entries(parsed)) {
      if (!state || !Number.isFinite(state.until) || state.until <= Date.now()
        || !['short-quota', 'daily-quota', 'model-unavailable', 'unsupported-feature', 'service-unavailable'].includes(state.kind)) continue;
      if (validModel(key)) {
        // Older builds stored unsupported-feature as a model-wide ban. That
        // may have described only one configuration (for example tools plus
        // JSON schema), so never carry that overly broad cooldown forward.
        if (state.kind !== 'unsupported-feature') modelCooldowns.set(key, state);
        continue;
      }
      if (key.startsWith('capability:')) {
        const separator = key.indexOf(':', 'capability:'.length);
        const model = key.slice('capability:'.length, separator);
        const capability = key.slice(separator + 1);
        if (separator > 0 && validModel(model) && /^[a-z0-9+_-]{1,80}$/.test(capability)) capabilityCooldowns.set(key, state);
      }
    }
  } catch { /* A missing or unreadable local cooldown file does not prevent free use. */ }
}

function saveCooldowns() {
  if (isTestRuntime()) return;
  try {
    mkdirSync(path.dirname(cooldownPath), { recursive: true });
    const temporaryPath = `${cooldownPath}.${process.pid}.tmp`;
    const persisted = Object.fromEntries([
      ...modelCooldowns,
      ...capabilityCooldowns,
    ]);
    writeFileSync(temporaryPath, JSON.stringify(persisted), { encoding: 'utf8', mode: 0o600 });
    renameSync(temporaryPath, cooldownPath);
  } catch { /* Routing remains bounded in memory if local persistence is unavailable. */ }
}

export function resetGeminiRoutingForTests() {
  modelCooldowns.clear();
  capabilityCooldowns.clear();
  cooldownsLoaded = true;
}

export function parseGeminiRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value?.trim()) return null;
  const seconds = Number(value.trim());
  const ms = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(ms) && ms >= 0 ? Math.min(24 * 60 * 60 * 1000, ms) : null;
}

function selectableFreeModels() {
  const configured = process.env.GEMINI_FREE_MODEL_ORDER?.split(',').map(value => value.trim()).filter(Boolean);
  if (!configured?.length) return [...FREE_GEMINI_MODEL_PREFERENCE];
  return [...new Set(configured.filter((model): model is GeminiModelChoice => geminiModelChoiceSchema.safeParse(model).success))];
}
function configuredFreeModels() {
  const models=selectableFreeModels();
  // Other model families are an explicit economy/compatibility choice, not a
  // silent quality downgrade before the separately authorized paid fallback.
  return process.env.GEMINI_FREE_ALLOW_ALTERNATIVES==='true'?models:models.slice(0,1);
}

function quotaDetails(body: string) {
  try {
    const parsed = JSON.parse(body) as { error?: { status?: unknown; message?: unknown; details?: unknown } };
    const text = JSON.stringify(parsed.error ?? {}).toLowerCase();
    const daily = /per[_ ]?day|perday|daily.{0,30}quota|quota.{0,30}daily|requests[_ ]per[_ ]day/.test(text);
    return daily ? 'daily-quota' as const : 'short-quota' as const;
  } catch { return 'short-quota' as const; }
}

function containsInlineImage(value: unknown, depth = 0): boolean {
  if (depth > 8 || !value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(item => containsInlineImage(item, depth + 1));
  const record = value as Record<string, unknown>;
  if ('inlineData' in record) return true;
  return Object.values(record).some(item => containsInlineImage(item, depth + 1));
}

function providerCapabilityKey(model: string, params: GenerateContentParameters) {
  const capabilities = [
    ...(params.config?.tools?.length ? ['tools'] : []),
    ...(params.config?.responseJsonSchema || params.config?.responseMimeType ? ['structured-output'] : []),
    ...(containsInlineImage(params.contents) ? ['image-input'] : []),
  ].sort();
  return `capability:${model}:${capabilities.join('+') || 'unspecified'}`;
}

function recordModelCooldown(model: string, kind: ModelCooldown['kind'], retryAfterMs: number | null, params?: GenerateContentParameters) {
  loadCooldowns();
  const defaultDuration = kind === 'daily-quota' ? 24 * 60 * 60 * 1000
    : kind === 'model-unavailable' || kind === 'unsupported-feature' ? 24 * 60 * 60 * 1000
      : kind === 'service-unavailable' ? 5 * 60 * 1000
        : 60_000;
  const duration = retryAfterMs === null ? defaultDuration : Math.max(retryAfterMs, kind === 'service-unavailable' ? 15_000 : 0);
  const cooldown = { until: Date.now() + duration, kind, retryAfterMs } satisfies ModelCooldown;
  if (kind === 'unsupported-feature') capabilityCooldowns.set(providerCapabilityKey(model, params ?? { model, contents: '' }), cooldown);
  else modelCooldowns.set(model, cooldown);
  saveCooldowns();
  return cooldown;
}

function cooldownFor(model: string, params?: GenerateContentParameters) {
  loadCooldowns();
  const state = modelCooldowns.get(model);
  if (state && state.until <= Date.now()) { modelCooldowns.delete(model); saveCooldowns(); return null; }
  if (state) return state;
  if (!params) return null;
  const key = providerCapabilityKey(model, params);
  const capabilityState = capabilityCooldowns.get(key);
  if (capabilityState && capabilityState.until <= Date.now()) { capabilityCooldowns.delete(key); saveCooldowns(); return null; }
  return capabilityState ?? null;
}

/**
 * The Gemini Developer API's countTokens endpoint rejects systemInstruction
 * and tools in config, although generation accepts them. Include their exact
 * serialized declarations as an added text part so preflight counts them too.
 */
export async function buildCountTokensRequest(params: GenerateContentParameters): Promise<CountTokensParameters> {
  const { systemInstruction, tools } = params.config ?? {};
  const countableTools: Tool[] | undefined = tools
    ? await Promise.all((tools as ToolListUnion).map(async (tool) => {
        if ('tool' in tool && typeof tool.tool === 'function') return tool.tool();
        return tool as Tool;
      }))
    : undefined;
  const sourceContents = params.contents;
  const isContent = (value: unknown): value is Content => !!value && typeof value === 'object' && 'parts' in value;
  const contents: Content[] = Array.isArray(sourceContents)
    ? sourceContents.length > 0 && sourceContents.every(isContent)
      ? [...sourceContents]
      : sourceContents.length > 0
        ? [{ role: 'user', parts: sourceContents as Part[] }]
        : []
    : isContent(sourceContents)
      ? [sourceContents]
      : [{ role: 'user', parts: [sourceContents as Part] }];
  const hasConfigOverhead = systemInstruction !== undefined || countableTools !== undefined;
  if (hasConfigOverhead) {
    contents.push({
      role: 'user',
      parts: [{ text: `Serialized system instruction and tool declarations for token preflight: ${JSON.stringify({ systemInstruction, tools: countableTools })}` }],
    });
  }
  return {
    model: params.model,
    contents,
  };
}

type UsageRecord = {
  id: string;
  startedAt: string;
  tier: GeminiTier;
  purpose: GeminiPurpose;
  model: string;
  modelVersion: string | null;
  state: 'reserved' | 'completed' | 'failed';
  reservedUsd: number;
  promptTokens: number | null;
  cachedPromptTokens?: number | null;
  outputTokens: number | null;
  thoughtTokens: number | null;
  toolUsePromptTokens?: number | null;
  initialPromptTokens?: number | null;
  totalTokens: number | null;
  estimatedActualUsd: number | null;
  estimatedActualInr?: number | null;
  fxRateInrPerUsd?: number | null;
  priceInputUsdPerMillion?: number | null;
  priceCachedInputUsdPerMillion?: number | null;
  priceOutputUsdPerMillion?: number | null;
  promptTokensDetails?: unknown;
  cacheTokensDetails?: unknown;
  candidatesTokensDetails?: unknown;
  toolUsePromptTokensDetails?: unknown;
  trafficType?: string | null;
  groundedSearchQueryCount?: number | null;
  estimatedGroundingCostUpperUsd?: number | null;
  elapsedMs: number | null;
  providerHttpStatus?: number | null;
  providerFailureClass?: string | null;
};

type UsageLedger = { version: 1; calls: UsageRecord[] };

/** Release unused per-call reservations once the provider's settled usage is known. */
export function committedPaidSpendUsd(calls: ReadonlyArray<Pick<UsageRecord, 'state' | 'reservedUsd' | 'estimatedActualUsd' | 'estimatedGroundingCostUpperUsd'>>) {
  return calls.reduce((sum, call) => {
    if (call.state !== 'completed' || call.estimatedActualUsd === null) return sum + call.reservedUsd;
    return sum + call.estimatedActualUsd + (call.estimatedGroundingCostUpperUsd ?? 0);
  }, 0);
}

/** Count Search queries from either grounding metadata or echoed server tool-call parts. */
export function countGoogleSearchQueries(response: Pick<GenerateContentResponse, 'candidates'> | undefined) {
  const candidates = response?.candidates ?? [];
  const metadataCount = candidates.flatMap(candidate => candidate.groundingMetadata?.webSearchQueries ?? []).filter(query => query.trim()).length;
  const toolCallCount = candidates.flatMap(candidate => candidate.content?.parts ?? []).reduce((count, part) => {
    if (part.toolCall?.toolType !== 'GOOGLE_SEARCH_WEB') return count;
    const queries = part.toolCall.args?.queries;
    return count + (Array.isArray(queries) ? queries.filter(query => typeof query === 'string' && query.trim()).length : 0);
  }, 0);
  return Math.max(metadataCount, toolCallCount);
}

const ledgerPath = path.join(process.cwd(), '.data', 'gemini-usage.json');
const maxLedgerBytes = 5_000_000;
let ledgerQueue: Promise<void> = Promise.resolve();
let testLedger: UsageLedger = { version: 1, calls: [] };

function isTestRuntime() {
  return process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
}

/** Keeps mocked provider traffic out of the owner's local paid-usage ledger. */
export function resetGeminiUsageLedgerForTests() {
  testLedger = { version: 1, calls: [] };
}

function positiveNumber(name: string): number | null {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function validModel(value: string | undefined): string | null {
  const model = value?.trim() ?? '';
  return /^[A-Za-z0-9._-]{1,100}$/.test(model) ? model : null;
}

function tierFromEnvironment(): GeminiTier | null {
  const tier = process.env.GEMINI_PROVIDER?.trim();
  if (!tier) return 'free';
  return tier === 'free' || tier === 'paid' ? tier : null;
}

function paidAuthorizationReady() {
  const freeProject = process.env.GEMINI_FREE_PROJECT_ID?.trim();
  const paidProject = process.env.GEMINI_PAID_PROJECT_ID?.trim();
  return process.env.ENABLE_PAID_GEMINI === 'true'
    && Boolean(freeProject && paidProject && freeProject !== paidProject)
    && positiveNumber('GEMINI_PAID_BUDGET_USD') !== null
    && positiveNumber('GEMINI_PAID_MAX_CALLS') !== null
    && positiveNumber('GEMINI_PAID_MAX_INPUT_TOKENS') !== null
    && positiveNumber('GEMINI_PAID_MAX_OUTPUT_TOKENS') !== null
    && positiveNumber('GEMINI_PAID_INPUT_USD_PER_MILLION') !== null
    && positiveNumber('GEMINI_PAID_OUTPUT_USD_PER_MILLION') !== null;
}

function selectedKey(tier: GeminiTier | null) {
  return tier === 'free'
    ? process.env.FREE_GEMINI_API_KEY?.trim()
    : tier === 'paid'
      ? process.env.GEMINI_API_KEY?.trim()
      : undefined;
}

function selectedModel(tier: GeminiTier | null) {
  if (tier === 'free') {
    loadCooldowns();
    return configuredFreeModels().find(model => !cooldownFor(model)) ?? configuredFreeModels()[0] ?? null;
  }
  return validModel(process.env.GEMINI_MODEL);
}

function paidFallbackReady() {
  return process.env.ENABLE_PAID_GEMINI_FALLBACK === 'true'
    && paidAuthorizationReady()
    && Boolean(selectedKey('paid'));
}

export function providerStatus() {
  const tier = tierFromEnvironment();
  const model = selectedModel(tier);
  const configured = Boolean(tier && selectedKey(tier) && model);
  // Report the paid configuration independently of the selected provider. A
  // free selection must not make an unverified paid route appear authorized.
  const paidAuthorized = paidAuthorizationReady() && Boolean(selectedKey('paid'));
  const enabled = process.env.ENABLE_GEMINI === 'true' && configured && (tier !== 'paid' || paidAuthorized);
  const message = enabled
    ? `${tier === 'free' ? 'Free-tier' : 'Paid-tier'} Gemini is selected. Each remote request still requires consent.`
    : tier === 'paid' && configured && !paidAuthorized
      ? 'Paid Gemini is blocked: its explicit enablement, separate project identity, positive spend cap, request cap, input/output limits and current price rates are required.'
      : 'Gemini is disabled. Configure a server-side free-tier key and explicitly enable Gemini. No provider calls are made while disabled.';
  const searchEnabled = process.env.ENABLE_GEMINI_SEARCH === 'true';
  const freeProjectId = process.env.GEMINI_FREE_PROJECT_ID?.trim() || null;
  const paidProjectId = process.env.GEMINI_PAID_PROJECT_ID?.trim() || null;
  return {
    provider: 'Gemini', tier, requestedTier: tier, configured, enabled, paidAuthorized, model,
    preferredFreeModels: configuredFreeModels(),
    modelChoices: tier==='free'?selectableFreeModels():(model&&geminiModelChoiceSchema.safeParse(model).success?[model]:[]),
    projectIdentity: tier === 'paid' ? (paidProjectId ? 'declared' : 'unknown') : (freeProjectId ? 'declared' : 'unknown'),
    paidProjectIdentity: paidProjectId ? 'declared' : 'unknown',
    paidFallbackEnabled: paidFallbackReady(),
    paidFallbackModel: process.env.GEMINI_SAME_MODEL_FALLBACK==='true' ? null : (validModel(process.env.GEMINI_PAID_MODEL)??validModel(process.env.GEMINI_MODEL)),
    paidFallbackReason: paidFallbackReady() ? null : 'Paid fallback requires ENABLE_PAID_GEMINI_FALLBACK=true, distinct declared project IDs and the complete paid cap configuration.',
    searchEnabled, searchRequested: searchEnabled, message,
  };
}

function buildClient(apiKey: string, tier: GeminiTier, purpose: GeminiPurpose, model: string) {
  return new GoogleGenAI({ apiKey, httpOptions: {
    timeout: 62_000,
    // Keep SDK retries disabled so each provider HTTP attempt is observable.
    // Free routing can try another eligible model; paid mode must never make
    // an untracked retry that might spend twice.
    retryOptions: { attempts: 1 },
    fetch: async (target, init) => {
      const address = new URL(target instanceof Request ? target.url : String(target));
      if (address.protocol !== 'https:' || address.hostname !== 'generativelanguage.googleapis.com' || address.port || address.username || address.password) {
        throw new ApiError(502, 'provider_destination', 'Provider destination was rejected.');
      }
      const response = await fetch(target, { ...init, redirect: 'error' });
      const body = await readBounded(response.body, 160_000, init?.signal ?? undefined);
      if (response.status === 429) {
        const retryAfterMs = parseGeminiRetryAfter(response.headers.get('retry-after'));
        recordModelCooldown(model, quotaDetails(body), retryAfterMs);
      } else if (response.status === 404) {
        recordModelCooldown(model, 'model-unavailable', null);
      } else if (response.status === 503 || response.status === 504) {
        recordModelCooldown(model, 'service-unavailable', null);
      }
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    },
  } });
}

export function applicationGeminiContext(allowPaidFallback=false,requestedModel?:GeminiModelChoice): GeminiContext {
  const status = providerStatus();
  if (!status.enabled || !status.tier || !status.model) {
    const code = status.tier === 'paid' && !status.paidAuthorized ? 'paid_provider_unauthorized' : 'provider_disabled';
    throw new ApiError(503, code, status.message);
  }
  const apiKey = selectedKey(status.tier);
  if (!apiKey) throw new ApiError(503, 'provider_not_configured', 'The explicitly selected Gemini project has no server-side key.');
  if(requestedModel&&!status.modelChoices.includes(requestedModel))throw new ApiError(400,'model_not_enabled','This model is not enabled by the server configuration.');
  const model=requestedModel??status.model;
  return { tier: status.tier, model, purpose: 'application',allowPaidFallback,modelPinned:Boolean(requestedModel), client: buildClient(apiKey, status.tier, 'application', model) };
}

/** The only smoke-test context is explicitly bound to the free project. */
export function freeTierSyntheticSmokeContext(model: string): GeminiContext {
  if (!validModel(model)) throw new ApiError(400, 'invalid_model', 'Choose a stable Gemini model identifier.');
  const apiKey = process.env.FREE_GEMINI_API_KEY?.trim();
  if (!apiKey) throw new ApiError(503, 'free_provider_not_configured', 'The free-tier Gemini project has no server-side key.');
  return { tier: 'free', model, purpose: 'synthetic-smoke', client: buildClient(apiKey, 'free', 'synthetic-smoke', model) };
}

async function readLedger(): Promise<UsageLedger> {
  if (isTestRuntime()) return testLedger;
  try {
    const contents = await readFile(ledgerPath);
    if (contents.byteLength > maxLedgerBytes) throw new Error('size');
    const parsed = JSON.parse(contents.toString('utf8')) as UsageLedger;
    if (parsed.version !== 1 || !Array.isArray(parsed.calls)) throw new Error('shape');
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, calls: [] };
    throw new ApiError(503, 'usage_ledger_unavailable', 'Local provider usage accounting is unavailable; no request was sent.');
  }
}

async function updateLedger<T>(update: (ledger: UsageLedger) => T | Promise<T>): Promise<T> {
  const prior = ledgerQueue;
  let release!: () => void;
  ledgerQueue = new Promise<void>((resolve) => { release = resolve; });
  await prior;
  try {
    const testRuntime = isTestRuntime();
    const ledger = testRuntime ? testLedger : await readLedger();
    const value = await update(ledger);
    if (testRuntime) {
      testLedger = ledger;
      return value;
    }
    await mkdir(path.dirname(ledgerPath), { recursive: true });
    const temporaryPath = `${ledgerPath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(ledger), { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, ledgerPath);
    return value;
  } finally {
    release();
  }
}

export function modelPrice(tier: GeminiTier) {
  if (tier === 'free') return { input: 0, cachedInput: 0, output: 0 };
  const input = positiveNumber('GEMINI_PAID_INPUT_USD_PER_MILLION');
  const output = positiveNumber('GEMINI_PAID_OUTPUT_USD_PER_MILLION');
  if (input === null || output === null) throw new ApiError(503, 'paid_price_missing', 'Paid Gemini is blocked until current model prices are configured.');
  // If no cache price is configured, assume the full input rate (a safe upper bound).
  const cachedInput = positiveNumber('GEMINI_PAID_CACHED_INPUT_USD_PER_MILLION') ?? input;
  return { input, cachedInput, output };
}

export function estimateGeminiTokenCostUsd(
  usage: { promptTokenCount?: number; cachedContentTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; toolUsePromptTokenCount?: number } | undefined,
  price: { input: number; cachedInput: number; output: number },
) {
  if (usage?.promptTokenCount === undefined || usage.candidatesTokenCount === undefined) return null;
  const prompt = Math.max(0, usage.promptTokenCount);
  const cached = Math.min(prompt, Math.max(0, usage.cachedContentTokenCount ?? 0));
  const inputUsd = (prompt - cached) * price.input + cached * price.cachedInput + Math.max(0, usage.toolUsePromptTokenCount ?? 0) * price.input;
  const outputUsd = (Math.max(0, usage.candidatesTokenCount) + Math.max(0, usage.thoughtsTokenCount ?? 0)) * price.output;
  return (inputUsd + outputUsd) / 1_000_000;
}

async function reserveCall(context: GeminiContext, record: UsageRecord) {
  return updateLedger((ledger) => {
    if (context.purpose === 'synthetic-smoke') {
      const priorSmokeCalls = ledger.calls.filter((call) => call.tier === 'free' && call.purpose === 'synthetic-smoke' && call.model === context.model);
      if (priorSmokeCalls.length >= 2) throw new ApiError(429, 'synthetic_smoke_cap', 'The authorized free-tier synthetic smoke test is capped at two generation requests.');
    }
    if (context.tier === 'paid') {
      const maxCalls = positiveNumber('GEMINI_PAID_MAX_CALLS')!;
      const budget = positiveNumber('GEMINI_PAID_BUDGET_USD')!;
      const paidCalls = ledger.calls.filter((call) => call.tier === 'paid');
      const reserved = committedPaidSpendUsd(paidCalls);
      // Controlled local development is budget-bound, per the owner's authorization.
      // Production retains its independent request-count limit and billing consent.
      if (process.env.NODE_ENV !== 'development' && paidCalls.length >= maxCalls) throw new ApiError(429, 'paid_request_cap', 'The configured paid Gemini request cap has been reached.');
      if (reserved + record.reservedUsd > budget + 1e-12) throw new ApiError(429, 'paid_spend_cap', 'The conservative paid Gemini spend estimate exceeds the configured cap.');
    }
    ledger.calls.push(record);
  });
}

export function safeProviderFailure(error: unknown, attemptSignal?: AbortSignal) {
  const chain: Array<{ name: string; code: string }> = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
    const value = current as { name?: unknown; code?: unknown; cause?: unknown };
    chain.push({
      name: typeof value.name === 'string' ? value.name : '',
      code: typeof value.code === 'string' ? value.code : '',
    });
    current = value.cause;
  }
  const rawStatus = error && typeof error === 'object'
    ? ('status' in error && typeof error.status === 'number' ? error.status
      : 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : null)
    : null;
  const status = rawStatus === null ? null : Math.min(599, Math.max(100, Math.floor(rawStatus)));
  const transportTimedOut = chain.some(item => item.name === 'TimeoutError' || item.code === 'ETIMEDOUT' || item.code === 'UND_ERR_CONNECT_TIMEOUT');
  const failureClass = status === 401 ? 'authentication'
    : status === 403 ? 'access-denied'
      : status === 404 ? 'model-or-endpoint'
        : status === 429 ? 'rate-or-quota'
          : status === 400 || status === 422 ? 'request-rejected'
              : status === 408 || status === 504 || (status === null && (transportTimedOut || attemptSignal?.aborted === true)) ? 'timeout'
              : status !== null && status >= 500 ? 'provider-unavailable'
                : 'transport-or-unknown';
  // The SDK error message contains Google's response body, so classify it
  // locally and retain only safe API status/path metadata. Never persist the
  // raw provider text, which can include request details.
  const message = error instanceof Error ? error.message.slice(0, 16_000) : '';
  const jsonStart = message.indexOf('{');
  let providerStatus: string | null = null;
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(message.slice(jsonStart)) as { error?: { status?: unknown } };
      const candidate = parsed.error?.status;
      if (typeof candidate === 'string' && /^[A-Z_]{3,80}$/.test(candidate)) providerStatus = candidate;
    } catch { /* SDK error text is not guaranteed to contain a JSON body. */ }
  }
  const fieldPath = message.match(/\bat ['"]([A-Za-z0-9_.\[\]-]{1,120})['"]/i)?.[1] ?? null;
  const providerFieldPath = fieldPath && /^(?:contents|generationConfig|tools|toolConfig)(?:\.[A-Za-z0-9_-]+|\[\d+\])*$/.test(fieldPath)
    ? fieldPath
    : null;
  const providerReasonClass = /maximum allowed nesting depth|nesting depth/i.test(message) ? 'schema-nesting-depth'
    : /too many states|too much branching|constraint.*states/i.test(message) ? 'schema-complexity'
      : /response.?json.?schema|response.?schema/i.test(message) ? 'response-schema'
        : /function.?declaration|function.?schema|parameters.?schema|tool.?schema/i.test(message) ? 'function-schema'
          : /inline.?data|mime.?type|image part/i.test(message) ? 'image-parts'
            : /unknown name|unknown field|invalid json payload|invalid value at/i.test(message) ? 'request-field'
              : /thinking.?config|thinking.?level/i.test(message) ? 'thinking-config'
                : status === 400 || status === 422 ? 'unclassified-request-rejection'
                  : null;
  return { status, failureClass, providerStatus, providerReasonClass, providerFieldPath };
}

function requestContentMetadata(contents: unknown) {
  const metadata = { contentPartCount: 0, textPartCount: 0, imageCount: 0, imageBytes: 0, functionResponseCount: 0 };
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string') { metadata.contentPartCount += 1; metadata.textPartCount += 1; }
    if ('functionResponse' in record) { metadata.contentPartCount += 1; metadata.functionResponseCount += 1; }
    if (record.inlineData && typeof record.inlineData === 'object') {
      const inlineData = record.inlineData as Record<string, unknown>;
      const bytes = typeof inlineData.data === 'string' ? Buffer.from(inlineData.data, 'base64').byteLength : 0;
      metadata.contentPartCount += 1;
      metadata.imageCount += 1;
      metadata.imageBytes += bytes;
      return;
    }
    Object.entries(record).forEach(([key, child]) => { if (key !== 'data') visit(child); });
  };
  visit(contents);
  return metadata;
}

function requestToolNames(params: GenerateContentParameters) {
  return (params.config?.tools ?? []).flatMap(tool => {
    const record = tool as unknown as Record<string, unknown>;
    const declarations = record.functionDeclarations;
    if (Array.isArray(declarations)) return declarations.flatMap(declaration => {
      if (!declaration || typeof declaration !== 'object') return [];
      const name = (declaration as Record<string, unknown>).name;
      return typeof name === 'string' ? [name] : [];
    });
    return 'googleSearch' in record ? ['googleSearch'] : [];
  });
}

async function settleCall(id: string, state: 'completed' | 'failed', response: GenerateContentResponse | undefined, elapsedMs: number, context: GeminiContext, failure?: unknown, attemptSignal?: AbortSignal) {
  const price = modelPrice(context.tier);
  const usage = response?.usageMetadata;
  const promptTokens = usage?.promptTokenCount ?? null;
  const cachedPromptTokens = usage?.cachedContentTokenCount ?? null;
  const outputTokens = usage?.candidatesTokenCount ?? null;
  const thoughtTokens = usage?.thoughtsTokenCount ?? null;
  const toolUsePromptTokens = usage?.toolUsePromptTokenCount ?? null;
  const initialPromptTokens = usage?.initialPromptTokenCount ?? null;
  const totalTokens = usage?.totalTokenCount ?? null;
  const estimate = estimateGeminiTokenCostUsd(usage, price);
    const groundedSearchQueryCount = countGoogleSearchQueries(response);
  await updateLedger((ledger) => {
    const record = ledger.calls.find((call) => call.id === id);
    if (!record) throw new ApiError(503, 'usage_ledger_unavailable', 'Provider usage could not be reconciled locally.');
    record.state = state;
    record.promptTokens = promptTokens;
    record.cachedPromptTokens = cachedPromptTokens;
    record.outputTokens = outputTokens;
    record.thoughtTokens = thoughtTokens;
    record.toolUsePromptTokens = toolUsePromptTokens;
    record.initialPromptTokens = initialPromptTokens;
    record.totalTokens = totalTokens;
    record.modelVersion = response?.modelVersion ?? null;
    record.estimatedActualUsd = estimate;
    const fxRateInrPerUsd = positiveNumber('GEMINI_USD_TO_INR_ASSUMPTION');
    record.fxRateInrPerUsd = fxRateInrPerUsd;
    record.estimatedActualInr = estimate !== null && fxRateInrPerUsd !== null ? estimate * fxRateInrPerUsd : null;
    record.priceInputUsdPerMillion = price.input;
    record.priceCachedInputUsdPerMillion = price.cachedInput;
    record.priceOutputUsdPerMillion = price.output;
    record.promptTokensDetails = usage?.promptTokensDetails ?? null;
    record.cacheTokensDetails = usage?.cacheTokensDetails ?? null;
    record.candidatesTokensDetails = usage?.candidatesTokensDetails ?? null;
    record.toolUsePromptTokensDetails = usage?.toolUsePromptTokensDetails ?? null;
    record.trafficType = usage?.trafficType ?? null;
    record.groundedSearchQueryCount = groundedSearchQueryCount;
    // Gross upper bound assumes the project's monthly free search allowance
    // has already been exhausted; actual billing can be lower.
    record.estimatedGroundingCostUpperUsd = groundedSearchQueryCount * 0.014;
    record.elapsedMs = elapsedMs;
    if (state === 'failed') {
      const safeFailure = safeProviderFailure(failure, attemptSignal);
      record.providerHttpStatus = safeFailure.status;
      record.providerFailureClass = safeFailure.failureClass;
    } else {
      record.providerHttpStatus = null;
      record.providerFailureClass = null;
    }
  });
}

async function generateTrackedOnce(context: GeminiContext, params: GenerateContentParameters, diagnosticContext: GenerateDiagnosticContext = {}): Promise<GenerateContentResponse> {
  if (params.model !== context.model) throw new ApiError(400, 'provider_model_mismatch', 'Request model does not match the selected provider configuration.');
  const maxOutputTokens = params.config?.maxOutputTokens ?? 0;
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 12000) throw new ApiError(400, 'output_limit', 'Gemini output must be explicitly bounded to at most 12000 tokens.');
  const serializedBytes = Buffer.byteLength(JSON.stringify(params.contents));
  const containsInlineImage = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(containsInlineImage);
    if (!value || typeof value !== 'object') return false;
    if (Object.prototype.hasOwnProperty.call(value, 'inlineData')) return true;
    return Object.values(value).some(containsInlineImage);
  };
  const maxContentBytes = context.purpose === 'synthetic-smoke' ? 24_000 : containsInlineImage(params.contents) ? 4_500_000 : 300_000;
  if (serializedBytes > maxContentBytes) throw new ApiError(413, 'input_limit', 'Gemini input exceeds its request-size limit.');

  const id = randomUUID();
  const started = Date.now();
  let reservedUsd = 0;
  if (context.tier === 'paid') {
    if (context.purpose !== 'application' || !paidAuthorizationReady()) throw new ApiError(503, 'paid_provider_unauthorized', 'Paid Gemini is blocked until an explicit positive spend cap and limits are configured.');
    const countStarted = Date.now();
    let tokenCount;
    try {
      tokenCount = await context.client.models.countTokens(await buildCountTokensRequest(params));
      const rawCountTokens = tokenCount.totalTokens ?? -1;
      const estimatedPromptTokens = Math.ceil(rawCountTokens * 1.1);
      await recordGeminiDiagnostic({
        event: 'count_tokens', analysisId: diagnosticContext.analysisId ?? id, callId: id, stage: diagnosticContext.stage ?? 'generation', round: diagnosticContext.round ?? null,
        model: context.model, profileIncluded: diagnosticContext.profileIncluded ?? false, elapsedMs: Date.now() - countStarted,
        promptTokens: estimatedPromptTokens, rawCountTokens,
        estimateMethod: 'counted-content-plus-serialized-system-and-tools-with-10-percent-margin',
      });
      tokenCount = { ...tokenCount, totalTokens: estimatedPromptTokens };
    } catch (error) {
      const safeFailure = safeProviderFailure(error);
      await recordGeminiDiagnostic({ event: 'count_tokens_failed', analysisId: diagnosticContext.analysisId ?? id, callId: id, stage: diagnosticContext.stage ?? 'generation', round: diagnosticContext.round ?? null, model: context.model, profileIncluded: diagnosticContext.profileIncluded ?? false, elapsedMs: Date.now() - countStarted, failure: safeFailure });
      throw error;
    }
    const promptTokens = tokenCount.totalTokens;
    const maxInputTokens = positiveNumber('GEMINI_PAID_MAX_INPUT_TOKENS')!;
    if (!Number.isInteger(promptTokens) || promptTokens! < 0 || promptTokens! > maxInputTokens) throw new ApiError(413, 'paid_input_cap', 'The estimated paid input exceeds its configured token limit.');
    if (maxOutputTokens > positiveNumber('GEMINI_PAID_MAX_OUTPUT_TOKENS')!) throw new ApiError(413, 'paid_output_cap', 'The requested paid output exceeds its configured token limit.');
    const price = modelPrice(context.tier);
    const tokenReservation = ((promptTokens! * price.input) + (maxOutputTokens * price.output)) / 1_000_000;
    const searchToolOffered = params.config?.tools?.some(tool => 'googleSearch' in tool) ?? false;
    // Reserve for up to five search queries per generation at Google's
    // published $14/1,000 over-quota rate. This is a conservative upper bound.
    reservedUsd = tokenReservation + (searchToolOffered ? 5 * 0.014 : 0);
  }

  const record: UsageRecord = {
    id,
    startedAt: new Date().toISOString(),
    tier: context.tier,
    purpose: context.purpose,
    model: context.model,
    modelVersion: null,
    state: 'reserved',
    reservedUsd,
    promptTokens: null,
    outputTokens: null,
    thoughtTokens: null,
    totalTokens: null,
    estimatedActualUsd: null,
    elapsedMs: null,
  };
  await reserveCall(context, record);
  await recordGeminiDiagnostic({
    event: 'provider_request', analysisId: diagnosticContext.analysisId ?? id, callId: id, stage: diagnosticContext.stage ?? 'generation', round: diagnosticContext.round ?? null,
    tier: context.tier, purpose: context.purpose, model: context.model, profileIncluded: diagnosticContext.profileIncluded ?? false,
    requestMetadata: {
      ...requestContentMetadata(params.contents), maxOutputTokens, responseMimeType: params.config?.responseMimeType ?? null,
      responseSchemaPresent: Boolean(params.config?.responseJsonSchema),
      responseSchemaMode: params.config?.responseJsonSchema ? 'structured-schema' : params.config?.responseMimeType === 'application/json' ? 'json-mode-client-validated' : 'unconstrained',
      toolNames: requestToolNames(params),
      googleSearchOffered: params.config?.tools?.some(tool => 'googleSearch' in tool) ?? false,
    },
  });
  await recordGeminiEvaluationEvent(diagnosticContext.analysisId ?? id, {
    event: 'provider_request', callId: id, stage: diagnosticContext.stage ?? 'generation', round: diagnosticContext.round ?? null,
    model: context.model, tier: context.tier, purpose: context.purpose,
    request: { model: params.model, contents: params.contents, config: params.config },
  });
  try {
    const response = await context.client.models.generateContent(params);
    await settleCall(id, 'completed', response, Date.now() - started, context);
    const headers = response.sdkHttpResponse?.headers ?? {};
    const safeHeader = (name: string) => Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1] ?? null;
    const responseUsage = response.usageMetadata;
    const responsePrices = modelPrice(context.tier);
    const estimatedTokenUsd = estimateGeminiTokenCostUsd(responseUsage, responsePrices);
    const groundingQueryCount = countGoogleSearchQueries(response);
    const estimatedGroundingUpperUsd = groundingQueryCount * 0.014;
    const fxRateInrPerUsd = positiveNumber('GEMINI_USD_TO_INR_ASSUMPTION');
    const estimatedTotalUsd = estimatedTokenUsd === null ? null : estimatedTokenUsd + estimatedGroundingUpperUsd;
    await recordGeminiDiagnostic({
      event: 'provider_response', analysisId: diagnosticContext.analysisId ?? id, callId: id, stage: diagnosticContext.stage ?? 'generation', round: diagnosticContext.round ?? null,
      tier: context.tier, purpose: context.purpose, model: context.model, profileIncluded: diagnosticContext.profileIncluded ?? false, elapsedMs: Date.now() - started,
      responseMetadata: {
        responseId: response.responseId, createTime: response.createTime, modelVersion: response.modelVersion, modelStatus: response.modelStatus,
        promptBlockReason: response.promptFeedback?.blockReason ?? null,
        candidateCount: response.candidates?.length ?? 0,
        finishReasons: (response.candidates ?? []).map(candidate => candidate.finishReason ?? null),
        functionCallNames: (response.functionCalls ?? []).flatMap(call => typeof call.name === 'string' ? [call.name] : []),
        usageMetadata: response.usageMetadata,
        costEstimate: {
          estimatedTokenUsd, groundingQueryCount, estimatedGroundingUpperUsd, estimatedTotalUsd,
          fxRateInrPerUsd, estimatedTotalInr: estimatedTotalUsd !== null && fxRateInrPerUsd !== null ? estimatedTotalUsd * fxRateInrPerUsd : null,
          basis: 'Token usage × configured Google list rates; search assumes every query is beyond the monthly free allowance. Not a Google billing receipt.',
          pricesUsdPerMillion: responsePrices,
        },
        http: { status: response.sdkHttpResponse?.responseInternal?.status, requestId: safeHeader('x-goog-request-id') ?? safeHeader('x-request-id'), date: safeHeader('date'), contentType: safeHeader('content-type') },
      },
    });
    await recordGeminiEvaluationEvent(diagnosticContext.analysisId ?? id, {
      event: 'provider_response', callId: id, stage: diagnosticContext.stage ?? 'generation', round: diagnosticContext.round ?? null,
      model: context.model, tier: context.tier, purpose: context.purpose, elapsedMs: Date.now() - started,
      modelVersion: response.modelVersion ?? null, modelStatus: response.modelStatus ?? null,
      finishReasons: (response.candidates ?? []).map(candidate => candidate.finishReason ?? 'unspecified'),
      functionCallNames: (response.functionCalls ?? []).flatMap(call => typeof call.name === 'string' ? [call.name] : []),
      usageMetadata: response.usageMetadata,
      costEstimate: {
        estimatedTokenUsd, groundingQueryCount, estimatedGroundingUpperUsd, estimatedTotalUsd,
        fxRateInrPerUsd, estimatedTotalInr: estimatedTotalUsd !== null && fxRateInrPerUsd !== null ? estimatedTotalUsd * fxRateInrPerUsd : null,
      },
      http: {
        status: response.sdkHttpResponse?.responseInternal?.status ?? null,
        requestId: safeHeader('x-goog-request-id') ?? safeHeader('x-request-id'),
        date: safeHeader('date'),
      },
    });
    return response;
  } catch (error) {
    // Keep the full reservation on failure; ambiguous network failures may have reached the provider.
    const attemptSignal = params.config?.abortSignal;
    await settleCall(id, 'failed', undefined, Date.now() - started, context, error, attemptSignal);
    const failure = safeProviderFailure(error, attemptSignal);
    await recordGeminiDiagnostic({ event: 'provider_error', analysisId: diagnosticContext.analysisId ?? id, callId: id, stage: diagnosticContext.stage ?? 'generation', round: diagnosticContext.round ?? null, tier: context.tier, purpose: context.purpose, model: context.model, profileIncluded: diagnosticContext.profileIncluded ?? false, elapsedMs: Date.now() - started, failure });
    await recordGeminiEvaluationEvent(diagnosticContext.analysisId ?? id, { event: 'provider_error', callId: id, stage: diagnosticContext.stage ?? 'generation', round: diagnosticContext.round ?? null, model: context.model, tier: context.tier, purpose: context.purpose, elapsedMs: Date.now() - started, failure });
    throw error;
  }
}

function unsupportedModelFeature(error: unknown) {
  const safe = safeProviderFailure(error);
  if (safe.status !== 400 && safe.status !== 422) return false;
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return /(?:model|this endpoint|function calling|tool use|response schema|json schema).{0,100}(?:does not support|is not supported|unsupported)/.test(message)
    || /(?:not supported|unsupported).{0,100}(?:model|function calling|tool use|response schema|json schema)/.test(message);
}

function fallbackCategory(error: unknown, signal?: AbortSignal, deadlineAt?: number, parentSignal?: AbortSignal): ModelCooldown['kind'] | null {
  const safe = safeProviderFailure(error, signal);
  if (safe.status === 429) {
    const message = error instanceof Error ? error.message : '';
    return quotaDetails(message).startsWith('daily') ? 'daily-quota' : 'short-quota';
  }
  if (safe.status === 404) return 'model-unavailable';
  const hasAgentTime = !parentSignal?.aborted && (deadlineAt === undefined || deadlineAt > Date.now());
  if ((safe.status === 503 || safe.status === 504 || safe.failureClass === 'timeout') && hasAgentTime) return 'service-unavailable';
  const errorMessage = error instanceof Error ? error.message : '';
  if (safe.status === null && /(?:request|operation|provider) (?:timed? ?out|timeout)|deadline exceeded/i.test(errorMessage) && hasAgentTime) return 'service-unavailable';
  if (unsupportedModelFeature(error)) return 'unsupported-feature';
  return null;
}

function errorRetryAfterMs(error: unknown) {
  if (!error || typeof error !== 'object') return null;
  const headers = 'headers' in error ? (error as { headers?: Headers }).headers : undefined;
  return headers instanceof Headers ? parseGeminiRetryAfter(headers.get('retry-after')) : null;
}

function wait(milliseconds: number) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Math.min(1_500, milliseconds))));
}

/**
 * The production path tries free models in the configured preference order.
 * It retries one sub-1.5s transient Retry-After once, then moves on; daily
 * quotas and unsupported/unavailable models are persisted as cooldowns.
 */
export async function generateTracked(context: GeminiContext, params: GenerateContentParameters, diagnosticContext: GenerateDiagnosticContext = {}): Promise<GenerateContentResponse> {
  const requestedTier = context.tier;
  const attempts: ModelRouteAttempt[] = [];
  const requestedModel = context.model;
  const sameModelOnly=process.env.GEMINI_SAME_MODEL_FALLBACK==='true';
  const models = requestedTier === 'free' && context.purpose === 'application'
    ? (context.modelPinned||sameModelOnly)?[context.model]:configuredFreeModels()
    : [context.model];
  const paidBackupModel=sameModelOnly?validModel(requestedModel):(validModel(process.env.GEMINI_PAID_MODEL)??validModel(process.env.GEMINI_MODEL));
  const paidBackupEligible=requestedTier==='free'&&context.purpose==='application'&&context.allowPaidFallback===true&&paidFallbackReady()
    &&Boolean(paidBackupModel&&(!context.modelPinned||context.model===paidBackupModel));
  let lastRetryableError: unknown = null;
  const parentSignal = params.config?.abortSignal;

  for (const model of models) {
    const cooldown = requestedTier === 'free' ? cooldownFor(model, params) : null;
    if (cooldown) {
      attempts.push({ model, outcome: 'skipped', reason: cooldown.kind, retryAfterMs: cooldown.retryAfterMs, cooldownUntil: cooldown.until });
      continue;
    }
    const apiKey = requestedTier === 'free' ? selectedKey('free') : selectedKey('paid');
    if (!apiKey) throw new ApiError(503, requestedTier === 'free' ? 'free_provider_not_configured' : 'paid_provider_unauthorized', 'The selected Gemini project has no configured server-side key.');
    const modelContext: GeminiContext = model === context.model && requestedTier === context.tier
      ? context
      : { tier: requestedTier, model, purpose: context.purpose, client: buildClient(apiKey, requestedTier, context.purpose, model) };
    let routeAttemptSignal: AbortSignal | undefined;
    const invoke = () => {
      const remaining = diagnosticContext.deadlineAt === undefined ? null : diagnosticContext.deadlineAt - Date.now();
      if (remaining !== null && remaining <= 0) throw new ApiError(504, 'agent_timeout', 'Gemini analysis reached its bounded time limit. Your scan and local analysis remain available.');
      // Bound each route attempt separately. The caller's stage signal still
      // caps the complete operation, but a slow model must not consume the
      // entire stage timeout and prevent the next eligible route from running.
      // A single free-only route needs the full generation window. Reserve
      // time when another free route or an authorized paid backup is eligible.
      const routeLimit = requestedTier === 'paid' || (models.length === 1&&!paidBackupEligible) ? 60_000 : 20_000;
      const timeout = remaining === null ? routeLimit : Math.max(1, Math.min(routeLimit, remaining));
      const ownTimeoutSignal = AbortSignal.timeout(timeout);
      const attemptSignal = parentSignal ? AbortSignal.any([parentSignal, ownTimeoutSignal]) : ownTimeoutSignal;
      routeAttemptSignal = attemptSignal;
      const routeParams = {
        ...params,
        model,
        ...(params.config ? { config: { ...params.config, ...(attemptSignal ? { abortSignal: attemptSignal } : {}) } } : {}),
      };
      return generateTrackedOnce(modelContext, routeParams, diagnosticContext);
    };
    try {
      const response = await invoke();
      attempts.push({ model, outcome: 'used' });
      context.tier = modelContext.tier;
      context.model = modelContext.model;
      context.client = modelContext.client;
      const route = { requestedTier, actualTier: modelContext.tier, requestedModel, actualModel: model, fallback: model !== requestedModel || modelContext.tier !== requestedTier, completedWithRequiredCapabilities: true, attempts };
      await recordGeminiDiagnostic({ event: 'provider_route', analysisId: diagnosticContext.analysisId, requestedTier, actualTier: modelContext.tier, requestedModel, actualModel: model, fallback: route.fallback, completedWithRequiredCapabilities: true, attempts });
      await recordGeminiEvaluationEvent(diagnosticContext.analysisId ?? '', { event: 'provider_route', ...route });
      return response;
    } catch (error) {
      const category = fallbackCategory(error, routeAttemptSignal, diagnosticContext.deadlineAt, parentSignal);
      if (requestedTier !== 'free' || context.purpose !== 'application' || !category) {
        const failure = safeProviderFailure(error, routeAttemptSignal);
        attempts.push({ model, outcome: 'failed', reason: category ?? failure.failureClass, failureClass: failure.failureClass });
        const route = { requestedTier, actualTier: null, requestedModel, actualModel: null, fallback: attempts.length > 1, completedWithRequiredCapabilities: false, attempts };
        await recordGeminiDiagnostic({ event: 'provider_route', analysisId: diagnosticContext.analysisId, ...route });
        await recordGeminiEvaluationEvent(diagnosticContext.analysisId ?? '', { event: 'provider_route', ...route });
        throw error;
      }
      const retryAfterMs = errorRetryAfterMs(error) ?? cooldownFor(model)?.retryAfterMs ?? null;
      const cooldownState = recordModelCooldown(model, category, retryAfterMs, params);
      const failure = safeProviderFailure(error, routeAttemptSignal);
      attempts.push({ model, outcome: 'failed', reason: category, failureClass: failure.failureClass, retryAfterMs, cooldownUntil: cooldownState.until });
      lastRetryableError = error;

      // Respect a very short provider Retry-After once without sleeping through
      // longer windows; longer limits route directly to the next free model.
      if (category === 'short-quota' && retryAfterMs !== null && retryAfterMs <= 1_500) {
        await wait(retryAfterMs);
        try {
          const response = await invoke();
          attempts[attempts.length - 1] = { model, outcome: 'used' };
          modelCooldowns.delete(model);
          context.tier = modelContext.tier;
          context.model = modelContext.model;
          context.client = modelContext.client;
          const route = { requestedTier, actualTier: modelContext.tier, requestedModel, actualModel: model, fallback: model !== requestedModel, completedWithRequiredCapabilities: true, attempts };
          await recordGeminiDiagnostic({ event: 'provider_route', analysisId: diagnosticContext.analysisId, ...route });
          await recordGeminiEvaluationEvent(diagnosticContext.analysisId ?? '', { event: 'provider_route', ...route });
          return response;
        } catch (retryError) {
          const retryCategory = fallbackCategory(retryError, routeAttemptSignal, diagnosticContext.deadlineAt, parentSignal);
          if (!retryCategory) throw retryError;
          const retryWait = errorRetryAfterMs(retryError) ?? null;
          const retryCooldown = recordModelCooldown(model, retryCategory, retryWait, params);
          const retryFailure = safeProviderFailure(retryError, routeAttemptSignal);
          attempts[attempts.length - 1] = { model, outcome: 'failed', reason: retryCategory, failureClass: retryFailure.failureClass, retryAfterMs: retryWait, cooldownUntil: retryCooldown.until };
          lastRetryableError = retryError;
        }
      }
    }
  }

  if (paidBackupEligible && !parentSignal?.aborted) {
    const paidModel = paidBackupModel;
    const paidKey = selectedKey('paid');
    if (paidModel && paidKey && (!context.modelPinned||context.model===paidModel)) {
      const paidContext: GeminiContext = { tier: 'paid', model: paidModel, purpose: 'application', client: buildClient(paidKey, 'paid', 'application', paidModel) };
      const remaining = diagnosticContext.deadlineAt === undefined ? null : diagnosticContext.deadlineAt - Date.now();
      if (remaining !== null && remaining <= 0) {
        attempts.push({ model: paidModel, outcome: 'skipped', reason: 'agent-deadline' });
      } else {
        const timeout = remaining === null ? 45_000 : Math.max(1, Math.min(45_000, remaining));
        const paidTimeoutSignal = AbortSignal.timeout(timeout);
        const paidAttemptSignal = parentSignal ? AbortSignal.any([parentSignal, paidTimeoutSignal]) : paidTimeoutSignal;
        const paidParams = {
          ...params,
          model: paidModel,
          ...(params.config ? { config: { ...params.config, abortSignal: paidAttemptSignal } } : {}),
        };
        try {
          const response = await generateTrackedOnce(paidContext, paidParams, diagnosticContext);
          attempts.push({ model: paidModel, outcome: 'used', reason: 'explicitly-enabled-paid-last-resort' });
          context.tier = 'paid'; context.model = paidModel; context.client = paidContext.client;
          const route = { requestedTier, actualTier: 'paid' as const, requestedModel, actualModel: paidModel, fallback: true, completedWithRequiredCapabilities: true, attempts };
          await recordGeminiDiagnostic({ event: 'provider_route', analysisId: diagnosticContext.analysisId, ...route });
          await recordGeminiEvaluationEvent(diagnosticContext.analysisId ?? '', { event: 'provider_route', ...route });
          return response;
        } catch (error) {
          attempts.push({ model: paidModel, outcome: 'failed', reason: 'paid-last-resort-failed' });
          await recordGeminiDiagnostic({ event: 'provider_route', analysisId: diagnosticContext.analysisId, requestedTier, actualTier: 'paid', requestedModel, actualModel: null, fallback: true, completedWithRequiredCapabilities: false, attempts });
          await recordGeminiEvaluationEvent(diagnosticContext.analysisId ?? '', { event: 'provider_route', requestedTier, actualTier: 'paid', requestedModel, actualModel: null, fallback: true, completedWithRequiredCapabilities: false, attempts });
          throw error;
        }
      }
    }
  }

  await recordGeminiDiagnostic({ event: 'provider_route', analysisId: diagnosticContext.analysisId, requestedTier, actualTier: null, requestedModel, actualModel: null, fallback: attempts.length > 1, completedWithRequiredCapabilities: false, attempts });
  await recordGeminiEvaluationEvent(diagnosticContext.analysisId ?? '', { event: 'provider_route', requestedTier, actualTier: null, requestedModel, actualModel: null, fallback: attempts.length > 1, completedWithRequiredCapabilities: false, attempts });
  if (requestedTier === 'free' && attempts.length > 0) throw new ApiError(503, 'free_models_exhausted', 'Free Gemini is temporarily unavailable across the configured models. Your scan and conversation are saved; try again later.');
  throw lastRetryableError ?? new ApiError(503, 'provider_disabled', 'Gemini could not complete this request.');
}

export async function recordModelAvailabilityCheck(context: GeminiContext, available: boolean) {
  const record: UsageRecord = {
    id: randomUUID(),
    startedAt: new Date().toISOString(),
    tier: context.tier,
    purpose: context.purpose,
    model: `${context.model}:availability-check:${available ? 'available' : 'unavailable'}`,
    modelVersion: null,
    state: 'completed',
    reservedUsd: 0,
    promptTokens: null,
    outputTokens: null,
    thoughtTokens: null,
    totalTokens: null,
    estimatedActualUsd: 0,
    elapsedMs: null,
  };
  await updateLedger((ledger) => { ledger.calls.push(record); });
}
