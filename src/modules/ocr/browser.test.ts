import { describe, expect, it, vi } from 'vitest';
import { retryShortAutoRecognition } from './browser';

describe('short AUTO OCR recovery', () => {
  it('retries a near-empty label read as a single block and uses the richer evidence', async () => {
    const retry = vi.fn().mockResolvedValue({ data: { text: 'Energy 376 kcal per 100 g\nSodium 2283 mg' } });
    const recovered = await retryShortAutoRecognition({ data: { text: '—' } }, retry);

    expect(retry).toHaveBeenCalledOnce();
    expect(recovered).toEqual({ result: { data: { text: 'Energy 376 kcal per 100 g\nSodium 2283 mg' } }, segmentationMode: 'single-block' });
  });

  it('does not pay for a second pass when AUTO already returned usable text', async () => {
    const retry = vi.fn();
    const primary = { data: { text: 'Ingredients: oats, salt. Nutrition facts...' } };
    expect(await retryShortAutoRecognition(primary, retry)).toEqual({ result: primary, segmentationMode: 'auto' });
    expect(retry).not.toHaveBeenCalled();
  });

  it('keeps the original observation when a fallback is no better', async () => {
    const primary = { data: { text: 'ABC 12' } };
    const retry = vi.fn().mockResolvedValue({ data: { text: 'XYZ 34' } });
    expect(await retryShortAutoRecognition(primary, retry)).toEqual({ result: primary, segmentationMode: 'auto' });
  });

  it('propagates actual reader failures instead of hiding them as empty OCR', async () => {
    const failure = new Error('worker unavailable');
    await expect(retryShortAutoRecognition({ data: { text: '' } }, async () => { throw failure; })).rejects.toBe(failure);
  });
});
