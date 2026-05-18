# Plan 3 — YOLOv8 Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the bootstrap path that produces a trained YOLOv8 ball detector: frame extraction from rally segments → bbox annotation canvas UI → initial training run → test-set evaluation → model promotion gate.

**Architecture:** Hybrid storage — JPEG frames and YOLO `.txt` annotation files live on disk; SQLite tracks job state, frame metadata, and model versions. A reconciler heals disk/DB drift before every training run. The new `YoloDetector` implements the existing `BaseDetector` interface and slots into the processor without touching existing routes.

**Tech Stack:** Python FastAPI + SQLAlchemy 2.0 + SQLite, ultralytics (YOLOv8n), OpenCV, React 18 + TypeScript + Tailwind CSS, Vitest + React Testing Library

---

## File Map

**New files:**
- `backend/cv/yolo_detector.py` — Tier 2 detector using `.pt` weights
- `backend/training/__init__.py` — empty package marker
- `backend/training/reconciler.py` — disk ↔ DB drift healing
- `backend/training/frame_extractor.py` — samples frames from rally segments
- `backend/training/trainer.py` — YOLOv8 fine-tune pipeline
- `backend/routers/bootstrap.py` — all new API routes
- `tests/test_yolo_detector.py`
- `tests/test_reconciler.py`
- `tests/test_frame_extractor.py`
- `tests/test_bootstrap_routes.py`
- `tests/test_training.py`

**Modified files:**
- `backend/config.py` — add FRAMES_DIR, DATASET_DIR, MODELS_DIR
- `backend/models/match.py` — add 3 new tables + enums + Video.labeled_frames relationship
- `backend/models/__init__.py` — re-export new models
- `backend/schemas/match.py` — add new Pydantic schemas
- `backend/jobs/processor.py` — select detector based on active ModelVersion
- `backend/main.py` — register bootstrap router
- `backend/requirements.txt` — add ultralytics
- `tests/conftest.py` — add filesystem cleanup fixture
- `frontend/src/types.ts` — add new TS types
- `frontend/src/api/client.ts` — add new API functions
- `frontend/src/views/ActiveLearning.tsx` — replace stub with full UI

---

## Task 1: Install ultralytics + extend config + scaffold data dirs

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `backend/config.py`

- [ ] **Step 1: Add ultralytics to requirements.txt**

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
ultralytics==8.3.0
```

- [ ] **Step 2: Install it**

```bash
cd /home/leew4/volleyball-cv
pip install ultralytics==8.3.0
```

Expected: package installs without error.

- [ ] **Step 3: Extend config.py with new directory constants**

Replace the full content of `backend/config.py` with:

```python
# backend/config.py
import os
from pathlib import Path

DATA_DIR = Path(os.getenv("DATA_DIR", str(Path(__file__).parent.parent / "data")))
UPLOADS_DIR = DATA_DIR / "uploads"
EXPORTS_DIR = DATA_DIR / "exports"
FRAMES_DIR = DATA_DIR / "frames"
DATASET_DIR = DATA_DIR / "dataset"
MODELS_DIR = DATA_DIR / "models"
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DATA_DIR}/volleyball_cv.db")

UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
FRAMES_DIR.mkdir(parents=True, exist_ok=True)
DATASET_DIR.mkdir(parents=True, exist_ok=True)
MODELS_DIR.mkdir(parents=True, exist_ok=True)
```

- [ ] **Step 4: Create gitkeep files for new data dirs**

```bash
touch /home/leew4/volleyball-cv/data/frames/.gitkeep
touch /home/leew4/volleyball-cv/data/dataset/.gitkeep
touch /home/leew4/volleyball-cv/data/models/.gitkeep
```

- [ ] **Step 5: Verify config imports without error**

```bash
cd /home/leew4/volleyball-cv && python -c "from backend.config import FRAMES_DIR, DATASET_DIR, MODELS_DIR; print(FRAMES_DIR, DATASET_DIR, MODELS_DIR)"
```

Expected: three directory paths printed.

- [ ] **Step 6: Commit**

```bash
git add backend/requirements.txt backend/config.py data/frames/.gitkeep data/dataset/.gitkeep data/models/.gitkeep
git commit -m "feat: add ultralytics dep and data directory config"
```

---

## Task 2: DB models + schemas + conftest filesystem cleanup

**Files:**
- Modify: `backend/models/match.py`
- Modify: `backend/models/__init__.py`
- Modify: `backend/schemas/match.py`
- Modify: `tests/conftest.py`
- Modify: `tests/test_db.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_db.py`:

```python
from sqlalchemy import inspect
from backend.database import engine


def test_tables_created():
    from backend.models import Match, Video, Job, Rally, ProcessedVideo  # noqa
    from backend.models.match import LabeledFrame, ModelVersion, TrainingRun  # noqa
    from backend.database import Base
    Base.metadata.create_all(engine)
    inspector = inspect(engine)
    tables = inspector.get_table_names()
    for name in ("matches", "videos", "jobs", "rallies", "processed_videos",
                 "labeled_frames", "model_versions", "training_runs"):
        assert name in tables, f"missing table: {name}"
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd /home/leew4/volleyball-cv && python -m pytest tests/test_db.py -v
```

Expected: FAIL — `labeled_frames`, `model_versions`, `training_runs` not found.

- [ ] **Step 3: Add new enums and tables to backend/models/match.py**

Add the following after the existing imports and before the `Match` class:

```python
class FrameSplit(str, enum.Enum):
    train = "train"
    val = "val"
    test = "test"


class FrameStatus(str, enum.Enum):
    pending = "pending"
    annotated = "annotated"
    skipped = "skipped"
    missing = "missing"


class TrainingStatus(str, enum.Enum):
    pending = "pending"
    running = "running"
    done = "done"
    error = "error"
```

Add a `labeled_frames` relationship to the existing `Video` class:

```python
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
    labeled_frames: Mapped[list["LabeledFrame"]] = relationship(back_populates="video", cascade="all, delete-orphan")
```

Append three new model classes at the end of `backend/models/match.py`:

```python
class LabeledFrame(Base):
    __tablename__ = "labeled_frames"
    id: Mapped[int] = mapped_column(primary_key=True)
    video_id: Mapped[int] = mapped_column(ForeignKey("videos.id"))
    frame_number: Mapped[int] = mapped_column(Integer)
    timestamp: Mapped[float] = mapped_column(Float)
    img_path: Mapped[str] = mapped_column(String(500))
    label_path: Mapped[str] = mapped_column(String(500))
    split: Mapped[FrameSplit] = mapped_column(SAEnum(FrameSplit))
    review_status: Mapped[FrameStatus] = mapped_column(SAEnum(FrameStatus), default=FrameStatus.pending)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    video: Mapped["Video"] = relationship(back_populates="labeled_frames")


class ModelVersion(Base):
    __tablename__ = "model_versions"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    weights_path: Mapped[str] = mapped_column(String(500))
    dataset_size: Mapped[int] = mapped_column(Integer)
    test_precision: Mapped[float | None] = mapped_column(Float)
    test_recall: Mapped[float | None] = mapped_column(Float)
    test_map50: Mapped[float | None] = mapped_column(Float)
    is_active: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class TrainingRun(Base):
    __tablename__ = "training_runs"
    id: Mapped[int] = mapped_column(primary_key=True)
    status: Mapped[TrainingStatus] = mapped_column(SAEnum(TrainingStatus), default=TrainingStatus.pending)
    base_model_id: Mapped[int | None] = mapped_column(ForeignKey("model_versions.id"), nullable=True)
    new_model_id: Mapped[int | None] = mapped_column(ForeignKey("model_versions.id"), nullable=True)
    frames_used: Mapped[int | None] = mapped_column(Integer)
    epochs: Mapped[int | None] = mapped_column(Integer)
    final_loss: Mapped[float | None] = mapped_column(Float)
    duration_s: Mapped[float | None] = mapped_column(Float)
    error: Mapped[str | None] = mapped_column(String(2000))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
```

- [ ] **Step 4: Re-export new models in backend/models/__init__.py**

```python
# backend/models/__init__.py
from backend.models.match import (  # noqa: F401 — registers models with Base
    FrameSplit,
    FrameStatus,
    JobStatus,
    LabeledFrame,
    Match,
    Job,
    ModelVersion,
    ProcessedVideo,
    Rally,
    TrainingRun,
    TrainingStatus,
    Video,
    VideoStatus,
)
```

- [ ] **Step 5: Add new Pydantic schemas to backend/schemas/match.py**

Append to `backend/schemas/match.py` (keep all existing content, add below):

```python
from backend.models.match import FrameSplit, FrameStatus, TrainingStatus


class LabeledFrameRead(BaseModel):
    id: int
    video_id: int
    frame_number: int
    timestamp: float
    img_path: str
    label_path: str
    split: FrameSplit
    review_status: FrameStatus
    created_at: datetime

    model_config = {"from_attributes": True}


class ModelVersionRead(BaseModel):
    id: int
    name: str
    weights_path: str
    dataset_size: int
    test_precision: float | None
    test_recall: float | None
    test_map50: float | None
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class TrainingRunRead(BaseModel):
    id: int
    status: TrainingStatus
    base_model_id: int | None
    new_model_id: int | None
    frames_used: int | None
    epochs: int | None
    final_loss: float | None
    duration_s: float | None
    error: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class BootstrapExtractRequest(BaseModel):
    sample_rate: int = 30
    max_frames: int = 500
    split_train: float = 0.8
    split_val: float = 0.1
    split_test: float = 0.1


class AnnotateRequest(BaseModel):
    cx: float
    cy: float
    w: float
    h: float


class TrainingRunRequest(BaseModel):
    epochs: int = 50


class BootstrapStatus(BaseModel):
    frames_total: int
    annotated: int
    skipped: int
    pending: int
    missing: int
    model_ready: bool
    active_model_id: int | None


class ReconcileResult(BaseModel):
    missing: int
    restored: int
    reregistered: int
    malformed: int
    split_conflicts: int
    ok: int
```

- [ ] **Step 6: Add filesystem cleanup fixture to tests/conftest.py**

Append to `tests/conftest.py`:

```python
import shutil

@pytest.fixture(autouse=True)
def clean_data_dirs():
    yield
    data_dir = Path("/tmp/volleyball_cv_test_data")
    if data_dir.exists():
        shutil.rmtree(data_dir, ignore_errors=True)
```

Also add `from pathlib import Path` to the imports at the top of `tests/conftest.py`.

- [ ] **Step 7: Run test to confirm it passes**

```bash
cd /home/leew4/volleyball-cv && python -m pytest tests/test_db.py -v
```

Expected: PASS — all 8 tables found.

- [ ] **Step 8: Run full test suite to confirm no regressions**

```bash
cd /home/leew4/volleyball-cv && python -m pytest tests/ -v
```

Expected: all existing tests pass.

- [ ] **Step 9: Commit**

```bash
git add backend/models/match.py backend/models/__init__.py backend/schemas/match.py tests/conftest.py tests/test_db.py
git commit -m "feat: add LabeledFrame, ModelVersion, TrainingRun DB models and schemas"
```

---

## Task 3: YoloDetector + processor model resolution

**Files:**
- Create: `backend/cv/yolo_detector.py`
- Modify: `backend/jobs/processor.py`
- Create: `tests/test_yolo_detector.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_yolo_detector.py`:

```python
# tests/test_yolo_detector.py
import pytest
from unittest.mock import MagicMock, patch


def _make_result(conf: float):
    result = MagicMock()
    result.boxes = MagicMock()
    result.boxes.conf.tolist.return_value = [conf] if conf > 0 else []
    return result


@patch("backend.cv.yolo_detector.cv2.VideoCapture")
def test_detect_returns_rally_when_ball_detected(mock_cap_cls):
    mock_cap = MagicMock()
    mock_cap.isOpened.return_value = True
    mock_cap.get.return_value = 30.0
    mock_cap_cls.return_value = mock_cap

    mock_model = MagicMock()
    # 100 frames with ball (conf=0.9), then 100 quiet frames
    mock_model.predict.return_value = iter(
        [_make_result(0.9)] * 100 + [_make_result(0.0)] * 100
    )

    from backend.cv.yolo_detector import YoloDetector
    detector = YoloDetector.__new__(YoloDetector)
    detector.weights_path = "fake.pt"
    detector.conf_threshold = 0.25
    detector.rally_start_frames = 30
    detector.rally_end_frames = 60
    detector._model = mock_model

    segments = detector.detect("fake.mp4")

    assert len(segments) == 1
    assert segments[0].start_time == pytest.approx(0.0, abs=0.1)
    assert segments[0].confidence == pytest.approx(0.9)


@patch("backend.cv.yolo_detector.cv2.VideoCapture")
def test_detect_returns_empty_when_no_ball(mock_cap_cls):
    mock_cap = MagicMock()
    mock_cap.isOpened.return_value = True
    mock_cap.get.return_value = 30.0
    mock_cap_cls.return_value = mock_cap

    mock_model = MagicMock()
    mock_model.predict.return_value = iter([_make_result(0.0)] * 50)

    from backend.cv.yolo_detector import YoloDetector
    detector = YoloDetector.__new__(YoloDetector)
    detector.weights_path = "fake.pt"
    detector.conf_threshold = 0.25
    detector.rally_start_frames = 30
    detector.rally_end_frames = 60
    detector._model = mock_model

    segments = detector.detect("fake.mp4")

    assert segments == []


@patch("backend.cv.yolo_detector.cv2.VideoCapture")
def test_detect_raises_on_bad_video(mock_cap_cls):
    mock_cap = MagicMock()
    mock_cap.isOpened.return_value = False
    mock_cap_cls.return_value = mock_cap

    from backend.cv.yolo_detector import YoloDetector
    detector = YoloDetector.__new__(YoloDetector)
    detector.weights_path = "fake.pt"
    detector.conf_threshold = 0.25
    detector.rally_start_frames = 30
    detector.rally_end_frames = 60
    detector._model = MagicMock()

    with pytest.raises(ValueError, match="Cannot open video"):
        detector.detect("nonexistent.mp4")
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /home/leew4/volleyball-cv && python -m pytest tests/test_yolo_detector.py -v
```

Expected: FAIL — `backend.cv.yolo_detector` not found.

- [ ] **Step 3: Create backend/cv/yolo_detector.py**

```python
# backend/cv/yolo_detector.py
import cv2

from backend.cv.detector import BaseDetector, RallySegment


class YoloDetector(BaseDetector):
    """
    Tier 2 rally detector using a fine-tuned YOLOv8 ball detection model.
    Ball detected (conf >= conf_threshold) maps to motion; absence maps to quiet.
    """

    def __init__(
        self,
        weights_path: str,
        conf_threshold: float = 0.25,
        rally_start_frames: int = 30,
        rally_end_frames: int = 60,
    ):
        self.weights_path = weights_path
        self.conf_threshold = conf_threshold
        self.rally_start_frames = rally_start_frames
        self.rally_end_frames = rally_end_frames
        self._model = None

    def _load(self) -> None:
        if self._model is None:
            from ultralytics import YOLO
            self._model = YOLO(self.weights_path)

    def detect(self, video_path: str) -> list[RallySegment]:
        self._load()
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"Cannot open video: {video_path}")
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        cap.release()

        scores: list[float] = []
        for result in self._model.predict(source=video_path, stream=True, verbose=False):
            confs = (
                [c for c in result.boxes.conf.tolist() if c >= self.conf_threshold]
                if result.boxes
                else []
            )
            scores.append(max(confs) if confs else 0.0)

        return self._segments_from_scores(scores, fps)

    def _segments_from_scores(self, scores: list[float], fps: float) -> list[RallySegment]:
        segments: list[RallySegment] = []
        state = "quiet"
        state_start = 0
        rally_start = 0.0
        peak_conf = 0.0

        for i, score in enumerate(scores):
            moving = score >= self.conf_threshold
            if moving:
                peak_conf = max(peak_conf, score)

            if state == "quiet" and moving:
                state = "candidate_start"
                state_start = i
                peak_conf = score

            elif state == "candidate_start":
                if not moving:
                    state = "quiet"
                    peak_conf = 0.0
                elif (i - state_start) >= self.rally_start_frames:
                    state = "rally"
                    rally_start = state_start / fps

            elif state == "rally" and not moving:
                state = "candidate_end"
                state_start = i

            elif state == "candidate_end":
                if moving:
                    state = "rally"
                    peak_conf = max(peak_conf, score)
                elif (i - state_start) >= self.rally_end_frames:
                    segments.append(RallySegment(
                        start_time=rally_start,
                        end_time=state_start / fps,
                        confidence=peak_conf,
                    ))
                    state = "quiet"
                    peak_conf = 0.0

        if state in ("rally", "candidate_end"):
            segments.append(RallySegment(
                start_time=rally_start,
                end_time=len(scores) / fps,
                confidence=peak_conf,
            ))

        return segments
```

- [ ] **Step 4: Run YoloDetector tests to confirm they pass**

```bash
cd /home/leew4/volleyball-cv && python -m pytest tests/test_yolo_detector.py -v
```

Expected: 3 PASS.

- [ ] **Step 5: Write the failing processor test**

Add to `tests/test_jobs.py`:

```python
def test_processor_uses_yolo_when_active_model_exists(client):
    """Processor selects YoloDetector when a ModelVersion is active."""
    from unittest.mock import patch, MagicMock
    import io
    from backend.database import SessionLocal
    from backend.models.match import ModelVersion

    # Create an active ModelVersion
    with SessionLocal() as db:
        mv = ModelVersion(
            name="test-v1", weights_path="/fake/weights.pt",
            dataset_size=200, test_precision=0.8, test_recall=0.8, test_map50=0.8,
            is_active=True,
        )
        db.add(mv)
        db.commit()

    match_id = client.post("/matches", json={"date": "2026-05-19"}).json()["id"]
    video_resp = client.post(
        f"/matches/{match_id}/videos",
        data={"set_number": "1"},
        files={"file": ("s.mp4", io.BytesIO(b"x"), "video/mp4")},
    )
    vid_id = video_resp.json()["id"]

    with patch("backend.jobs.processor.YoloDetector") as mock_yolo_cls:
        mock_detector = MagicMock()
        mock_detector.detect.side_effect = ValueError("test — fake video")
        mock_yolo_cls.return_value = mock_detector

        job_resp = client.post(f"/videos/{vid_id}/process")
        assert job_resp.status_code == 202

        job_id = job_resp.json()["id"]
        job_data = client.get(f"/jobs/{job_id}").json()
        assert job_data["status"] == "error"
        mock_yolo_cls.assert_called_once_with("/fake/weights.pt")
```

- [ ] **Step 6: Run test to confirm it fails**

```bash
cd /home/leew4/volleyball-cv && python -m pytest tests/test_jobs.py::test_processor_uses_yolo_when_active_model_exists -v
```

Expected: FAIL — `YoloDetector` not imported in processor.

- [ ] **Step 7: Update backend/jobs/processor.py to resolve detector at runtime**

Replace `_run_pipeline` with:

```python
def _run_pipeline(video: Video, job: Job, db: Session) -> None:
    from backend.cv.yolo_detector import YoloDetector
    from backend.models.match import ModelVersion

    active_model = db.query(ModelVersion).filter_by(is_active=True).first()
    detector = YoloDetector(active_model.weights_path) if active_model else MotionDetector()

    job.progress_pct = 10.0
    db.commit()

    segments: list[RallySegment] = detector.detect(video.raw_path)

    job.progress_pct = 60.0
    db.commit()

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

    output_filename = f"processed_match{video.match_id}_set{video.set_number}_vid{video.id}.mp4"
    output_path = cut_and_join(video.raw_path, segments, output_filename)

    db.add(ProcessedVideo(match_id=video.match_id, output_path=output_path))

    job.progress_pct = 95.0
    db.commit()
```

- [ ] **Step 8: Run all job tests to confirm they pass**

```bash
cd /home/leew4/volleyball-cv && python -m pytest tests/test_jobs.py -v
```

Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/cv/yolo_detector.py backend/jobs/processor.py tests/test_yolo_detector.py tests/test_jobs.py
git commit -m "feat: YoloDetector and processor model resolution"
```

---

## Task 4: Reconciler

**Files:**
- Create: `backend/training/__init__.py`
- Create: `backend/training/reconciler.py`
- Create: `tests/test_reconciler.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_reconciler.py`:

```python
# tests/test_reconciler.py
from pathlib import Path
from backend.database import SessionLocal
from backend.models.match import FrameStatus, FrameSplit, LabeledFrame, Match, Video


def _make_video(db) -> int:
    match = Match(date="2026-05-19")
    db.add(match)
    db.flush()
    video = Video(match_id=match.id, set_number=1, raw_path="/fake/video.mp4")
    db.add(video)
    db.commit()
    return video.id


def _make_frame(db, video_id, img_path, label_path, status=FrameStatus.pending):
    frame = LabeledFrame(
        video_id=video_id, frame_number=1, timestamp=0.0,
        img_path=img_path, label_path=label_path,
        split=FrameSplit.train, review_status=status,
    )
    db.add(frame)
    db.commit()
    db.refresh(frame)
    return frame


def test_missing_image_sets_status_to_missing(tmp_path):
    with SessionLocal() as db:
        video_id = _make_video(db)
        frame = _make_frame(db, video_id, "/nonexistent/img.jpg", str(tmp_path / "label.txt"))

        from backend.training.reconciler import reconcile
        result = reconcile(db)

        db.refresh(frame)
        assert frame.review_status == FrameStatus.missing
        assert result["missing"] >= 1


def test_label_exists_but_db_says_pending_restores_annotated(tmp_path):
    img_path = tmp_path / "frame_1_1.jpg"
    img_path.write_bytes(b"fake")
    label_path = tmp_path / "label.txt"
    label_path.write_text("0 0.5 0.5 0.1 0.1\n")

    with SessionLocal() as db:
        video_id = _make_video(db)
        frame = _make_frame(db, video_id, str(img_path), str(label_path), FrameStatus.pending)

        from backend.training.reconciler import reconcile
        result = reconcile(db)

        db.refresh(frame)
        assert frame.review_status == FrameStatus.annotated
        assert result["restored"] >= 1


def test_db_says_annotated_but_label_missing_resets_to_pending(tmp_path):
    img_path = tmp_path / "frame_1_1.jpg"
    img_path.write_bytes(b"fake")

    with SessionLocal() as db:
        video_id = _make_video(db)
        frame = _make_frame(db, video_id, str(img_path), str(tmp_path / "missing_label.txt"), FrameStatus.annotated)

        from backend.training.reconciler import reconcile
        result = reconcile(db)

        db.refresh(frame)
        assert frame.review_status == FrameStatus.pending
        assert result["missing"] >= 1


def test_malformed_label_deleted_and_status_reset(tmp_path):
    img_path = tmp_path / "frame_1_1.jpg"
    img_path.write_bytes(b"fake")
    label_path = tmp_path / "label.txt"
    label_path.write_text("this is not valid yolo format\n")

    with SessionLocal() as db:
        video_id = _make_video(db)
        frame = _make_frame(db, video_id, str(img_path), str(label_path), FrameStatus.annotated)

        from backend.training.reconciler import reconcile
        result = reconcile(db)

        db.refresh(frame)
        assert frame.review_status == FrameStatus.pending
        assert not label_path.exists()
        assert result["malformed"] >= 1


def test_ok_count_for_clean_annotated_frame(tmp_path):
    img_path = tmp_path / "frame_1_1.jpg"
    img_path.write_bytes(b"fake")
    label_path = tmp_path / "label.txt"
    label_path.write_text("0 0.5 0.5 0.1 0.1\n")

    with SessionLocal() as db:
        video_id = _make_video(db)
        _make_frame(db, video_id, str(img_path), str(label_path), FrameStatus.annotated)

        from backend.training.reconciler import reconcile
        result = reconcile(db)

        assert result["ok"] >= 1
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /home/leew4/volleyball-cv && python -m pytest tests/test_reconciler.py -v
```

Expected: FAIL — `backend.training.reconciler` not found.

- [ ] **Step 3: Create backend/training/__init__.py**

```bash
touch /home/leew4/volleyball-cv/backend/training/__init__.py
```

- [ ] **Step 4: Create backend/training/reconciler.py**

```python
# backend/training/reconciler.py
import re
from pathlib import Path

import cv2
from sqlalchemy.orm import Session

from backend.config import FRAMES_DIR, DATASET_DIR
from backend.models.match import FrameStatus, FrameSplit, LabeledFrame, Video

_YOLO_LINE_RE = re.compile(r"^0 [\d.]+ [\d.]+ [\d.]+ [\d.]+\s*$")


def reconcile(db: Session) -> dict[str, int]:
    counts = {"missing": 0, "restored": 0, "reregistered": 0, "malformed": 0, "split_conflicts": 0, "ok": 0}

    for frame in db.query(LabeledFrame).all():
        img_path = Path(frame.img_path)
        label_path = Path(frame.label_path)

        if not img_path.exists():
            frame.review_status = FrameStatus.missing
            counts["missing"] += 1
            continue

        if label_path.exists():
            content = label_path.read_text().strip()
            if content and not _YOLO_LINE_RE.match(content):
                label_path.unlink()
                frame.review_status = FrameStatus.pending
                counts["malformed"] += 1
            elif frame.review_status == FrameStatus.pending:
                frame.review_status = FrameStatus.annotated
                counts["restored"] += 1
            else:
                counts["ok"] += 1
        else:
            if frame.review_status == FrameStatus.annotated:
                frame.review_status = FrameStatus.pending
                counts["missing"] += 1
            else:
                counts["ok"] += 1

    db.commit()

    # Re-register orphaned JPEGs in data/frames/ that have no DB row
    known = {f.img_path for f in db.query(LabeledFrame).all()}
    for jpg in FRAMES_DIR.glob("frame_*.jpg"):
        if str(jpg) in known:
            continue
        parts = jpg.stem.split("_")
        if len(parts) != 3:
            continue
        try:
            video_id, frame_number = int(parts[1]), int(parts[2])
        except ValueError:
            continue
        video = db.get(Video, video_id)
        if not video:
            continue
        cap = cv2.VideoCapture(video.raw_path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        cap.release()
        label_path = DATASET_DIR / "labels" / "train" / f"{jpg.stem}.txt"
        db.add(LabeledFrame(
            video_id=video_id,
            frame_number=frame_number,
            timestamp=frame_number / fps,
            img_path=str(jpg),
            label_path=str(label_path),
            split=FrameSplit.train,
            review_status=FrameStatus.pending,
        ))
        counts["reregistered"] += 1

    db.commit()
    return counts
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd /home/leew4/volleyball-cv && python -m pytest tests/test_reconciler.py -v
```

Expected: 5 PASS.

- [ ] **Step 6: Run full suite to confirm no regressions**

```bash
cd /home/leew4/volleyball-cv && python -m pytest tests/ -v
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add backend/training/__init__.py backend/training/reconciler.py tests/test_reconciler.py
git commit -m "feat: disk-DB reconciler for labeled frame healing"
```

---

## Task 5: Frame extractor

**Files:**
- Create: `backend/training/frame_extractor.py`
- Create: `tests/test_frame_extractor.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_frame_extractor.py`:

```python
# tests/test_frame_extractor.py
import io
import numpy as np
import cv2
from pathlib import Path
from backend.database import SessionLocal
from backend.models.match import FrameSplit, FrameStatus


def _make_synthetic_video(path: Path, n_frames: int = 120, fps: int = 30) -> None:
    """Write a minimal real MP4 so cv2.VideoCapture works."""
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(path), fourcc, fps, (64, 64))
    for _ in range(n_frames):
        writer.write(np.zeros((64, 64, 3), dtype=np.uint8))
    writer.release()


def _make_match_video_rally(db, video_path: str):
    from backend.models.match import Match, Video, Rally
    match = Match(date="2026-05-19")
    db.add(match)
    db.flush()
    video = Video(match_id=match.id, set_number=1, raw_path=video_path)
    db.add(video)
    db.flush()
    # Rally covering frames 0–90 (3s at 30fps)
    rally = Rally(video_id=video.id, start_time=0.0, end_time=3.0, confidence=1.0)
    db.add(rally)
    db.commit()
    return video.id


def test_extracts_frames_and_creates_db_rows(tmp_path):
    video_path = tmp_path / "test.mp4"
    _make_synthetic_video(video_path)

    from backend.config import FRAMES_DIR
    FRAMES_DIR.mkdir(parents=True, exist_ok=True)

    with SessionLocal() as db:
        video_id = _make_match_video_rally(db, str(video_path))

        from backend.training.frame_extractor import extract_frames
        count = extract_frames(video_id, db, sample_rate=30, max_frames=500)

        frames = db.query(__import__("backend.models.match", fromlist=["LabeledFrame"]).LabeledFrame).all()

    assert count > 0
    assert len(frames) == count
    for frame in frames:
        assert Path(frame.img_path).exists()
        assert frame.review_status == FrameStatus.pending


def test_split_proportions_are_roughly_correct(tmp_path):
    video_path = tmp_path / "test.mp4"
    _make_synthetic_video(video_path, n_frames=300)

    from backend.config import FRAMES_DIR
    FRAMES_DIR.mkdir(parents=True, exist_ok=True)

    with SessionLocal() as db:
        video_id = _make_match_video_rally(db, str(video_path))
        # Rally covers the full 10s so we get ~10 frames at sample_rate=30
        from backend.training.frame_extractor import extract_frames
        from backend.models.match import LabeledFrame
        count = extract_frames(video_id, db, sample_rate=30, max_frames=500,
                               split_ratios={"train": 0.8, "val": 0.1, "test": 0.1})

        train_count = db.query(LabeledFrame).filter_by(split=FrameSplit.train).count()
        total = db.query(LabeledFrame).count()

    assert total == count
    # With small N exact proportions vary, but train should be the majority
    assert train_count >= total * 0.5


def test_raises_when_video_not_found():
    with SessionLocal() as db:
        from backend.training.frame_extractor import extract_frames
        try:
            extract_frames(99999, db)
            assert False, "expected ValueError"
        except ValueError as e:
            assert "not found" in str(e)


def test_raises_when_no_rallies(tmp_path):
    video_path = tmp_path / "test.mp4"
    _make_synthetic_video(video_path)

    with SessionLocal() as db:
        from backend.models.match import Match, Video
        match = Match(date="2026-05-19")
        db.add(match)
        db.flush()
        video = Video(match_id=match.id, set_number=1, raw_path=str(video_path))
        db.add(video)
        db.commit()
        video_id = video.id

        from backend.training.frame_extractor import extract_frames
        try:
            extract_frames(video_id, db)
            assert False, "expected ValueError"
        except ValueError as e:
            assert "No rallies" in str(e)
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /home/leew4/volleyball-cv && python -m pytest tests/test_frame_extractor.py -v
```

Expected: FAIL — `backend.training.frame_extractor` not found.

- [ ] **Step 3: Create backend/training/frame_extractor.py**

```python
# backend/training/frame_extractor.py
import random
from pathlib import Path

import cv2
from sqlalchemy.orm import Session

from backend.config import FRAMES_DIR, DATASET_DIR
from backend.models.match import FrameSplit, FrameStatus, LabeledFrame, Rally, Video


def extract_frames(
    video_id: int,
    db: Session,
    sample_rate: int = 30,
    max_frames: int = 500,
    split_ratios: dict[str, float] | None = None,
) -> int:
    if split_ratios is None:
        split_ratios = {"train": 0.8, "val": 0.1, "test": 0.1}

    video = db.get(Video, video_id)
    if not video:
        raise ValueError(f"Video {video_id} not found")

    rallies = db.query(Rally).filter_by(video_id=video_id).all()
    if not rallies:
        raise ValueError(f"No rallies found for video {video_id}")

    FRAMES_DIR.mkdir(parents=True, exist_ok=True)
    for split in ("train", "val", "test"):
        (DATASET_DIR / "labels" / split).mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(video.raw_path)
    if not cap.isOpened():
        raise ValueError(f"Cannot open video: {video.raw_path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0

    candidates: list[int] = []
    for rally in rallies:
        start_f = int(rally.start_time * fps)
        end_f = int(rally.end_time * fps)
        candidates.extend(range(start_f, end_f, sample_rate))

    candidates = sorted(set(candidates))
    if len(candidates) > max_frames:
        candidates = sorted(random.sample(candidates, max_frames))

    shuffled = candidates[:]
    random.shuffle(shuffled)
    n = len(shuffled)
    n_train = int(n * split_ratios["train"])
    n_val = int(n * split_ratios["val"])
    assignments = (
        [FrameSplit.train] * n_train
        + [FrameSplit.val] * n_val
        + [FrameSplit.test] * (n - n_train - n_val)
    )
    split_map = dict(zip(shuffled, assignments))

    extracted = 0
    for frame_idx in candidates:
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ret, frame = cap.read()
        if not ret:
            continue

        img_path = FRAMES_DIR / f"frame_{video_id}_{frame_idx}.jpg"
        assigned_split = split_map[frame_idx]
        label_path = DATASET_DIR / "labels" / assigned_split.value / f"frame_{video_id}_{frame_idx}.txt"

        cv2.imwrite(str(img_path), frame)
        db.add(LabeledFrame(
            video_id=video_id,
            frame_number=frame_idx,
            timestamp=frame_idx / fps,
            img_path=str(img_path),
            label_path=str(label_path),
            split=assigned_split,
            review_status=FrameStatus.pending,
        ))
        extracted += 1

    cap.release()
    db.commit()
    return extracted
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /home/leew4/volleyball-cv && python -m pytest tests/test_frame_extractor.py -v
```

Expected: 4 PASS.

- [ ] **Step 5: Run full suite**

```bash
cd /home/leew4/volleyball-cv && python -m pytest tests/ -v
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/training/frame_extractor.py tests/test_frame_extractor.py
git commit -m "feat: frame extractor samples rally segments with configurable splits"
```

---

## Task 6: Bootstrap routes — extraction, frames list, image serving

**Files:**
- Create: `backend/routers/bootstrap.py`
- Modify: `backend/main.py`
- Create: `tests/test_bootstrap_routes.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_bootstrap_routes.py`:

```python
# tests/test_bootstrap_routes.py
import io
from pathlib import Path
from backend.database import SessionLocal
from backend.models.match import FrameStatus, FrameSplit, LabeledFrame, Match, Video, Rally


def _setup_video_with_rally(client) -> tuple[int, int]:
    """Creates match + video + rally, returns (match_id, video_id)."""
    match_id = client.post("/matches", json={"date": "2026-05-19"}).json()["id"]
    video_resp = client.post(
        f"/matches/{match_id}/videos",
        data={"set_number": "1"},
        files={"file": ("s.mp4", io.BytesIO(b"x"), "video/mp4")},
    )
    video_id = video_resp.json()["id"]
    with SessionLocal() as db:
        db.add(Rally(video_id=video_id, start_time=0.0, end_time=5.0, confidence=1.0))
        db.commit()
    return match_id, video_id


def _make_frame(db, video_id, img_path, label_path, status=FrameStatus.pending) -> LabeledFrame:
    frame = LabeledFrame(
        video_id=video_id, frame_number=1, timestamp=0.0,
        img_path=img_path, label_path=label_path,
        split=FrameSplit.train, review_status=status,
    )
    db.add(frame)
    db.commit()
    db.refresh(frame)
    return frame


def test_extract_returns_202(client):
    _, video_id = _setup_video_with_rally(client)
    resp = client.post(f"/bootstrap/extract/{video_id}", json={})
    assert resp.status_code == 202
    assert resp.json()["video_id"] == video_id


def test_extract_rejects_invalid_split_ratios(client):
    _, video_id = _setup_video_with_rally(client)
    resp = client.post(f"/bootstrap/extract/{video_id}",
                       json={"split_train": 0.5, "split_val": 0.5, "split_test": 0.5})
    assert resp.status_code == 422


def test_list_frames_returns_all(client, tmp_path):
    _, video_id = _setup_video_with_rally(client)
    with SessionLocal() as db:
        _make_frame(db, video_id, str(tmp_path / "a.jpg"), str(tmp_path / "a.txt"))
        _make_frame(db, video_id, str(tmp_path / "b.jpg"), str(tmp_path / "b.txt"))
    resp = client.get("/bootstrap/frames")
    assert resp.status_code == 200
    assert len(resp.json()) == 2


def test_list_frames_filters_by_status(client, tmp_path):
    _, video_id = _setup_video_with_rally(client)
    with SessionLocal() as db:
        _make_frame(db, video_id, str(tmp_path / "a.jpg"), str(tmp_path / "a.txt"), FrameStatus.pending)
        _make_frame(db, video_id, str(tmp_path / "b.jpg"), str(tmp_path / "b.txt"), FrameStatus.annotated)
    resp = client.get("/bootstrap/frames?status=pending")
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["review_status"] == "pending"


def test_get_frame_image_returns_jpeg(client, tmp_path):
    _, video_id = _setup_video_with_rally(client)
    img_path = tmp_path / "frame.jpg"
    img_path.write_bytes(b"fakejpeg")
    with SessionLocal() as db:
        frame = _make_frame(db, video_id, str(img_path), str(tmp_path / "lbl.txt"))
        frame_id = frame.id
    resp = client.get(f"/bootstrap/frames/{frame_id}/image")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/jpeg"


def test_get_frame_image_404_when_file_missing(client, tmp_path):
    _, video_id = _setup_video_with_rally(client)
    with SessionLocal() as db:
        frame = _make_frame(db, video_id, "/nonexistent/img.jpg", str(tmp_path / "lbl.txt"))
        frame_id = frame.id
    resp = client.get(f"/bootstrap/frames/{frame_id}/image")
    assert resp.status_code == 404
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /home/leew4/volleyball-cv && python -m pytest tests/test_bootstrap_routes.py -v
```

Expected: FAIL — `/bootstrap/...` routes not registered.

- [ ] **Step 3: Create backend/routers/bootstrap.py with extraction + frames + image routes**

```python
# backend/routers/bootstrap.py
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.config import DATABASE_URL
from backend.database import get_db
from backend.models.match import FrameStatus, FrameSplit, LabeledFrame, ModelVersion, TrainingRun, TrainingStatus
from backend.schemas.match import (
    AnnotateRequest,
    BootstrapExtractRequest,
    BootstrapStatus,
    LabeledFrameRead,
    ModelVersionRead,
    ReconcileResult,
    TrainingRunRead,
    TrainingRunRequest,
)
from backend.training.frame_extractor import extract_frames
from backend.training.reconciler import reconcile
from backend.training.trainer import run_training

router = APIRouter()
MIN_FRAMES = 200


def _extraction_task(video_id: int, sample_rate: int, max_frames: int,
                     split_ratios: dict, db_url: str) -> None:
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    engine = create_engine(db_url, connect_args={"check_same_thread": False})
    try:
        with sessionmaker(bind=engine)() as db:
            extract_frames(video_id, db, sample_rate, max_frames, split_ratios)
    finally:
        engine.dispose()


@router.post("/bootstrap/extract/{video_id}", status_code=202)
def start_extraction(
    video_id: int,
    body: BootstrapExtractRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    ratios = {"train": body.split_train, "val": body.split_val, "test": body.split_test}
    if abs(sum(ratios.values()) - 1.0) > 0.001:
        raise HTTPException(status_code=422, detail="split ratios must sum to 1.0")
    background_tasks.add_task(
        _extraction_task, video_id, body.sample_rate, body.max_frames, ratios, DATABASE_URL
    )
    return {"video_id": video_id}


@router.get("/bootstrap/frames", response_model=list[LabeledFrameRead])
def list_frames(
    status: str | None = None,
    split: str | None = None,
    db: Session = Depends(get_db),
):
    q = db.query(LabeledFrame)
    if status:
        try:
            q = q.filter(LabeledFrame.review_status == FrameStatus(status))
        except ValueError:
            raise HTTPException(status_code=422, detail=f"invalid status: {status}")
    if split:
        try:
            q = q.filter(LabeledFrame.split == FrameSplit(split))
        except ValueError:
            raise HTTPException(status_code=422, detail=f"invalid split: {split}")
    return q.all()


@router.get("/bootstrap/frames/{frame_id}/image")
def get_frame_image(frame_id: int, db: Session = Depends(get_db)):
    frame = db.get(LabeledFrame, frame_id)
    if not frame:
        raise HTTPException(status_code=404, detail="frame not found")
    if not Path(frame.img_path).exists():
        raise HTTPException(status_code=404, detail="image file not found on disk")
    return FileResponse(frame.img_path, media_type="image/jpeg")
```

- [ ] **Step 4: Register router in backend/main.py**

Add to imports:
```python
from backend.routers import matches, videos, jobs, rallies, bootstrap
```

Add after existing router registrations:
```python
app.include_router(bootstrap.router)
```

Also add a static mount for frames dir after the existing mounts:
```python
from backend.config import EXPORTS_DIR, UPLOADS_DIR, FRAMES_DIR
# ...
app.mount("/frames", StaticFiles(directory=str(FRAMES_DIR)), name="frames")
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd /home/leew4/volleyball-cv && python -m pytest tests/test_bootstrap_routes.py -v
```

Expected: 5 PASS.

- [ ] **Step 6: Run full suite**

```bash
cd /home/leew4/volleyball-cv && python -m pytest tests/ -v
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add backend/routers/bootstrap.py backend/main.py tests/test_bootstrap_routes.py
git commit -m "feat: bootstrap extraction routes and frame serving"
```

---

## Task 7: Annotation, skip, status, and admin reconcile routes

**Files:**
- Modify: `backend/routers/bootstrap.py`
- Modify: `tests/test_bootstrap_routes.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_bootstrap_routes.py`:

```python
def test_annotate_writes_label_file_and_sets_status(client, tmp_path):
    _, video_id = _setup_video_with_rally(client)
    img_path = tmp_path / "frame.jpg"
    img_path.write_bytes(b"fake")
    label_path = tmp_path / "label.txt"
    with SessionLocal() as db:
        frame = _make_frame(db, video_id, str(img_path), str(label_path))
        frame_id = frame.id

    resp = client.post(f"/bootstrap/frames/{frame_id}/annotate",
                       json={"cx": 0.5, "cy": 0.5, "w": 0.1, "h": 0.1})
    assert resp.status_code == 200
    assert resp.json()["review_status"] == "annotated"
    assert label_path.exists()
    content = label_path.read_text().strip()
    assert content.startswith("0 ")
    parts = content.split()
    assert len(parts) == 5
    assert float(parts[1]) == pytest.approx(0.5)


def test_skip_writes_empty_label_and_sets_status(client, tmp_path):
    _, video_id = _setup_video_with_rally(client)
    img_path = tmp_path / "frame.jpg"
    img_path.write_bytes(b"fake")
    label_path = tmp_path / "label.txt"
    with SessionLocal() as db:
        frame = _make_frame(db, video_id, str(img_path), str(label_path))
        frame_id = frame.id

    resp = client.post(f"/bootstrap/frames/{frame_id}/skip")
    assert resp.status_code == 200
    assert resp.json()["review_status"] == "skipped"
    assert label_path.exists()
    assert label_path.read_text() == ""


def test_bootstrap_status_counts_frames(client, tmp_path):
    _, video_id = _setup_video_with_rally(client)
    with SessionLocal() as db:
        _make_frame(db, video_id, str(tmp_path / "a.jpg"), str(tmp_path / "a.txt"), FrameStatus.annotated)
        _make_frame(db, video_id, str(tmp_path / "b.jpg"), str(tmp_path / "b.txt"), FrameStatus.pending)

    resp = client.get("/bootstrap/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["annotated"] == 1
    assert data["pending"] == 1
    assert data["frames_total"] == 2
    assert data["model_ready"] is False
    assert data["active_model_id"] is None


def test_admin_reconcile_returns_summary(client, tmp_path):
    _, video_id = _setup_video_with_rally(client)
    img_path = tmp_path / "frame.jpg"
    img_path.write_bytes(b"fake")
    label_path = tmp_path / "label.txt"
    label_path.write_text("0 0.5 0.5 0.1 0.1\n")
    with SessionLocal() as db:
        _make_frame(db, video_id, str(img_path), str(label_path), FrameStatus.pending)

    resp = client.post("/admin/reconcile")
    assert resp.status_code == 200
    data = resp.json()
    assert "restored" in data
    assert data["restored"] >= 1
```

Also add `import pytest` at the top of `tests/test_bootstrap_routes.py`.

- [ ] **Step 2: Run tests to confirm new ones fail**

```bash
cd /home/leew4/volleyball-cv && python -m pytest tests/test_bootstrap_routes.py -v
```

Expected: 5 existing pass, 4 new FAIL — routes not yet implemented.

- [ ] **Step 3: Add annotation, skip, status, and reconcile routes to backend/routers/bootstrap.py**

Append to `backend/routers/bootstrap.py` (after the `get_frame_image` route):

```python
@router.post("/bootstrap/frames/{frame_id}/annotate", response_model=LabeledFrameRead)
def annotate_frame(frame_id: int, body: AnnotateRequest, db: Session = Depends(get_db)):
    frame = db.get(LabeledFrame, frame_id)
    if not frame:
        raise HTTPException(status_code=404, detail="frame not found")
    label_path = Path(frame.label_path)
    label_path.parent.mkdir(parents=True, exist_ok=True)
    label_path.write_text(f"0 {body.cx:.6f} {body.cy:.6f} {body.w:.6f} {body.h:.6f}\n")
    frame.review_status = FrameStatus.annotated
    db.commit()
    db.refresh(frame)
    return frame


@router.post("/bootstrap/frames/{frame_id}/skip", response_model=LabeledFrameRead)
def skip_frame(frame_id: int, db: Session = Depends(get_db)):
    frame = db.get(LabeledFrame, frame_id)
    if not frame:
        raise HTTPException(status_code=404, detail="frame not found")
    label_path = Path(frame.label_path)
    label_path.parent.mkdir(parents=True, exist_ok=True)
    label_path.write_text("")
    frame.review_status = FrameStatus.skipped
    db.commit()
    db.refresh(frame)
    return frame


@router.get("/bootstrap/status", response_model=BootstrapStatus)
def bootstrap_status(db: Session = Depends(get_db)):
    counts = dict(
        db.query(LabeledFrame.review_status, func.count(LabeledFrame.id))
        .group_by(LabeledFrame.review_status)
        .all()
    )
    annotated = counts.get(FrameStatus.annotated, 0)
    skipped = counts.get(FrameStatus.skipped, 0)
    pending = counts.get(FrameStatus.pending, 0)
    missing = counts.get(FrameStatus.missing, 0)
    active = db.query(ModelVersion).filter_by(is_active=True).first()
    return BootstrapStatus(
        frames_total=annotated + skipped + pending + missing,
        annotated=annotated,
        skipped=skipped,
        pending=pending,
        missing=missing,
        model_ready=annotated >= MIN_FRAMES,
        active_model_id=active.id if active else None,
    )


@router.post("/admin/reconcile", response_model=ReconcileResult)
def run_reconcile(db: Session = Depends(get_db)):
    return reconcile(db)
```

- [ ] **Step 4: Run all bootstrap tests to confirm they pass**

```bash
cd /home/leew4/volleyball-cv && python -m pytest tests/test_bootstrap_routes.py -v
```

Expected: 9 PASS.

- [ ] **Step 5: Run full suite**

```bash
cd /home/leew4/volleyball-cv && python -m pytest tests/ -v
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/routers/bootstrap.py tests/test_bootstrap_routes.py
git commit -m "feat: annotation, skip, status, and reconcile routes"
```

---

## Task 8: Training pipeline

**Files:**
- Create: `backend/training/trainer.py`
- Create: `tests/test_training.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_training.py`:

```python
# tests/test_training.py
import io
from pathlib import Path
from unittest.mock import MagicMock, patch
from backend.database import SessionLocal
from backend.models.match import (
    FrameStatus, FrameSplit, LabeledFrame, Match, ModelVersion, Rally, TrainingRun, TrainingStatus, Video,
)
from backend.config import FRAMES_DIR, DATASET_DIR, MODELS_DIR


def _make_200_annotated_frames(db, video_id: int) -> None:
    FRAMES_DIR.mkdir(parents=True, exist_ok=True)
    (DATASET_DIR / "labels" / "train").mkdir(parents=True, exist_ok=True)
    for i in range(200):
        img = FRAMES_DIR / f"frame_{video_id}_{i}.jpg"
        img.write_bytes(b"fake")
        lbl = DATASET_DIR / "labels" / "train" / f"frame_{video_id}_{i}.txt"
        lbl.write_text("0 0.5 0.5 0.1 0.1\n")
        db.add(LabeledFrame(
            video_id=video_id, frame_number=i, timestamp=float(i) / 30,
            img_path=str(img), label_path=str(lbl),
            split=FrameSplit.train, review_status=FrameStatus.annotated,
        ))
    db.commit()


def _setup(db):
    match = Match(date="2026-05-19")
    db.add(match)
    db.flush()
    video = Video(match_id=match.id, set_number=1, raw_path="/fake/video.mp4")
    db.add(video)
    db.flush()
    db.add(Rally(video_id=video.id, start_time=0.0, end_time=10.0, confidence=1.0))
    db.commit()
    return video.id


def _make_mock_yolo(best_weights_path: Path):
    best_weights_path.parent.mkdir(parents=True, exist_ok=True)
    best_weights_path.write_bytes(b"fake weights")
    mock_results = MagicMock()
    mock_results.results_dict = {"train/box_loss": 0.05}
    mock_metrics = MagicMock()
    mock_metrics.box.mp = 0.85
    mock_metrics.box.mr = 0.82
    mock_metrics.box.map50 = 0.83
    mock_model = MagicMock()
    mock_model.train.return_value = mock_results
    mock_model.val.return_value = mock_metrics
    return mock_model


def test_run_training_creates_model_version_on_success():
    from backend.config import DATABASE_URL
    best_weights = MODELS_DIR / "run_1" / "weights" / "best.pt"

    with SessionLocal() as db:
        video_id = _setup(db)
        _make_200_annotated_frames(db, video_id)
        run = TrainingRun(status=TrainingStatus.pending, epochs=1)
        db.add(run)
        db.commit()
        run_id = run.id

    mock_model = _make_mock_yolo(best_weights)
    with patch("ultralytics.YOLO", return_value=mock_model):
        from backend.training.trainer import run_training
        run_training(run_id, 1, DATABASE_URL)

    with SessionLocal() as db:
        run = db.get(TrainingRun, run_id)
        assert run.status == TrainingStatus.done
        assert run.new_model_id is not None
        mv = db.get(ModelVersion, run.new_model_id)
        assert mv.test_precision == 0.85
        assert mv.test_recall == 0.82
        assert mv.test_map50 == 0.83
        assert mv.is_active is False


def test_run_training_sets_error_on_exception():
    from backend.config import DATABASE_URL

    with SessionLocal() as db:
        run = TrainingRun(status=TrainingStatus.pending, epochs=1)
        db.add(run)
        db.commit()
        run_id = run.id

    with patch("ultralytics.YOLO", side_effect=RuntimeError("GPU not available")):
        from backend.training.trainer import run_training
        run_training(run_id, 1, DATABASE_URL)

    with SessionLocal() as db:
        run = db.get(TrainingRun, run_id)
        assert run.status == TrainingStatus.error
        assert "GPU not available" in run.error
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /home/leew4/volleyball-cv && python -m pytest tests/test_training.py -v
```

Expected: FAIL — `backend.training.trainer` not found.

- [ ] **Step 3: Create backend/training/trainer.py**

```python
# backend/training/trainer.py
import shutil
import time
import traceback
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.config import DATASET_DIR, MODELS_DIR
from backend.models.match import FrameStatus, FrameSplit, LabeledFrame, ModelVersion, TrainingRun, TrainingStatus
from backend.training.reconciler import reconcile


def run_training(run_id: int, epochs: int, db_url: str) -> None:
    engine = create_engine(db_url, connect_args={"check_same_thread": False})
    try:
        with sessionmaker(bind=engine)() as db:
            run = db.get(TrainingRun, run_id)
            if not run:
                return
            run.status = TrainingStatus.running
            db.commit()
            try:
                _do_train(run, epochs, db)
                run.status = TrainingStatus.done
            except Exception:
                run.status = TrainingStatus.error
                run.error = traceback.format_exc()[:2000]
            db.commit()
    finally:
        engine.dispose()


def _do_train(run: TrainingRun, epochs: int, db) -> None:
    from ultralytics import YOLO
    import datetime

    reconcile(db)

    for split in ("train", "val", "test"):
        (DATASET_DIR / "images" / split).mkdir(parents=True, exist_ok=True)
        (DATASET_DIR / "labels" / split).mkdir(parents=True, exist_ok=True)

    frames = db.query(LabeledFrame).filter(
        LabeledFrame.review_status.in_([FrameStatus.annotated, FrameStatus.skipped])
    ).all()

    frames_used = 0
    for frame in frames:
        img_src = Path(frame.img_path)
        if not img_src.exists():
            continue
        split_val = frame.split.value
        shutil.copy2(img_src, DATASET_DIR / "images" / split_val / img_src.name)
        label_src = Path(frame.label_path)
        label_dst = DATASET_DIR / "labels" / split_val / label_src.name
        if label_src.exists():
            shutil.copy2(label_src, label_dst)
        else:
            label_dst.write_text("")
        if frame.split == FrameSplit.train:
            frames_used += 1

    run.frames_used = frames_used
    db.commit()

    yaml_path = DATASET_DIR / "data.yaml"
    yaml_path.write_text(
        f"path: {DATASET_DIR}\n"
        "train: images/train\n"
        "val: images/val\n"
        "test: images/test\n"
        "nc: 1\n"
        "names: [ball]\n"
    )

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    t_start = time.time()
    model = YOLO("yolov8n.pt")
    results = model.train(
        data=str(yaml_path),
        epochs=epochs,
        imgsz=640,
        device=0,
        project=str(MODELS_DIR),
        name=f"run_{run.id}",
        exist_ok=True,
    )

    best_weights = MODELS_DIR / f"run_{run.id}" / "weights" / "best.pt"
    eval_model = YOLO(str(best_weights))
    metrics = eval_model.val(data=str(yaml_path), split="test", verbose=False)

    run.epochs = epochs
    run.final_loss = float(results.results_dict.get("train/box_loss", 0.0))
    run.duration_s = time.time() - t_start

    mv = ModelVersion(
        name=f"v{run.id}-{datetime.date.today()}",
        weights_path=str(best_weights),
        dataset_size=frames_used,
        test_precision=float(metrics.box.mp),
        test_recall=float(metrics.box.mr),
        test_map50=float(metrics.box.map50),
        is_active=False,
    )
    db.add(mv)
    db.flush()
    run.new_model_id = mv.id
    db.commit()
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /home/leew4/volleyball-cv && python -m pytest tests/test_training.py -v
```

Expected: 2 PASS.

- [ ] **Step 5: Run full suite**

```bash
cd /home/leew4/volleyball-cv && python -m pytest tests/ -v
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/training/trainer.py tests/test_training.py
git commit -m "feat: YOLOv8 training pipeline with test-set evaluation"
```

---

## Task 9: Training trigger + model list + promotion gate routes

**Files:**
- Modify: `backend/routers/bootstrap.py`
- Modify: `tests/test_bootstrap_routes.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_bootstrap_routes.py`:

```python
def _make_model_version(db, precision, recall, map50, is_active=False) -> ModelVersion:
    from backend.models.match import ModelVersion
    mv = ModelVersion(
        name="test-model", weights_path="/fake/weights.pt",
        dataset_size=200, test_precision=precision, test_recall=recall, test_map50=map50,
        is_active=is_active,
    )
    db.add(mv)
    db.commit()
    db.refresh(mv)
    return mv


def test_training_run_blocked_below_min_frames(client):
    resp = client.post("/training/run", json={"epochs": 5})
    assert resp.status_code == 422


def test_training_run_returns_202_when_enough_frames(client, tmp_path):
    _, video_id = _setup_video_with_rally(client)
    with SessionLocal() as db:
        for i in range(200):
            img = tmp_path / f"f{i}.jpg"
            img.write_bytes(b"fake")
            lbl = tmp_path / f"f{i}.txt"
            lbl.write_text("0 0.5 0.5 0.1 0.1\n")
            _make_frame(db, video_id, str(img), str(lbl), FrameStatus.annotated)

    from unittest.mock import patch, MagicMock
    mock_model = MagicMock()
    mock_model.train.return_value = MagicMock(results_dict={"train/box_loss": 0.05})
    mock_metrics = MagicMock()
    mock_metrics.box.mp = 0.85
    mock_metrics.box.mr = 0.82
    mock_metrics.box.map50 = 0.83

    best = Path("/tmp/volleyball_cv_test_data/models/run_1/weights/best.pt")
    best.parent.mkdir(parents=True, exist_ok=True)
    best.write_bytes(b"fake")
    mock_model.val.return_value = mock_metrics

    with patch("ultralytics.YOLO", return_value=mock_model):
        resp = client.post("/training/run", json={"epochs": 1})
    assert resp.status_code == 202
    assert "run_id" in resp.json()


def test_list_models_returns_all(client):
    with SessionLocal() as db:
        _make_model_version(db, 0.8, 0.8, 0.8)
        _make_model_version(db, 0.9, 0.9, 0.9, is_active=True)
    resp = client.get("/models")
    assert resp.status_code == 200
    assert len(resp.json()) == 2


def test_promote_first_model_always_allowed(client):
    with SessionLocal() as db:
        mv = _make_model_version(db, 0.8, 0.8, 0.8, is_active=False)
        model_id = mv.id
    resp = client.post(f"/models/{model_id}/promote")
    assert resp.status_code == 200
    assert resp.json()["is_active"] is True


def test_promote_blocked_when_net_delta_negative(client):
    with SessionLocal() as db:
        _make_model_version(db, 0.9, 0.9, 0.9, is_active=True)
        worse = _make_model_version(db, 0.7, 0.7, 0.7, is_active=False)
        worse_id = worse.id
    resp = client.post(f"/models/{worse_id}/promote")
    assert resp.status_code == 409
    assert "net_delta" in resp.json()["detail"]


def test_promote_allowed_when_net_delta_positive(client):
    with SessionLocal() as db:
        _make_model_version(db, 0.7, 0.7, 0.7, is_active=True)
        better = _make_model_version(db, 0.9, 0.9, 0.9, is_active=False)
        better_id = better.id
    resp = client.post(f"/models/{better_id}/promote")
    assert resp.status_code == 200
    assert resp.json()["is_active"] is True


def test_promote_allowed_when_net_positive_despite_one_regressed_metric(client):
    """precision +0.1, recall -0.05, map50 +0.1 → net +0.15 → allowed."""
    with SessionLocal() as db:
        _make_model_version(db, 0.7, 0.9, 0.7, is_active=True)
        mixed = _make_model_version(db, 0.8, 0.85, 0.8, is_active=False)
        mixed_id = mixed.id
    resp = client.post(f"/models/{mixed_id}/promote")
    assert resp.status_code == 200
```

Also add `from backend.models.match import ModelVersion` to the imports at the top of `tests/test_bootstrap_routes.py`.

- [ ] **Step 2: Run new tests to confirm they fail**

```bash
cd /home/leew4/volleyball-cv && python -m pytest tests/test_bootstrap_routes.py -k "training or promote or models" -v
```

Expected: FAIL — routes not yet implemented.

- [ ] **Step 3: Append training + model routes to backend/routers/bootstrap.py**

Append to `backend/routers/bootstrap.py`:

```python
@router.post("/training/run", status_code=202)
def start_training_run(
    body: TrainingRunRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    annotated_count = db.query(LabeledFrame).filter_by(review_status=FrameStatus.annotated).count()
    if annotated_count < MIN_FRAMES:
        raise HTTPException(
            status_code=422,
            detail=f"need at least {MIN_FRAMES} annotated frames, have {annotated_count}",
        )
    in_progress = db.query(TrainingRun).filter_by(status=TrainingStatus.running).first()
    if in_progress:
        raise HTTPException(status_code=409, detail="a training run is already in progress")
    run = TrainingRun(status=TrainingStatus.pending, epochs=body.epochs)
    db.add(run)
    db.commit()
    db.refresh(run)
    background_tasks.add_task(run_training, run.id, body.epochs, DATABASE_URL)
    return {"run_id": run.id}


@router.get("/training/runs/{run_id}", response_model=TrainingRunRead)
def get_training_run(run_id: int, db: Session = Depends(get_db)):
    run = db.get(TrainingRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="training run not found")
    return run


@router.get("/models", response_model=list[ModelVersionRead])
def list_models(db: Session = Depends(get_db)):
    return db.query(ModelVersion).order_by(ModelVersion.created_at.desc()).all()


@router.post("/models/{model_id}/promote", response_model=ModelVersionRead)
def promote_model(model_id: int, db: Session = Depends(get_db)):
    new_model = db.get(ModelVersion, model_id)
    if not new_model:
        raise HTTPException(status_code=404, detail="model not found")
    old_model = db.query(ModelVersion).filter_by(is_active=True).first()
    if old_model and old_model.id != model_id:
        net_delta = (
            (new_model.test_precision or 0.0) - (old_model.test_precision or 0.0)
            + (new_model.test_recall or 0.0) - (old_model.test_recall or 0.0)
            + (new_model.test_map50 or 0.0) - (old_model.test_map50 or 0.0)
        )
        if net_delta <= 0:
            raise HTTPException(
                status_code=409,
                detail=f"model did not improve overall (net_delta={net_delta:.4f})",
            )
        old_model.is_active = False
    new_model.is_active = True
    db.commit()
    db.refresh(new_model)
    return new_model
```

- [ ] **Step 4: Run all bootstrap tests**

```bash
cd /home/leew4/volleyball-cv && python -m pytest tests/test_bootstrap_routes.py -v
```

Expected: all PASS.

- [ ] **Step 5: Run full suite**

```bash
cd /home/leew4/volleyball-cv && python -m pytest tests/ -v
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/routers/bootstrap.py tests/test_bootstrap_routes.py
git commit -m "feat: training trigger, model list, and promotion gate routes"
```

---

## Task 10: Frontend types + API client

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api/client.ts`

- [ ] **Step 1: Add new TypeScript types to frontend/src/types.ts**

Append to `frontend/src/types.ts`:

```typescript
export type FrameSplit = 'train' | 'val' | 'test'
export type FrameStatus = 'pending' | 'annotated' | 'skipped' | 'missing'
export type TrainingStatus = 'pending' | 'running' | 'done' | 'error'

export interface LabeledFrame {
  id: number
  video_id: number
  frame_number: number
  timestamp: number
  img_path: string
  label_path: string
  split: FrameSplit
  review_status: FrameStatus
  created_at: string
}

export interface ModelVersion {
  id: number
  name: string
  weights_path: string
  dataset_size: number
  test_precision: number | null
  test_recall: number | null
  test_map50: number | null
  is_active: boolean
  created_at: string
}

export interface TrainingRun {
  id: number
  status: TrainingStatus
  base_model_id: number | null
  new_model_id: number | null
  frames_used: number | null
  epochs: number | null
  final_loss: number | null
  duration_s: number | null
  error: string | null
  created_at: string
}

export interface BootstrapStatus {
  frames_total: number
  annotated: number
  skipped: number
  pending: number
  missing: number
  model_ready: boolean
  active_model_id: number | null
}

export interface ReconcileResult {
  missing: number
  restored: number
  reregistered: number
  malformed: number
  split_conflicts: number
  ok: number
}

export interface AnnotateBbox {
  cx: number
  cy: number
  w: number
  h: number
}
```

- [ ] **Step 2: Add new API functions to frontend/src/api/client.ts**

Append to `frontend/src/api/client.ts`:

```typescript
import type {
  AnnotateBbox, BootstrapStatus, LabeledFrame, ModelVersion, ReconcileResult, TrainingRun,
} from '../types'

export function getBootstrapStatus(): Promise<BootstrapStatus> {
  return request('/bootstrap/status')
}

export function startExtraction(
  videoId: number,
  opts: { sample_rate?: number; max_frames?: number; split_train?: number; split_val?: number; split_test?: number } = {}
): Promise<{ video_id: number }> {
  return request(`/bootstrap/extract/${videoId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  })
}

export function getFrames(params: { status?: string; split?: string } = {}): Promise<LabeledFrame[]> {
  const qs = new URLSearchParams(params as Record<string, string>).toString()
  return request(`/bootstrap/frames${qs ? '?' + qs : ''}`)
}

export function getFrameImageUrl(frameId: number): string {
  return `http://localhost:8000/bootstrap/frames/${frameId}/image`
}

export function annotateFrame(frameId: number, bbox: AnnotateBbox): Promise<LabeledFrame> {
  return request(`/bootstrap/frames/${frameId}/annotate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bbox),
  })
}

export function skipFrame(frameId: number): Promise<LabeledFrame> {
  return request(`/bootstrap/frames/${frameId}/skip`, { method: 'POST' })
}

export function startTraining(epochs = 50): Promise<{ run_id: number }> {
  return request('/training/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ epochs }),
  })
}

export function getTrainingRun(runId: number): Promise<TrainingRun> {
  return request(`/training/runs/${runId}`)
}

export function getModels(): Promise<ModelVersion[]> {
  return request('/models')
}

export function promoteModel(modelId: number): Promise<ModelVersion> {
  return request(`/models/${modelId}/promote`, { method: 'POST' })
}

export function runReconcile(): Promise<ReconcileResult> {
  return request('/admin/reconcile', { method: 'POST' })
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /home/leew4/volleyball-cv/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /home/leew4/volleyball-cv
git add frontend/src/types.ts frontend/src/api/client.ts
git commit -m "feat: frontend types and API client for bootstrap flow"
```

---

## Task 11: ActiveLearning Phase A — canvas annotation UI

**Files:**
- Modify: `frontend/src/views/ActiveLearning.tsx`
- Create: `frontend/src/test/ActiveLearning.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/test/ActiveLearning.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import ActiveLearning from '../views/ActiveLearning'

vi.mock('../api/client', () => ({
  getBootstrapStatus: vi.fn(),
  getFrames: vi.fn(),
  startExtraction: vi.fn(),
  annotateFrame: vi.fn(),
  skipFrame: vi.fn(),
  getFrameImageUrl: vi.fn((id: number) => `http://fake/frame/${id}`),
  startTraining: vi.fn(),
  getTrainingRun: vi.fn(),
  getModels: vi.fn(),
  promoteModel: vi.fn(),
  runReconcile: vi.fn(),
}))

import * as api from '../api/client'

const mockStatus = (overrides = {}) => ({
  frames_total: 0, annotated: 0, skipped: 0, pending: 0, missing: 0,
  model_ready: false, active_model_id: null, ...overrides,
})

const mockFrame = (overrides = {}) => ({
  id: 1, video_id: 1, frame_number: 0, timestamp: 0.0,
  img_path: '/fake/frame.jpg', label_path: '/fake/label.txt',
  split: 'train', review_status: 'pending', created_at: '2026-05-19T00:00:00',
  ...overrides,
})

describe('ActiveLearning Phase A', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows frame count and progress', async () => {
    vi.mocked(api.getBootstrapStatus).mockResolvedValue(mockStatus({ annotated: 50, frames_total: 100 }))
    vi.mocked(api.getFrames).mockResolvedValue([mockFrame()])
    render(<ActiveLearning />)
    await waitFor(() => expect(screen.getByText(/50 \/ 100/)).toBeInTheDocument())
  })

  it('shows Start Training button only when model_ready is true', async () => {
    vi.mocked(api.getBootstrapStatus).mockResolvedValue(mockStatus({ annotated: 200, frames_total: 200, model_ready: true }))
    vi.mocked(api.getFrames).mockResolvedValue([])
    render(<ActiveLearning />)
    await waitFor(() => expect(screen.getByText('Start Training')).not.toBeDisabled())
  })

  it('Start Training button is disabled when model_ready is false', async () => {
    vi.mocked(api.getBootstrapStatus).mockResolvedValue(mockStatus({ annotated: 5, frames_total: 10, model_ready: false }))
    vi.mocked(api.getFrames).mockResolvedValue([mockFrame()])
    render(<ActiveLearning />)
    await waitFor(() => expect(screen.getByText('Start Training')).toBeDisabled())
  })

  it('clicking No ball calls skipFrame and loads next frame', async () => {
    vi.mocked(api.getBootstrapStatus).mockResolvedValue(mockStatus({ frames_total: 2, pending: 2 }))
    const frame1 = mockFrame({ id: 1 })
    const frame2 = mockFrame({ id: 2, frame_number: 1 })
    vi.mocked(api.getFrames).mockResolvedValue([frame1, frame2])
    vi.mocked(api.skipFrame).mockResolvedValue({ ...frame1, review_status: 'skipped' })

    render(<ActiveLearning />)
    await waitFor(() => screen.getByText('No ball'))
    fireEvent.click(screen.getByText('No ball'))
    await waitFor(() => expect(api.skipFrame).toHaveBeenCalledWith(1))
  })

  it('clicking Skip does not call annotateFrame or skipFrame', async () => {
    vi.mocked(api.getBootstrapStatus).mockResolvedValue(mockStatus({ frames_total: 1, pending: 1 }))
    vi.mocked(api.getFrames).mockResolvedValue([mockFrame()])
    render(<ActiveLearning />)
    await waitFor(() => screen.getByText('Skip'))
    fireEvent.click(screen.getByText('Skip'))
    expect(api.annotateFrame).not.toHaveBeenCalled()
    expect(api.skipFrame).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /home/leew4/volleyball-cv/frontend && npx vitest run src/test/ActiveLearning.test.tsx
```

Expected: FAIL — `ActiveLearning` is the stub.

- [ ] **Step 3: Implement Phase A in frontend/src/views/ActiveLearning.tsx**

```typescript
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AnnotateBbox, BootstrapStatus, LabeledFrame } from '../types'
import {
  annotateFrame, getBootstrapStatus, getFrameImageUrl, getFrames,
  skipFrame, startExtraction, startTraining,
} from '../api/client'

interface Rect { x: number; y: number; w: number; h: number }

export default function ActiveLearning() {
  const [status, setStatus] = useState<BootstrapStatus | null>(null)
  const [frames, setFrames] = useState<LabeledFrame[]>([])
  const [idx, setIdx] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const [drawing, setDrawing] = useState(false)
  const [startPt, setStartPt] = useState<{ x: number; y: number } | null>(null)
  const [phase, setPhase] = useState<'annotate' | 'training'>('annotate')
  const [runId, setRunId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  const refresh = useCallback(async () => {
    const [s, f] = await Promise.all([
      getBootstrapStatus(),
      getFrames({ status: 'pending' }),
    ])
    setStatus(s)
    setFrames(f)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const currentFrame: LabeledFrame | undefined = frames[idx]

  useEffect(() => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img || !currentFrame) return
    const ctx = canvas.getContext('2d')!
    img.onload = () => {
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      ctx.drawImage(img, 0, 0)
      if (rect) {
        ctx.strokeStyle = '#00ff00'
        ctx.lineWidth = 2
        ctx.strokeRect(rect.x, rect.y, rect.w, rect.h)
      }
    }
    img.src = getFrameImageUrl(currentFrame.id)
  }, [currentFrame, rect])

  const canvasCoords = (e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const canvas = canvasRef.current!
    const bounds = canvas.getBoundingClientRect()
    const scaleX = canvas.width / bounds.width
    const scaleY = canvas.height / bounds.height
    return {
      x: (e.clientX - bounds.left) * scaleX,
      y: (e.clientY - bounds.top) * scaleY,
    }
  }

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setDrawing(true)
    setStartPt(canvasCoords(e))
    setRect(null)
  }

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drawing || !startPt) return
    const pt = canvasCoords(e)
    setRect({
      x: Math.min(startPt.x, pt.x),
      y: Math.min(startPt.y, pt.y),
      w: Math.abs(pt.x - startPt.x),
      h: Math.abs(pt.y - startPt.y),
    })
  }

  const onMouseUp = () => setDrawing(false)

  const confirm = async () => {
    if (!currentFrame || !rect) return
    const canvas = canvasRef.current!
    const bbox: AnnotateBbox = {
      cx: (rect.x + rect.w / 2) / canvas.width,
      cy: (rect.y + rect.h / 2) / canvas.height,
      w: rect.w / canvas.width,
      h: rect.h / canvas.height,
    }
    await annotateFrame(currentFrame.id, bbox)
    setRect(null)
    setIdx(i => i + 1)
    await refresh()
  }

  const noBall = async () => {
    if (!currentFrame) return
    await skipFrame(currentFrame.id)
    setRect(null)
    setIdx(i => i + 1)
    await refresh()
  }

  const skip = () => {
    setRect(null)
    setIdx(i => i + 1)
  }

  const handleStartTraining = async () => {
    try {
      const { run_id } = await startTraining(50)
      setRunId(run_id)
      setPhase('training')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to start training')
    }
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (phase !== 'annotate') return
      if (e.key === 'Enter') confirm()
      if (e.key === 'n' || e.key === 'N') noBall()
      if (e.key === 's' || e.key === 'S') skip()
      if (e.key === 'r' || e.key === 'R') setRect(null)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  if (phase === 'training') {
    return <TrainingPhase runId={runId!} onBack={() => setPhase('annotate')} />
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Active Learning — Bootstrap</h1>

      {error && <p className="text-red-500 mb-2">{error}</p>}

      {status && (
        <div className="flex items-center gap-4 mb-4">
          <span className="text-lg font-mono">
            {status.annotated} / {status.frames_total} frames annotated
          </span>
          <button
            onClick={handleStartTraining}
            disabled={!status.model_ready}
            className="px-4 py-2 bg-green-600 text-white rounded disabled:opacity-40"
          >
            Start Training
          </button>
        </div>
      )}

      {currentFrame ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-500">
            Frame {idx + 1} of {frames.length} — {currentFrame.split} split —
            t={currentFrame.timestamp.toFixed(2)}s
          </p>
          <div className="relative border border-gray-300 rounded overflow-hidden" style={{ maxWidth: 640 }}>
            <img ref={imgRef} alt="frame" className="hidden" />
            <canvas
              ref={canvasRef}
              style={{ width: '100%', cursor: 'crosshair', display: 'block' }}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={confirm}
              disabled={!rect}
              className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-40"
            >
              Confirm (Enter)
            </button>
            <button onClick={noBall} className="px-4 py-2 bg-yellow-500 text-white rounded">
              No ball (N)
            </button>
            <button onClick={skip} className="px-4 py-2 bg-gray-400 text-white rounded">
              Skip (S)
            </button>
            <button onClick={() => setRect(null)} className="px-4 py-2 bg-red-400 text-white rounded">
              Redo (R)
            </button>
          </div>
        </div>
      ) : (
        <p className="text-gray-500">
          {status?.frames_total === 0
            ? 'No frames extracted yet. Use the Extract Frames button to sample from a processed video.'
            : 'All pending frames reviewed.'}
        </p>
      )}
    </div>
  )
}

function TrainingPhase({ runId, onBack }: { runId: number; onBack: () => void }) {
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Training</h1>
      <p className="text-gray-500">Training run #{runId} started. See Phase B for progress.</p>
      <button onClick={onBack} className="mt-4 px-4 py-2 bg-gray-600 text-white rounded">
        Back
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Run Phase A tests to confirm they pass**

```bash
cd /home/leew4/volleyball-cv/frontend && npx vitest run src/test/ActiveLearning.test.tsx
```

Expected: 5 PASS.

- [ ] **Step 5: Verify TypeScript**

```bash
cd /home/leew4/volleyball-cv/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd /home/leew4/volleyball-cv
git add frontend/src/views/ActiveLearning.tsx frontend/src/test/ActiveLearning.test.tsx
git commit -m "feat: ActiveLearning Phase A — canvas bbox annotation UI"
```

---

## Task 12: ActiveLearning Phase B — training progress + promotion UI

**Files:**
- Modify: `frontend/src/views/ActiveLearning.tsx`
- Modify: `frontend/src/test/ActiveLearning.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/test/ActiveLearning.test.tsx`:

```typescript
describe('ActiveLearning Phase B — promotion', () => {
  it('shows promotion table after training completes', async () => {
    const mockRun = {
      id: 1, status: 'done', base_model_id: null, new_model_id: 2,
      frames_used: 200, epochs: 50, final_loss: 0.05, duration_s: 300, error: null,
      created_at: '2026-05-19T00:00:00',
    }
    const mockNewModel = {
      id: 2, name: 'v1', weights_path: '/w.pt', dataset_size: 200,
      test_precision: 0.85, test_recall: 0.82, test_map50: 0.83,
      is_active: false, created_at: '2026-05-19T00:00:00',
    }
    vi.mocked(api.getTrainingRun).mockResolvedValue(mockRun as any)
    vi.mocked(api.getModels).mockResolvedValue([mockNewModel])
    vi.mocked(api.promoteModel).mockResolvedValue({ ...mockNewModel, is_active: true })

    const { PromotionPanel } = await import('../views/ActiveLearning')
    render(<PromotionPanel runId={1} oldModel={null} newModel={mockNewModel as any} onPromoted={() => {}} />)

    expect(screen.getByText(/0.85/)).toBeInTheDocument()
    expect(screen.getByText('Promote')).not.toBeDisabled()
  })

  it('disables Promote when net_delta is negative', async () => {
    const oldModel = {
      id: 1, name: 'old', weights_path: '/w.pt', dataset_size: 200,
      test_precision: 0.95, test_recall: 0.95, test_map50: 0.95,
      is_active: true, created_at: '2026-05-19T00:00:00',
    }
    const newModel = {
      id: 2, name: 'new', weights_path: '/w2.pt', dataset_size: 200,
      test_precision: 0.7, test_recall: 0.7, test_map50: 0.7,
      is_active: false, created_at: '2026-05-19T00:00:00',
    }

    const { PromotionPanel } = await import('../views/ActiveLearning')
    render(<PromotionPanel runId={1} oldModel={oldModel as any} newModel={newModel as any} onPromoted={() => {}} />)

    expect(screen.getByText('Promote')).toBeDisabled()
    expect(screen.getByText(/did not improve/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /home/leew4/volleyball-cv/frontend && npx vitest run src/test/ActiveLearning.test.tsx
```

Expected: Phase A tests pass, Phase B tests FAIL — `PromotionPanel` not exported.

- [ ] **Step 3: Add PromotionPanel and training polling to ActiveLearning.tsx**

Replace the `TrainingPhase` stub component at the bottom of `ActiveLearning.tsx` with:

```typescript
import { getModels, getTrainingRun, promoteModel } from '../api/client'
import type { ModelVersion, TrainingRun } from '../types'

export function PromotionPanel({
  runId,
  oldModel,
  newModel,
  onPromoted,
}: {
  runId: number
  oldModel: ModelVersion | null
  newModel: ModelVersion
  onPromoted: () => void
}) {
  const [promoting, setPromoting] = useState(false)
  const [promoted, setPromoted] = useState(false)

  const netDelta = oldModel
    ? (newModel.test_precision ?? 0) - (oldModel.test_precision ?? 0)
    + (newModel.test_recall ?? 0) - (oldModel.test_recall ?? 0)
    + (newModel.test_map50 ?? 0) - (oldModel.test_map50 ?? 0)
    : 1

  const canPromote = netDelta > 0

  const handlePromote = async () => {
    setPromoting(true)
    await promoteModel(newModel.id)
    setPromoted(true)
    setPromoting(false)
    onPromoted()
  }

  const fmt = (v: number | null) => v != null ? v.toFixed(3) : '—'
  const diff = (n: number | null, o: number | null) => {
    if (n == null || o == null) return ''
    const d = n - o
    return d >= 0 ? `+${d.toFixed(3)}` : d.toFixed(3)
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Test Set Evaluation</h2>
      <table className="border-collapse text-sm w-full max-w-lg">
        <thead>
          <tr className="bg-gray-100">
            <th className="border p-2 text-left">Metric</th>
            {oldModel && <th className="border p-2">Old model</th>}
            <th className="border p-2">New model</th>
            {oldModel && <th className="border p-2">Change</th>}
          </tr>
        </thead>
        <tbody>
          {(['test_precision', 'test_recall', 'test_map50'] as const).map(key => (
            <tr key={key}>
              <td className="border p-2 font-mono">{key.replace('test_', '')}</td>
              {oldModel && <td className="border p-2 text-center">{fmt(oldModel[key])}</td>}
              <td className="border p-2 text-center">{fmt(newModel[key])}</td>
              {oldModel && (
                <td className={`border p-2 text-center ${
                  (newModel[key] ?? 0) >= (oldModel[key] ?? 0) ? 'text-green-600' : 'text-red-600'
                }`}>
                  {diff(newModel[key], oldModel[key])}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {oldModel && (
        <p className={`font-mono text-sm ${canPromote ? 'text-green-700' : 'text-red-700'}`}>
          Net delta: {netDelta >= 0 ? '+' : ''}{netDelta.toFixed(4)} —{' '}
          {canPromote ? 'Model improved overall' : 'Model did not improve overall'}
        </p>
      )}

      {promoted ? (
        <p className="text-green-700 font-semibold">Model promoted successfully.</p>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={handlePromote}
            disabled={!canPromote || promoting}
            className="px-4 py-2 bg-green-600 text-white rounded disabled:opacity-40"
          >
            Promote
          </button>
          <button
            onClick={onPromoted}
            className="px-4 py-2 bg-gray-400 text-white rounded"
          >
            Discard
          </button>
        </div>
      )}
    </div>
  )
}

function TrainingPhase({ runId, onBack }: { runId: number; onBack: () => void }) {
  const [run, setRun] = useState<TrainingRun | null>(null)
  const [models, setModels] = useState<ModelVersion[]>([])

  useEffect(() => {
    if (!run || run.status === 'running' || run.status === 'pending') {
      const id = setInterval(async () => {
        const r = await getTrainingRun(runId)
        setRun(r)
        if (r.status === 'done' || r.status === 'error') {
          clearInterval(id)
          const ms = await getModels()
          setModels(ms)
        }
      }, 3000)
      // Fire immediately
      getTrainingRun(runId).then(r => {
        setRun(r)
        if (r.status === 'done' || r.status === 'error') {
          getModels().then(setModels)
        }
      })
      return () => clearInterval(id)
    }
  }, [runId])

  const newModel = run?.new_model_id ? models.find(m => m.id === run.new_model_id) : undefined
  const oldModel = models.find(m => m.is_active && m.id !== run?.new_model_id) ?? null

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold">Training Run #{runId}</h1>

      {!run && <p className="text-gray-500">Loading…</p>}

      {run && run.status !== 'done' && run.status !== 'error' && (
        <div>
          <p className="text-gray-700">Status: <span className="font-mono">{run.status}</span></p>
          <p className="text-gray-500 text-sm">Training in progress — checking every 3s…</p>
        </div>
      )}

      {run?.status === 'error' && (
        <div className="text-red-600">
          <p className="font-semibold">Training failed</p>
          <pre className="text-xs bg-red-50 p-2 rounded overflow-auto">{run.error}</pre>
          <button onClick={onBack} className="mt-2 px-4 py-2 bg-gray-600 text-white rounded">
            Back
          </button>
        </div>
      )}

      {run?.status === 'done' && newModel && (
        <PromotionPanel
          runId={runId}
          oldModel={oldModel}
          newModel={newModel}
          onPromoted={onBack}
        />
      )}

      {run?.status === 'done' && !newModel && (
        <p className="text-gray-500">Training complete — model version not found.</p>
      )}
    </div>
  )
}
```

Also add `useState` and `useEffect` to the existing imports if not already there (they are in Phase A's implementation above).

- [ ] **Step 4: Run all ActiveLearning tests**

```bash
cd /home/leew4/volleyball-cv/frontend && npx vitest run src/test/ActiveLearning.test.tsx
```

Expected: all 7 PASS.

- [ ] **Step 5: Run the full frontend test suite**

```bash
cd /home/leew4/volleyball-cv/frontend && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 6: TypeScript check**

```bash
cd /home/leew4/volleyball-cv/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit and push**

```bash
cd /home/leew4/volleyball-cv
git add frontend/src/views/ActiveLearning.tsx frontend/src/test/ActiveLearning.test.tsx frontend/src/types.ts frontend/src/api/client.ts
git commit -m "feat: ActiveLearning Phase B — training progress and model promotion UI"
git push git@github-wesclee:wesclee/volleyball-cv.git master
```

---

## Self-Review

**Spec coverage check:**
- ✅ Architecture: YoloDetector, frame_extractor, reconciler, trainer, bootstrap router — all present
- ✅ Data model: LabeledFrame, ModelVersion, TrainingRun — Task 2
- ✅ Reconciler: all 6 scenarios covered in Task 4 tests
- ✅ Frame extractor: rally-based sampling, split assignment — Task 5
- ✅ Bootstrap routes: extract, frames list, image serve, annotate, skip, status, reconcile — Tasks 6–7
- ✅ Training pipeline: preflight reconcile, dataset population, data.yaml, train, eval, ModelVersion creation — Task 8
- ✅ Training routes + promotion gate with net_delta formula — Task 9
- ✅ Configurable 80/10/10 split — BootstrapExtractRequest in Task 2, sent in Task 6
- ✅ First model: no gate (no old_model) — Task 9 route + Task 12 PromotionPanel netDelta=1 fallback
- ✅ Frontend Phase A: canvas annotation, keyboard shortcuts, progress counter — Task 11
- ✅ Frontend Phase B: polling, promotion table, net_delta display — Task 12

**Type consistency check:**
- `BootstrapExtractRequest.split_train/val/test` used consistently in Task 2 (schema), Task 6 (route), Task 10 (API client) ✅
- `MIN_FRAMES = 200` defined once in `bootstrap.py`, referenced in `bootstrap_status` and `start_training_run` ✅
- `FrameStatus`, `FrameSplit`, `TrainingStatus` enums defined in models, imported in schemas, router, reconciler ✅
- `net_delta` formula identical in route (Task 9) and PromotionPanel (Task 12) ✅
- `getFrameImageUrl` returns a URL string (not a Promise) — consistent with usage in canvas effect ✅
