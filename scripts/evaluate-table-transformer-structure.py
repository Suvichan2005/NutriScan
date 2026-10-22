"""Offline exploratory Table Transformer structure probe for package-label photos.

The model checkpoint, Python runtime, source photographs, overlays and result JSON
remain local. This does not claim table-structure accuracy: those annotations do
not yet exist for the selected development images.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_IMAGES = [
    "saffola-veggie-oats-nutrition-off-8901088068758.jpg",
    "bagrrys-white-oats-nutrition-off-8902710100150.jpg",
    "coca-cola-label-off-5449000000996.jpg",
    "nutella-nutrition-es-off-3017620422003.jpg",
    "nutella-nutrition-nl-off-3017620422003.jpg",
]
MODEL_ID = "microsoft/table-transformer-structure-recognition"
MODEL_REVISION = "f4d4bdc85c3fe4b1fa49658882a5d38bbdd0f343"
MODEL_SHA256 = "f581da65a586591124cac9545b09b93e4e8bf28ce3a8357af6ac15ce94fce16b"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", default=".data/table-transformer")
    parser.add_argument("--output-dir", default="docs/evidence/private/table-transformer")
    parser.add_argument("--images", nargs="*", default=DEFAULT_IMAGES)
    args = parser.parse_args()

    model_dir = (ROOT / args.model_dir).resolve()
    output_dir = (ROOT / args.output_dir).resolve()
    manifest = json.loads((ROOT / "data/semantic-photo-manifest.json").read_text(encoding="utf-8"))
    records = {record["file"]: record for record in manifest["records"]}
    selected = []
    for name in args.images:
        record = records.get(name)
        if not record or not record.get("manualAnnotation", {}).get("nutrients"):
            raise SystemExit(f"No annotated development photo found in manifest: {name}")
        photo = ROOT / "docs/evidence/private" / name
        if sha256_file(photo) != record["hash"].lower():
            raise SystemExit(f"Photo hash differs from the manifest: {name}")
        selected.append((record, photo))

    weights = model_dir / "model.safetensors"
    if sha256_file(weights) != MODEL_SHA256:
        raise SystemExit("The local model checkpoint hash does not match the pinned official file.")

    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"

    import psutil
    import torch
    import transformers
    from PIL import Image, ImageDraw
    from transformers import AutoImageProcessor, TableTransformerConfig, TableTransformerForObjectDetection

    torch.set_num_threads(4)
    process = psutil.Process(os.getpid())
    peak_rss = [process.memory_info().rss]
    stop_monitor = threading.Event()

    def sample_memory() -> None:
        while not stop_monitor.wait(0.05):
            peak_rss[0] = max(peak_rss[0], process.memory_info().rss)

    monitor = threading.Thread(target=sample_memory, daemon=True)
    monitor.start()
    load_started = time.perf_counter()
    processor = AutoImageProcessor.from_pretrained(model_dir, local_files_only=True, use_fast=False)
    config = TableTransformerConfig.from_pretrained(model_dir, local_files_only=True)
    # The checkpoint contains its ResNet weights. Avoid fetching an unrelated pretrained backbone.
    config.use_pretrained_backbone = False
    model = TableTransformerForObjectDetection.from_pretrained(
        model_dir,
        config=config,
        local_files_only=True,
        use_safetensors=True,
    ).eval()
    load_ms = round((time.perf_counter() - load_started) * 1000, 1)
    results = []
    output_dir.mkdir(parents=True, exist_ok=True)

    for record, photo in selected:
        image = Image.open(photo).convert("RGB")
        inference_started = time.perf_counter()
        inputs = processor(images=image, return_tensors="pt")
        with torch.inference_mode():
            outputs = model(**inputs)
        predicted = processor.post_process_object_detection(
            outputs,
            threshold=0.5,
            target_sizes=torch.tensor([[image.height, image.width]]),
        )[0]
        inference_ms = round((time.perf_counter() - inference_started) * 1000, 1)

        boxes = []
        overlay = image.copy()
        draw = ImageDraw.Draw(overlay)
        width = max(2, round(min(image.size) * 0.002))
        for label_id, score, coords in zip(
            predicted["labels"].tolist(), predicted["scores"].tolist(), predicted["boxes"].tolist()
        ):
            label = model.config.id2label[label_id]
            box = [round(float(value), 1) for value in coords]
            boxes.append({"label": label, "score": round(float(score), 4), "boxPx": box})
            draw.rectangle(box, outline="#e83f78", width=width)
            draw.text((box[0], max(0, box[1] - 14)), f"{label} {score:.2f}", fill="#e83f78", stroke_width=1, stroke_fill="white")

        overlay_path = output_dir / f"{photo.stem}-table-transformer.png"
        overlay.save(overlay_path)
        counts = {label: sum(item["label"] == label for item in boxes) for label in model.config.id2label.values()}
        results.append(
            {
                "file": record["file"],
                "sha256": record["hash"],
                "sourceProductPage": record.get("productPage"),
                "marketGroup": "india-primary" if record["file"].startswith(("saffola-", "bagrrys-")) else "multilingual-secondary",
                "imageSizePx": {"width": image.width, "height": image.height},
                "annotatedNutrientCount": len(record["manualAnnotation"]["nutrients"]),
                "inferenceMs": inference_ms,
                "detectionsAtScoreThreshold0_5": len(boxes),
                "classCounts": counts,
                "boxes": boxes,
                "overlay": str(overlay_path.relative_to(ROOT)),
            }
        )

    stop_monitor.set()
    monitor.join(timeout=1)
    peak_rss[0] = max(peak_rss[0], process.memory_info().rss)
    output = {
        "schemaVersion": 1,
        "kind": "exploratory-table-transformer-structure-probe",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "model": {
            "id": MODEL_ID,
            "revision": MODEL_REVISION,
            "license": "MIT",
            "trainingDomain": "PubTables-1M document tables",
            "checkpointBytes": weights.stat().st_size,
            "checkpointSha256": MODEL_SHA256,
            "threshold": 0.5,
            "scoreCalibration": "not established",
        },
        "runtime": {
            "python": os.sys.version.split()[0],
            "torch": torch.__version__,
            "transformers": transformers.__version__,
            "device": "CPU",
            "threads": torch.get_num_threads(),
            "modelLoadMsAfterImports": load_ms,
            "peakProcessRssBytes": peak_rss[0],
        },
        "evaluationScope": {
            "primaryMarket": "Indian packaged food",
            "primaryFiles": [name for name in args.images if name.startswith(("saffola-", "bagrrys-"))],
            "secondaryFiles": [name for name in args.images if not name.startswith(("saffola-", "bagrrys-"))],
            "datasetSplit": "previously explored development images only; no held-out claim",
            "inputMethod": "full nutrition-label photograph supplied directly to the structure model; no separate table detector or human crop",
            "measurements": "detection boxes, class counts and runtime only; no independent row/column geometry annotations, OCR-text association or structured-field accuracy",
        },
        "images": results,
        "privacy": "Images and derived overlays remain in the ignored local evidence directory; no image upload or provider call is made.",
    }
    output_path = output_dir / "structure-probe.json"
    output_path.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output_path.relative_to(ROOT)), "loadMs": load_ms, "peakRssBytes": peak_rss[0], "images": [{"file": item["file"], "inferenceMs": item["inferenceMs"], "counts": item["classCounts"]} for item in results]}, indent=2))


if __name__ == "__main__":
    main()
