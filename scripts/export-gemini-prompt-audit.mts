import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';
import {
  assistInput,
  assistPromptPayload,
  getAgentSystemInstruction,
  getAgentToolDeclarations,
  getPackageReconstructionSystemInstruction,
  packageReconstructionPromptPayload,
} from '../src/lib/server/gemini';

const root = process.cwd();
const outputPath = resolve(root, '.data/gemini-prompt-audit/current.json');
const runId = `prompt-audit-${new Date().toISOString().replace(/[:.]/g, '-')}`;
let previousPrompt: { head: string | null; generatedAt: string | null; systemInstruction: string; reconstructionSystemInstruction?: string } | null = null;
try {
  const previous = JSON.parse(await readFile(outputPath, 'utf8')) as {
    repository?: { head?: unknown };
    generatedAt?: unknown;
    systemInstruction?: unknown;
    reconstruction?: { systemInstruction?: unknown };
  };
  if (typeof previous.systemInstruction === 'string') {
    previousPrompt = {
      head: typeof previous.repository?.head === 'string' ? previous.repository.head : null,
      generatedAt: typeof previous.generatedAt === 'string' ? previous.generatedAt : null,
      systemInstruction: previous.systemInstruction,
      ...(typeof previous.reconstruction?.systemInstruction === 'string' ? { reconstructionSystemInstruction: previous.reconstruction.systemInstruction } : {}),
    };
  }
} catch {
  // The first audit has no earlier prompt snapshot to compare.
}
const imageId = 'audit-photo-1';
const observationId = 'audit-ocr-1';
const observation = {
  id: observationId,
  field: 'ocr-line',
  text: 'SERVING SIZE 2 BISCUITS (APPROX. 13.4 g) · CARBOHYDRATE 69.29 g PER 100 g',
  side: 'back' as const,
  confidence: 90,
  origin: 'ocr' as const,
  imageId,
  readingOrder: { runId: 'audit-ocr-run', blockIndex: 0, paragraphIndex: 0, lineIndex: 0 },
  bbox: { x0: 20, y0: 30, x1: 780, y1: 68 },
};
const packageData = {
  id: 'audit-package',
  name: 'Unidentified package',
  ingredients: [],
  additives: [],
  allergens: [],
  claims: [],
  nutrients: [],
  observations: [observation],
  ocrCaptures: [{
    runId: 'audit-ocr-run',
    imageId,
    side: 'back' as const,
    sourceImage: { width: 900, height: 363 },
    preparedImage: { width: 900, height: 363 },
    bboxCoordinateSpace: 'prepared-image-pixels' as const,
    engine: { name: 'audit-fixture', version: '1', language: 'eng', confidenceScale: '0-100' as const, segmentationMode: 'auto' },
    processing: { rotation: 0 as const, contrast: false, invert: false, cropPercent: null },
  }],
  rawText: observation.text,
  warnings: [],
  synthetic: true,
  createdAt: new Date().toISOString(),
};
const handle = { handle: imageId, side: 'back' as const, width: 900, height: 363, role: 'nutrition' as const };
const auditImage = await sharp({ create: { width: 900, height: 363, channels: 3, background: '#fff' } }).png().toBuffer();
const initial = assistInput.parse({
  consent: true,
  question: 'What can you tell me about this package?',
  package: packageData,
  images: [handle],
  visualImages: [{
    imageId,
    mimeType: 'image/png' as const,
    base64: auditImage.toString('base64'),
    side: 'back' as const,
    sourceImage: { width: 900, height: 363 },
    preprocessing: { rotation: 0 as const, contrast: false, invert: false, crop: null },
  }],
});
const followupPackage = {
  ...packageData,
  reconstruction: {
    identity: { brand: null, name: 'Example biscuits', variant: null, status: 'provisional' as const, evidence: { observationIds: [observationId], imageRegions: [] } },
    serving: { printedText: '2 biscuits (approximately 13.4 g)', quantity: 13.4, unit: 'g' as const, pieceCount: 2, pieceDescription: 'biscuits', status: 'provisional' as const, evidence: { observationIds: [observationId], imageRegions: [] } },
    nutritionRows: [{
      rowId: 'audit-carbohydrate-100g', nutrient: 'Carbohydrate', printedLabel: 'Carbohydrate', printedValue: '69.29 g', value: 69.29, unit: 'g',
      columnLabel: 'Per 100 g', basisText: 'per 100 g', basisAmount: 100, basisUnit: 'g' as const, qualifier: null, status: 'provisional' as const,
      evidence: { observationIds: [observationId], imageRegions: [{ imageId, region: { x: 0.05, y: 0.1, width: 0.4, height: 0.35 } }] },
    }],
    ingredients: [], additives: [], statements: [], regions: [], unresolved: [], interpretationNote: 'Synthetic audit fixture only.',
    revision: 1, updatedAt: new Date().toISOString(), model: 'audit-fixture', current: true,
  },
};
const followup = assistInput.parse({
  consent: true,
  question: 'What about two biscuits?',
  package: followupPackage,
  images: [handle],
  conversationContext: [{ question: 'Is this suitable as a snack?', answer: 'The package reading is provisional.' }],
});
const utf8 = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
const safeTool = (tool: unknown) => JSON.parse(JSON.stringify(tool));
const snapshot = {
  generatedAt: new Date().toISOString(),
  runId,
  repository: {
    branch: execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim(),
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    workingTreeChangesPresent: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0,
  },
  method: 'Source-derived snapshot using current exported production prompt/context/tool builders. Synthetic fixture only; no provider request was made.',
  systemInstruction: getAgentSystemInstruction(),
  systemInstructionSize: {
    characters: getAgentSystemInstruction().length,
    utf8Bytes: Buffer.byteLength(getAgentSystemInstruction(), 'utf8'),
    providerTokenCount: null,
  },
  effectiveInstructions: {
    conversation: getAgentSystemInstruction(),
    reconstruction: getPackageReconstructionSystemInstruction(),
    reconstructionCharacters: getPackageReconstructionSystemInstruction().length,
    reconstructionUtf8Bytes: Buffer.byteLength(getPackageReconstructionSystemInstruction(), 'utf8'),
    reconstructionProviderTokenCount: null,
  },
  promptComparison: {
    priorSnapshot: previousPrompt,
    currentSnapshot: {
      systemInstruction: getAgentSystemInstruction(),
      characters: getAgentSystemInstruction().length,
      utf8Bytes: Buffer.byteLength(getAgentSystemInstruction(), 'utf8'),
    },
    reconstructionPrior: previousPrompt?.reconstructionSystemInstruction ?? null,
    reconstructionChanged: previousPrompt?.reconstructionSystemInstruction !== getPackageReconstructionSystemInstruction(),
    changed: previousPrompt?.systemInstruction !== getAgentSystemInstruction(),
  },
  reconstruction: {
    systemInstruction: getPackageReconstructionSystemInstruction(),
    userPayload: packageReconstructionPromptPayload(initial),
    textPayloadUtf8Bytes: utf8(packageReconstructionPromptPayload(initial)),
    imageBytesIncludedInArtifact: false,
    nativeFunctionDeclaration: safeTool(getAgentToolDeclarations(false, true)[0]),
    generation: {
      maxOutputTokens: 9000,
      thinkingLevel: 'LOW',
      automaticContinuation: false,
      functionCallingMode: 'ANY',
      allowedFunctionNames: ['submit_package_reconstruction'],
      timeoutMs: 65000,
      responseMimeType: null,
      responseJsonSchema: null,
    },
  },
  conversationalAgent: {
    initialAfterReconstructionWithImageTools: safeTool(getAgentToolDeclarations(true, false)),
    ordinaryPhotoFreeFollowupTools: safeTool(getAgentToolDeclarations(false, false)),
    initialUserPayload: assistPromptPayload(initial),
    initialUserPayloadUtf8Bytes: utf8(assistPromptPayload(initial)),
    followupUserPayload: assistPromptPayload(followup),
    followupUserPayloadUtf8Bytes: utf8(assistPromptPayload(followup)),
    generation: {
      maxOutputTokens: { toolRounds: 4500, finalOnly: 3000 },
      thinkingLevel: 'LOW',
      automaticContinuation: false,
      functionCallingMode: 'AUTO; final-only turn has no tools',
      googleSearch: 'Conditional; only when provider status and request privacy/context checks allow it.',
      timeoutMsPerCall: 65000,
      maxToolRounds: 5,
      maxToolCalls: 12,
      wallClockLimitMs: 110000,
      freeProviderModelAttemptTimeoutMs: 20000,
      paidLastResortAttemptTimeoutMs: 45000,
      responseMimeType: null,
      responseJsonSchema: null,
    },
  },
  finalAnswerAndPresentation: {
    answer: 'Plain text from non-thought candidate parts; one bounded answer returned to the caller.',
    validation: 'validateNaturalAnswerText checks unsupported numeric quantities and serving bases against the saved package, deterministic calculations and retrieved evidence; it does not require exact OCR quotations or lexical answer-to-claim matching.',
    components: 'Trusted app components are derived from successful calculation/source tool results and current package state; the model does not return HTML, React or a required UI tree.',
  },
  legacyPaths: {
    oldQuestionCoverageAndAnswerIntentPromptBlocks: 'Removed from the canonical agent instruction.',
    rootJsonAnswerEnvelope: 'Not sent or required in the canonical conversational agent.',
    answerStructureRepairAndClaimSynthesis: 'The unreferenced final JSON formatter and structure-repair prompt builder were removed. The canonical assist route does not run claim synthesis or answer-format repair.',
    compatibilityHelpers: 'Historical provider-shape and claim-validation adapters remain only for offline regression tests; the active assist route does not call them.',
  },
  providerMeasurements: {
    providerCallsMadeByThisAudit: 0,
    actualSdkInputOutputThinkingCachedTokens: null,
    providerLatencyMs: null,
    estimatedCost: null,
    reason: 'No API request was made. Provider token and cost values must come from the per-call SDK usage metadata in a real evaluation transcript; no estimate is invented here.',
  },
  privacy: 'No API key, generated image bytes, actual profile, user conversation, or hidden reasoning is stored. The package example, blank image fixture and conversation are synthetic.',
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
console.log(outputPath);
