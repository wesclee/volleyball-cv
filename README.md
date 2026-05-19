# Volleyball CV

Local web app for processing volleyball match recordings: detects rallies via CV, cuts dead time, tracks scores, and exports clean MP4s ready for YouTube. Includes a YOLOv8 active-learning pipeline that improves the detector over time as you label frames.

## What it does

1. **Upload** raw set recordings (up to 3 sets per match)
2. **Process** — detects rally segments automatically (MOG2 motion detector initially; YOLOv8 once a model is trained)
3. **Review** — inspect detected rallies, edit timestamps, record home/away scores
4. **Export** — ffmpeg cuts and joins rally segments into a clean MP4 per set
5. **Label** — annotate uncertain frames to train a custom ball detector; retrain as more data accumulates

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Python | 3.12 | Other 3.x versions untested |
| Node.js | 20 | |
| ffmpeg | any recent | Must be on `PATH` |

Install ffmpeg:

```bash
# macOS
brew install ffmpeg

# Ubuntu / Debian
sudo apt-get install ffmpeg

# Windows — download from https://ffmpeg.org/download.html, add bin/ to PATH
```

---

## Setup

### 1. Clone

```bash
git clone git@github.com:wesclee/volleyball-cv.git
cd volleyball-cv
```

### 2. Python environment

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cd ..
```

> **Note:** `ultralytics` requires PyTorch. `pip install -r requirements.txt` will install a CPU-only PyTorch build by default. For GPU inference, install the matching CUDA build of PyTorch first — see https://pytorch.org/get-started/locally/.

### 3. Frontend

```bash
cd frontend
npm install
cd ..
```

---

## Running

Both services must be running at the same time.

**Backend** (from repo root, with venv active):

```bash
uvicorn backend.main:app --port 8000 --reload
```

**Frontend** (from `frontend/`):

```bash
npm run dev
```

Open http://localhost:5173. The API is at http://localhost:8000.

On first start the backend creates:
```
data/
  uploads/          raw video files
  exports/          processed MP4s
  frames/           extracted frame JPEGs for labeling
  dataset/          YOLO training data
  models/           trained model weights
  volleyball_cv.db  SQLite database
```

---

## Docker (production-style)

```bash
docker compose up --build
```

| Service | URL |
|---------|-----|
| Frontend (nginx) | http://localhost:3000 |
| Backend (FastAPI) | http://localhost:8000 |

Data is persisted via the `./data` volume. Stop with `docker compose down`.

---

## Running tests

**Backend** (from repo root, with venv active):

```bash
python -m pytest tests/ -v
```

**Frontend** (from `frontend/`):

```bash
npm test
```

---

## Project structure

```
volleyball-cv/
├── backend/
│   ├── main.py              FastAPI app — CORS, router wiring
│   ├── config.py            Paths + active learning constants (ACTIVE_LOW_CONF, ACTIVE_HIGH_CONF, RETRAIN_THRESHOLD)
│   ├── database.py          SQLAlchemy engine + session factory
│   ├── models/match.py      ORM models: Match, Video, Job, Rally, LabeledFrame, ModelVersion, TrainingRun, ...
│   ├── schemas/match.py     Pydantic request/response schemas
│   ├── routers/
│   │   ├── matches.py       CRUD for matches + videos
│   │   ├── jobs.py          Job dispatch + status polling
│   │   ├── rallies.py       Rally review + score recording
│   │   ├── bootstrap.py     Frame extraction for initial labeling
│   │   ├── labeling.py      /labeling/status, /labeling/queue
│   │   ├── training.py      Training run dispatch + status
│   │   └── models.py        Model listing + promotion
│   ├── cv/
│   │   ├── detector.py      BaseDetector ABC + RallySegment dataclass
│   │   ├── motion_detector.py  Tier 1: MOG2 background subtraction
│   │   └── yolo_detector.py    Tier 2: YOLOv8 ball detector
│   ├── editor/
│   │   └── ffmpeg_editor.py cut_and_join() — trim and concatenate rally clips
│   ├── training/
│   │   ├── frame_extractor.py  Sample frames from processed videos for bootstrap labeling
│   │   ├── trainer.py          YOLOv8 fine-tuning pipeline
│   │   └── reconciler.py       Disk-DB consistency (disk is truth for annotation content)
│   └── jobs/
│       └── processor.py        BackgroundTask pipeline: detect → persist rallies → export → queue uncertain frames
├── frontend/
│   ├── src/
│   │   ├── types.ts            TypeScript interfaces matching all backend schemas
│   │   ├── api/client.ts       Typed fetch wrappers for every endpoint
│   │   └── views/
│   │       ├── MatchManager.tsx      List + create matches
│   │       ├── UploadProcess.tsx     Upload set videos + poll processing progress
│   │       ├── RallyReview.tsx       Review rallies, edit timestamps, record scores
│   │       ├── ExportUpload.tsx      Trigger export + download links
│   │       └── LabelingQueue.tsx     Bootstrap labeling + active review queue + retrain panel
│   └── Dockerfile              Multi-stage: Node build → nginx:alpine serve
├── tests/                      pytest integration tests (TestClient + SQLite)
├── backend/requirements.txt
├── frontend/package.json
├── docker-compose.yml
└── data/                       Created at runtime — gitignored
```

---

## How the detectors work

### Tier 1 — MotionDetector (no training required)

Uses OpenCV MOG2 background subtraction on a static camera:

1. **Warm-up** (first 60 frames): MOG2 learns the background
2. **Detection**: `learningRate=0` freezes the model so players stay flagged rather than absorbed into background
3. A state machine over per-frame motion scores identifies rally start/end segments

### Tier 2 — YoloDetector (requires labeled data)

Fine-tuned YOLOv8n that detects the volleyball directly:

1. **Bootstrap**: extract sample frames from processed videos, annotate bounding boxes in the UI
2. **Train**: once ≥ 200 frames are labeled, kick off a training run
3. **Promote**: if the new model's precision + recall + mAP50 improve overall, promote it as the active model
4. **Active learning**: every new video processed by the active model queues uncertain frames (confidence 0.4–0.85) for review, sorted most-uncertain-first — reviewed labels feed the next training run

---

## Roadmap

- **Plan 5** — YouTube OAuth2 upload integration
