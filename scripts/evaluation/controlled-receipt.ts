import { createHash } from 'node:crypto';

type MetadataEvent = Record<string, unknown>;
type UsageLedger = { calls: Array<{ id: string; elapsedMs?: number | null }> };
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Explicit study output, separate from the app's metadata-only recorder. */
export function controlledReceipt<T extends { packageReconstruction: unknown; packageContextSha256?: string }>(
  result: T,
  packageContext: unknown,
  inputFileSha256: string,
  events: MetadataEvent[],
  ledger: UsageLedger,
) {
  return {
    ...result,
    inputFileSha256,
    packageContextSha256: result.packageContextSha256 ?? digest(packageContext),
    responseSha256: digest(result),
    providerRoutes: events.filter(event => event.event === 'provider_route'),
    providerCallMetadata: events.filter(event => ['provider_response', 'provider_error'].includes(String(event.event)))
      .map(event => ({
        event: event.event, callId: event.callId, model: event.model,
        modelVersion: event.modelVersion ?? null, tier: event.tier ?? null,
        usage: event.usageMetadata ?? null, cost: event.costEstimate ?? null,
        elapsedMs: event.elapsedMs ?? ledger.calls.find(call => call.id === event.callId)?.elapsedMs ?? null,
        finishReasons: event.finishReasons ?? [], functionCallNames: event.functionCallNames ?? [],
        failure: event.failure ?? null,
      })),
    claimScope: 'unscored-controlled-extraction',
  };
}
