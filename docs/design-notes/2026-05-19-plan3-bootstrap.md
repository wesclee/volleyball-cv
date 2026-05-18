# Design Notes — Plan 3 Bootstrap (2026-05-19)

## Session goal

Design the bootstrap path for Tier 2 YOLOv8 detection: frame extraction from rally segments → bbox annotation UI → initial fine-tune → model promotion. Active learning loop is deferred to Plan 4.

---

## Decisions made

### Scope split

**Decision:** Plan 3 = bootstrap only (frame extraction, bbox labeling, first training run, model promotion). Plan 4 = active learning loop (confidence-based routing, keyboard review queue, retrain cycle).

**Reason:** Keeping them separate so a bad design in one doesn't force a redesign of the other.

---

### Storage architecture

**Decision:** Hybrid — frames + YOLO `.txt` annotation files live on disk, DB tracks job state and metadata only.

**Alternatives considered:**
- DB-centric (annotations as JSON in SQLite) — rejected: YOLO training reads files natively, export step would be awkward
- Filesystem-centric (no DB) — rejected: no job tracking or status polling

**Reconciliation rule:** Disk is truth for annotation content, DB is truth for job state.

- If `.txt` file exists but DB says `pending` → restore DB to `annotated`
- If DB says `annotated` but `.txt` missing → reset to `pending`, log warning
- If image file missing → mark `review_status = missing`, skip in training
- If JPEG on disk with no DB row → re-register as `pending`
- Write order is always: disk first, then DB (crash-safe)
- Reconciler runs automatically before every training run and is also callable manually via `POST /admin/reconcile`

---

### Bbox annotation format

**Decision:** Rectangular bounding boxes only, YOLO format (`0 cx cy w h`, normalised coords). One line per frame, class 0 = ball. Empty `.txt` file = "no ball visible."

**Reason:** YOLOv8 detection task uses axis-aligned rectangles. Polygons are for segmentation (different model, different task — out of scope).

---

### Annotation UI

**Decision:** Custom React canvas built into the ActiveLearning view. Click-drag to draw a rect, Confirm / No ball / Skip buttons (keyboard: Enter / N / S). No external library.

**Reason:** Single class, one bbox per frame — this is ~50 lines of canvas code. External labeling tools (LabelImg, CVAT) add friction (install, navigate to folder, import back) that would discourage doing the bootstrap at all.

---

### Training execution

**Decision:** FastAPI `BackgroundTask` (same pattern as CV pipeline), not a subprocess.

**Reason:** Training is a deliberate one-shot action where the machine is expected to be busy. BackgroundTask is sufficient for a single-user local app. Subprocess adds complexity (IPC for status updates, zombie handling) with no practical benefit here.

**Hardware context:** GTX 1080 (8GB VRAM). Use YOLOv8n or YOLOv8s — both fit comfortably. Expected training time: 5–10 min for initial bootstrap dataset.

---

### Train/val/test split

**Decision:** Configurable in the UI, defaulting to **80/10/10**.

**Reason:** Bootstrap dataset is small (200–500 frames). 70/15/15 wastes training data — 15% of 300 frames is only 45 frames per split, too thin. 80/10/10 maximises training frames while keeping a meaningful held-out test set.

**Assignment:** Stratified random at frame extraction time. Split assigned once, never reassigned. Reconciler verifies no frame appears in multiple splits.

---

### Model promotion gate

**Decision:** Net delta promotion gate — always ask the user, but enable/disable the Promote button based on net improvement.

**Gate formula:**
```
net_delta = (new_precision - old_precision)
          + (new_recall - old_recall)
          + (new_map50 - old_map50)

net_delta > 0  → Promote button enabled,  "Model improved overall"
net_delta ≤ 0  → Promote button disabled, "Model did not improve overall"
```

**Reason:** A single mAP50 gate could veto a model that meaningfully improves precision (fewer false alarms) even if recall dips slightly. Net delta across all three metrics captures overall direction without any single metric having veto power.

**Negative detections:** Correctly identifying frames with no ball is captured by precision — false positives (predicting ball when there isn't one) directly lower precision. No separate metric needed.

**First training run:** No active model to compare against → skip the gate entirely, show absolute metrics, always allow promotion.

---

### Promotion screen layout

After training completes, the UI shows:

```
Test set evaluation

                Old model    New model
Precision         0.xx         0.xx     ✓/✗
Recall            0.xx         0.xx     ✓/✗
mAP50             0.xx         0.xx     ✓/✗

Net delta: +/-0.xx

[Promote]  [Discard]
```

Promote button enabled/disabled per gate above. User is always asked regardless.

---

## New DB tables (summary)

| Table | Purpose |
|-------|---------|
| `LabeledFrame` | Frame metadata, disk paths, `review_status`, `split` (train/val/test) |
| `ModelVersion` | Weights path, precision/recall/mAP50 (test set), `is_active` |
| `TrainingRun` | Job tracking for training — status, epochs, loss, duration, FK to old/new ModelVersion |

---

## Out of scope for Plan 3

- Active learning loop (confidence-based routing, keyboard review queue) → Plan 4
- YouTube upload → Plan 5 (was Plan 4)
- Stats (serve %, attack %) → future phase

---

## Open questions / deferred

- What YOLOv8 model variant to default to (n vs s)? Can expose as a UI setting in Plan 3, decide empirically after first training run.
- Minimum frame count before training is allowed: 200 (configurable).
