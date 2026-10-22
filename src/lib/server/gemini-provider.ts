import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { GoogleGenAI, type GenerateContentParameters, type GenerateContentResponse } from '@google/genai';
import { ApiError, readBounded } from './http';

export type GeminiTier = 'free' | 'paid';
export type GeminiPurpose = 'application' | 'synthetic-smoke';

export type GeminiContext = {
  tier: GeminiTier;
  model: string;
  purpose: GeminiPurpose;
  client: GoogleGenAI;
};

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
  outputTokens: number | null;
  thoughtTokens: number | null;
  totalTokens: number | null;
  estimatedActualUsd: number | null;
  elapsedMs: number | null;
};

type UsageLedger = { version: 1; calls: UsageRecord[] };

const ledgerPath = path.join(process.cwd(), '.data', 'gemini-usage.json');
const maxLedgerBytes = 5_000_000;
let ledgerQueue: Promise<void> = Promise.resolve();

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
  return tier === 'free' || tier === 'paid' ? tier : null;
}

function paidAuthorizationReady() {
  return process.env.ENABLE_PAID_GEMINI === 'true'
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

export function providerStatus() {
  const tier = tierFromEnvironment();
  const model = validModel(process.env.GEMINI_MODEL);
  const configured = Boolean(tier && selectedKey(tier) && model);
  const paidAuthorized = tier !== 'paid' || paidAuthorizationReady();
  const enabled = process.env.ENABLE_GEMINI === 'true' && configured && paidAuthorized;
  const message = enabled
    ? `${tier === 'free' ? 'Free-tier' : 'Paid-tier'} Gemini is explicitly selected. Each remote request still requires consent.`
    : tier === 'paid' && configured && !paidAuthorized
      ? 'Paid Gemini is blocked: explicit enablement, a positive spend cap, a request cap, input/output limits and current price rates are all required.'
      : 'Gemini is disabled. Select a server-side provider and stable model, then explicitly enable the chosen tier. No provider calls are made while disabled.';
  return { provider: 'Gemini', tier, configured, enabled, paidAuthorized, model, searchEnabled: false, searchRequested: process.env.ENABLE_GEMINI_SEARCH === 'true', message };
}

function buildClient(apiKey: string, tier: GeminiTier, purpose: GeminiPurpose) {
  return new GoogleGenAI({ apiKey, httpOptions: {
    timeout: 62_000,
    // A free-tier application request may survive one temporary service-capacity
    // failure. Keep paid calls single-attempt because a retry could consume the
    // reserved spend twice, and keep smoke measurements reproducible.
    retryOptions: tier === 'free' && purpose === 'application'
      ? { attempts: 2, initialDelay: 1, maxDelay: 2, expBase: 2, jitter: 1, httpStatusCodes: [503] }
      : { attempts: 1 },
    fetch: async (target, init) => {
      const address = new URL(target instanceof Request ? target.url : String(target));
      if (address.protocol !== 'https:' || address.hostname !== 'generativelanguage.googleapis.com' || address.port || address.username || address.password) {
        throw new ApiError(502, 'provider_destination', 'Provider destination was rejected.');
      }
      const response = await fetch(target, { ...init, redirect: 'error' });
      const body = await readBounded(response.body, 160_000, init?.signal ?? undefined);
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    },
  } });
}

export function applicationGeminiContext(): GeminiContext {
  const status = providerStatus();
  if (!status.enabled || !status.tier || !status.model) {
    const code = status.tier === 'paid' && !status.paidAuthorized ? 'paid_provider_unauthorized' : 'provider_disabled';
    throw new ApiError(503, code, status.message);
  }
  const apiKey = selectedKey(status.tier);
  if (!apiKey) throw new ApiError(503, 'provider_not_configured', 'The explicitly selected Gemini project has no server-side key.');
  return { tier: status.tier, model: status.model, purpose: 'application', client: buildClient(apiKey, status.tier, 'application') };
}

/** The only smoke-test context is explicitly bound to the free project. */
export function freeTierSyntheticSmokeContext(model: string): GeminiContext {
  if (!validModel(model)) throw new ApiError(400, 'invalid_model', 'Choose a stable Gemini model identifier.');
  const apiKey = process.env.FREE_GEMINI_API_KEY?.trim();
  if (!apiKey) throw new ApiError(503, 'free_provider_not_configured', 'The free-tier Gemini project has no server-side key.');
  return { tier: 'free', model, purpose: 'synthetic-smoke', client: buildClient(apiKey, 'free', 'synthetic-smoke') };
}

async function readLedger(): Promise<UsageLedger> {
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
    const ledger = await readLedger();
    const value = await update(ledger);
    await mkdir(path.dirname(ledgerPath), { recursive: true });
    const temporaryPath = `${ledgerPath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(ledger), { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, ledgerPath);
    return value;
  } finally {
    release();
  }
}

function modelPrice(tier: GeminiTier) {
  if (tier === 'free') return { input: 0, output: 0 };
  const input = positiveNumber('GEMINI_PAID_INPUT_USD_PER_MILLION');
  const output = positiveNumber('GEMINI_PAID_OUTPUT_USD_PER_MILLION');
  if (input === null || output === null) throw new ApiError(503, 'paid_price_missing', 'Paid Gemini is blocked until current model prices are configured.');
  return { input, output };
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
      const reserved = paidCalls.reduce((sum, call) => sum + call.reservedUsd, 0);
      if (paidCalls.length >= maxCalls) throw new ApiError(429, 'paid_request_cap', 'The configured paid Gemini request cap has been reached.');
      if (reserved + record.reservedUsd > budget + 1e-12) throw new ApiError(429, 'paid_spend_cap', 'The conservative paid Gemini spend estimate exceeds the configured cap.');
    }
    ledger.calls.push(record);
  });
}

async function settleCall(id: string, state: 'completed' | 'failed', response: GenerateContentResponse | undefined, elapsedMs: number, context: GeminiContext) {
  const price = modelPrice(context.tier);
  const usage = response?.usageMetadata;
  const promptTokens = usage?.promptTokenCount ?? null;
  const outputTokens = usage?.candidatesTokenCount ?? null;
  const thoughtTokens = usage?.thoughtsTokenCount ?? null;
  const totalTokens = usage?.totalTokenCount ?? null;
  const billableOutput = (outputTokens ?? 0) + (thoughtTokens ?? 0);
  const estimate = promptTokens === null || outputTokens === null
    ? null
    : ((promptTokens * price.input) + (billableOutput * price.output)) / 1_000_000;
  await updateLedger((ledger) => {
    const record = ledger.calls.find((call) => call.id === id);
    if (!record) throw new ApiError(503, 'usage_ledger_unavailable', 'Provider usage could not be reconciled locally.');
    record.state = state;
    record.promptTokens = promptTokens;
    record.outputTokens = outputTokens;
    record.thoughtTokens = thoughtTokens;
    record.totalTokens = totalTokens;
    record.modelVersion = response?.modelVersion ?? null;
    record.estimatedActualUsd = estimate;
    record.elapsedMs = elapsedMs;
  });
}

export async function generateTracked(context: GeminiContext, params: GenerateContentParameters): Promise<GenerateContentResponse> {
  if (params.model !== context.model) throw new ApiError(400, 'provider_model_mismatch', 'Request model does not match the selected provider configuration.');
  const maxOutputTokens = params.config?.maxOutputTokens ?? 0;
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 4000) throw new ApiError(400, 'output_limit', 'Gemini output must be explicitly bounded to at most 4000 tokens.');
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
    const tokenCount = await context.client.models.countTokens({ model: context.model, contents: params.contents });
    const promptTokens = tokenCount.totalTokens;
    const maxInputTokens = positiveNumber('GEMINI_PAID_MAX_INPUT_TOKENS')!;
    if (!Number.isInteger(promptTokens) || promptTokens! < 0 || promptTokens! > maxInputTokens) throw new ApiError(413, 'paid_input_cap', 'The estimated paid input exceeds its configured token limit.');
    if (maxOutputTokens > positiveNumber('GEMINI_PAID_MAX_OUTPUT_TOKENS')!) throw new ApiError(413, 'paid_output_cap', 'The requested paid output exceeds its configured token limit.');
    const price = modelPrice(context.tier);
    reservedUsd = ((promptTokens! * price.input) + (maxOutputTokens * price.output)) / 1_000_000;
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
  try {
    const response = await context.client.models.generateContent(params);
    await settleCall(id, 'completed', response, Date.now() - started, context);
    return response;
  } catch (error) {
    // Keep the full reservation on failure; ambiguous network failures may have reached the provider.
    await settleCall(id, 'failed', undefined, Date.now() - started, context);
    throw error;
  }
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
