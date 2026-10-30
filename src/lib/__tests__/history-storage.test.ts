import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseLabel } from '../parser';
import { applyNutrientCorrection } from '../correction';
import type { SavedScanRecord } from '../contracts';

const store = vi.hoisted(() => ({ data: new Map<string, unknown>(), failNext: false }));
vi.mock('idb-keyval', () => ({
  get: async (key: string) => store.data.get(key),
  set: async (key: string, value: unknown) => { store.data.set(key, value); },
  del: async (key: string) => { store.data.delete(key); },
  update: async (key: string, fn: (old: unknown) => unknown) => {
    if (store.failNext) { store.failNext = false; throw new Error('Storage unavailable'); }
    store.data.set(key, fn(store.data.get(key)));
  },
}));
import { clearHistory, readHistory, removeSavedScan, saveScan } from '../browser';

function scan(id: string): SavedScanRecord {
  const pkg = parseLabel('Synthetic history fixture\nNutrition per 100 g\nProtein 10 g', { origin: 'user' });
  return { id, name: 'History fixture', createdAt: pkg.createdAt, package: pkg, portion: 30, unit: 'g' };
}

describe('local history persistence ordering and compatibility', () => {
  beforeEach(() => { store.data.clear(); store.failNext = false; });
  it('keeps legacy records and the corrected reading when updating one investigation', async () => {
    const first = scan('legacy'); const current = scan('current');
    store.data.set('nutriscan.history.v1', [first]);
    await saveScan(current);
    const corrected = { ...current, package: applyNutrientCorrection(current.package, { key: 'protein', value: 12, unit: 'g', basisAmount: 100, basisUnit: 'g' }) };
    await saveScan(corrected);
    const records = await readHistory();
    expect(records.map(item => item.id)).toEqual(['current', 'legacy']);
    expect(records[0].package).toEqual(corrected.package);
    expect(records[1]).toEqual(first);
  });
  it('does not resurrect an investigation when removal follows a queued autosave', async () => {
    await Promise.all([saveScan(scan('first')), saveScan(scan('second')), removeSavedScan('first')]);
    expect((await readHistory()).map(item => item.id)).toEqual(['second']);
    await Promise.all([saveScan(scan('third')), clearHistory()]);
    expect(await readHistory()).toEqual([]);
  });
  it('reports a failed write and allows the next write and clear to recover', async () => {
    store.failNext = true;
    await expect(saveScan(scan('failed'))).rejects.toThrow('Storage unavailable');
    await saveScan(scan('success'));
    expect((await readHistory()).map(item => item.id)).toEqual(['success']);
    await clearHistory(); expect(await readHistory()).toEqual([]);
  });
  it('rejects photos and separate profile fields without writing either', async () => {
    await expect(saveScan({ ...scan('invalid'), images: ['private'] } as SavedScanRecord)).rejects.toThrow();
    await expect(saveScan({ ...scan('invalid'), profile: { healthConsiderations: 'private' } } as SavedScanRecord)).rejects.toThrow();
    expect(await readHistory()).toEqual([]);
  });
});
