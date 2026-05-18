# Volleyball CV

Local web app for processing volleyball match recordings: detects rallies via motion analysis, cuts dead time, tracks scores, and exports clean MP4s ready for YouTube.

## What it does

1. **Upload** raw set recordings (up to 3 sets per match)
2. **Process** — OpenCV MOG2 background subtraction detects rally segments automatically
3. **Review** — inspect detected rallies, edit timestamps, record home/away scores per rally
4. **Export** — ffmpeg cuts and joins rally segments into a clean MP4 per set

---

## Prerequisites

### System packages

| Package | Why |
|---------|-----|
| **Python 3.12** | Backend runtime |
| **Node.js 20** | Frontend dev server and build |
| **ffmpeg** | Video cutting and joining (must be on `PATH`) |

Install ffmpeg:
```bash
# macOS
brew install ffmpeg

# Ubuntu / Debian
sudo apt-get install ffmpeg

# Windows — download from https://ffmpeg.org/download.html and add to PATH
```

### Python environment

The backend uses `opencv-python-headless` which requires no display server. On headless Linux servers no extra system packages are needed beyond ffmpeg.

---

## Setup — local development

### 1. Clone the repo

```bash
git clone git@github.com:wesclee/volleyball-cv.git
cd volleyball-cv
```

### 2. Backend

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Run the API server:

```bash
# From the repo root
PYTHONPATH=backend uvicorn backend.main:app --port 8000 --reload
```

The server creates `data/uploads/` and `data/exports/` on first start. The SQLite database lives at `data/volleyball_cv.db`.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

The frontend expects the backend at `http://localhost:8000`. Both must be running at the same time during development.

---

## Setup — Docker (production-style)

Requires Docker and Docker Compose.

```bash
docker compose up --build
```

| Service | URL |
|---------|-----|
| Frontend (nginx) | http://localhost:3000 |
| Backend (FastAPI) | http://localhost:8000 |

Video files are persisted via the `./data` volume mount. Stop with `docker compose down`.

---

## Running tests

### Backend

```bash
# From repo root, with venv active
PYTHONPATH=backend python3.12 -m pytest tests/ -v
```

### Frontend

```bash
cd frontend
npm test
```

---

## Project structure

```
volleyball-cv/
├── backend/
│   ├── main.py              FastAPI app — CORS, static file mounts, router wiring
│   ├── config.py            DATA_DIR / UPLOADS_DIR / EXPORTS_DIR paths
│   ├── database.py          SQLAlchemy engine + session
│   ├── models/              ORM models (Match, Video, Job, Rally, ProcessedVideo)
│   ├── schemas/             Pydantic request/response schemas
│   ├── routers/             matches, videos, jobs, rallies endpoints
│   ├── cv/
│   │   ├── detector.py      BaseDetector ABC + RallySegment dataclass
│   │   └── motion_detector.py  Tier 1: MOG2 background subtraction
│   ├── editor/
│   │   └── ffmpeg_editor.py cut_and_join() — trims and concatenates rally clips
│   └── jobs/
│       └── processor.py     BackgroundTask pipeline: detect → persist → export
├── frontend/
│   ├── src/
│   │   ├── types.ts         TypeScript interfaces mirroring all backend schemas
│   │   ├── api/client.ts    Typed fetch wrappers for every endpoint
│   │   └── views/
│   │       ├── MatchManager.tsx    List + create matches
│   │       ├── UploadProcess.tsx   Upload set videos + poll processing progress
│   │       ├── RallyReview.tsx     Review rallies, edit timestamps, record scores
│   │       ├── ExportUpload.tsx    Trigger export + download links
│   │       └── ActiveLearning.tsx  Stub — implemented in Plan 3
│   └── Dockerfile           Multi-stage: Node build → nginx:alpine serve
├── tests/                   pytest integration tests (TestClient + SQLite in-memory)
├── docker-compose.yml
└── data/                    Created at runtime — gitignored
    ├── uploads/             Raw video files
    └── exports/             Processed MP4 exports
```

---

## How the rally detector works

The Tier 1 detector (`MotionDetector`) uses OpenCV's MOG2 background subtraction:

1. **Warm-up phase** (first 60 frames): MOG2 learns the static background at `learningRate=-1`
2. **Detection phase**: `learningRate=0` freezes the model so sustained foreground motion (players) stays flagged rather than being absorbed into the background
3. A state machine over per-frame motion scores identifies rally start/end with configurable thresholds

This works well for a static camera on a fixed court. Tier 2 (YOLOv8 fine-tuning) is planned for Plan 3.

---

## Roadmap

- **Plan 3** — Active Learning + Tier 2 YOLOv8 fine-tuning pipeline
- **Plan 4** — YouTube OAuth2 upload integration
