import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadEnvConfig } = require('@next/env') as typeof import('@next/env');
loadEnvConfig(process.cwd());
const { applicationGeminiContext, FREE_GEMINI_MODEL_PREFERENCE, providerStatus } = await import('../src/lib/server/gemini-provider');

const status = providerStatus();
if (status.tier !== 'free' || !status.enabled) throw new Error('Free Gemini mode is not enabled; no model-list request was sent.');
const context = applicationGeminiContext();
const models = await context.client.models.list({ config: { pageSize: 100, abortSignal: AbortSignal.timeout(15_000) } });
const returned = models.page ?? [];
const results = FREE_GEMINI_MODEL_PREFERENCE.map(preferred => {
  const found = returned.find(model => model.name === `models/${preferred}` || model.baseModelId === preferred);
  return {
    model: preferred,
    listedForConfiguredFreeCredential: Boolean(found),
    supportsGenerateContent: (found?.supportedActions ?? []).includes('generateContent'),
    advertisedActions: found?.supportedActions ?? [],
    version: found?.version ?? null,
  };
});
console.log(JSON.stringify({ requestedMode: status.tier, credentialSelected: 'FREE_GEMINI_API_KEY', preferredModel: context.model, checkedAt: new Date().toISOString(), models: results, note: 'Model listing confirms project availability and generateContent advertisement. Image, tools, JSON schema, quota and response quality are validated only by the actual application request.' }, null, 2));
