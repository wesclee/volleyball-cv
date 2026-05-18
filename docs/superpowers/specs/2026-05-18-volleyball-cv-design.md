# Volleyball CV — Design Spec
_Date: 2026-05-18_

## Overview

A local web app (Python FastAPI + React) that ingests raw volleyball set recordings, detects rallies via motion detection and fine-tuned YOLOv8, cuts dead time, tracks scores via one-click prompts, and exports a clean MP4 ready for YouTube upload — with an active learning loop that surfaces only uncertain frames for review and improves the model with each match.

**User:** Solo player doing personal VOD review. Not shared/hosted — runs entirely on local machine.

**Input:** 1–3 MP4 files per match (~15–20 min each), recorded from a phone on a tripod at full-court angle.

**Output:** Trimmed MP4 per match (rallies only, score overlay), uploaded directly to YouTube or downloaded.

---

## Architecture

```
frontend/          React + TypeScript + Vite
backend/           Python FastAPI
  ├── cv/          Computer vision pipeline (OpenCV + YOLOv8)
  ├── editor/      Video editing (ffmpeg-python)
  └── youtube/     YouTube Data API v3
docker-compose.yml Spins everything up locally
```

**Request flow:**
1. User uploads 1–3 set videos via the React UI
2. FastAPI stores them and starts an async background processing job per video
3. CV pipeline detects rally start/end timestamps (Tier 1 immediately, Tier 2 when a trained model exists)
4. ffmpeg cuts dead time, stitches rallies, burns in score overlay
5. User previews the result, then downloads or pushes to YouTube

**Key dependencies:**
- `ultralytics` (YOLOv8) — ball + player detection
- `opencv-python` — frame processing, motion analysis, background subtraction
- `ffmpeg-python` — video cutting, concatenation, text overlay
- `google-api-python-client` — YouTube Data API v3
- FastAPI background tasks — async job processing (no Celery needed for single-user local use)

---

## CV Pipeline

### Tier 1 — Motion Detection (works immediately, no training required)

- OpenCV MOG2 background subtraction on the static camera feed
- Court ROI mask defined once by the user (drag a box in the UI on first use)
- Sustained high motion (>1s) in the ROI = rally start
- Sustained low motion (>2s) = rally end
- Accuracy: ~75–85% on rally detection

### Tier 2 — YOLOv8 Fine-Tuned (replaces Tier 1 once trained)

- Detects volleyball position per frame
- Ball moving within ROI = rally in progress
- Ball missing or stationary = dead time
- Fine-tuned on user's own footage for their specific court, lighting, and camera

### Detector Interface

The pipeline has a swappable detector interface so Tier 1 and Tier 2 are interchangeable. The active model is configurable; Tier 1 is the default until a trained model is promoted.

### Bootstrapping Tier 2

Before any fine-tuned model exists, Tier 2 needs an initial training set. The bootstrap flow:

1. Run Tier 1 on 1–2 matches → get rally timestamps
2. System extracts frames sampled from within rally segments (ball is likely visible)
3. User labels those frames with bounding boxes (the one time bbox drawing is the first resort)
4. ~200–500 labeled frames is enough for an initial fine-tune
5. After initial training, the active learning loop takes over and bbox work drops to escalation-only

This is a one-time cost. The Active Learning Review view has a "Bootstrap mode" that presents the sampled frames for labeling.

### Active Learning Loop

```
Batch ingest (hours of footage)
    │
    ▼
Current detector scores every frame
    │
    ├── confidence > 0.85 → auto-accept → training set
    ├── confidence 0.40–0.85 → queued for human review
    └── confidence < 0.40 → auto-reject
    │
    ▼
Review queue (only uncertain frames surfaced to user)
    │
    ▼
User reviews via multi-choice UI (keyboard-driven, one keypress per frame)
    │
    ▼
Confirmed labels → accumulated dataset
    │
    ▼
User triggers retrain → fine-tune from last model checkpoint (~5–10 min)
    │
    ▼
Model promotion gate → user approves before new model goes active
    │
    ▼
Fewer uncertain frames next batch (compounds over time)
```

**Review UI decisions surfaced to user:**
- Ball detection: `Y` confirm / `N` reject / `P` partially visible / `S` skip
- Score attribution (end of each rally): `[Home scored]` / `[Away scored]`
- Set break vs long pause: `[Set break]` / `[Timeout/injury]`
- Model promotion: old-vs-new comparison on 5 sample frames, user approves
- Annotation escalation: when the model is consistently wrong on a pattern (8+ failures), escalates from multi-choice to bbox drawing for 5 targeted examples

**Bounding box annotation** is available but not the default — triggered only by escalation when multi-choice review is insufficient.

---

## Data Model

### Core

| Entity | Key fields |
|--------|-----------|
| `Match` | id, date, opponent, venue, notes |
| `Video` | id, match_id, set_number, raw_path, status, duration |
| `Job` | id, video_id, status, progress_pct, error, created_at |
| `Rally` | id, video_id, start_time, end_time, score_home, score_away, confidence |
| `ProcessedVideo` | id, match_id, output_path, created_at |

### Active Learning

| Entity | Key fields |
|--------|-----------|
| `LabeledFrame` | id, video_id, frame_number, timestamp, annotations (YOLO JSON), confidence, review_status |
| `ModelVersion` | id, name, weights_path, precision, recall, dataset_size, created_at, is_active |
| `TrainingRun` | id, base_model_id, new_model_id, frames_used, epochs, duration_s, status |

---

## API

```
# Match + video management
POST   /matches                       create match
POST   /matches/{id}/videos           upload raw video file
POST   /videos/{id}/process           start CV processing job
GET    /jobs/{id}                     poll job status + progress

# Rally + score
GET    /videos/{id}/rallies           list detected rallies
PATCH  /rallies/{id}                  correct score / edit timestamps

# Review queue
GET    /review/queue                  next batch of low-confidence frames
POST   /review/frames/{id}            submit multi-choice label
POST   /review/frames/{id}/bbox       submit bounding box (escalated)

# Training
POST   /training/run                  trigger fine-tune from confirmed labels
GET    /models                        list model versions with metrics
POST   /models/{id}/promote           approve new model as active

# Export + YouTube
POST   /matches/{id}/export           generate processed video
POST   /exports/{id}/upload-youtube   push to YouTube (OAuth required)
GET    /youtube/auth                  OAuth2 redirect
GET    /youtube/callback              OAuth2 token exchange
```

---

## Frontend (5 views)

**1. Match Manager** — home screen, list of matches, create new, processing status at a glance.

**2. Upload + Process** — drag-drop up to 3 video files (Set 1/2/3), hit Process. Live progress bar per video. Tier 1 runs first for fast rough output; Tier 2 runs on top if a trained model is active.

**3. Rally Review** — timeline of detected rallies per set. Click any rally to preview the clip. After each rally end: `[Home scored]` / `[Away scored]` prompt (one click per point). Drag rally boundaries to fine-tune timestamps before export.

**4. Active Learning Review** — low-confidence frame queue. One frame at a time with bbox highlighted. Keyboard-driven: `Y/N/P/S`. Progress counter ("12 of 47 reviewed"). Escalates to bbox draw mode when triggered. Retrain button clears the queue and kicks off fine-tuning.

**5. Export + Upload** — select sets to include, preview combined video, download MP4 or push to YouTube. Model promotion comparison shown here: 5-frame old-vs-new diff, user approves upgrade.

---

## YouTube Integration

- One-time OAuth2 setup: user clicks "Connect YouTube", grants upload permission, token stored locally
- Upload via YouTube Data API v3 `videos.insert`
- Title/description/tags pre-filled from match metadata, editable before upload
- Privacy defaults to `unlisted`
- Daily API quota: 10,000 units/day (~6 uploads/day) — sufficient for personal use

---

## Stats (future phase)

Once Tier 2 is trained and reliable, the following can be derived from ball + player tracking:
- Serve stats
- Attack/kill percentage
- Block percentage
- Pass quality
- Errors

These are explicitly out of scope for v1 but the data model and CV pipeline are designed to support them.

---

## Out of Scope (v1)

- Multi-user / hosted deployment
- Real-time analysis (live game)
- Automatic score detection (user provides score via one-click prompts)
- Stats (future phase, post Tier 2 training)
- Mobile app
