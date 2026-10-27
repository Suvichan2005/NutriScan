import { appendFile, chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFile = promisify(execFileCallback);
const evaluationRoot = path.resolve(process.cwd(), '.data', 'gemini-evaluations');
const maxEventBytes = 2_000_000;
const maxRunBytes = 24_000_000;
const activeRuns = new Map<string, { directory: string }>();
const writeQueues = new Map<string, Promise<void>>();

export function geminiEvaluationCaptureEnabled(environment: NodeJS.ProcessEnv = process.env) {
  // Local metadata capture is an explicit development opt-in. Production,
  // hosted preview, CI and unit-test processes never enable this recorder.
  return environment.NUTRISCAN_GEMINI_EVAL_CAPTURE === '1'
    && environment.NODE_ENV === 'development'
    && !environment.VERCEL
    && !environment.CI;
}

const privateContentKeys = new Set([
  'question', 'prompt', 'contents', 'text', 'answer', 'answerparts', 'response', 'request', 'claims', 'claim', 'args', 'arguments', 'query', 'result', 'output',
  'summary', 'quote', 'supportingspans', 'uncertainty', 'interpretation', 'goal', 'condition', 'jurisdiction', 'profile', 'conversationcontext', 'history', 'context',
  'rawtext', 'observations', 'visualimages', 'images', 'image', 'imageid', 'base64', 'data', 'ingredients', 'allergens', 'warnings', 'nutritionrows', 'evidence', 'citationevidence',
]);

const metadataStringKeys = new Set([
  'recordedat', 'event', 'analysisid', 'callid', 'stage', 'taskkind', 'model', 'modelversion', 'modelstatus', 'actualtier', 'requestedtier',
  'requestedmodel', 'status', 'reason', 'failureclass', 'providerstatus', 'providerreasonclass', 'code', 'category', 'name', 'finishreason', 'requestid', 'date',
  'capturemode', 'contentpolicy', 'outcome', 'tier', 'purpose', 'mode', 'role',
]);
const metadataStructuredKeys = new Set(['usagemetadata', 'costestimate', 'failure', 'attempts', 'decisions', 'http']);
const metadataStringArrayKeys = new Set(['toolnames', 'functioncallnames', 'finishreasons']);
const metadataNumberKeys = new Set([
  'round', 'index', 'elapsedms', 'latencyms', 'prompttokencount', 'candidatestokencount', 'totaltokencount', 'thoughtstokencount', 'cachedcontenttokencount',
  'groundingquerycount', 'estimatedgroundingupperusd', 'estimatedtotalusd', 'fxrateinrperusd', 'estimatedtotalinr', 'estimatedtokenusd', 'schemabytes', 'status',
  'resultcount', 'toolcallcount', 'sourcecount', 'calculationcount', 'imagecount', 'observationcount', 'answercharacters', 'questioncharacters',
  'retryafterms', 'cooldownuntil', 'acceptedsentences', 'withheldquantitysentences', 'withheldsourcescopesentences', 'statuscode', 'httpstatus',
]);

/** Retain an explicit operational-metadata allowlist; unknown fields are treated as content. */
export function sanitizeGeminiEvaluationValue(value: unknown, key = '', parent: Record<string, unknown> | null = null): unknown {
  if (/^(?:apiKey|authorization|accessToken|refreshToken|clientSecret|privateKey)$/i.test(key)) return '[redacted credential]';
  if (privateContentKeys.has(key.toLowerCase().replace(/[^a-z0-9]/g, ''))) return '[omitted private content]';
  if (key === 'thoughtSignature') return undefined;
  if (parent?.thought === true) return undefined;
  if (typeof value === 'string') {
    return metadataStringKeys.has(key.toLowerCase().replace(/[^a-z0-9]/g, ''))
      ? (value.length > 500 ? `${value.slice(0, 500)}[truncated]` : value)
      : '[omitted non-metadata string]';
  }
  if (Array.isArray(value)) {
    if (metadataStringArrayKeys.has(key.toLowerCase().replace(/[^a-z0-9]/g, ''))) return value.slice(0, 100).map(item => typeof item === 'string' ? item.slice(0, 120) : undefined).filter(item => item !== undefined);
    if (key.toLowerCase() !== 'attempts') return '[omitted non-metadata array]';
    return value.slice(0, 100).map(item => sanitizeGeminiEvaluationValue(item)).filter(item => item !== undefined);
  }
  if (!value || typeof value !== 'object') {
    if (typeof value === 'number') return metadataNumberKeys.has(key.toLowerCase().replace(/[^a-z0-9]/g, '')) ? value : undefined;
    if (typeof value === 'boolean') return /^(?:fallback|completedwithrequiredcapabilities|questionpresent|requestreceived|enabled)$/i.test(key) ? value : undefined;
    return value;
  }
  if (!metadataStructuredKeys.has(key.toLowerCase().replace(/[^a-z0-9]/g, '')) && key !== '') return '[omitted non-metadata object]';
  const record = value as Record<string, unknown>;
  if (record.thought === true) return undefined;
  const result: Record<string, unknown> = {};
  for (const [childKey, child] of Object.entries(record).slice(0, 500)) {
    const sanitized = sanitizeGeminiEvaluationValue(child, childKey, record);
    if (sanitized !== undefined) result[childKey] = sanitized;
  }
  return result;
}

async function secureEvaluationDirectory(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') {
    const account = process.env.USERDOMAIN && process.env.USERNAME
      ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}`
      : process.env.USERNAME;
    if (!account) throw new Error('Cannot determine the local Windows account for transcript ACLs.');
    await execFile('icacls', [directory, '/inheritance:r', '/grant:r', `${account}:(OI)(CI)F`], { windowsHide: true });
  } else {
    await chmod(directory, 0o700);
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function startGeminiEvaluation(analysisId: string, input: {
  model: string;
  taskKind: 'package-reconstruction' | 'follow-up' | 'other';
}) {
  if (!geminiEvaluationCaptureEnabled() || !isUuid(analysisId)) return false;
  const directory = path.join(evaluationRoot, analysisId);
  try {
    await secureEvaluationDirectory(directory);
    const manifest = {
      format: 'nutriscan-gemini-evaluation', version: 1, analysisId,
      createdAt: new Date().toISOString(), model: input.model, taskKind: input.taskKind,
      captureMode: 'local-opt-in-metadata-only',
      contentPolicy: 'Only allowlisted operational metadata is recorded; prompts, package/profile data, images, tool arguments/results, and answers are omitted.',
    };
    await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await writeFile(path.join(directory, 'events.jsonl'), '', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    const run = { directory };
    activeRuns.set(analysisId, run);
    await recordGeminiEvaluationEvent(analysisId, {
      event: 'application_input', requestReceived: true,
      note: 'Validated application input received; private content is not stored.',
    });
    return true;
  } catch {
    activeRuns.delete(analysisId);
    return false;
  }
}

export async function recordGeminiEvaluationEvent(analysisId: string, event: Record<string, unknown>) {
  const run = activeRuns.get(analysisId);
  if (!run) return;
  const previous = writeQueues.get(analysisId) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>(resolve => { release = resolve; });
  writeQueues.set(analysisId, next);
  await previous;
  try {
    const safe = sanitizeGeminiEvaluationValue({ recordedAt: new Date().toISOString(), ...event }) as Record<string, unknown>;
    const current = await stat(path.join(run.directory, 'events.jsonl')).catch(() => null);
    if (current && current.size >= maxRunBytes) return;
    let line = JSON.stringify(safe) + '\n';
    if (Buffer.byteLength(line) > maxEventBytes) line = JSON.stringify({ recordedAt: new Date().toISOString(), event: event.event ?? 'evaluation_event', content: '[event exceeded local transcript size limit]', originalBytes: Buffer.byteLength(JSON.stringify(safe)) }) + '\n';
    if (current && current.size + Buffer.byteLength(line) > maxRunBytes) return;
    await appendFile(path.join(run.directory, 'events.jsonl'), line, { encoding: 'utf8', mode: 0o600 });
    if (process.platform !== 'win32') await chmod(path.join(run.directory, 'events.jsonl'), 0o600).catch(() => undefined);
  } catch {
    // Evaluation capture is best-effort and never changes provider or product behavior.
  } finally {
    release();
  }
}

export async function finishGeminiEvaluation(analysisId: string, status: 'completed' | 'failed') {
  const run = activeRuns.get(analysisId);
  if (!run) return;
  await recordGeminiEvaluationEvent(analysisId, { event: 'analysis_finished', status });
  activeRuns.delete(analysisId);
  await writeQueues.get(analysisId)?.catch(() => undefined);
  writeQueues.delete(analysisId);
}

export async function readGeminiEvaluation(analysisId: string) {
  if (!isUuid(analysisId)) throw new Error('Invalid Gemini analysis identifier.');
  const directory = path.join(evaluationRoot, analysisId);
  const [manifestText, eventsText] = await Promise.all([
    readFile(path.join(directory, 'manifest.json'), 'utf8'),
    readFile(path.join(directory, 'events.jsonl'), 'utf8'),
  ]);
  const manifest: unknown = JSON.parse(manifestText);
  if (!manifest || typeof manifest !== 'object' || (manifest as { analysisId?: string }).analysisId !== analysisId) throw new Error('Gemini evaluation manifest does not match its directory.');
  const events = eventsText.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as unknown);
  return { manifest, events };
}

export const geminiEvaluationPaths = { root: evaluationRoot };
