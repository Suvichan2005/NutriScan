import { get, set, del } from 'idb-keyval';
import { hasUserContext, profileSchema, savedScanSchema, type ImageAsset, type Observation, type OcrCapture, type Profile, type SavedScanRecord } from './contracts';
import { detectRetailBarcodes } from './barcode';
import { measureScanStage } from './scan-performance';
import { readOcrImages } from '../modules/ocr';
import type { BrowserOcrOptions } from '../modules/ocr';

export { BROWSER_OCR_ENGINE_VERSION, prepareImage } from '../modules/ocr';
export type { Crop } from '../modules/ocr';

export type SavedScan = SavedScanRecord;
const historyKey = 'nutriscan.history.v1';
const rememberedProfileKey = 'nutriscan.user-context.v1';
const sessionProfileKey = 'nutriscan.user-context.session.v1';
const onboardingCompleteKey = 'nutriscan.onboarding.complete.v1';

export async function readHistory(): Promise<SavedScan[]> {
  const data: unknown = await get(historyKey);
  return Array.isArray(data) ? data.flatMap(item => {
    const parsed = savedScanSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  }).slice(0, 20) : [];
}
export async function saveScan(input: SavedScan) {
  const scan = savedScanSchema.parse(input);
  const history = await readHistory();
  await set(historyKey, [scan, ...history.filter(item => item.id !== scan.id)].slice(0, 20));
}
export async function removeSavedScan(id: string) {
  const history = await readHistory();
  await set(historyKey, history.filter(scan => scan.id !== id));
}
export async function clearHistory() { await del(historyKey); }

/** Optional user context is stored separately from scan and conversation history. */
export async function readRememberedProfile(): Promise<Profile | null> {
  const value: unknown = await get(rememberedProfileKey);
  if (value === undefined) return null;
  const parsed = profileSchema.safeParse(value);
  if (!parsed.success) { await del(rememberedProfileKey); return null; }
  return hasUserContext(parsed.data) ? parsed.data : null;
}
export async function saveRememberedProfile(input: Profile): Promise<void> {
  const profile = profileSchema.parse(input);
  if (!hasUserContext(profile)) { await del(rememberedProfileKey); return; }
  await set(rememberedProfileKey, profile);
}
export async function deleteRememberedProfile(): Promise<void> { await del(rememberedProfileKey); }

/** Session-only context is scoped to this tab and restored after a reload. */
export function readSessionProfile(): Profile | null {
  try {
    if (sessionStorage.getItem(onboardingCompleteKey) !== '1') return null;
    const raw = sessionStorage.getItem(sessionProfileKey);
    if (!raw) return null;
    const parsed = profileSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) { sessionStorage.removeItem(sessionProfileKey); return null; }
    return hasUserContext(parsed.data) ? parsed.data : null;
  } catch { return null; }
}
export function saveSessionProfile(input: Profile): void {
  const profile = profileSchema.parse(input);
  if (!hasUserContext(profile)) { deleteSessionProfile(); return; }
  sessionStorage.setItem(sessionProfileKey, JSON.stringify(profile));
}
export function deleteSessionProfile(): void { sessionStorage.removeItem(sessionProfileKey); }
export function hasCompletedOnboardingSession(): boolean {
  try { return sessionStorage.getItem(onboardingCompleteKey) === '1'; } catch { return false; }
}
export function completeOnboardingSession(): void {
  sessionStorage.setItem(onboardingCompleteKey, '1');
}

export async function loadImage(file: Blob, side: ImageAsset['side'], name = 'Package photograph'): Promise<ImageAsset> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPG, PNG or WebP photo. HEIC needs conversion first.');
  if (file.size > 12 * 1024 * 1024) throw new Error('This photo is larger than 12 MB. Choose a smaller image.');
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  bitmap.close();
  if (width * height > 40_000_000) throw new Error('This image is too large to process comfortably. Choose a photo below 40 megapixels.');
  return { id: crypto.randomUUID(), side, blob: file, url: URL.createObjectURL(file), width, height, name };
}

/** Compatibility boundary: local OCR stays in its module; barcode decoding and app orchestration stay here. */
export async function readImages(
  assets: ImageAsset[],
  onProgress: (label: string, progress: number) => void,
  signal: AbortSignal,
  options: BrowserOcrOptions
): Promise<{ text: string; observations: Observation[]; confidence: number; barcodes: { code: string; imageId: string; side: ImageAsset['side'] }[]; captures: OcrCapture[] }> {
  const barcodes: { code: string; imageId: string; side: ImageAsset['side'] }[] = [];
  const recognized = await readOcrImages(assets, onProgress, signal, {
    ...options,
    beforeImage: async asset => {
      const values = await measureScanStage('barcode', () => detectRetailBarcodes(asset.blob));
      for (const code of values) barcodes.push({ code, imageId: asset.id, side: asset.side });
      await options.beforeImage?.(asset);
    }
  });
  return { ...recognized, barcodes };
}

export async function imageBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('Image could not be read.'));
    reader.readAsDataURL(blob);
  });
}
export function downloadJson(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
