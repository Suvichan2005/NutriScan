import { createHash } from 'node:crypto';
import { appendFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

const tracePath = path.join(process.cwd(), '.data', 'gemini-diagnostics.jsonl');
const maxTraceBytes = 32_000_000;
const maxEventBytes = 1_500_000;
let writeQueue = Promise.resolve();

/** Detailed provider traces are an explicit local-development opt-in and never run on hosted deployments. */
export function geminiDiagnosticsEnabled() {
  return process.env.NUTRISCAN_GEMINI_TRACE === '1'
    && process.env.NUTRISCAN_LOCAL_DEV_ONLY === '1'
    && process.env.VERCEL !== '1'
    && process.env.CI !== 'true'
    && process.env.NODE_ENV !== 'test';
}

function hashBytes(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

function sensitiveKey(key: string) {
  return /^(?:profile|profileFieldIds|conversationContext|healthContext|healthConsiderations|allergies|intolerances|ageGroup|sexOrReferenceGroup|locality|apiKey|authorization|accessToken|refreshToken|input|request|response|output|result|args|question|prompt|contents|content|parts|text|answer|answerParts|claim|claims|decisions|observations|package|images|visualImages|evidence|calculations|sources|summary|limitations|excerpt|quote|supportingSpans|visibleText|query|condition|goal|jurisdiction|rawText|rawValueText|productDescription|userDescription|searchTerms|candidate|candidates|ingredients|nutrients|nutrient|amount|unit|basis|value|description|uncertainty|interpretation|identity|allergens|additives|barcode|sourceImage|sourceObservationIds)$/i.test(key);
}

const safeMetadataStringKeys = new Set([
  'recordedAt', 'event', 'analysisId', 'callId', 'stage', 'model', 'modelVersion', 'tier', 'purpose', 'status',
  'code', 'category', 'failureCode', 'failureClass', 'schemaMode', 'modelOutputStatus', 'answerStatus', 'taskKind',
  'providerStatus', 'providerReasonClass', 'providerFieldPath', 'responseSchemaMode',
  'responseMimeType', 'promptBlockReason', 'modality', 'trafficType', 'mimeType', 'requestId', 'date',
  'contentType', 'name', 'toolCallId', 'providerFailureClass', 'responseId', 'createTime',
  'requestedTier', 'actualTier', 'requestedModel', 'actualModel', 'reason', 'outcome', 'retryAfterMs', 'cooldownUntil', 'fallback', 'completedWithRequiredCapabilities', 'regionSelection',
]);

const safeMetadataStringArrays = new Set(['toolNames', 'finishReasons', 'functionCallNames', 'uiComponentTypes', 'argumentFieldNames', 'reasonCodes', 'resultFieldNames', 'schemaIssuePaths', 'schemaIssueCodes']);
const safeCoverageFacets = new Set(['nutrition', 'ingredients', 'serving', 'nutrition-claim', 'local-guidance']);

function redactImage(value: Record<string, unknown>) {
  const data = typeof value.data === 'string' ? value.data : '';
  const bytes = Buffer.from(data, 'base64');
  return {
    mimeType: typeof value.mimeType === 'string' ? value.mimeType : 'unknown',
    byteLength: bytes.byteLength,
    sha256: data ? hashBytes(bytes) : null,
    imageBytesOmitted: true,
  };
}

/** Keep operational metadata while omitting request bodies and model conversations. */
export function sanitizeGeminiDiagnosticValue(value: unknown, key = '', parent: Record<string, unknown> | null = null, profileIncluded = false): unknown {
  const hasProfileContext = profileIncluded || parent?.profileIncluded === true;
  if (sensitiveKey(key)) {
    if (key === 'conversationContext' && Array.isArray(value)) return `[redacted ${value.length} prior turns]`;
    return '[omitted content]';
  }
  if (parent && Array.isArray(parent.profileFieldIds) && parent.profileFieldIds.length > 0 && ['text', 'answer', 'supportingSpans'].includes(key)) return '[omitted profile-dependent content]';
  if (hasProfileContext && (key === 'priorOutput' || key === 'normalizedOutput' || key === 'claims' || key === 'answerParts' || key === 'candidates' || key === 'result' || key === 'args')) return '[omitted profile-dependent content]';
  if (key === 'thoughtSignature') return '[opaque provider signature omitted]';
  if (key === 'base64' && typeof value === 'string') {
    const bytes = Buffer.from(value, 'base64');
    return { byteLength: bytes.byteLength, sha256: hashBytes(bytes), imageBytesOmitted: true };
  }
  if (typeof value === 'string') return safeMetadataStringKeys.has(key) ? value.slice(0, 160) : '[omitted content]';
  if (Array.isArray(value) && ['missingFacets', 'afterMissingFacets'].includes(key)) return value.slice(0, 12).map(item => typeof item === 'string' && safeCoverageFacets.has(item) ? item : '[omitted content]');
  if (Array.isArray(value)) return value.slice(0, 600).map(item => typeof item === 'string' && safeMetadataStringArrays.has(key)
    ? item.slice(0, 160)
    : sanitizeGeminiDiagnosticValue(item, '', null, hasProfileContext));
  if (!value || typeof value !== 'object') return value;

  const record = value as Record<string, unknown>;
  if (key === 'inlineData' && typeof record.data === 'string') return redactImage(record);
  const result: Record<string, unknown> = {};
  for (const [childKey, child] of Object.entries(record).slice(0, 160)) {
    if (childKey === 'thoughtSignature') {
      result[childKey] = '[opaque provider signature omitted]';
      continue;
    }
    result[childKey] = sanitizeGeminiDiagnosticValue(child, childKey, record, hasProfileContext);
  }
  return result;
}

/** Appends private local diagnostics. Logging failure must never alter product behavior. */
export async function recordGeminiDiagnostic(event: Record<string, unknown>) {
  if (!geminiDiagnosticsEnabled()) return;
  const prior = writeQueue;
  let release!: () => void;
  writeQueue = new Promise<void>(resolve => { release = resolve; });
  await prior;
  try {
    const safeEvent = sanitizeGeminiDiagnosticValue({ recordedAt: new Date().toISOString(), ...event });
    let line = JSON.stringify(safeEvent) + '\n';
    if (Buffer.byteLength(line) > maxEventBytes) {
      line = JSON.stringify({ recordedAt: new Date().toISOString(), event: 'diagnostic_truncated', reason: 'event_exceeded_size_limit', originalEvent: event.event, analysisId: event.analysisId, callId: event.callId }) + '\n';
    }
    await mkdir(path.dirname(tracePath), { recursive: true });
    const current = await stat(tracePath).catch(() => null);
    if (current && current.size + Buffer.byteLength(line) > maxTraceBytes) return;
    await appendFile(tracePath, line, { encoding: 'utf8', mode: 0o600 });
  } catch {
    // Diagnostics are deliberately best-effort. Never turn observability into an API outage.
  } finally {
    release();
  }
}
