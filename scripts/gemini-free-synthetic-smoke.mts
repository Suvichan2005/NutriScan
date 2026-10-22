import { createRequire } from 'node:module';
import { ThinkingLevel } from '@google/genai';
import sharp from 'sharp';
import { z } from 'zod';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { freeTierSyntheticSmokeContext, generateTracked, recordModelAvailabilityCheck } from '../src/lib/server/gemini-provider';

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require('@next/env') as typeof import('@next/env');
loadEnvConfig(process.cwd());

const expectedConfirmation = '--confirm-two-free-synthetic-calls';
if (process.argv.filter((arg) => arg === expectedConfirmation).length !== 1 || process.argv.length !== 3) {
  console.error(`Run only with ${expectedConfirmation}; the script is capped at one text and one synthetic-image generation call.`);
  process.exit(2);
}

const model = 'gemini-3.8-flash';
const outputPath = path.resolve('docs/evidence/gemini-3.8-flash-free-synthetic-smoke.json');
// This script reads only FREE_GEMINI_API_KEY. It never accesses GEMINI_API_KEY.
const context = freeTierSyntheticSmokeContext(model);
function safeProviderFailure(error: unknown) {
  if (!error || typeof error !== 'object') return 'provider_request_failed';
  const record = error as { code?: unknown; status?: unknown; statusCode?: unknown };
  if (typeof record.code === 'string' && /^[a-z0-9_-]{1,64}$/i.test(record.code)) return record.code;
  const status = typeof record.status === 'number' ? record.status : record.statusCode;
  return typeof status === 'number' && Number.isInteger(status) ? `http_${status}` : 'provider_request_failed';
}

let listedModel: Awaited<ReturnType<typeof context.client.models.list>>['page'][number] | undefined;
try {
  // The SDK returns a Pager; inspect its first page and never paginate or retry this availability probe.
  const models = await context.client.models.list({ config: { pageSize: 100, abortSignal: AbortSignal.timeout(12_000) } });
  listedModel = models.page.find((candidate) => candidate.name === `models/${model}` || candidate.baseModelId === model);
} catch (error) {
  console.error(JSON.stringify({ status: 'blocked', model, generationRequests: 0, reason: safeProviderFailure(error), retries: 0 }));
  process.exit(1);
}
const supportsGenerateContent = (listedModel?.supportedActions ?? []).includes('generateContent');
await recordModelAvailabilityCheck(context, Boolean(listedModel && supportsGenerateContent));
if (!listedModel || !supportsGenerateContent) {
  console.error(JSON.stringify({ status: 'blocked', model, availableToFreeProject: false, reason: 'The selected free-project key did not list this model with generateContent support. No generation request was sent.' }));
  process.exit(1);
}

const reference = {
  productName: 'Toasted Millet Crackers',
  serving: { value: 30, unit: 'g', basis: 'per serving' },
  nutrients: [
    { name: 'energy', value: 120, unit: 'kcal', basis: 'per 30 g' },
    { name: 'protein', value: 3, unit: 'g', basis: 'per 30 g' },
    { name: 'sodium', value: 180, unit: 'mg', basis: 'per 30 g' },
  ],
  ingredients: ['rice flour', 'millet flour', 'sunflower oil', 'iodized salt'],
  allergens: ['sesame'],
};

const candidateSchema = z.object({
  productName: z.object({ value: z.string().nullable(), status: z.enum(['accepted', 'tentative', 'withheld']), evidence: z.string().nullable() }).strict(),
  serving: z.object({ value: z.number().nullable(), unit: z.string().nullable(), basis: z.string().nullable(), status: z.enum(['accepted', 'tentative', 'withheld']), evidence: z.string().nullable() }).strict(),
  nutrients: z.array(z.object({ name: z.string(), value: z.number().nullable(), unit: z.string().nullable(), basis: z.string().nullable(), status: z.enum(['accepted', 'tentative', 'withheld']), evidence: z.array(z.string()).max(4) }).strict()).max(12),
  ingredients: z.object({ items: z.array(z.string()).max(20), status: z.enum(['accepted', 'tentative', 'withheld']), evidence: z.string().nullable() }).strict(),
  allergens: z.object({ items: z.array(z.string()).max(12), status: z.enum(['accepted', 'tentative', 'withheld']), evidence: z.string().nullable() }).strict(),
}).strict();
const responseJsonSchema = z.toJSONSchema(candidateSchema);

const syntheticLabelText = [
  'DEMO FOODS',
  'TOASTED MILLET CRACKERS',
  'NUTRITION INFORMATION',
  'Serving size: 30 g',
  'Per 30 g serving',
  'Energy 120 kcal',
  'Protein 3 g',
  'Sodium 180 mg',
  'INGREDIENTS: Rice flour, millet flour, sunflower oil, iodized salt.',
  'CONTAINS: SESAME.',
].join('\n');
const textPrompt = `[NUTRISCAN FREE-TIER SYNTHETIC SMOKE TEST — NO REAL PRODUCT DATA]\nExtract only explicit observations from this synthetic OCR transcript. Preserve exact values, units, bases, ingredient order and allergen wording. Use tentative or withheld where text does not support a field. Evidence must be verbatim from the input. Do not make health claims.\n\n${syntheticLabelText}`;
const visionPrompt = '[NUTRISCAN FREE-TIER SYNTHETIC SMOKE TEST — NO REAL PRODUCT DATA]\nRead only what is visible in this synthetic label image. Do not use OCR text or infer missing values. Preserve exact value, unit, basis, ingredient order and allergen wording. Evidence must be verbatim from the image. Do not make health claims.';

function makeSyntheticLabelImage() {
  const rows = ['DEMO FOODS', 'TOASTED MILLET CRACKERS', 'NUTRITION INFORMATION', 'Serving size: 30 g', 'Per 30 g serving', 'Energy 120 kcal', 'Protein 3 g', 'Sodium 180 mg', 'INGREDIENTS: Rice flour, millet flour, sunflower oil, iodized salt.', 'CONTAINS: SESAME.'];
  const body = rows.map((row, index) => `<text x="64" y="${90 + index * 68}" font-family="Arial, sans-serif" font-size="${index < 3 ? 36 : 30}" font-weight="${index < 3 ? 700 : 400}" fill="#111">${row.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="820"><rect width="100%" height="100%" fill="#fff"/>${body}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

const schemaPrompt = 'Return JSON matching the supplied schema. Model-assigned status is only a candidate label and is not independent verification.';
let failedAttemptElapsedMs: number | null = null;
async function runArm(arm: 'text-only' | 'vision-only', contents: Parameters<typeof context.client.models.generateContent>[0]['contents']) {
  const started = Date.now();
  let response: Awaited<ReturnType<typeof context.client.models.generateContent>>;
  try {
    response = await generateTracked(context, {
      model,
      contents,
      config: {
        systemInstruction: schemaPrompt,
        responseMimeType: 'application/json',
        responseJsonSchema,
        maxOutputTokens: 500,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        automaticContinuation: false,
        abortSignal: AbortSignal.timeout(20_000),
      },
    });
  } catch (error) {
    failedAttemptElapsedMs = Date.now() - started;
    throw error;
  }
  if (response.candidates?.[0]?.finishReason !== 'STOP' || !response.text || response.text.length > 10_000) throw new Error('bounded_response_incomplete');
  const parsed = candidateSchema.safeParse(JSON.parse(response.text));
  if (!parsed.success) throw new Error('structured_output_invalid');
  return { arm, elapsedMs: Date.now() - started, modelVersion: response.modelVersion ?? null, usage: { promptTokens: response.usageMetadata?.promptTokenCount ?? null, outputTokens: response.usageMetadata?.candidatesTokenCount ?? null, thoughtTokens: response.usageMetadata?.thoughtsTokenCount ?? null, totalTokens: response.usageMetadata?.totalTokenCount ?? null }, output: parsed.data };
}

const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function score(result: z.infer<typeof candidateSchema>) {
  const nutrients = reference.nutrients.map((expected) => {
    const found = result.nutrients.find((item) => normalized(item.name) === expected.name);
    if (!found) return { name: expected.name, outcome: 'omitted' };
    if (found.status !== 'accepted' || found.value === null || !found.unit || !found.basis) return { name: expected.name, outcome: 'withheld' };
    const exact = found.value === expected.value && normalized(found.unit) === expected.unit && normalized(found.basis) === normalized(expected.basis);
    return { name: expected.name, outcome: exact ? 'correct' : 'incorrect' };
  });
  const extraAccepted = result.nutrients.filter((item) => item.status === 'accepted' && !reference.nutrients.some((expected) => normalized(item.name) === expected.name)).length;
  const servingExact = result.serving.status === 'accepted' && result.serving.value === reference.serving.value && normalized(result.serving.unit ?? '') === reference.serving.unit && normalized(result.serving.basis ?? '') === normalized(reference.serving.basis);
  const identityExact = result.productName.status === 'accepted' && result.productName.value === reference.productName;
  const ingredientsExact = result.ingredients.status === 'accepted' && JSON.stringify(result.ingredients.items.map(normalized)) === JSON.stringify(reference.ingredients.map(normalized));
  const allergensExact = result.allergens.status === 'accepted' && JSON.stringify(result.allergens.items.map(normalized)) === JSON.stringify(reference.allergens.map(normalized));
  const counts = { correctAccepted: nutrients.filter((item) => item.outcome === 'correct').length, incorrectAccepted: nutrients.filter((item) => item.outcome === 'incorrect').length + extraAccepted, omitted: nutrients.filter((item) => item.outcome === 'omitted').length, withheld: nutrients.filter((item) => item.outcome === 'withheld').length };
  return { nutrition: { ...counts, unusable: counts.omitted + counts.withheld, usable: counts.correctAccepted, expected: reference.nutrients.length }, productIdentity: { correct: identityExact, status: result.productName.status }, serving: { correct: servingExact, status: result.serving.status }, ingredients: { exactOrderedList: ingredientsExact, status: result.ingredients.status }, allergens: { exact: allergensExact, status: result.allergens.status } };
}

const image = await makeSyntheticLabelImage();
const outputs: Awaited<ReturnType<typeof runArm>>[] = [];
try {
  outputs.push(await runArm('text-only', [{ role: 'user', parts: [{ text: textPrompt }] }]));
  outputs.push(await runArm('vision-only', [{ role: 'user', parts: [{ text: visionPrompt }, { inlineData: { mimeType: 'image/png', data: image.toString('base64') } }] }]));
} catch (error) {
  const failedArm = outputs.length === 0 ? 'text-only' : 'vision-only';
  const failureReceipt = {
    schemaVersion: 1,
    kind: 'gemini-free-synthetic-extraction-smoke',
    date: new Date().toISOString().slice(0, 10),
    model,
    tier: 'free',
    selectedProviderKey: 'FREE_GEMINI_API_KEY',
    paidKeySelectedOrTransmitted: false,
    modelAvailability: { listed: Boolean(listedModel), supportsGenerateContent, stableModelId: model, version: listedModel?.version ?? null },
    calls: outputs.map((item) => ({ arm: item.arm, status: 'completed' as const, elapsedMs: item.elapsedMs, modelVersion: item.modelVersion, usage: item.usage, score: score(item.output), output: item.output })),
    failedAttempt: { arm: failedArm, status: 'http-error' as const, reason: safeProviderFailure(error), elapsedMs: failedAttemptElapsedMs, modelVersion: null, usage: { promptTokens: null, outputTokens: null, thoughtTokens: null, totalTokens: null }, retryCount: 0 },
    budget: { modelListRequests: 1, generationRequestsAttempted: outputs.length + 1, generationRequestsCompleted: outputs.length, maxGenerationRequests: 2, retries: 0, maxOutputTokensPerGeneration: 500, providerEstimatedCostUsd: 0, pricingBasis: 'Google Gemini API free-tier pricing lists this model as no-charge; API response usage was unavailable for the failed attempt.' },
    privacy: { realPackageImages: 0, userProfiles: 0, personalConversations: 0, paidProviderCalls: 0 },
    limitations: ['Synthetic fixture only; this is not packaged-food accuracy evidence.', 'Model availability was confirmed by the free-project model list, but the first generation request returned an HTTP error; no model output or token usage was available.', 'No retry, second generation request or paid fallback was made. The vision-only arm was not run.', 'Free-tier prompts may be used to improve Google products; only synthetic text was sent.'],
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(failureReceipt, null, 2)}\n`, 'utf8');
  console.error(JSON.stringify({ status: 'failed', model, completedGenerationRequests: outputs.length, maxGenerationRequests: 2, retries: 0, paidFallback: false, reason: safeProviderFailure(error) }));
  process.exit(1);
}

const receipt = {
  schemaVersion: 1,
  kind: 'gemini-free-synthetic-extraction-smoke',
  date: '2026-10-22',
  model,
  tier: 'free',
  selectedProviderKey: 'FREE_GEMINI_API_KEY',
  paidKeyReadOrUsed: false,
  modelAvailability: { listed: Boolean(listedModel), supportsGenerateContent, stableModelId: model, version: listedModel?.version ?? null },
  calls: outputs.map((item) => ({ arm: item.arm, elapsedMs: item.elapsedMs, modelVersion: item.modelVersion, usage: item.usage, score: score(item.output), output: item.output })),
  reference,
  fixture: { type: 'synthetic SVG-rendered food label and synthetic OCR transcript', imageSha256: createHash('sha256').update(image).digest('hex'), textOnlyArmReceivedImage: false, visionOnlyArmReceivedOcrTranscript: false },
  budget: { modelListRequests: 1, generationRequests: outputs.length, maxGenerationRequests: 2, retries: 0, maxOutputTokensPerGeneration: 500, providerEstimatedCostUsd: 0, pricingBasis: 'Google Gemini API free-tier pricing says no charge for gemini-3.8-flash; per-project active RPM/TPM/RPD quotas remain account-specific.' },
  privacy: { realPackageImages: 0, userProfiles: 0, personalConversations: 0, paidProviderCalls: 0 },
  modelSelection: { reason: 'Gemini 3.8 Flash is the current stable general-purpose model available for this free-tier synthetic smoke. Google now lists Gemini 4 Argon as its newest, most capable stable reasoning model, but it is not available on the Free tier and paid spend remains unauthorized; evaluate it only after explicit paid authorization.', gemini4ArgonTested: false },
  limitations: ['Synthetic fixture checks wiring and structured extraction behavior only; it is not packaged-food accuracy evidence.', 'Model-reported candidate status is not verification; field outcomes are scored against the synthetic fixture reference.', 'Free-tier Google documentation says prompts and responses may be used to improve Google products. Only synthetic content was sent.', 'The selected model was checked against the free project model list, but its project-specific live quotas must still be viewed in AI Studio.'],
};
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ status: 'completed', receipt: outputPath, model, calls: outputs.map((item) => ({ arm: item.arm, score: score(item.output) })) }, null, 2));
