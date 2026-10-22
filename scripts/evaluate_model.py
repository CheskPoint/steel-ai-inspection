"""Validate an installed CR7 detector against a user-supplied validation set.

Writes evidence to outputs/ for review. It never changes deployed weights,
business data, or the checked-in evaluation.json automatically.
"""

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png"}


def weight_sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, required=True, help="Ultralytics dataset YAML")
    parser.add_argument("--images", type=Path, required=True, help="Validation image directory")
    parser.add_argument("--weights", type=Path, default=ROOT / "backend/models/best.pt")
    parser.add_argument("--output", type=Path, default=ROOT / "outputs/model-evaluation")
    parser.add_argument("--batch", type=int, default=8)
    parser.add_argument("--image-size", type=int, default=640)
    parser.add_argument("--device", default="cpu")
    args = parser.parse_args()

    for path in (args.data, args.weights):
        if not path.is_file():
            parser.error(f"File not found: {path}")
    if not args.images.is_dir():
        parser.error(f"Image directory not found: {args.images}")
    if args.batch < 1 or args.image_size < 1:
        parser.error("Batch and image size must be positive")
    sample_count = sum(path.suffix.lower() in IMAGE_SUFFIXES for path in args.images.rglob("*"))
    if sample_count == 0:
        parser.error("Image directory contains no JPG or PNG files")

    from ultralytics import YOLO
    import torch
    import ultralytics

    args.output.mkdir(parents=True, exist_ok=True)
    fingerprint = weight_sha256(args.weights)
    model = YOLO(str(args.weights))
    print(f"Validating {sample_count} images against SHA-256 {fingerprint}", flush=True)
    metrics = model.val(
        data=str(args.data), split="val", imgsz=args.image_size,
        device=args.device, batch=args.batch, workers=0, conf=0.001, iou=0.7, plots=False,
        save_json=False, project=str(args.output), name="validation",
        exist_ok=True, verbose=False,
    )
    if weight_sha256(args.weights) != fingerprint:
        raise RuntimeError("Model weights changed during validation")

    classes = []
    for position, class_index in enumerate(metrics.box.ap_class_index):
        precision, recall, map50, map50_95 = metrics.box.class_result(position)
        classes.append({
            "name": model.names[int(class_index)], "precision": float(precision),
            "recall": float(recall), "map50": float(map50), "map50_95": float(map50_95),
        })

    evidence = {
        "status": "available", "model_sha256": fingerprint,
        "dataset": args.data.stem, "split": "val", "sample_count": sample_count,
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "device": args.device, "image_size": args.image_size,
        "precision": float(metrics.box.mp), "recall": float(metrics.box.mr),
        "map50": float(metrics.box.map50), "map50_95": float(metrics.box.map),
        "inference_ms": float(metrics.speed["inference"]),
        "inference_timing_scope": (
            f"{args.device}、batch={args.batch}，仅统计单图模型推理均值；"
            "不含预处理、后处理/NMS、读写、绘图、网络及数据库耗时。"
        ),
        "per_class": classes,
        "source": (
            f"当前权重在 {args.data.stem} 验证集的完整评估，共 {sample_count} 张图片；"
            "仅代表该验证集，不是独立外部测试或产线验收。"
        ),
        "runtime": {
            "ultralytics_version": ultralytics.__version__,
            "torch_version": torch.__version__, "python_version": sys.version.split()[0],
            "batch": args.batch, "conf": 0.001, "iou": 0.7,
        },
        "dataset_config_source": args.data.name,
    }
    target = args.output / "evaluation.json"
    target.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {target}")


if __name__ == "__main__":
    main()
