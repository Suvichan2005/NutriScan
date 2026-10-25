/** Local Performance entries only: no image, text, profile or network logging. */
export async function measureScanStage<T>(
  stage: 'primary-ocr' | 'secondary-ocr' | 'barcode' | 'local-retrieval' | 'cloud-roundtrip' | 'assist-server',
  work: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  try { return await work(); }
  finally {
    try {
      const name = `nutriscan:${stage}`;
      if (performance.getEntriesByName(name, 'measure').length >= 100) performance.clearMeasures(name);
      performance.measure(name, { start: started, end: performance.now() });
    } catch { /* Diagnostics must never change scan behavior. */ }
  }
}

/** Add a server-reported duration to local browser diagnostics without exposing request content. */
export function recordScanDuration(
  stage: 'primary-ocr' | 'secondary-ocr' | 'barcode' | 'local-retrieval' | 'cloud-roundtrip' | 'assist-server',
  durationMs: number,
): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  try {
    const name = `nutriscan:${stage}`;
    if (performance.getEntriesByName(name, 'measure').length >= 100) performance.clearMeasures(name);
    const end = performance.now();
    performance.measure(name, { start: Math.max(0, end - durationMs), end });
  } catch { /* Diagnostics must never change scan behavior. */ }
}
