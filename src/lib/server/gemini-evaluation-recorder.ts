import { createHash } from 'node:crypto';
import { appendFile, chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFile = promisify(execFileCallback);
const evaluationRoot = path.resolve(process.cwd(), '.data', 'gemini-evaluations');
const maxEventBytes = 2_000_000;
const maxRunBytes = 24_000_000;
const activeRuns = new Map<string, { directory: string; profileIncluded: boolean; allowProfileContent: boolean }>();
const writeQueues = new Map<string, Promise<void>>();

type EvaluationPrivacy = { profileIncluded?: boolean; allowProfileContent?: boolean };

export function geminiEvaluationCaptureEnabled(environment: NodeJS.ProcessEnv = process.env) {
  // Readable traces are an explicit local development opt-in. Production,
  // hosted preview, CI and unit-test processes never enable this recorder.
  return environment.NUTRISCAN_GEMINI_EVAL_CAPTURE === '1'
    && environment.NODE_ENV === 'development'
    && !environment.VERCEL
    && !environment.CI;
}

function imageDigest(value: string) {
  const bytes = Buffer.from(value, 'base64');
  return { byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'), bytesOmitted: true };
}

const profileDerivedContentKeys = new Set([
  'question', 'prompt', 'contents', 'text', 'answer', 'answerParts', 'claims', 'claim', 'args', 'arguments', 'query', 'result', 'output',
  'summary', 'quote', 'supportingSpans', 'uncertainty', 'interpretation', 'goal', 'condition', 'jurisdiction', 'profile',
]);

/** Remove photo bytes, credentials and non-user-facing model thought parts from a local evaluation artifact. */
export function sanitizeGeminiEvaluationValue(value: unknown, key = '', parent: Record<string, unknown> | null = null, privacy: EvaluationPrivacy = {}): unknown {
  const allowProfileContent = privacy.allowProfileContent === true;
  const profileIncluded = privacy.profileIncluded === true;
  if (/^(?:apiKey|authorization|accessToken|refreshToken|clientSecret|privateKey)$/i.test(key)) return '[redacted credential]';
  if (key === 'thoughtSignature') return undefined;
  if (parent?.thought === true) return undefined;
  if (profileIncluded && !allowProfileContent && profileDerivedContentKeys.has(key)) return '[omitted because profile context was present]';
  if (key === 'profile' && !allowProfileContent && value && typeof value === 'object' && !Array.isArray(value)) {
    return { fieldNames: Object.keys(value as Record<string, unknown>).sort(), valuesOmitted: true };
  }
  if ((key === 'base64' || key === 'data') && typeof value === 'string' && (key === 'base64' || parent?.mimeType)) return imageDigest(value);
  if (typeof value === 'string') {
    // Gemini's application payload is serialized JSON in a text part. Parse it
    // so profile values can be removed without losing the rest of the prompt.
    if ((key === 'text' || key === 'contents' || key === 'prompt') && value.length < maxEventBytes) {
      try {
        const parsed: unknown = JSON.parse(value);
        return JSON.stringify(sanitizeGeminiEvaluationValue(parsed, '', null, privacy), null, 2);
      } catch { /* Preserve ordinary natural-language prompt text. */ }
    }
    return value.length > 200_000 ? `${value.slice(0, 200_000)}\n[truncated at 200000 characters]` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 2_000).map(item => sanitizeGeminiEvaluationValue(item, '', null, privacy)).filter(item => item !== undefined);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  if (record.thought === true) return undefined;
  const result: Record<string, unknown> = {};
  for (const [childKey, child] of Object.entries(record).slice(0, 500)) {
    const sanitized = sanitizeGeminiEvaluationValue(child, childKey, record, privacy);
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
  question: string;
  profileIncluded: boolean;
  request: unknown;
}) {
  if (!geminiEvaluationCaptureEnabled() || !isUuid(analysisId)) return false;
  const allowProfileContent = input.profileIncluded && process.env.NUTRISCAN_GEMINI_EVAL_ALLOW_SYNTHETIC_PROFILE === '1';
  const directory = path.join(evaluationRoot, analysisId);
  try {
    await secureEvaluationDirectory(directory);
    const manifest = {
      format: 'nutriscan-gemini-evaluation', version: 1, analysisId,
      createdAt: new Date().toISOString(), model: input.model, taskKind: input.taskKind,
      captureMode: 'local-opt-in', profileContent: input.profileIncluded ? (allowProfileContent ? 'explicit-synthetic-profile-opt-in' : 'omitted') : 'not-present',
      imagePolicy: 'inline image bytes replaced with SHA-256 and byte length; hidden thought parts omitted',
    };
    await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await writeFile(path.join(directory, 'events.jsonl'), '', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    const run = { directory, profileIncluded: input.profileIncluded, allowProfileContent };
    activeRuns.set(analysisId, run);
    await recordGeminiEvaluationEvent(analysisId, {
      event: 'application_input', question: input.question, request: input.request,
      note: 'Validated local application request; visual payloads are represented by hashes, never stored as image bytes.',
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
    const safe = sanitizeGeminiEvaluationValue({ recordedAt: new Date().toISOString(), ...event }, '', null, run) as Record<string, unknown>;
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
