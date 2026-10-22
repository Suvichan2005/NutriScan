'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Check, Crop, ImagePlus, RotateCw, RotateCcw, SlidersHorizontal, Trash2 } from 'lucide-react';
import { adjustImage, isValidPerspectiveQuad, rectifyPerspective, type ImageAdjustments, type PerspectiveQuad, type Point } from '@/modules/ocr';
import type { ImageAsset } from '@/lib/contracts';

export type PhotoReviewAsset = ImageAsset & {
  originalBlob?: Blob;
  originalUrl?: string;
  originalWidth?: number;
  originalHeight?: number;
  editedBlob?: Blob;
  editedUrl?: string;
  editedWidth?: number;
  editedHeight?: number;
  isOriginal?: boolean;
  editVersion?: number;
};

type Props = {
  asset: PhotoReviewAsset;
  index: number;
  busy: boolean;
  onRotate: (id: string) => void;
  onTransform: (id: string, result: { blob: Blob; width: number; height: number }) => void;
  onReset: (id: string) => void;
  onRemove: (id: string) => void;
  onReplace: (id: string, file: File) => void;
  onError: (message: string) => void;
};

const fullFrame: PerspectiveQuad = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
const cornerNames = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
const neutralAdjustments: ImageAdjustments = { brightness: 100, contrast: 100, grayscale: false, threshold: null };

export function PackagePhotoCard({ asset, index, busy, onRotate, onTransform, onReset, onRemove, onReplace, onError }: Props) {
  const [cropOpen, setCropOpen] = useState(false);
  const [enhanceOpen, setEnhanceOpen] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [working, setWorking] = useState(false);
  const [corners, setCorners] = useState<PerspectiveQuad>(fullFrame);
  const [adjustments, setAdjustments] = useState<ImageAdjustments>(neutralAdjustments);
  const [thresholdPreview, setThresholdPreview] = useState<{ key: string; url: string } | null>(null);
  const [frameLimit, setFrameLimit] = useState({ width: 0, height: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  const originalAvailable = Boolean(asset.originalUrl);
  const hasSavedEdits = asset.isOriginal === false && Boolean(asset.editedBlob || asset.editVersion);
  const validCorners = isValidPerspectiveQuad(corners);
  const cornersChanged = corners.some((point, pointIndex) => point.x !== fullFrame[pointIndex].x || point.y !== fullFrame[pointIndex].y);
  const adjustmentKey = JSON.stringify(adjustments);
  const thresholdPreviewReady = adjustments.threshold !== null && thresholdPreview?.key === adjustmentKey;
  const displayUrl = showOriginal ? asset.originalUrl ?? asset.url : thresholdPreviewReady ? thresholdPreview.url : asset.url;
  const neutralPreview = adjustments.brightness === 100 && adjustments.contrast === 100 && !adjustments.grayscale;
  const displayFilter = showOriginal || thresholdPreviewReady || neutralPreview
    ? 'none'
    : 'brightness(' + adjustments.brightness + '%) contrast(' + adjustments.contrast + '%) grayscale(' + (adjustments.grayscale ? '1' : '0') + ')';

  useEffect(() => {
    setCropOpen(false);
    setEnhanceOpen(false);
    setShowOriginal(false);
    setCorners(fullFrame);
    setAdjustments(neutralAdjustments);
  }, [asset.id, asset.editVersion]);

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
    if (adjustments.threshold === null) {
      setThresholdPreview(null);
      return;
    }
    let active = true;
    let createdUrl = '';
    setThresholdPreview(null);
    void adjustImage(asset.blob, adjustments).then(result => {
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
  }, [asset.blob, adjustments, adjustmentKey, onError]);

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

  async function saveCrop() {
    setWorking(true);
    try {
      onTransform(asset.id, await rectifyPerspective(asset.blob, corners));
      setCropOpen(false);
      setCorners(fullFrame);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Could not correct this photo.');
    } finally {
      setWorking(false);
    }
  }

  async function saveAdjustments() {
    if (adjustments.brightness === 100 && adjustments.contrast === 100 && !adjustments.grayscale && adjustments.threshold === null) {
      setEnhanceOpen(false);
      return;
    }
    setWorking(true);
    try {
      onTransform(asset.id, await adjustImage(asset.blob, adjustments));
      setEnhanceOpen(false);
      setAdjustments(neutralAdjustments);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Could not adjust this photo.');
    } finally {
      setWorking(false);
    }
  }

  function resetPhoto() {
    setShowOriginal(false);
    setCropOpen(false);
    setEnhanceOpen(false);
    setCorners(fullFrame);
    setAdjustments(neutralAdjustments);
    if (hasSavedEdits) onReset(asset.id);
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
            <polygon points={corners.map(point => point.x * 100 + ',' + point.y * 100).join(' ')} />
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
      <button type="button" onClick={() => onRotate(asset.id)} disabled={busy || working || showOriginal} aria-label="Rotate photo">
        <RotateCw size={17} /><span>Rotate</span>
      </button>
      <button type="button" aria-pressed={cropOpen} onClick={() => { setCropOpen(value => !value); setEnhanceOpen(false); setShowOriginal(false); setCorners(fullFrame); }} disabled={busy || working}>
        <Crop size={17} /><span>Crop / Adjust</span>
      </button>
      <button type="button" aria-pressed={enhanceOpen} onClick={() => { setEnhanceOpen(value => !value); setCropOpen(false); setShowOriginal(false); }} disabled={busy || working}>
        <SlidersHorizontal size={17} /><span>Enhance</span>
      </button>
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
      <span>Move the four corners to the label edges.</span>
      <div>
        <button type="button" className="text-button" onClick={() => setCorners(fullFrame)} disabled={working}>Reset corners</button>
        <button type="button" className="secondary-button" onClick={() => void saveCrop()} disabled={working || !validCorners || !cornersChanged}>
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
        <button type="button" className="secondary-button" onClick={() => void saveAdjustments()} disabled={working}>
          {working ? 'Saving…' : 'Save side'}<Check size={15} />
        </button>
      </div>
    </div>}
  </article>;
}
