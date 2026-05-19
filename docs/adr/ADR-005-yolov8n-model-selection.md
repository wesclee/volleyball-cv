# ADR-005: YOLOv8n for fine-tuned ball detection

**Status:** Accepted  
**Date:** 2026-05-19

## Context

The Tier 2 detector requires a YOLO model variant. Options range from `yolov8n` (nano, ~3.2M params) to `yolov8x` (extra-large, ~68M params). Larger models give higher baseline accuracy but require more VRAM and longer inference time.

Hardware constraint: GTX 1080, 8GB VRAM.

The detection task is single-class (volleyball), small object, static camera — a simpler task than general object detection benchmarks.

## Decision

Use `yolov8n.pt` (nano) as the base model for fine-tuning.

## Consequences

- Fits comfortably within 8GB VRAM for both training and inference.
- Inference is fast enough for batch frame processing without a dedicated inference queue.
- For a single-class, fixed-camera task, nano capacity is sufficient — the domain-specific fine-tune compensates for the smaller baseline.
- If accuracy proves insufficient after several training cycles, upgrading to `yolov8s` is a one-line config change.
