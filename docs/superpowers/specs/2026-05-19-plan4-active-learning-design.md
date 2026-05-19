# Plan 4 Design: Active Learning Loop

**Date:** 2026-05-19  
**Status:** Approved

---

## Overview

Plan 4 closes the model improvement loop. After Plan 3's bootstrap produces the first trained YOLOv8 model, every new video processed by that model generates uncertain frames — detections where the model isn't confident enough to auto-accept or auto-reject. Those frames are queued for human review, corrected labels feed back into the training pool, and a recommendation indicator tells the user when enough new data has accumulated to warrant a retrain.

The loop: **process video → queue uncertain frames → review → labels added → retrain recommended → retrain → promote → process next video with better model.**

---

## Data Model

### LabeledFrame — new columns

Five nullable columns store the model's prediction for active-learning frames:

| Column | Type | Description |
|--------|------|-------------|
| `pred_cx` | `float \| None` | Predicted bbox center x (normalised 0–1) |
| `pred_cy` | `float \| None` | Predicted bbox center y (normalised 0–1) |
| `pred_w` | `float \| None` | Predicted bbox width (normalised 0–1) |
| `pred_h` | `float \| None` | Predicted bbox height (normalised 0–1) |
| `pred_conf` | `float \| None` | Predicted confidence score |

`pred_conf IS NOT NULL` is the discriminator between active-learning frames (model had a prediction) and bootstrap frames (drawn from scratch). No new `review_status` value is needed — both flows use `pending → annotated | skipped`.

### Configuration constants (config.py, all env-backed)

| Constant | Default | Meaning |
|----------|---------|---------|
| `ACTIVE_LOW_CONF` | `0.4` | Below this: auto-reject, frame not queued |
| `ACTIVE_HIGH_CONF` | `0.85` | Above this: auto-accept, frame not queued |
| `RETRAIN_THRESHOLD` | `50` | New labeled frames since last train to recommend retrain |

---

## Processor Changes

`_run_pipeline` in `processor.py` gains an active learning step after detection.

### YoloDetector extension

Add `detect_with_scores(video_path) -> tuple[list[RallySegment], list[float]]` to `YoloDetector`. This reuses the single `model.predict()` pass already made in `detect()` — no second model run. Returns both the rally segments and the per-frame confidence scores (max detection confidence per frame, 0.0 if no detection).

### Frame queuing (YoloDetector path only)

After `detect_with_scores()`:

1. Collect all frame indices where `ACTIVE_LOW_CONF <= score <= ACTIVE_HIGH_CONF`
2. No cap on count — all uncertain frames are queued
3. Sort by confidence ascending (most uncertain first — highest training value per review)
4. For each frame: extract JPEG to `FRAMES_DIR`, run single-frame `model.predict()` to get the bbox, write `LabeledFrame` with `pred_conf` set and `pred_cx/cy/w/h` set if a bbox was returned (if single-frame predict returns no detection, store bbox fields as `None` — the review UI shows a blank canvas for the user to draw on), `review_status=pending`
5. Skip frames already in `labeled_frames` for this video (same double-extraction guard as the extractor)

When the detector is `MotionDetector` (no model yet), this step is skipped entirely.

---

## Frontend — LabelingQueue view

`ActiveLearning.tsx` is replaced by `LabelingQueue.tsx` at the same route (`/active-learning`). The view detects its mode automatically from API state.

### Bootstrap mode (no active model)

Identical to the current Phase A: extract frames from a video, draw bboxes from scratch using the existing canvas component, start training when ready. No changes to this flow.

### Active review mode (model exists, pending queue non-empty)

Same canvas layout as bootstrap. The model's predicted bbox is pre-drawn in yellow. Review actions:

| Action | Key | Button | Effect |
|--------|-----|--------|--------|
| Confirm prediction | Enter | Confirm | Accepts predicted bbox as-is |
| Correct prediction | drag + Enter | Confirm | Replaces predicted bbox with drawn rect |
| No ball | N | No ball | Marks frame skipped, empty label |
| Skip (defer) | S | Skip | Moves to next frame, leaves pending |
| Redo | R | Redo | Clears drawn rect |

Frames are served in `pred_conf ASC` order (most uncertain first).

### Retrain recommendation panel

Visible at the top of the view whenever a model exists (both modes):

```
[ 312 / 362 new frames · last trained at 200 ]  [ Retrain ]
```

- Counter: `new_labeled_since_last_train / (last_trained_at_size + RETRAIN_THRESHOLD)`
- Retrain button highlighted (green) when `retrain_recommended = true`
- Button always clickable — user can retrain at any time
- On click: transitions to the existing `TrainingPhase` + `PromotionPanel` flow

---

## Backend Routes

All existing bootstrap and training routes are unchanged. Two targeted additions:

### Rename + extend status endpoint

`GET /bootstrap/status` → `GET /labeling/status`

Existing fields kept. New fields added to `LabelingStatus` response:

| Field | Type | Description |
|-------|------|-------------|
| `new_labeled_since_last_train` | `int` | Labeled frames since most recent ModelVersion |
| `retrain_recommended` | `bool` | `new_labeled_since_last_train >= RETRAIN_THRESHOLD` |
| `last_trained_at_size` | `int \| None` | `dataset_size` of most recent ModelVersion |

`new_labeled_since_last_train` = count of `LabeledFrame` rows with `review_status IN (annotated, skipped)` and `created_at > last_model.created_at`. Zero if no model exists.

### New queue endpoint

`GET /labeling/queue` — returns pending `LabeledFrame` rows where `pred_conf IS NOT NULL`, ordered by `pred_conf ASC`. Used by the frontend to populate the active review queue separately from bootstrap frames.

---

## Testing

### Backend

- **`test_processor.py`** — patch `YoloDetector.detect_with_scores`; verify uncertain frames are written to `labeled_frames` with `pred_*` fields; verify frames outside the band are not queued; verify `MotionDetector` path skips queuing; verify duplicate frames are not re-queued
- **`test_labeling_routes.py`** — `/labeling/status` returns correct `new_labeled_since_last_train` and `retrain_recommended`; `/labeling/queue` returns only active-learning frames ordered by `pred_conf ASC`

### Frontend

- **`LabelingQueue.test.tsx`** — bootstrap mode renders when no active model; active review mode renders with predicted bbox visible; confirm/correct/no-ball call correct API endpoints; retrain panel shows correct counter and threshold; Retrain button highlighted when recommended; transitions to TrainingPhase on click

---

## What Does Not Change

- Bootstrap extraction routes (`/bootstrap/extract`, `/bootstrap/frames`, `/bootstrap/frames/{id}/annotate`, `/bootstrap/frames/{id}/skip`, `/bootstrap/frames/{id}/image`)
- Training routes (`/training/run`, `/training/runs/{id}`, `/models`, `/models/{id}/promote`)
- `TrainingPhase` and `PromotionPanel` components
- Promotion gate logic (`net_delta > 0`)
- Reconciler
