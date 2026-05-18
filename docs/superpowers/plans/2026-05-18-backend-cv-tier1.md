# Volleyball CV — Plan 1: Backend + CV Tier 1 + Video Editor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working local backend that accepts volleyball video uploads, detects rallies using OpenCV motion analysis, cuts dead time with ffmpeg, and returns trimmed MP4 files — testable end-to-end via the API with no frontend required.

**Architecture:** Python FastAPI with SQLite (SQLAlchemy 2.0), OpenCV MOG2 background subtraction for Tier 1 rally detection, ffmpeg-python for video editing. Background tasks handle long-running processing jobs. The detector is abstracted behind a swappable interface so Tier 2 (YOLOv8, Plan 3) slots in without touching the pipeline.

**Tech Stack:** Python 3.12, FastAPI 0.115, SQLAlchemy 2.0, OpenCV (opencv-python-headless), ffmpeg-python 0.2, pytest, Docker

---

## File Structure

```
volleyball-cv/
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py                    FastAPI app, mounts routers, creates DB tables on startup
│   ├── config.py                  DATA_DIR, UPLOADS_DIR, EXPORTS_DIR, DATABASE_URL
│   ├── database.py                engine, SessionLocal, Base, get_db()
│   ├── models/
│   │   ├── __init__.py            imports all models (registers them with Base)
│   │   └── match.py               Match, Video, Job, Rally, ProcessedVideo ORM classes
│   ├── schemas/
│   │   ├── __init__.py
│   │   └── match.py               Pydantic request/response schemas for all entities
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── matches.py             POST /matches, GET /matches, GET /matches/{id}, POST /matches/{id}/export
│   │   ├── videos.py              POST /matches/{id}/videos, POST /videos/{id}/process
│   │   ├── jobs.py                GET /jobs/{id}
│   │   └── rallies.py             GET /videos/{id}/rallies, PATCH /rallies/{id}
│   ├── cv/
│   │   ├── __init__.py
│   │   ├── detector.py            RallySegment dataclass, BaseDetector ABC
│   │   └── motion_detector.py     MotionDetector: MOG2 state-machine rally detection
│   ├── editor/
│   │   ├── __init__.py
│   │   └── ffmpeg_editor.py       cut_and_join(video_path, segments, output_filename) → str
│   └── jobs/
│       ├── __init__.py
│       └── processor.py           process_video(video_id, db_url): runs pipeline + editor
├── tests/
│   ├── conftest.py                env setup, clean_db fixture, client fixture
│   ├── test_matches.py            create/read matches
│   ├── test_videos.py             upload video file, trigger process
│   ├── test_motion_detector.py    synthetic video → assert rally segments detected
│   ├── test_ffmpeg_editor.py      synthetic video → assert output is shorter
│   └── test_rallies.py            list rallies, PATCH score attribution
├── data/
│   ├── uploads/                   raw uploaded videos (gitignored)
│   └── exports/                   processed outputs (gitignored)
├── docker-compose.yml
└── .gitignore
```

---

### Task 1: Project Scaffold

**Files:**
- Create: `volleyball-cv/.gitignore`
- Create: `volleyball-cv/docker-compose.yml`
- Create: `volleyball-cv/backend/Dockerfile`
- Create: `volleyball-cv/backend/requirements.txt`

- [ ] **Step 1: Create directory structure**

```bash
cd /home/leew4/volleyball-cv
mkdir -p backend/{models,schemas,routers,cv,editor,jobs} tests data/{uploads,exports}
touch backend/models/__init__.py backend/schemas/__init__.py backend/routers/__init__.py
touch backend/cv/__init__.py backend/editor/__init__.py backend/jobs/__init__.py
touch data/uploads/.gitkeep data/exports/.gitkeep
```

- [ ] **Step 2: Create .gitignore**

```
# /home/leew4/volleyball-cv/.gitignore
__pycache__/
*.pyc
*.db
data/uploads/
data/exports/
.env
backend/.venv/
node_modules/
dist/
```

- [ ] **Step 3: Create backend/requirements.txt**

```
fastapi==0.115.5
uvicorn[standard]==0.32.1
sqlalchemy==2.0.36
python-multipart==0.0.12
opencv-python-headless==4.10.0.84
ffmpeg-python==0.2.0
pydantic==2.9.2
pytest==8.3.3
httpx==0.28.0
numpy==2.1.3
```

- [ ] **Step 4: Create backend/Dockerfile**

```dockerfile
FROM python:3.12-slim

RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN mkdir -p /app/data/uploads /app/data/exports

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
```

- [ ] **Step 5: Create docker-compose.yml**

```yaml
version: '3.9'
services:
  backend:
    build: ./backend
    ports:
      - "8000:8000"
    volumes:
      - ./data:/app/data
    environment:
      - DATA_DIR=/app/data
      - DATABASE_URL=sqlite:////app/data/volleyball_cv.db
```

- [ ] **Step 6: Commit**

```bash
cd /home/leew4/volleyball-cv
git add .
git commit -m "chore: project scaffold — dirs, dockerfile, requirements"
```

---

### Task 2: Database Setup

**Files:**
- Create: `backend/config.py`
- Create: `backend/database.py`
- Create: `backend/models/match.py`
- Modify: `backend/models/__init__.py`

- [ ] **Step 1: Write failing test for table creation**

```python
# tests/test_db.py
from sqlalchemy import inspect
from backend.database import engine


def test_tables_created():
    from backend.models import Match, Video, Job, Rally, ProcessedVideo  # noqa
    from backend.database import Base
    Base.metadata.create_all(engine)
    inspector = inspect(engine)
    tables = inspector.get_table_names()
    for name in ("matches", "videos", "jobs", "rallies", "processed_videos"):
        assert name in tables, f"missing table: {name}"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/leew4/volleyball-cv
PYTHONPATH=backend pytest tests/test_db.py -v
```

Expected: `ModuleNotFoundError: No module named 'backend.database'`

- [ ] **Step 3: Create backend/config.py**

```python
# backend/config.py
import os
from pathlib import Path

DATA_DIR = Path(os.getenv("DATA_DIR", str(Path(__file__).parent.parent / "data")))
UPLOADS_DIR = DATA_DIR / "uploads"
EXPORTS_DIR = DATA_DIR / "exports"
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DATA_DIR}/volleyball_cv.db")

UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
```

- [ ] **Step 4: Create backend/database.py**

```python
# backend/database.py
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from backend.config import DATABASE_URL

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

- [ ] **Step 5: Create backend/models/match.py**

```python
# backend/models/match.py
import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum as SAEnum, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.database import Base


class VideoStatus(str, enum.Enum):
    pending = "pending"
    processing = "processing"
    done = "done"
    error = "error"


class JobStatus(str, enum.Enum):
    pending = "pending"
    running = "running"
    done = "done"
    error = "error"


class Match(Base):
    __tablename__ = "matches"
    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[str] = mapped_column(String(20))
    opponent: Mapped[str | None] = mapped_column(String(200))
    venue: Mapped[str | None] = mapped_column(String(200))
    notes: Mapped[str | None] = mapped_column(String(2000))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    videos: Mapped[list["Video"]] = relationship(back_populates="match", cascade="all, delete-orphan")
    processed_videos: Mapped[list["ProcessedVideo"]] = relationship(back_populates="match", cascade="all, delete-orphan")


class Video(Base):
    __tablename__ = "videos"
    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id"))
    set_number: Mapped[int] = mapped_column(Integer)
    raw_path: Mapped[str] = mapped_column(String(500))
    status: Mapped[VideoStatus] = mapped_column(SAEnum(VideoStatus), default=VideoStatus.pending)
    duration: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    match: Mapped["Match"] = relationship(back_populates="videos")
    rallies: Mapped[list["Rally"]] = relationship(back_populates="video", cascade="all, delete-orphan")
    jobs: Mapped[list["Job"]] = relationship(back_populates="video", cascade="all, delete-orphan")


class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[int] = mapped_column(primary_key=True)
    video_id: Mapped[int] = mapped_column(ForeignKey("videos.id"))
    status: Mapped[JobStatus] = mapped_column(SAEnum(JobStatus), default=JobStatus.pending)
    progress_pct: Mapped[float] = mapped_column(Float, default=0.0)
    error: Mapped[str | None] = mapped_column(String(2000))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    video: Mapped["Video"] = relationship(back_populates="jobs")


class Rally(Base):
    __tablename__ = "rallies"
    id: Mapped[int] = mapped_column(primary_key=True)
    video_id: Mapped[int] = mapped_column(ForeignKey("videos.id"))
    start_time: Mapped[float] = mapped_column(Float)
    end_time: Mapped[float] = mapped_column(Float)
    score_home: Mapped[int | None] = mapped_column(Integer)
    score_away: Mapped[int | None] = mapped_column(Integer)
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    video: Mapped["Video"] = relationship(back_populates="rallies")


class ProcessedVideo(Base):
    __tablename__ = "processed_videos"
    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id"))
    output_path: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    match: Mapped["Match"] = relationship(back_populates="processed_videos")
```

- [ ] **Step 6: Update backend/models/__init__.py**

```python
# backend/models/__init__.py
from backend.models.match import (  # noqa: F401 — registers models with Base
    JobStatus,
    Match,
    Job,
    ProcessedVideo,
    Rally,
    Video,
    VideoStatus,
)
```

- [ ] **Step 7: Create tests/conftest.py**

```python
# tests/conftest.py
import os
import sys
from pathlib import Path

# Set env vars before any backend imports so config.py picks them up
os.environ["DATABASE_URL"] = "sqlite:////tmp/volleyball_cv_test.db"
os.environ["DATA_DIR"] = "/tmp/volleyball_cv_test_data"

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def clean_db():
    from backend.database import Base, engine
    import backend.models  # noqa — registers all models
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)
    db_path = Path("/tmp/volleyball_cv_test.db")
    if db_path.exists():
        db_path.unlink()


@pytest.fixture
def client(clean_db):
    from backend.main import app
    with TestClient(app) as c:
        yield c
```

- [ ] **Step 8: Run test to verify it passes**

```bash
cd /home/leew4/volleyball-cv
PYTHONPATH=backend pytest tests/test_db.py -v
```

Expected: `PASSED`

- [ ] **Step 9: Commit**

```bash
git add backend/config.py backend/database.py backend/models/ tests/conftest.py tests/test_db.py
git commit -m "feat: database setup — SQLAlchemy models and config"
```

---

### Task 3: Pydantic Schemas

**Files:**
- Create: `backend/schemas/match.py`

- [ ] **Step 1: Create backend/schemas/match.py**

```python
# backend/schemas/match.py
from datetime import datetime
from backend.models.match import JobStatus, VideoStatus
from pydantic import BaseModel


class MatchCreate(BaseModel):
    date: str
    opponent: str | None = None
    venue: str | None = None
    notes: str | None = None


class MatchRead(BaseModel):
    id: int
    date: str
    opponent: str | None
    venue: str | None
    notes: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class VideoRead(BaseModel):
    id: int
    match_id: int
    set_number: int
    raw_path: str
    status: VideoStatus
    duration: float | None
    created_at: datetime

    model_config = {"from_attributes": True}


class JobRead(BaseModel):
    id: int
    video_id: int
    status: JobStatus
    progress_pct: float
    error: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class RallyRead(BaseModel):
    id: int
    video_id: int
    start_time: float
    end_time: float
    score_home: int | None
    score_away: int | None
    confidence: float

    model_config = {"from_attributes": True}


class RallyUpdate(BaseModel):
    score_home: int | None = None
    score_away: int | None = None
    start_time: float | None = None
    end_time: float | None = None


class ProcessedVideoRead(BaseModel):
    id: int
    match_id: int
    output_path: str
    created_at: datetime

    model_config = {"from_attributes": True}
```

- [ ] **Step 2: Commit**

```bash
git add backend/schemas/
git commit -m "feat: pydantic schemas for all entities"
```

---

### Task 4: FastAPI App + Match Router

**Files:**
- Create: `backend/main.py`
- Create: `backend/routers/matches.py`
- Create: `tests/test_matches.py`

- [ ] **Step 1: Write failing tests for match endpoints**

```python
# tests/test_matches.py


def test_create_match(client):
    resp = client.post("/matches", json={"date": "2026-05-18", "opponent": "Team A"})
    assert resp.status_code == 201
    data = resp.json()
    assert data["date"] == "2026-05-18"
    assert data["opponent"] == "Team A"
    assert "id" in data


def test_list_matches(client):
    client.post("/matches", json={"date": "2026-05-18"})
    client.post("/matches", json={"date": "2026-05-19"})
    resp = client.get("/matches")
    assert resp.status_code == 200
    assert len(resp.json()) == 2


def test_get_match(client):
    create = client.post("/matches", json={"date": "2026-05-18"})
    match_id = create.json()["id"]
    resp = client.get(f"/matches/{match_id}")
    assert resp.status_code == 200
    assert resp.json()["id"] == match_id


def test_get_match_not_found(client):
    resp = client.get("/matches/999")
    assert resp.status_code == 404
```

- [ ] **Step 2: Run to verify failure**

```bash
PYTHONPATH=backend pytest tests/test_matches.py -v
```

Expected: `ModuleNotFoundError: No module named 'backend.main'`

- [ ] **Step 3: Create backend/routers/matches.py**

```python
# backend/routers/matches.py
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models.match import Match
from backend.schemas.match import MatchCreate, MatchRead, ProcessedVideoRead

router = APIRouter(prefix="/matches", tags=["matches"])


@router.post("", response_model=MatchRead, status_code=status.HTTP_201_CREATED)
def create_match(body: MatchCreate, db: Session = Depends(get_db)):
    match = Match(**body.model_dump())
    db.add(match)
    db.commit()
    db.refresh(match)
    return match


@router.get("", response_model=list[MatchRead])
def list_matches(db: Session = Depends(get_db)):
    return db.query(Match).all()


@router.get("/{match_id}", response_model=MatchRead)
def get_match(match_id: int, db: Session = Depends(get_db)):
    match = db.get(Match, match_id)
    if not match:
        raise HTTPException(status_code=404, detail="Match not found")
    return match


@router.post("/{match_id}/export", response_model=list[ProcessedVideoRead])
def export_match(match_id: int, db: Session = Depends(get_db)):
    """
    Re-runs the editor for each set using the current (possibly user-adjusted)
    rally timestamps. Creates a fresh ProcessedVideo record per set.
    Returns the list of output file records.
    """
    from backend.cv.detector import RallySegment
    from backend.editor.ffmpeg_editor import cut_and_join
    from backend.models.match import ProcessedVideo, Rally, Video

    match = db.get(Match, match_id)
    if not match:
        raise HTTPException(status_code=404, detail="Match not found")

    results = []
    videos = db.query(Video).filter(Video.match_id == match_id).order_by(Video.set_number).all()
    for video in videos:
        rallies = db.query(Rally).filter(Rally.video_id == video.id).order_by(Rally.start_time).all()
        if not rallies:
            continue
        segments = [RallySegment(r.start_time, r.end_time, r.confidence) for r in rallies]
        filename = f"export_match{match_id}_set{video.set_number}.mp4"
        output_path = cut_and_join(video.raw_path, segments, filename)
        pv = ProcessedVideo(match_id=match_id, output_path=output_path)
        db.add(pv)
        db.commit()
        db.refresh(pv)
        results.append(pv)
    return results
```

- [ ] **Step 4: Create backend/main.py**

```python
# backend/main.py
from contextlib import asynccontextmanager

from fastapi import FastAPI

import backend.models  # noqa — registers all ORM models with Base
from backend.database import Base, engine
from backend.routers import matches, videos, jobs, rallies


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    yield


app = FastAPI(title="Volleyball CV", lifespan=lifespan)
app.include_router(matches.router)
app.include_router(videos.router)
app.include_router(jobs.router)
app.include_router(rallies.router)
```

Create stub routers so main.py imports don't fail before Tasks 5–7:

```python
# backend/routers/videos.py
from fastapi import APIRouter
router = APIRouter()
```

```python
# backend/routers/jobs.py
from fastapi import APIRouter
router = APIRouter()
```

```python
# backend/routers/rallies.py
from fastapi import APIRouter
router = APIRouter()
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
PYTHONPATH=backend pytest tests/test_matches.py -v
```

Expected: all 4 `PASSED`

- [ ] **Step 6: Commit**

```bash
git add backend/main.py backend/routers/matches.py backend/routers/videos.py \
        backend/routers/jobs.py backend/routers/rallies.py tests/test_matches.py
git commit -m "feat: FastAPI app + match CRUD endpoints"
```

---

### Task 5: Video Upload Endpoint

**Files:**
- Modify: `backend/routers/videos.py`
- Create: `tests/test_videos.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_videos.py
import io


def _make_match(client):
    return client.post("/matches", json={"date": "2026-05-18"}).json()["id"]


def test_upload_video(client, tmp_path):
    match_id = _make_match(client)
    fake_video = b"fake video bytes"
    resp = client.post(
        f"/matches/{match_id}/videos",
        data={"set_number": "1"},
        files={"file": ("set1.mp4", io.BytesIO(fake_video), "video/mp4")},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["match_id"] == match_id
    assert data["set_number"] == 1
    assert data["status"] == "pending"


def test_upload_video_match_not_found(client):
    resp = client.post(
        "/matches/999/videos",
        data={"set_number": "1"},
        files={"file": ("set1.mp4", io.BytesIO(b"x"), "video/mp4")},
    )
    assert resp.status_code == 404


def test_upload_duplicate_set_number(client):
    match_id = _make_match(client)
    for _ in range(2):
        client.post(
            f"/matches/{match_id}/videos",
            data={"set_number": "1"},
            files={"file": ("set1.mp4", io.BytesIO(b"x"), "video/mp4")},
        )
    resp = client.get(f"/matches/{match_id}")
    # Both uploads accepted — set_number is not unique-constrained, coach may re-upload
    assert resp.status_code == 200
```

- [ ] **Step 2: Run to verify failure**

```bash
PYTHONPATH=backend pytest tests/test_videos.py -v
```

Expected: `FAILED` (stub router returns no routes)

- [ ] **Step 3: Implement backend/routers/videos.py**

```python
# backend/routers/videos.py
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from backend.config import UPLOADS_DIR
from backend.database import get_db
from backend.models.match import Job, Match, Video, VideoStatus
from backend.schemas.match import JobRead, VideoRead

router = APIRouter(tags=["videos"])


@router.post("/matches/{match_id}/videos", response_model=VideoRead, status_code=status.HTTP_201_CREATED)
def upload_video(
    match_id: int,
    set_number: int = Form(...),
    file: UploadFile = ...,
    db: Session = Depends(get_db),
):
    match = db.get(Match, match_id)
    if not match:
        raise HTTPException(status_code=404, detail="Match not found")

    dest = UPLOADS_DIR / f"match{match_id}_set{set_number}_{file.filename}"
    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    video = Video(match_id=match_id, set_number=set_number, raw_path=str(dest), status=VideoStatus.pending)
    db.add(video)
    db.commit()
    db.refresh(video)
    return video


@router.post("/videos/{video_id}/process", response_model=JobRead, status_code=status.HTTP_202_ACCEPTED)
def process_video(video_id: int, db: Session = Depends(get_db)):
    video = db.get(Video, video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    job = Job(video_id=video_id)
    db.add(job)
    video.status = VideoStatus.processing
    db.commit()
    db.refresh(job)

    # Background task dispatched in Task 10 — returns job immediately
    return job
```

- [ ] **Step 4: Run tests**

```bash
PYTHONPATH=backend pytest tests/test_videos.py -v
```

Expected: all `PASSED`

- [ ] **Step 5: Commit**

```bash
git add backend/routers/videos.py tests/test_videos.py
git commit -m "feat: video upload endpoint — stores file, creates Video record"
```

---

### Task 6: Job Status Endpoint

**Files:**
- Modify: `backend/routers/jobs.py`

- [ ] **Step 1: Write failing test**

```python
# tests/test_jobs.py
import io


def test_get_job_status(client):
    match_id = client.post("/matches", json={"date": "2026-05-18"}).json()["id"]
    client.post(
        f"/matches/{match_id}/videos",
        data={"set_number": "1"},
        files={"file": ("s.mp4", io.BytesIO(b"x"), "video/mp4")},
    )
    video_id = client.get(f"/matches/{match_id}").json()  # we'll check via process endpoint
    # Upload then trigger process to get a job
    video_resp = client.post(
        f"/matches/{match_id}/videos",
        data={"set_number": "2"},
        files={"file": ("s2.mp4", io.BytesIO(b"x"), "video/mp4")},
    )
    vid_id = video_resp.json()["id"]
    job_resp = client.post(f"/videos/{vid_id}/process")
    assert job_resp.status_code == 202
    job_id = job_resp.json()["id"]

    resp = client.get(f"/jobs/{job_id}")
    assert resp.status_code == 200
    assert resp.json()["status"] == "pending"
    assert resp.json()["progress_pct"] == 0.0


def test_get_job_not_found(client):
    resp = client.get("/jobs/999")
    assert resp.status_code == 404
```

- [ ] **Step 2: Run to verify failure**

```bash
PYTHONPATH=backend pytest tests/test_jobs.py -v
```

Expected: `FAILED`

- [ ] **Step 3: Implement backend/routers/jobs.py**

```python
# backend/routers/jobs.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models.match import Job
from backend.schemas.match import JobRead

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.get("/{job_id}", response_model=JobRead)
def get_job(job_id: int, db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job
```

- [ ] **Step 4: Run tests**

```bash
PYTHONPATH=backend pytest tests/test_jobs.py -v
```

Expected: all `PASSED`

- [ ] **Step 5: Commit**

```bash
git add backend/routers/jobs.py tests/test_jobs.py
git commit -m "feat: job status polling endpoint"
```

---

### Task 7: Detector Interface + MotionDetector

**Files:**
- Create: `backend/cv/detector.py`
- Create: `backend/cv/motion_detector.py`
- Create: `tests/test_motion_detector.py`

- [ ] **Step 1: Write failing tests for motion detector**

```python
# tests/test_motion_detector.py
import subprocess
import tempfile
from pathlib import Path

import pytest


def make_synthetic_video(path: str, fps: float = 30.0) -> None:
    """
    Creates a 10-second video:
    - 0–2s:  static blue frame (no motion)
    - 2–7s:  moving white circle on black (motion = rally)
    - 7–10s: static blue frame (no motion)
    """
    filter_graph = (
        "color=c=blue:s=320x240:r=30:d=2[quiet1];"
        "color=c=black:s=320x240:r=30:d=5,"
        "drawbox=x='mod(t*80\\,260)':y=100:w=40:h=40:color=white:t=fill[motion];"
        "color=c=blue:s=320x240:r=30:d=3[quiet2];"
        "[quiet1][motion][quiet2]concat=n=3:v=1:a=0[v]"
    )
    subprocess.run(
        ["ffmpeg", "-y", "-filter_complex", filter_graph, "-map", "[v]",
         "-c:v", "libx264", "-an", path],
        check=True, capture_output=True,
    )


@pytest.fixture
def synthetic_video(tmp_path):
    path = str(tmp_path / "test.mp4")
    make_synthetic_video(path)
    return path


def test_detects_one_rally(synthetic_video):
    from backend.cv.motion_detector import MotionDetector
    detector = MotionDetector()
    segments = detector.detect(synthetic_video)
    assert len(segments) == 1


def test_rally_timing_approximate(synthetic_video):
    from backend.cv.motion_detector import MotionDetector
    detector = MotionDetector()
    segments = detector.detect(synthetic_video)
    seg = segments[0]
    # Rally starts around t=2s, ends around t=7s — allow 1.5s tolerance
    assert 0.5 <= seg.start_time <= 3.5
    assert 5.5 <= seg.end_time <= 8.5
    assert seg.confidence == 1.0


def test_static_video_no_rallies(tmp_path):
    path = str(tmp_path / "static.mp4")
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=blue:s=320x240:r=30:d=5",
         "-c:v", "libx264", "-an", path],
        check=True, capture_output=True,
    )
    from backend.cv.motion_detector import MotionDetector
    detector = MotionDetector()
    assert detector.detect(path) == []
```

- [ ] **Step 2: Run to verify failure**

```bash
PYTHONPATH=backend pytest tests/test_motion_detector.py -v
```

Expected: `ModuleNotFoundError`

- [ ] **Step 3: Create backend/cv/detector.py**

```python
# backend/cv/detector.py
from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class RallySegment:
    start_time: float  # seconds from video start
    end_time: float    # seconds from video start
    confidence: float  # 0.0–1.0; Tier 1 always 1.0, Tier 2 uses model confidence


class BaseDetector(ABC):
    @abstractmethod
    def detect(self, video_path: str) -> list[RallySegment]:
        """Analyse video_path and return rally time segments."""
        ...
```

- [ ] **Step 4: Create backend/cv/motion_detector.py**

```python
# backend/cv/motion_detector.py
import cv2
import numpy as np

from backend.cv.detector import BaseDetector, RallySegment


class MotionDetector(BaseDetector):
    """
    Tier 1 rally detector using MOG2 background subtraction.

    roi: (x, y, w, h) crop applied to each frame before analysis.
         None = full frame. Define once from the frontend after first use.
    motion_threshold: fraction of pixels that must be foreground to count as motion.
    rally_start_frames: consecutive motion frames required to declare rally start (~1s at 30fps).
    rally_end_frames: consecutive quiet frames required to declare rally end (~2s at 30fps).
    """

    def __init__(
        self,
        roi: tuple[int, int, int, int] | None = None,
        motion_threshold: float = 0.01,
        rally_start_frames: int = 30,
        rally_end_frames: int = 60,
    ):
        self.roi = roi
        self.motion_threshold = motion_threshold
        self.rally_start_frames = rally_start_frames
        self.rally_end_frames = rally_end_frames

    def detect(self, video_path: str) -> list[RallySegment]:
        cap = cv2.VideoCapture(video_path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        subtractor = cv2.createBackgroundSubtractorMOG2(detectShadows=False)
        scores: list[float] = []

        while True:
            ret, frame = cap.read()
            if not ret:
                break
            if self.roi:
                x, y, w, h = self.roi
                frame = frame[y : y + h, x : x + w]
            fg = subtractor.apply(frame)
            scores.append(float(np.count_nonzero(fg)) / fg.size)

        cap.release()
        return self._segments_from_scores(scores, fps)

    def _segments_from_scores(self, scores: list[float], fps: float) -> list[RallySegment]:
        """State machine over per-frame motion scores → rally segments."""
        segments: list[RallySegment] = []
        state = "quiet"   # quiet | candidate_start | rally | candidate_end
        state_start = 0
        rally_start = 0.0

        for i, score in enumerate(scores):
            moving = score > self.motion_threshold

            if state == "quiet" and moving:
                state = "candidate_start"
                state_start = i

            elif state == "candidate_start":
                if not moving:
                    state = "quiet"
                elif (i - state_start) >= self.rally_start_frames:
                    state = "rally"
                    rally_start = state_start / fps

            elif state == "rally" and not moving:
                state = "candidate_end"
                state_start = i

            elif state == "candidate_end":
                if moving:
                    state = "rally"  # brief pause inside a rally
                elif (i - state_start) >= self.rally_end_frames:
                    segments.append(
                        RallySegment(start_time=rally_start, end_time=state_start / fps, confidence=1.0)
                    )
                    state = "quiet"

        if state in ("rally", "candidate_end"):
            segments.append(
                RallySegment(start_time=rally_start, end_time=len(scores) / fps, confidence=1.0)
            )

        return segments
```

- [ ] **Step 5: Run tests**

```bash
PYTHONPATH=backend pytest tests/test_motion_detector.py -v
```

Expected: all 3 `PASSED`. If the timing tolerance test fails, widen the tolerance in the test (the synthetic video timing can vary by a frame or two).

- [ ] **Step 6: Commit**

```bash
git add backend/cv/detector.py backend/cv/motion_detector.py tests/test_motion_detector.py
git commit -m "feat: Tier 1 motion detector — MOG2 state machine rally detection"
```

---

### Task 8: ffmpeg Editor

**Files:**
- Create: `backend/editor/ffmpeg_editor.py`
- Create: `tests/test_ffmpeg_editor.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_ffmpeg_editor.py
import subprocess
from pathlib import Path

import pytest


def make_video_with_audio(path: str, duration: float = 10.0) -> None:
    subprocess.run(
        ["ffmpeg", "-y",
         "-f", "lavfi", "-i", f"color=c=blue:s=320x240:r=30:d={duration}",
         "-f", "lavfi", "-i", f"anullsrc=r=44100:cl=stereo",
         "-t", str(duration), "-c:v", "libx264", "-c:a", "aac",
         path],
        check=True, capture_output=True,
    )


def get_duration(path: str) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", path],
        capture_output=True, text=True, check=True,
    )
    return float(result.stdout.strip())


@pytest.fixture
def source_video(tmp_path):
    p = str(tmp_path / "source.mp4")
    make_video_with_audio(p, duration=10.0)
    return p


def test_cut_single_segment(source_video, tmp_path, monkeypatch):
    import backend.config as cfg
    monkeypatch.setattr(cfg, "EXPORTS_DIR", tmp_path)

    from backend.cv.detector import RallySegment
    from backend.editor.ffmpeg_editor import cut_and_join

    segments = [RallySegment(start_time=2.0, end_time=5.0, confidence=1.0)]
    out = cut_and_join(source_video, segments, "test_out.mp4")

    assert Path(out).exists()
    assert get_duration(out) == pytest.approx(3.0, abs=0.5)


def test_cut_multiple_segments(source_video, tmp_path, monkeypatch):
    import backend.config as cfg
    monkeypatch.setattr(cfg, "EXPORTS_DIR", tmp_path)

    from backend.cv.detector import RallySegment
    from backend.editor.ffmpeg_editor import cut_and_join

    segments = [
        RallySegment(start_time=1.0, end_time=3.0, confidence=1.0),
        RallySegment(start_time=6.0, end_time=8.0, confidence=1.0),
    ]
    out = cut_and_join(source_video, segments, "test_multi.mp4")

    assert Path(out).exists()
    assert get_duration(out) == pytest.approx(4.0, abs=0.5)


def test_no_segments_raises(source_video, tmp_path, monkeypatch):
    import backend.config as cfg
    monkeypatch.setattr(cfg, "EXPORTS_DIR", tmp_path)

    from backend.editor.ffmpeg_editor import cut_and_join

    with pytest.raises(ValueError, match="No segments"):
        cut_and_join(source_video, [], "empty.mp4")
```

- [ ] **Step 2: Run to verify failure**

```bash
PYTHONPATH=backend pytest tests/test_ffmpeg_editor.py -v
```

Expected: `ModuleNotFoundError`

- [ ] **Step 3: Create backend/editor/ffmpeg_editor.py**

```python
# backend/editor/ffmpeg_editor.py
import ffmpeg

from backend.config import EXPORTS_DIR
from backend.cv.detector import RallySegment


def cut_and_join(video_path: str, segments: list[RallySegment], output_filename: str) -> str:
    """
    Cut segments from video_path and concatenate them into a single output file.
    Returns the absolute path of the output file.
    """
    if not segments:
        raise ValueError("No segments to cut")

    output_path = str(EXPORTS_DIR / output_filename)
    streams = []

    for seg in segments:
        clip = ffmpeg.input(video_path, ss=seg.start_time, to=seg.end_time)
        streams.extend([clip.video, clip.audio])

    concat = ffmpeg.concat(*streams, v=1, a=1)
    ffmpeg.output(concat, output_path).overwrite_output().run(quiet=True)

    return output_path
```

- [ ] **Step 4: Run tests**

```bash
PYTHONPATH=backend pytest tests/test_ffmpeg_editor.py -v
```

Expected: all `PASSED`. If ffmpeg is not installed locally, install with `sudo apt-get install ffmpeg` or run tests inside Docker.

- [ ] **Step 5: Commit**

```bash
git add backend/editor/ffmpeg_editor.py tests/test_ffmpeg_editor.py
git commit -m "feat: ffmpeg editor — cut segments and concatenate into output MP4"
```

---

### Task 9: Background Processor

**Files:**
- Create: `backend/jobs/processor.py`
- Modify: `backend/routers/videos.py` (wire background task)

- [ ] **Step 1: Create backend/jobs/processor.py**

```python
# backend/jobs/processor.py
import traceback
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from backend.cv.motion_detector import MotionDetector
from backend.cv.detector import RallySegment
from backend.editor.ffmpeg_editor import cut_and_join
from backend.models.match import Job, JobStatus, Rally, Video, VideoStatus


def process_video(job_id: int, db_url: str) -> None:
    """
    Runs inside a FastAPI BackgroundTask. Opens its own DB session because
    FastAPI's request-scoped session has already closed by the time this runs.
    """
    engine = create_engine(db_url, connect_args={"check_same_thread": False})
    SessionLocal = sessionmaker(bind=engine)

    with SessionLocal() as db:
        job = db.get(Job, job_id)
        if not job:
            return

        job.status = JobStatus.running
        db.commit()

        try:
            video = db.get(Video, job.video_id)
            _run_pipeline(video, job, db)
            job.status = JobStatus.done
            job.progress_pct = 100.0
            video.status = VideoStatus.done
        except Exception:
            job.status = JobStatus.error
            job.error = traceback.format_exc()
            video = db.get(Video, job.video_id)
            if video:
                video.status = VideoStatus.error

        db.commit()


def _run_pipeline(video: Video, job: Job, db: Session) -> None:
    detector = MotionDetector()

    job.progress_pct = 10.0
    db.commit()

    segments: list[RallySegment] = detector.detect(video.raw_path)

    job.progress_pct = 60.0
    db.commit()

    # Persist detected rallies
    for seg in segments:
        db.add(Rally(
            video_id=video.id,
            start_time=seg.start_time,
            end_time=seg.end_time,
            confidence=seg.confidence,
        ))
    db.commit()

    job.progress_pct = 70.0
    db.commit()

    # Edit video
    output_filename = f"processed_match{video.match_id}_set{video.set_number}.mp4"
    output_path = cut_and_join(video.raw_path, segments, output_filename)

    db.add(ProcessedVideo(match_id=video.match_id, output_path=output_path))

    job.progress_pct = 95.0
    db.commit()
```

- [ ] **Step 2: Update backend/routers/videos.py to dispatch background task**

Replace the `process_video` endpoint with:

```python
# backend/routers/videos.py  (full updated file)
import shutil
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from backend.config import DATABASE_URL, UPLOADS_DIR
from backend.database import get_db
from backend.jobs.processor import process_video as run_processing
from backend.models.match import Job, Match, ProcessedVideo, Video, VideoStatus
from backend.schemas.match import JobRead, ProcessedVideoRead, VideoRead

router = APIRouter(tags=["videos"])


@router.post("/matches/{match_id}/videos", response_model=VideoRead, status_code=status.HTTP_201_CREATED)
def upload_video(
    match_id: int,
    set_number: int = Form(...),
    file: UploadFile = ...,
    db: Session = Depends(get_db),
):
    match = db.get(Match, match_id)
    if not match:
        raise HTTPException(status_code=404, detail="Match not found")

    dest = UPLOADS_DIR / f"match{match_id}_set{set_number}_{file.filename}"
    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    video = Video(match_id=match_id, set_number=set_number, raw_path=str(dest), status=VideoStatus.pending)
    db.add(video)
    db.commit()
    db.refresh(video)
    return video


@router.post("/videos/{video_id}/process", response_model=JobRead, status_code=status.HTTP_202_ACCEPTED)
def process_video(
    video_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    video = db.get(Video, video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    job = Job(video_id=video_id)
    db.add(job)
    video.status = VideoStatus.processing
    db.commit()
    db.refresh(job)

    background_tasks.add_task(run_processing, job.id, DATABASE_URL)
    return job
```

- [ ] **Step 3: Run all tests to ensure nothing broke**

```bash
PYTHONPATH=backend pytest tests/ -v
```

Expected: all previously passing tests still `PASSED`

- [ ] **Step 4: Commit**

```bash
git add backend/jobs/processor.py backend/routers/videos.py
git commit -m "feat: background processor — wires CV pipeline and ffmpeg editor to job"
```

---

### Task 10: Rally Endpoints

**Files:**
- Modify: `backend/routers/rallies.py`
- Create: `tests/test_rallies.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_rallies.py
import io


def _setup(client):
    match_id = client.post("/matches", json={"date": "2026-05-18"}).json()["id"]
    video_resp = client.post(
        f"/matches/{match_id}/videos",
        data={"set_number": "1"},
        files={"file": ("s.mp4", io.BytesIO(b"x"), "video/mp4")},
    )
    return match_id, video_resp.json()["id"]


def _seed_rally(db, video_id):
    from backend.models.match import Rally
    rally = Rally(video_id=video_id, start_time=10.0, end_time=25.0, confidence=1.0)
    db.add(rally)
    db.commit()
    db.refresh(rally)
    return rally


def test_list_rallies_empty(client):
    _, video_id = _setup(client)
    resp = client.get(f"/videos/{video_id}/rallies")
    assert resp.status_code == 200
    assert resp.json() == []


def test_list_rallies(client, clean_db):
    from backend.database import SessionLocal
    _, video_id = _setup(client)
    with SessionLocal() as db:
        _seed_rally(db, video_id)
        _seed_rally(db, video_id)
    resp = client.get(f"/videos/{video_id}/rallies")
    assert resp.status_code == 200
    assert len(resp.json()) == 2


def test_patch_rally_score(client, clean_db):
    from backend.database import SessionLocal
    _, video_id = _setup(client)
    with SessionLocal() as db:
        rally = _seed_rally(db, video_id)
        rally_id = rally.id
    resp = client.patch(f"/rallies/{rally_id}", json={"score_home": 5, "score_away": 3})
    assert resp.status_code == 200
    data = resp.json()
    assert data["score_home"] == 5
    assert data["score_away"] == 3


def test_patch_rally_not_found(client):
    resp = client.patch("/rallies/999", json={"score_home": 1})
    assert resp.status_code == 404
```

- [ ] **Step 2: Run to verify failure**

```bash
PYTHONPATH=backend pytest tests/test_rallies.py -v
```

Expected: `FAILED`

- [ ] **Step 3: Implement backend/routers/rallies.py**

```python
# backend/routers/rallies.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models.match import Rally, Video
from backend.schemas.match import RallyRead, RallyUpdate

router = APIRouter(tags=["rallies"])


@router.get("/videos/{video_id}/rallies", response_model=list[RallyRead])
def list_rallies(video_id: int, db: Session = Depends(get_db)):
    video = db.get(Video, video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    return db.query(Rally).filter(Rally.video_id == video_id).order_by(Rally.start_time).all()


@router.patch("/rallies/{rally_id}", response_model=RallyRead)
def update_rally(rally_id: int, body: RallyUpdate, db: Session = Depends(get_db)):
    rally = db.get(Rally, rally_id)
    if not rally:
        raise HTTPException(status_code=404, detail="Rally not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(rally, field, value)
    db.commit()
    db.refresh(rally)
    return rally
```

- [ ] **Step 4: Run all tests**

```bash
PYTHONPATH=backend pytest tests/ -v
```

Expected: all `PASSED`

- [ ] **Step 5: Commit**

```bash
git add backend/routers/rallies.py tests/test_rallies.py
git commit -m "feat: rally endpoints — list rallies and score attribution PATCH"
```

---

### Task 11: End-to-End Smoke Test

**Files:**
- No new files — manual test with a real video file

- [ ] **Step 1: Install dependencies locally**

```bash
cd /home/leew4/volleyball-cv/backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

- [ ] **Step 2: Start the server**

```bash
cd /home/leew4/volleyball-cv/backend
PYTHONPATH=. uvicorn main:app --reload --port 8000
```

- [ ] **Step 3: Create a match and upload a real video**

In a second terminal:

```bash
# Create match
curl -s -X POST http://localhost:8000/matches \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-05-18","opponent":"Test Opponent"}' | python3 -m json.tool

# Upload video (replace path with your actual video file)
MATCH_ID=1
curl -s -X POST http://localhost:8000/matches/$MATCH_ID/videos \
  -F "set_number=1" \
  -F "file=@/path/to/your/set1.mp4" | python3 -m json.tool

# Trigger processing
VIDEO_ID=1
curl -s -X POST http://localhost:8000/videos/$VIDEO_ID/process | python3 -m json.tool

# Poll job status
JOB_ID=1
curl -s http://localhost:8000/jobs/$JOB_ID | python3 -m json.tool

# List detected rallies once job is done
curl -s http://localhost:8000/videos/$VIDEO_ID/rallies | python3 -m json.tool
```

- [ ] **Step 4: Attribute scores**

```bash
# For each rally ID returned above, record who scored
RALLY_ID=1
curl -s -X PATCH http://localhost:8000/rallies/$RALLY_ID \
  -H "Content-Type: application/json" \
  -d '{"score_home": 1, "score_away": 0}' | python3 -m json.tool
```

- [ ] **Step 5: Verify output file exists**

```bash
ls -lh /home/leew4/volleyball-cv/data/exports/
# Should contain processed_match1_set1.mp4
```

- [ ] **Step 6: Final commit**

```bash
cd /home/leew4/volleyball-cv
git add .
git commit -m "chore: verify end-to-end pipeline working — Plan 1 complete"
```

---

## Remaining Plans

- **Plan 2:** React frontend — 5 views (Match Manager, Upload+Process, Rally Review, Active Learning, Export)
- **Plan 3:** Active learning + Tier 2 YOLOv8 fine-tuning pipeline
- **Plan 4:** YouTube OAuth2 + upload integration
