'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Check, Crop, ImagePlus, Redo2, RotateCw, RotateCcw, SlidersHorizontal, Trash2, Undo2 } from 'lucide-react';
import { adjustImage, isValidPerspectiveQuad, rectifyPerspective, rotateImage, type ImageAdjustments, type PerspectiveQuad, type Point } from '@/modules/ocr';
import type { ImageAsset } from '@/lib/contracts';

export type PhotoReviewAsset = ImageAsset & {
  originalBlob?: Blob;
  originalUrl?: string;
  originalWidth?: number;
  originalHeight?: number;
  originalOrientation?: number;
  editedBlob?: Blob;
  editedUrl?: string;
  editedWidth?: number;
  editedHeight?: number;
  isOriginal?: boolean;
  editVersion?: number;
  editState?: PhotoEditState;
  editHistory?: PhotoEditState[];
  editHistoryIndex?: number;
};

export type PhotoEditState = {
  /** Corners are normalized against the immutable browser-decoded original image. */
  cropQuad: PerspectiveQuad | null;
  rotation: 0 | 90 | 180 | 270;
  adjustments: ImageAdjustments;
};

const fullFrame: PerspectiveQuad = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
const neutralAdjustments: ImageAdjustments = { brightness: 100, contrast: 100, grayscale: false, threshold: null };
export const pristinePhotoEditState: PhotoEditState = { cropQuad: null, rotation: 0, adjustments: neutralAdjustments };

export function clonePhotoEditState(state: PhotoEditState): PhotoEditState {
  return {
    cropQuad: state.cropQuad ? state.cropQuad.map(point => ({ ...point })) as PerspectiveQuad : null,
    rotation: state.rotation,
    adjustments: { ...state.adjustments },
  };
}

export function photoHasEdits(state: PhotoEditState): boolean {
  return Boolean(
    (state.cropQuad && state.cropQuad.some((point, index) => point.x !== fullFrame[index].x || point.y !== fullFrame[index].y)) ||
    state.rotation !== 0 ||
    state.adjustments.brightness !== 100 || state.adjustments.contrast !== 100 || state.adjustments.grayscale || state.adjustments.threshold !== null
  );
}

/** Rebuilds every saved revision from the immutable original, never from a prior JPEG export. */
export async function renderPhotoEdit(original: Blob, state: PhotoEditState): Promise<{ blob: Blob; width: number; height: number }> {
  let result: { blob: Blob; width: number; height: number } | null = null;
  let source = original;
  if (state.cropQuad && state.cropQuad.some((point, index) => point.x !== fullFrame[index].x || point.y !== fullFrame[index].y)) {
    result = await rectifyPerspective(source, state.cropQuad);
    source = result.blob;
  }
  for (let turn = 0; turn < state.rotation / 90; turn++) {
    result = await rotateImage(source);
    source = result.blob;
  }
  const { brightness, contrast, grayscale, threshold } = state.adjustments;
  if (brightness !== 100 || contrast !== 100 || grayscale || threshold !== null) result = await adjustImage(source, state.adjustments);
  if (!result) {
    const bitmap = await createImageBitmap(original);
    try { return { blob: original, width: bitmap.width, height: bitmap.height }; }
    finally { bitmap.close(); }
  }
  return result;
}

type Props = {
  asset: PhotoReviewAsset;
  index: number;
  busy: boolean;
  onTransform: (id: string, state: PhotoEditState) => Promise<void>;
  onUndo: (id: string) => Promise<void>;
  onRedo: (id: string) => Promise<void>;
  onRemove: (id: string) => void;
  onReplace: (id: string, file: File) => void;
  onError: (message: string) => void;
};

const cornerNames = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];

export function PackagePhotoCard({ asset, index, busy, onTransform, onUndo, onRedo, onRemove, onReplace, onError }: Props) {
  const [cropOpen, setCropOpen] = useState(false);
  const [enhanceOpen, setEnhanceOpen] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [working, setWorking] = useState(false);
  const [corners, setCorners] = useState<PerspectiveQuad>(fullFrame);
  const [adjustments, setAdjustments] = useState<ImageAdjustments>(neutralAdjustments);
  const [thresholdPreview, setThresholdPreview] = useState<{ key: string; url: string } | null>(null);
  const [frameLimit, setFrameLimit] = useState({ width: 0, height: 0 });
  const [adjustmentBase, setAdjustmentBase] = useState<{ blob: Blob; url: string } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  const originalAvailable = Boolean(asset.originalUrl);
  const savedState = asset.editState ?? pristinePhotoEditState;
  const savedCorners = savedState.cropQuad ?? fullFrame;
  const hasSavedEdits = photoHasEdits(savedState);
  const canUndo = (asset.editHistoryIndex ?? 0) > 0;
  const canRedo = (asset.editHistoryIndex ?? 0) < (asset.editHistory?.length ?? 1) - 1;
  const validCorners = isValidPerspectiveQuad(corners);
  const cornersChanged = corners.some((point, pointIndex) => point.x !== savedCorners[pointIndex].x || point.y !== savedCorners[pointIndex].y);
  const adjustmentKey = JSON.stringify(adjustments);
  const thresholdPreviewReady = adjustments.threshold !== null && thresholdPreview?.key === adjustmentKey;
  const displayUrl = showOriginal || cropOpen ? asset.originalUrl ?? asset.url : thresholdPreviewReady ? thresholdPreview.url : enhanceOpen && adjustmentBase ? adjustmentBase.url : asset.url;
  const neutralPreview = adjustments.brightness === 100 && adjustments.contrast === 100 && !adjustments.grayscale;
  const displayFilter = showOriginal || cropOpen || thresholdPreviewReady || !enhanceOpen || !adjustmentBase || neutralPreview
    ? 'none'
    : 'brightness(' + adjustments.brightness + '%) contrast(' + adjustments.contrast + '%) grayscale(' + (adjustments.grayscale ? '1' : '0') + ')';
  const perspectivePoints = corners.map(point => point.x * 100 + ',' + point.y * 100);

  useEffect(() => {
    setCropOpen(false);
    setEnhanceOpen(false);
    setShowOriginal(false);
    setCorners(asset.editState?.cropQuad ?? fullFrame);
    setAdjustments({ ...(asset.editState?.adjustments ?? neutralAdjustments) });
  }, [asset.id, asset.editVersion]);

  useEffect(() => {
    if (!enhanceOpen) {
      setAdjustmentBase(null);
      return;
    }
    let active = true;
    let url = '';
    const baseState = clonePhotoEditState(savedState);
    baseState.adjustments = { ...neutralAdjustments };
    void renderPhotoEdit(asset.originalBlob ?? asset.blob, baseState).then(result => {
      url = URL.createObjectURL(result.blob);
      if (active) setAdjustmentBase({ blob: result.blob, url });
      else URL.revokeObjectURL(url);
    }).catch(() => {
      if (active) onError('The clean edit preview could not be prepared. Your saved photo is unchanged.');
    });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [enhanceOpen, asset.id, asset.editVersion, onError]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const style = getComputedStyle(stage);
      const width = Math.max(0, stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
      const height = Math.max(0, stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom));
      setFrameLimit(previous => Math.abs(previous.width - width) < 1 && Math.abs(previous.height - height) < 1
        ? previous
        : { width, height });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    measure();
    return () => observer.disconnect();
  }, [asset.id]);

  useEffect(() => {
    if (adjustments.threshold === null || !enhanceOpen || !adjustmentBase) {
      setThresholdPreview(null);
      return;
    }
    let active = true;
    let createdUrl = '';
    setThresholdPreview(null);
    void adjustImage(adjustmentBase.blob, adjustments).then(result => {
      createdUrl = URL.createObjectURL(result.blob);
      if (active) setThresholdPreview({ key: adjustmentKey, url: createdUrl });
      else URL.revokeObjectURL(createdUrl);
    }).catch(() => {
      if (active) onError('The threshold preview could not be prepared. Your original photo is unchanged.');
    });
    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [adjustmentBase, adjustments, adjustmentKey, enhanceOpen, onError]);

  function updateCorner(index: number, clientX: number, clientY: number) {
    const bounds = frameRef.current?.getBoundingClientRect();
    if (!bounds?.width || !bounds.height) return;
    const point = {
      x: Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (clientY - bounds.top) / bounds.height)),
    };
    setCorners(previous => {
      const next = previous.map((value, cornerIndex) => cornerIndex === index ? point : value) as PerspectiveQuad;
      return isValidPerspectiveQuad(next) ? next : previous;
    });
  }

  function onHandleDown(event: ReactPointerEvent<HTMLButtonElement>, index: number) {
    event.preventDefault();
    dragging.current = index;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onHandleMove(event: ReactPointerEvent<HTMLButtonElement>, index: number) {
    if (dragging.current === index) updateCorner(index, event.clientX, event.clientY);
  }

  function onHandleUp(event: ReactPointerEvent<HTMLButtonElement>) {
    dragging.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function onHandleKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const delta = event.shiftKey ? 0.02 : 0.005;
    const movement: Record<string, Point> = {
      ArrowLeft: { x: -delta, y: 0 },
      ArrowRight: { x: delta, y: 0 },
      ArrowUp: { x: 0, y: -delta },
      ArrowDown: { x: 0, y: delta },
    };
    const change = movement[event.key];
    if (!change) return;
    event.preventDefault();
    setCorners(previous => {
      const next = previous.map((point, cornerIndex) => cornerIndex === index
        ? { x: Math.min(1, Math.max(0, point.x + change.x)), y: Math.min(1, Math.max(0, point.y + change.y)) }
        : point) as PerspectiveQuad;
      return isValidPerspectiveQuad(next) ? next : previous;
    });
  }

  async function saveEdit(state: PhotoEditState) {
    setWorking(true);
    try {
      await onTransform(asset.id, clonePhotoEditState(state));
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Could not save this photo edit.');
    } finally {
      setWorking(false);
    }
  }

  async function runHistoryAction(action: (id: string) => Promise<void>) {
    setWorking(true);
    try { await action(asset.id); }
    catch (error) { onError(error instanceof Error ? error.message : 'Could not restore this photo edit.'); }
    finally { setWorking(false); }
  }

  function resetPhoto() {
    setShowOriginal(false);
    setCropOpen(false);
    setEnhanceOpen(false);
    setCorners(fullFrame);
    setAdjustments(neutralAdjustments);
    if (hasSavedEdits) void saveEdit(clonePhotoEditState(pristinePhotoEditState));
  }

  return <article className="package-photo-card" aria-label={'Edit package side ' + (index + 1)}>
    <div className="photo-stage" ref={stageRef}>
      <div className="photo-frame" ref={frameRef} style={frameLimit.width && frameLimit.height ? { maxWidth: frameLimit.width, maxHeight: frameLimit.height } : undefined}>
        <img
          className="package-photo"
          src={displayUrl}
          alt={'Package side ' + (index + 1) + ': ' + asset.name}
          draggable={false}
          style={{ filter: displayFilter, ...(frameLimit.width && frameLimit.height ? { maxWidth: frameLimit.width, maxHeight: frameLimit.height } : {}) }}
          data-preview-brightness={adjustments.brightness}
          data-preview-contrast={adjustments.contrast}
        />
        {cropOpen && !showOriginal && <div className="perspective-overlay" aria-label="Perspective adjustment corners">
          <svg className="perspective-guide" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <path className="perspective-mask" d={'M0 0H100V100H0Z M' + perspectivePoints.join('L') + 'Z'} fillRule="evenodd" />
            <polygon points={perspectivePoints.join(' ')} />
          </svg>
          {corners.map((point, cornerIndex) => <button
            key={cornerIndex}
            type="button"
            className="perspective-handle"
            style={{ left: point.x * 100 + '%', top: point.y * 100 + '%' }}
            aria-label={'Move ' + cornerNames[cornerIndex] + ' label corner; use arrow keys for fine adjustment'}
            title={'Move ' + cornerNames[cornerIndex] + ' corner'}
            onPointerDown={event => onHandleDown(event, cornerIndex)}
            onPointerMove={event => onHandleMove(event, cornerIndex)}
            onPointerUp={onHandleUp}
            onPointerCancel={onHandleUp}
            onKeyDown={event => onHandleKey(event, cornerIndex)}
          />)}
        </div>}
      </div>
      <div className="photo-stage-caption">
        <span>Side {index + 1} of package</span>
        {hasSavedEdits && <button type="button" onClick={() => { setShowOriginal(value => !value); setCropOpen(false); setEnhanceOpen(false); }}>
          {showOriginal ? 'Show saved edit' : 'View original'}
        </button>}
      </div>
    </div>

    <div className="photo-editor-toolbar" aria-label="Photo tools">
      <button type="button" onClick={() => void saveEdit({ ...savedState, rotation: ((savedState.rotation + 90) % 360) as PhotoEditState['rotation'] })} disabled={busy || working || showOriginal} aria-label="Rotate photo">
        <RotateCw size={17} /><span>Rotate</span>
      </button>
      <button type="button" aria-pressed={cropOpen} onClick={() => { const opening = !cropOpen; setCropOpen(opening); setEnhanceOpen(false); setShowOriginal(false); if (opening) setCorners(asset.editState?.cropQuad ?? fullFrame); }} disabled={busy || working}>
        <Crop size={17} /><span>Crop / Adjust</span>
      </button>
      <button type="button" aria-pressed={enhanceOpen} onClick={() => { const opening = !enhanceOpen; setEnhanceOpen(opening); setCropOpen(false); setShowOriginal(false); if (opening) setAdjustments({ ...savedState.adjustments }); }} disabled={busy || working}>
        <SlidersHorizontal size={17} /><span>Enhance</span>
      </button>
      <button type="button" onClick={() => void runHistoryAction(onUndo)} disabled={busy || working || !canUndo} aria-label="Undo photo edit" title="Undo photo edit"><Undo2 size={17}/><span>Undo</span></button>
      <button type="button" onClick={() => void runHistoryAction(onRedo)} disabled={busy || working || !canRedo} aria-label="Redo photo edit" title="Redo photo edit"><Redo2 size={17}/><span>Redo</span></button>
      <button type="button" onClick={resetPhoto} disabled={busy || working || !hasSavedEdits} aria-label="Reset to original">
        <RotateCcw size={17} /><span>Reset</span>
      </button>
      <label className="scanner-retake">
        <ImagePlus size={17} /><span>Retake</span>
        <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" aria-label="Retake package side" disabled={busy || working} onChange={event => {
          const file = event.target.files?.[0];
          if (file) onReplace(asset.id, file);
          event.target.value = '';
        }} />
      </label>
      <button type="button" className="scanner-remove-side" onClick={() => onRemove(asset.id)} disabled={busy || working} aria-label="Remove package side">
        <Trash2 size={17} /><span>Remove</span>
      </button>
    </div>

    {cropOpen && <div className="photo-tool-panel crop-tool-panel">
      <span>Move the four corners on the original photo. Saving rebuilds from the original.</span>
      <div>
        <button type="button" className="text-button" onClick={() => setCorners(fullFrame)} disabled={working}>Reset corners</button>
        <button type="button" className="secondary-button" onClick={() => { void saveEdit({ ...savedState, cropQuad: corners.some((point, index) => point.x !== fullFrame[index].x || point.y !== fullFrame[index].y) ? corners : null }); setCropOpen(false); }} disabled={working || !validCorners || !cornersChanged}>
          {working ? 'Saving…' : 'Save crop'}
        </button>
      </div>
    </div>}

    {enhanceOpen && <div className="photo-tool-panel enhance-tool-panel">
      <label className="adjustment-slider">Brightness <strong>{adjustments.brightness}%</strong>
        <input type="range" min="70" max="130" step="1" value={adjustments.brightness} disabled={busy || working || showOriginal} onChange={event => setAdjustments(previous => ({ ...previous, brightness: Number(event.target.value) }))} />
      </label>
      <label className="adjustment-slider">Contrast <strong>{adjustments.contrast}%</strong>
        <input type="range" min="70" max="160" step="1" value={adjustments.contrast} disabled={busy || working || showOriginal} onChange={event => setAdjustments(previous => ({ ...previous, contrast: Number(event.target.value) }))} />
      </label>
      <label className="check-label"><input type="checkbox" checked={adjustments.grayscale} disabled={busy || working || showOriginal} onChange={event => setAdjustments(previous => ({ ...previous, grayscale: event.target.checked }))} />Grayscale</label>
      <label className="adjustment-select">Threshold
        <select value={adjustments.threshold ?? ''} disabled={busy || working || showOriginal} onChange={event => setAdjustments(previous => ({ ...previous, threshold: event.target.value ? Number(event.target.value) : null }))}>
          <option value="">Off</option><option value="140">Light</option><option value="175">Medium</option><option value="205">Strong</option>
        </select>
      </label>
      <div className="photo-tool-panel-actions">
        <button type="button" className="text-button" onClick={() => setAdjustments(neutralAdjustments)} disabled={working}>Reset adjustments</button>
        <button type="button" className="secondary-button" onClick={() => { void saveEdit({ ...savedState, adjustments: { ...adjustments } }); setEnhanceOpen(false); }} disabled={working}>
          {working ? 'Saving…' : 'Save side'}<Check size={15} />
        </button>
      </div>
    </div>}
  </article>;
}
