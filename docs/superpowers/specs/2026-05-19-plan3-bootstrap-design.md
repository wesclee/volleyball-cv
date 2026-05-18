# Plan 3 — Bootstrap + YOLOv8 Initial Training Design Spec
_Date: 2026-05-19_

## Overview

Plan 3 adds the bootstrap path that turns the Tier 1 motion detector into a fine-tuned Tier 2 YOLOv8 ball detector. The user extracts frames from already-processed videos, draws bounding boxes on ~200–500 frames in a canvas UI, triggers a training run, evaluates the result against a held-out test set, and promotes the model if it passes. Plan 4 (active learning loop) builds on top of this.

**Scope boundary:** Plan 3 ends at a promoted YOLOv8 model that the processor will use for all future jobs. Active learning (confidence-based frame routing, keyboard review queue, retrain cycle) is out of scope.

---

## Architecture

New components only — existing backend/frontend are unchanged.

```
backend/
  cv/
    yolo_detector.py        # Tier 2 BaseDetector using a .pt weights file
  training/
    frame_extractor.py      # sample frames from rally segments → data/frames/
    trainer.py              # YOLOv8 fine-tune, reads dataset/, writes weights
    reconciler.py           # disk ↔ DB drift detection and healing
  routers/
    bootstrap.py            # all new API routes

data/
  frames/                   # raw extracted JPEGs (source of truth for images)
  dataset/
    images/
      train/                # copies of frames used during training
      val/
      test/
    labels/
      train/                # YOLO .txt annotation files
      val/
      test/
    data.yaml               # generated before each training run
  models/                   # saved .pt weight files

frontend/
  src/views/
    ActiveLearning.tsx      # replaces stub — full bootstrap UI
```

`YoloDetector` implements the existing `BaseDetector` interface and slots into `processor.py` without touching any existing routes. The processor checks for an active `ModelVersion` at job start and uses `YoloDetector` if one exists, `MotionDetector` otherwise.

---

## Data Model

Three new SQLAlchemy tables added to `backend/models/match.py`.

### `LabeledFrame`

| Column | Type | Notes |
|--------|------|-------|
| `id` | int PK | |
| `video_id` | int FK → videos | |
| `frame_number` | int | frame index in source video |
| `timestamp` | float | seconds from video start |
| `img_path` | str | absolute path to JPEG in `data/frames/` |
| `label_path` | str | absolute path to YOLO `.txt` file in `data/dataset/labels/` |
| `split` | enum | `train / val / test` — assigned at extraction, never changed |
| `review_status` | enum | `pending / annotated / skipped / missing` |
| `created_at` | datetime | |

Annotation format: each `.txt` has one line `0 cx cy w h` (normalised, class 0 = ball). Empty file = frame reviewed as "no ball visible." Single class only — polygons/segmentation out of scope.

### `ModelVersion`

| Column | Type | Notes |
|--------|------|-------|
| `id` | int PK | |
| `name` | str | human label e.g. "v1-2026-05-19" |
| `weights_path` | str | absolute path to `.pt` file |
| `dataset_size` | int | number of training frames used |
| `test_precision` | float | evaluated on held-out test split |
| `test_recall` | float | |
| `test_map50` | float | |
| `is_active` | bool | only one row can be True at a time |
| `created_at` | datetime | |

### `TrainingRun`

| Column | Type | Notes |
|--------|------|-------|
| `id` | int PK | |
| `status` | enum | `pending / running / done / error` |
| `base_model_id` | int FK → model_versions (nullable) | null = train from YOLOv8 pretrained weights |
| `new_model_id` | int FK → model_versions (nullable) | set on completion |
| `frames_used` | int | annotated + non-skipped frames in training set |
| `epochs` | int | |
| `final_loss` | float | |
| `duration_s` | float | |
| `error` | str (nullable) | truncated traceback on failure |
| `created_at` | datetime | |

---

## Reconciler

`backend/training/reconciler.py` — runs automatically as a preflight before every training run, also callable via `POST /admin/reconcile`.

| Scenario | Action |
|----------|--------|
| DB row exists, `img_path` file missing | Set `review_status = missing`, log warning |
| DB row `status = pending` but `label_path` file exists | Restore to `annotated` (disk is truth) |
| DB row `status = annotated` but `label_path` file missing | Reset to `pending`, log warning |
| JPEG in `data/frames/` with no DB row | Re-register as new `LabeledFrame` with `status = pending` |
| `label_path` content is malformed (not valid YOLO format) | Delete bad `.txt`, reset status to `pending`, log warning |
| Frame appears in multiple dataset splits on disk | Remove from all but `split` recorded in DB, log warning |

**Write ordering:** disk first, then DB — always. On a crash between the two, the reconciler restores from disk on next run.

**Return payload:** `{missing: N, restored: N, reregistered: N, malformed: N, split_conflicts: N, ok: N}` — surfaced in the UI after reconcile completes.

---

## API

All new routes in `backend/routers/bootstrap.py`.

```
# Frame extraction
POST   /bootstrap/extract/{video_id}
       body: {sample_rate: int = 30, max_frames: int = 500, split: {train: 0.8, val: 0.1, test: 0.1}}
       → starts BackgroundTask, returns {job_id}
       Samples every Nth frame from within rally segments only.
       Assigns each frame to train/val/test split stratified-randomly at extraction time.

GET    /bootstrap/frames
       query: ?status=pending|annotated|skipped|missing&split=train|val|test
       → paginated list of LabeledFrame rows

GET    /bootstrap/frames/{id}/image
       → serves JPEG file

# Annotation
POST   /bootstrap/frames/{id}/annotate
       body: {cx: float, cy: float, w: float, h: float}  (normalised 0.0–1.0)
       → writes .txt to disk, updates review_status = annotated

POST   /bootstrap/frames/{id}/skip
       → writes empty .txt to disk, updates review_status = skipped

# Reconcile
POST   /admin/reconcile
       → runs reconciler, returns summary dict

# Status
GET    /bootstrap/status
       → {frames_total, annotated, skipped, pending, missing, model_ready, active_model_id}
       model_ready = True when annotated >= min_frames (default 200)

# Training
POST   /training/run
       body: {epochs: int = 50}
       → preflight reconcile, then starts BackgroundTask, returns {run_id}
       Blocked if annotated < min_frames or a run is already in progress.

GET    /training/runs/{id}
       → {status, frames_used, epochs_done, epochs_total, final_loss, duration_s, error}

# Models
GET    /models
       → list of ModelVersion rows ordered by created_at desc

POST   /models/{id}/promote
       → sets is_active = True, deactivates previous active model
       Blocked if net_delta ≤ 0 (see promotion gate below).
       First model ever: gate skipped, always allowed.
```

---

## Promotion Gate

After a training run completes, the new model is automatically evaluated on the held-out test split. Results stored in `ModelVersion`.

```
net_delta = (new_precision - old_precision)
          + (new_recall    - old_recall)
          + (new_map50     - old_map50)
```

- `net_delta > 0` → `POST /models/{id}/promote` is allowed, Promote button enabled
- `net_delta ≤ 0` → endpoint returns 409, Promote button disabled
- No active model (first run) → gate skipped entirely, promotion always allowed

The user is always asked before promotion happens regardless of gate outcome.

---

## CV Pipeline Integration

`backend/jobs/processor.py` gains a model resolution step at the top of `_run_pipeline`:

```python
active = db.query(ModelVersion).filter_by(is_active=True).first()
detector = YoloDetector(active.weights_path) if active else MotionDetector()
```

No other changes to the existing pipeline. `YoloDetector` implements `BaseDetector.detect()` — returns `list[RallySegment]` with real confidence values (0.0–1.0) from model output.

---

## Frontend — ActiveLearning View

The stub is replaced with a two-phase UI, controlled by `bootstrap/status.model_ready`.

### Phase A — Annotation (model_ready = false)

**Header bar:**
- "X / Y frames annotated" progress counter
- Extract Frames button → calls `/bootstrap/extract/{video_id}` on the most recently processed video; shows extraction progress
- Split config: editable train/val/test percentages (must sum to 100), defaults 80/10/10

**Canvas annotation panel:**
- Full-width frame image rendered on a `<canvas>` element
- Click-drag draws a bounding box; box is previewed in real time as an overlay rect
- On release: box normalised to image dimensions, displayed as locked overlay
- Buttons: **Confirm** (Enter) / **No ball** (N) / **Skip** (S) / **Redo** (R clears current box)
- Auto-advances to next `pending` frame after each action

**Start Training button:** unlocks when `annotated >= 200` (configurable via `min_frames`).

### Phase B — Training + Promotion (after Start Training clicked)

- Polls `/training/runs/{id}` every 3s
- Shows epoch progress bar + current loss
- On completion: displays promotion comparison table (see below)
- On error: shows truncated error message with a "Retry" option

**Promotion table:**

```
Test set results

              Old model    New model    Change
Precision       0.79         0.84       +0.05  ✓
Recall          0.88         0.84       -0.04  ✗
mAP50           0.81         0.87       +0.06  ✓

Net delta: +0.07

[Promote]   [Discard]
```

Promote button enabled/disabled per net_delta gate. First run shows absolute metrics only with no comparison column.

### Canvas implementation

Standard React `useRef` on a `<canvas>`. `onMouseDown` records start point, `onMouseMove` redraws preview rect, `onMouseUp` locks the box. Coordinates normalised to `[0, 1]` relative to image dimensions before sending to API. No external library.

---

## Training Pipeline

`backend/training/trainer.py`:

1. Run reconciler preflight — abort if any `missing` frames were found in the annotated set (log, surface to user)
2. Populate `data/dataset/` — copy/symlink frames and `.txt` files into `images/{split}/` and `labels/{split}/` directories
3. Write `data/dataset/data.yaml`:
   ```yaml
   path: data/dataset
   train: images/train
   val: images/val
   test: images/test
   nc: 1
   names: [ball]
   ```
4. Load `ultralytics.YOLO("yolov8n.pt")` (pretrained base)
5. Call `model.train(data="data/dataset/data.yaml", epochs=N, imgsz=640, device=0)`
6. Save best weights to `data/models/run_{id}_best.pt`
7. Evaluate on test split: `model.val(data=..., split="test")` → extract precision/recall/mAP50
8. Create `ModelVersion` row with test metrics, set `TrainingRun.new_model_id`

Update `TrainingRun.status` at each stage. On exception: set `status = error`, store truncated traceback.

---

## Testing

- **Reconciler:** pytest fixtures for each scenario — missing file, extra file on disk, malformed `.txt`, split conflict. Assert DB state after each.
- **Frame extractor:** synthetic short MP4 (same pattern as existing tests). Assert correct frame count, split proportions, JPEG files on disk, DB rows created.
- **Annotation endpoint:** assert `.txt` written to disk with correct content + DB `review_status = annotated`.
- **Skip endpoint:** assert empty `.txt` written + `review_status = skipped`.
- **Promotion gate:** unit test `net_delta` calculation. Assert `/models/{id}/promote` returns 409 when net_delta ≤ 0.
- **Training:** mock `ultralytics.YOLO` — assert `TrainingRun` transitions `pending → running → done`, `ModelVersion` row created with metrics.
- **YoloDetector:** mock model inference — assert `detect()` returns `list[RallySegment]` with confidence values.

---

## Out of Scope

- Active learning loop (confidence routing, review queue) → Plan 4
- YouTube upload → Plan 5
- Stats (serve %, attack %) → future phase
- YOLOv8 model variant selection (n vs s) — expose as a UI dropdown in Plan 3, decide empirically after first training run
