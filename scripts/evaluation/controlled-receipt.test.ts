import { describe, expect, it } from 'vitest';
import { controlledReceipt } from './controlled-receipt';

describe('formal study receipt with metadata-only app recording', () => {
  it('retains controlled reconstruction, hashes and actual usage without requiring app transcripts', () => {
    const result = { packageReconstruction: { nutritionRows: [{ value: 12, unit: 'mg' }] }, actualModel: 'frozen-model' };
    const context = { observations: [{ text: 'Development-only raw label' }] };
    const events = [{ event: 'provider_response', callId: 'call-1', model: 'frozen-model', modelVersion: 'actual-version', tier: 'free', usageMetadata: { promptTokenCount: 100 }, costEstimate: { estimatedTokenUsd: 0 }, elapsedMs: 45 }];
    const receipt = controlledReceipt(result, context, 'input-hash', events, { calls: [] });
    expect(receipt.packageReconstruction).toEqual(result.packageReconstruction);
    expect(receipt.providerCallMetadata[0]).toMatchObject({ modelVersion: 'actual-version', tier: 'free', usage: { promptTokenCount: 100 }, cost: { estimatedTokenUsd: 0 }, elapsedMs: 45 });
    expect(receipt.responseSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.packageContextSha256).not.toBe(controlledReceipt(result, { observations: [] }, 'input-hash', events, { calls: [] }).packageContextSha256);
    expect(receipt.responseSha256).not.toBe(controlledReceipt({ ...result, actualModel: 'different-model' }, context, 'input-hash', events, { calls: [] }).responseSha256);
    expect(JSON.stringify(receipt)).not.toContain('Development-only raw label');
  });

  it('retains failed attempts and ledger latency without manufacturing usage', () => {
    const receipt = controlledReceipt({ packageReconstruction: {} }, {}, 'hash', [{ event: 'provider_error', callId: 'failed', model: 'frozen-model', failure: { code: 'timeout' } }], { calls: [{ id: 'failed', elapsedMs: 90 }] });
    expect(receipt.providerCallMetadata[0]).toMatchObject({ elapsedMs: 90, usage: null, cost: null, failure: { code: 'timeout' } });
  });
});
