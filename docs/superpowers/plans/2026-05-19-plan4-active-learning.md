# Plan 4: Active Learning Loop

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After every video is processed by the YOLO detector, uncertain frames (confidence in the band 0.4–0.85) are queued for human review; reviewed labels feed back into the training pool; a recommendation indicator tells the user when to retrain.

**Architecture:** `YoloDetector` gains `detect_with_scores()` returning segments + per-frame scores. The processor calls it and writes uncertain frames as `LabeledFrame` rows with `pred_*` bbox fields. A new `/labeling` router serves the review queue and a retrain-recommendation status. `ActiveLearning.tsx` is replaced by `LabelingQueue.tsx` which adapts between bootstrap mode (no model yet) and active review mode (predicted bbox pre-drawn in yellow).

**Tech Stack:** FastAPI, SQLAlchemy 2.0, SQLite, OpenCV, ultralytics YOLO, React 18, TypeScript, Tailwind, Vitest, pytest, httpx TestClient.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `backend/config.py` | Add `ACTIVE_LOW_CONF`, `ACTIVE_HIGH_CONF`, `RETRAIN_THRESHOLD` constants |
| Modify | `backend/models/match.py` | Add `pred_cx/cy/w/h/conf` nullable columns to `LabeledFrame` |
| Modify | `backend/schemas/match.py` | Add pred fields to `LabeledFrameRead`; new `LabelingStatus` schema; remove stale `split_conflicts` from `ReconcileResult` frontend type |
| Modify | `backend/cv/yolo_detector.py` | Add `detect_with_scores()`, refactor `detect()` to call it |
| Modify | `backend/jobs/processor.py` | Extract `_queue_uncertain_frames()`; update `_run_pipeline` |
| Create | `backend/routers/labeling.py` | `GET /labeling/status`, `GET /labeling/queue` |
| Modify | `backend/main.py` | Register labeling router |
| Modify | `backend/routers/bootstrap.py` | Remove `/bootstrap/status` endpoint (replaced) |
| Modify | `frontend/src/types.ts` | Add pred fields to `LabeledFrame`; new `LabelingStatus` type; remove `BootstrapStatus`; remove `split_conflicts` from `ReconcileResult` |
| Modify | `frontend/src/api/client.ts` | Add `getLabelingStatus()`, `getLabelingQueue()`; remove `getBootstrapStatus()` |
| Create | `frontend/src/views/LabelingQueue.tsx` | Unified labeling view (bootstrap + active review + retrain panel) |
| Modify | `frontend/src/App.tsx` | Swap `ActiveLearning` import/route for `LabelingQueue` |
| Delete | `frontend/src/views/ActiveLearning.tsx` | Replaced by `LabelingQueue.tsx` |
| Create | `tests/test_labeling_routes.py` | Tests for `/labeling/status` and `/labeling/queue` |
| Create | `tests/test_processor_active_learning.py` | Tests for `_queue_uncertain_frames` |
| Modify | `tests/test_yolo_detector.py` | Tests for `detect_with_scores()` |
| Modify | `tests/test_bootstrap_routes.py` | Update status test to use `/labeling/status` |
| Create | `frontend/src/test/LabelingQueue.test.tsx` | Frontend tests for bootstrap + active modes + retrain panel |
| Delete | `frontend/src/test/ActiveLearning.test.tsx` | Replaced |

---

## Task 1: Config constants + LabeledFrame pred_* columns + schemas

**Files:**
- Modify: `backend/config.py`
- Modify: `backend/models/match.py`
- Modify: `backend/schemas/match.py`
- Modify: `frontend/src/types.ts`

- [ ] **Step 1: Write failing test for new DB columns**

```python
# tests/test_db.py  — add to existing file
def test_labeled_frame_stores_pred_fields(db_session):
    from backend.models.match import LabeledFrame, FrameSplit, FrameStatus
    frame = LabeledFrame(
        video_id=1,
        frame_number=42,
        timestamp=1.4,
        img_path="/tmp/x.jpg",
        label_path="/tmp/x.txt",
        split=FrameSplit.train,
        review_status=FrameStatus.pending,
        pred_cx=0.5,
        pred_cy=0.5,
        pred_w=0.1,
        pred_h=0.1,
        pred_conf=0.72,
    )
    db_session.add(frame)
    db_session.commit()
    db_session.refresh(frame)
    assert frame.pred_conf == pytest.approx(0.72)
    assert frame.pred_cx == pytest.approx(0.5)

def test_labeled_frame_pred_fields_nullable(db_session):
    from backend.models.match import LabeledFrame, FrameSplit, FrameStatus
    frame = LabeledFrame(
        video_id=1, frame_number=10, timestamp=0.3,
        img_path="/tmp/y.jpg", label_path="/tmp/y.txt",
        split=FrameSplit.train, review_status=FrameStatus.pending,
    )
    db_session.add(frame)
    db_session.commit()
    db_session.refresh(frame)
    assert frame.pred_conf is None
    assert frame.pred_cx is None
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /home/leew4/volleyball-cv
PYTHONPATH=. DATABASE_URL=sqlite:////tmp/volleyball_cv_test_data/test.db \
  DATA_DIR=/tmp/volleyball_cv_test_data \
  /home/leew4/.local/bin/pytest tests/test_db.py::test_labeled_frame_stores_pred_fields -v
```

Expected: `FAILED` — `LabeledFrame.__init__() got an unexpected keyword argument 'pred_cx'`

- [ ] **Step 3: Add constants to config.py**

```python
# backend/config.py  — append after MODELS_DIR block
ACTIVE_LOW_CONF = float(os.getenv("ACTIVE_LOW_CONF", "0.4"))
ACTIVE_HIGH_CONF = float(os.getenv("ACTIVE_HIGH_CONF", "0.85"))
RETRAIN_THRESHOLD = int(os.getenv("RETRAIN_THRESHOLD", "50"))
```

- [ ] **Step 4: Add pred_* columns to LabeledFrame in match.py**

In `backend/models/match.py`, find the `LabeledFrame` class and add five columns after `review_status`:

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
    pred_cx: Mapped[float | None] = mapped_column(Float, nullable=True)
    pred_cy: Mapped[float | None] = mapped_column(Float, nullable=True)
    pred_w: Mapped[float | None] = mapped_column(Float, nullable=True)
    pred_h: Mapped[float | None] = mapped_column(Float, nullable=True)
    pred_conf: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    video: Mapped["Video"] = relationship(back_populates="labeled_frames")
```

- [ ] **Step 5: Update LabeledFrameRead schema and add LabelingStatus**

In `backend/schemas/match.py`, update `LabeledFrameRead` to include pred fields, and add `LabelingStatus` after `ReconcileResult`:

```python
class LabeledFrameRead(BaseModel):
    id: int
    video_id: int
    frame_number: int
    timestamp: float
    img_path: str
    label_path: str
    split: FrameSplit
    review_status: FrameStatus
    pred_cx: float | None
    pred_cy: float | None
    pred_w: float | None
    pred_h: float | None
    pred_conf: float | None
    created_at: datetime

    model_config = {"from_attributes": True}
```

```python
class LabelingStatus(BaseModel):
    frames_total: int
    annotated: int
    skipped: int
    pending: int
    missing: int
    model_ready: bool
    active_model_id: int | None
    new_labeled_since_last_train: int
    retrain_recommended: bool
    retrain_threshold: int
    last_trained_at_size: int | None
```

- [ ] **Step 6: Update frontend types.ts**

Replace `BootstrapStatus` with `LabelingStatus`, add pred fields to `LabeledFrame`, remove `split_conflicts` from `ReconcileResult`:

```typescript
// In LabeledFrame interface, add after review_status:
pred_cx: number | null
pred_cy: number | null
pred_w: number | null
pred_h: number | null
pred_conf: number | null
```

```typescript
// Replace BootstrapStatus with:
export interface LabelingStatus {
  frames_total: number
  annotated: number
  skipped: number
  pending: number
  missing: number
  model_ready: boolean
  active_model_id: number | null
  new_labeled_since_last_train: number
  retrain_recommended: boolean
  retrain_threshold: number
  last_trained_at_size: number | null
}
```

```typescript
// ReconcileResult — remove split_conflicts field:
export interface ReconcileResult {
  missing: number
  restored: number
  reregistered: number
  malformed: number
  ok: number
}
```

- [ ] **Step 7: Run tests to confirm they pass**

```bash
cd /home/leew4/volleyball-cv
PYTHONPATH=. DATABASE_URL=sqlite:////tmp/volleyball_cv_test_data/test.db \
  DATA_DIR=/tmp/volleyball_cv_test_data \
  /home/leew4/.local/bin/pytest tests/test_db.py -v
```

Expected: all `test_db.py` tests pass.

- [ ] **Step 8: Run full suite to confirm no regressions**

```bash
PYTHONPATH=. DATABASE_URL=sqlite:////tmp/volleyball_cv_test_data/test.db \
  DATA_DIR=/tmp/volleyball_cv_test_data \
  /home/leew4/.local/bin/pytest tests/ -q
```

Expected: all 54 pass.

- [ ] **Step 9: Commit**

```bash
git add backend/config.py backend/models/match.py backend/schemas/match.py frontend/src/types.ts
git commit -m "feat: add active learning config constants, LabeledFrame pred_* columns, LabelingStatus schema"
```

---

## Task 2: YoloDetector.detect_with_scores()

**Files:**
- Modify: `backend/cv/yolo_detector.py`
- Modify: `tests/test_yolo_detector.py`

- [ ] **Step 1: Write failing test**

```python
# tests/test_yolo_detector.py — add after existing tests
def test_detect_with_scores_returns_segments_and_scores(tmp_path):
    from unittest.mock import MagicMock, patch
    from backend.cv.yolo_detector import YoloDetector

    detector = YoloDetector("fake.pt", conf_threshold=0.25,
                            rally_start_frames=2, rally_end_frames=2)

    mock_result = MagicMock()
    mock_result.boxes.conf.tolist.return_value = [0.9]
    silent = MagicMock()
    silent.boxes = None

    mock_model = MagicMock()
    mock_model.predict.return_value = iter(
        [silent, silent, mock_result, mock_result, mock_result,
         silent, silent, mock_result, mock_result, mock_result]
    )

    with patch("backend.cv.yolo_detector.cv2.VideoCapture") as mock_cap_cls:
        mock_cap = MagicMock()
        mock_cap.isOpened.return_value = True
        mock_cap.get.return_value = 10.0
        mock_cap_cls.return_value = mock_cap
        detector._model = mock_model

        segments, scores = detector.detect_with_scores("fake.mp4")

    assert len(scores) == 10
    assert scores[0] == 0.0   # silent frame
    assert scores[2] == pytest.approx(0.9)  # detected frame
    assert len(segments) >= 1


def test_detect_calls_detect_with_scores(tmp_path):
    from unittest.mock import MagicMock, patch
    from backend.cv.yolo_detector import YoloDetector

    detector = YoloDetector("fake.pt")

    with patch.object(detector, "detect_with_scores", return_value=([], [0.1, 0.9])) as mock_dws:
        result = detector.detect("fake.mp4")

    mock_dws.assert_called_once_with("fake.mp4")
    assert result == []
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /home/leew4/volleyball-cv
PYTHONPATH=. DATABASE_URL=sqlite:////tmp/volleyball_cv_test_data/test.db \
  DATA_DIR=/tmp/volleyball_cv_test_data \
  /home/leew4/.local/bin/pytest tests/test_yolo_detector.py::test_detect_with_scores_returns_segments_and_scores -v
```

Expected: `FAILED` — `YoloDetector has no attribute detect_with_scores`

- [ ] **Step 3: Add detect_with_scores() and refactor detect()**

Replace the body of `detect()` and add `detect_with_scores()` in `backend/cv/yolo_detector.py`:

```python
def detect_with_scores(self, video_path: str) -> tuple[list[RallySegment], list[float]]:
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

    return self._segments_from_scores(scores, fps), scores

def detect(self, video_path: str) -> list[RallySegment]:
    segments, _ = self.detect_with_scores(video_path)
    return segments
```

- [ ] **Step 4: Run new tests**

```bash
PYTHONPATH=. DATABASE_URL=sqlite:////tmp/volleyball_cv_test_data/test.db \
  DATA_DIR=/tmp/volleyball_cv_test_data \
  /home/leew4/.local/bin/pytest tests/test_yolo_detector.py -v
```

Expected: all yolo_detector tests pass.

- [ ] **Step 5: Run full suite**

```bash
PYTHONPATH=. DATABASE_URL=sqlite:////tmp/volleyball_cv_test_data/test.db \
  DATA_DIR=/tmp/volleyball_cv_test_data \
  /home/leew4/.local/bin/pytest tests/ -q
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/cv/yolo_detector.py tests/test_yolo_detector.py
git commit -m "feat: add YoloDetector.detect_with_scores() returning segments and per-frame scores"
```

---

## Task 3: Processor active learning frame queuing

**Files:**
- Modify: `backend/jobs/processor.py`
- Create: `tests/test_processor_active_learning.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_processor_active_learning.py
import pytest
from unittest.mock import MagicMock, patch, call
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.database import Base
from backend.models.match import (
    FrameStatus, FrameSplit, LabeledFrame, Match, ModelVersion, Rally, Video, VideoStatus,
)


@pytest.fixture
def db_session(tmp_path):
    url = f"sqlite:///{tmp_path}/test.db"
    engine = create_engine(url, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    with Session() as db:
        yield db
    engine.dispose()


@pytest.fixture
def video_with_rally(db_session):
    match = Match(date="2026-01-01")
    db_session.add(match)
    db_session.flush()
    video = Video(match_id=match.id, set_number=1, raw_path="/fake/video.mp4",
                  status=VideoStatus.done)
    db_session.add(video)
    db_session.flush()
    db_session.add(Rally(video_id=video.id, start_time=0.0, end_time=10.0, confidence=1.0))
    db_session.commit()
    return video


def _make_detector_mock():
    mock_model = MagicMock()
    # Single-frame predict returns a bbox
    box = MagicMock()
    box.xywhn = [MagicMock()]
    box.xywhn[0].tolist.return_value = [0.5, 0.5, 0.1, 0.1]
    result = MagicMock()
    result.boxes = MagicMock()
    result.boxes.__len__ = lambda s: 1
    result.boxes.__getitem__ = lambda s, i: box
    mock_model.predict.return_value = [result]
    detector = MagicMock()
    detector._model = mock_model
    return detector


def test_uncertain_frames_are_queued(db_session, video_with_rally, tmp_path):
    from backend.config import ACTIVE_LOW_CONF, ACTIVE_HIGH_CONF
    from backend.jobs.processor import _queue_uncertain_frames

    # 3 scores: one below band, one in band, one above band
    scores = [0.1, 0.6, 0.9]
    detector = _make_detector_mock()

    with patch("backend.jobs.processor.cv2.VideoCapture") as mock_cap_cls, \
         patch("backend.jobs.processor.cv2.imwrite"):
        mock_cap = MagicMock()
        mock_cap.isOpened.return_value = True
        mock_cap.get.return_value = 1.0
        mock_cap.read.return_value = (True, MagicMock())
        mock_cap_cls.return_value = mock_cap

        _queue_uncertain_frames(video_with_rally, scores, detector, db_session)

    frames = db_session.query(LabeledFrame).filter_by(video_id=video_with_rally.id).all()
    assert len(frames) == 1
    assert frames[0].pred_conf == pytest.approx(0.6)
    assert frames[0].pred_cx == pytest.approx(0.5)
    assert frames[0].review_status == FrameStatus.pending


def test_frames_sorted_by_conf_ascending(db_session, video_with_rally, tmp_path):
    from backend.jobs.processor import _queue_uncertain_frames

    scores = [0.0, 0.8, 0.5, 0.0, 0.65]  # indices 1,2,4 are in band
    detector = _make_detector_mock()

    with patch("backend.jobs.processor.cv2.VideoCapture") as mock_cap_cls, \
         patch("backend.jobs.processor.cv2.imwrite"):
        mock_cap = MagicMock()
        mock_cap.isOpened.return_value = True
        mock_cap.get.return_value = 1.0
        mock_cap.read.return_value = (True, MagicMock())
        mock_cap_cls.return_value = mock_cap

        _queue_uncertain_frames(video_with_rally, scores, detector, db_session)

    frames = db_session.query(LabeledFrame).filter_by(video_id=video_with_rally.id).all()
    confs = [f.pred_conf for f in frames]
    assert confs == sorted(confs)  # ascending


def test_existing_frames_not_re_queued(db_session, video_with_rally, tmp_path):
    from backend.jobs.processor import _queue_uncertain_frames

    # Pre-create a LabeledFrame for frame_number=1
    db_session.add(LabeledFrame(
        video_id=video_with_rally.id, frame_number=1, timestamp=1.0,
        img_path="/tmp/x.jpg", label_path="/tmp/x.txt",
        split=FrameSplit.train, review_status=FrameStatus.annotated,
    ))
    db_session.commit()

    scores = [0.0, 0.6, 0.7]  # indices 1 and 2 in band, but 1 is already in DB
    detector = _make_detector_mock()

    with patch("backend.jobs.processor.cv2.VideoCapture") as mock_cap_cls, \
         patch("backend.jobs.processor.cv2.imwrite"):
        mock_cap = MagicMock()
        mock_cap.isOpened.return_value = True
        mock_cap.get.return_value = 1.0
        mock_cap.read.return_value = (True, MagicMock())
        mock_cap_cls.return_value = mock_cap

        _queue_uncertain_frames(video_with_rally, scores, detector, db_session)

    new_frames = db_session.query(LabeledFrame).filter(
        LabeledFrame.pred_conf.isnot(None)
    ).all()
    assert len(new_frames) == 1
    assert new_frames[0].frame_number == 2


def test_motion_detector_skips_queuing(db_session, video_with_rally):
    from backend.jobs.processor import _run_pipeline
    from backend.models.match import Job, JobStatus

    job = Job(video_id=video_with_rally.id, status=JobStatus.pending)
    db_session.add(job)
    db_session.commit()

    with patch("backend.jobs.processor.MotionDetector") as mock_md_cls, \
         patch("backend.jobs.processor.cut_and_join", return_value="/out.mp4"), \
         patch("backend.jobs.processor._queue_uncertain_frames") as mock_queue:
        mock_md = MagicMock()
        mock_md.detect.return_value = []
        mock_md_cls.return_value = mock_md
        # No active model → MotionDetector path
        _run_pipeline(video_with_rally, job, db_session)

    mock_queue.assert_not_called()
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /home/leew4/volleyball-cv
PYTHONPATH=. DATABASE_URL=sqlite:////tmp/volleyball_cv_test_data/test.db \
  DATA_DIR=/tmp/volleyball_cv_test_data \
  /home/leew4/.local/bin/pytest tests/test_processor_active_learning.py -v
```

Expected: `FAILED` — `cannot import name '_queue_uncertain_frames'`

- [ ] **Step 3: Add imports and _queue_uncertain_frames to processor.py**

Add `import cv2` and the new imports at the top of `backend/jobs/processor.py`:

```python
import cv2
import traceback
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from backend.config import ACTIVE_HIGH_CONF, ACTIVE_LOW_CONF, DATASET_DIR, FRAMES_DIR
from backend.cv.motion_detector import MotionDetector
from backend.cv.yolo_detector import YoloDetector
from backend.cv.detector import RallySegment
from backend.editor.ffmpeg_editor import cut_and_join
from backend.models.match import (
    FrameSplit, FrameStatus, Job, JobStatus, LabeledFrame,
    ModelVersion, ProcessedVideo, Rally, Video, VideoStatus,
)
```

Add `_queue_uncertain_frames` function before `_run_pipeline`:

```python
def _queue_uncertain_frames(
    video: Video,
    scores: list[float],
    detector: YoloDetector,
    db: Session,
) -> None:
    existing = {
        f.frame_number
        for f in db.query(LabeledFrame).filter_by(video_id=video.id).all()
    }
    uncertain = sorted(
        [
            (i, score) for i, score in enumerate(scores)
            if ACTIVE_LOW_CONF <= score <= ACTIVE_HIGH_CONF and i not in existing
        ],
        key=lambda x: x[1],
    )
    if not uncertain:
        return

    FRAMES_DIR.mkdir(parents=True, exist_ok=True)
    (DATASET_DIR / "labels" / "train").mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(video.raw_path)
    if not cap.isOpened():
        return
    try:
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        for frame_idx, score in uncertain:
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
            ret, frame_data = cap.read()
            if not ret:
                continue
            img_path = FRAMES_DIR / f"frame_{video.id}_{frame_idx}.jpg"
            cv2.imwrite(str(img_path), frame_data)

            pred_cx = pred_cy = pred_w = pred_h = None
            results = list(detector._model.predict(source=str(img_path), verbose=False))
            if results and results[0].boxes and len(results[0].boxes) > 0:
                xywhn = results[0].boxes[0].xywhn[0].tolist()
                pred_cx, pred_cy, pred_w, pred_h = xywhn

            label_path = DATASET_DIR / "labels" / "train" / f"frame_{video.id}_{frame_idx}.txt"
            db.add(LabeledFrame(
                video_id=video.id,
                frame_number=frame_idx,
                timestamp=frame_idx / fps,
                img_path=str(img_path),
                label_path=str(label_path),
                split=FrameSplit.train,
                review_status=FrameStatus.pending,
                pred_cx=pred_cx,
                pred_cy=pred_cy,
                pred_w=pred_w,
                pred_h=pred_h,
                pred_conf=score,
            ))
        db.commit()
    finally:
        cap.release()
```

- [ ] **Step 4: Update _run_pipeline to call detect_with_scores and queue uncertain frames**

Replace the existing `_run_pipeline` function:

```python
def _run_pipeline(video: Video, job: Job, db: Session) -> None:
    active_model = db.query(ModelVersion).filter_by(is_active=True).first()

    if active_model:
        detector = YoloDetector(active_model.weights_path)
    else:
        detector = MotionDetector()

    job.progress_pct = 10.0
    db.commit()

    if isinstance(detector, YoloDetector):
        segments, scores = detector.detect_with_scores(video.raw_path)
    else:
        segments = detector.detect(video.raw_path)
        scores = []

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

    job.progress_pct = 90.0
    db.commit()

    if scores and isinstance(detector, YoloDetector):
        _queue_uncertain_frames(video, scores, detector, db)

    job.progress_pct = 95.0
    db.commit()
```

- [ ] **Step 5: Run new tests**

```bash
PYTHONPATH=. DATABASE_URL=sqlite:////tmp/volleyball_cv_test_data/test.db \
  DATA_DIR=/tmp/volleyball_cv_test_data \
  /home/leew4/.local/bin/pytest tests/test_processor_active_learning.py -v
```

Expected: 4 tests pass.

- [ ] **Step 6: Run full suite**

```bash
PYTHONPATH=. DATABASE_URL=sqlite:////tmp/volleyball_cv_test_data/test.db \
  DATA_DIR=/tmp/volleyball_cv_test_data \
  /home/leew4/.local/bin/pytest tests/ -q
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add backend/jobs/processor.py tests/test_processor_active_learning.py
git commit -m "feat: queue uncertain frames during video processing for active learning review"
```

---

## Task 4: Labeling router

**Files:**
- Create: `backend/routers/labeling.py`
- Modify: `backend/routers/bootstrap.py` (remove `/bootstrap/status`)
- Modify: `backend/main.py`
- Create: `tests/test_labeling_routes.py`
- Modify: `tests/test_bootstrap_routes.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_labeling_routes.py
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.database import Base, get_db
from backend.models.match import FrameStatus, FrameSplit, LabeledFrame, Match, ModelVersion, Video, VideoStatus


@pytest.fixture
def client(tmp_path, monkeypatch):
    import backend.config as cfg
    monkeypatch.setattr(cfg, "DATA_DIR", tmp_path)
    monkeypatch.setattr(cfg, "FRAMES_DIR", tmp_path / "frames")
    monkeypatch.setattr(cfg, "DATASET_DIR", tmp_path / "dataset")
    monkeypatch.setattr(cfg, "MODELS_DIR", tmp_path / "models")
    (tmp_path / "frames").mkdir()

    url = f"sqlite:///{tmp_path}/test.db"
    engine = create_engine(url, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)

    def override_db():
        with SessionLocal() as db:
            yield db

    from backend.main import app
    app.dependency_overrides[get_db] = override_db
    yield TestClient(app), SessionLocal
    app.dependency_overrides.clear()
    engine.dispose()


def _make_frame(db, video_id, img, label, status, pred_conf=None):
    f = LabeledFrame(
        video_id=video_id, frame_number=len(db.query(LabeledFrame).all()),
        timestamp=0.0, img_path=img, label_path=label,
        split=FrameSplit.train, review_status=status,
        pred_conf=pred_conf,
    )
    db.add(f)
    db.commit()
    return f


def _setup_video(db):
    match = Match(date="2026-01-01")
    db.add(match)
    db.flush()
    video = Video(match_id=match.id, set_number=1, raw_path="/fake.mp4",
                  status=VideoStatus.done)
    db.add(video)
    db.commit()
    return video.id


def test_labeling_status_no_model(client):
    tc, SessionLocal = client
    with SessionLocal() as db:
        vid = _setup_video(db)
        _make_frame(db, vid, "/a.jpg", "/a.txt", FrameStatus.annotated)
        _make_frame(db, vid, "/b.jpg", "/b.txt", FrameStatus.pending)

    resp = tc.get("/labeling/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["annotated"] == 1
    assert data["pending"] == 1
    assert data["new_labeled_since_last_train"] == 0
    assert data["retrain_recommended"] is False
    assert data["last_trained_at_size"] is None
    assert data["retrain_threshold"] == 50


def test_labeling_status_retrain_recommended(client):
    from backend.config import RETRAIN_THRESHOLD
    from datetime import datetime, timedelta

    tc, SessionLocal = client
    with SessionLocal() as db:
        vid = _setup_video(db)
        model = ModelVersion(
            name="v1", weights_path="/w.pt", dataset_size=200,
            test_precision=0.9, test_recall=0.9, test_map50=0.9,
            is_active=True,
        )
        db.add(model)
        db.commit()
        # Add RETRAIN_THRESHOLD annotated frames after model creation
        for i in range(RETRAIN_THRESHOLD):
            f = LabeledFrame(
                video_id=vid, frame_number=i, timestamp=float(i),
                img_path=f"/f{i}.jpg", label_path=f"/f{i}.txt",
                split=FrameSplit.train, review_status=FrameStatus.annotated,
            )
            db.add(f)
        db.commit()

    resp = tc.get("/labeling/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["retrain_recommended"] is True
    assert data["new_labeled_since_last_train"] >= RETRAIN_THRESHOLD
    assert data["last_trained_at_size"] == 200


def test_labeling_queue_returns_active_learning_frames_sorted(client):
    tc, SessionLocal = client
    with SessionLocal() as db:
        vid = _setup_video(db)
        _make_frame(db, vid, "/a.jpg", "/a.txt", FrameStatus.pending, pred_conf=0.7)
        _make_frame(db, vid, "/b.jpg", "/b.txt", FrameStatus.pending, pred_conf=0.5)
        _make_frame(db, vid, "/c.jpg", "/c.txt", FrameStatus.pending)  # bootstrap, no pred_conf

    resp = tc.get("/labeling/queue")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2  # only frames with pred_conf
    assert data[0]["pred_conf"] == pytest.approx(0.5)  # ascending order
    assert data[1]["pred_conf"] == pytest.approx(0.7)


def test_labeling_queue_excludes_non_pending(client):
    tc, SessionLocal = client
    with SessionLocal() as db:
        vid = _setup_video(db)
        _make_frame(db, vid, "/a.jpg", "/a.txt", FrameStatus.annotated, pred_conf=0.6)
        _make_frame(db, vid, "/b.jpg", "/b.txt", FrameStatus.pending, pred_conf=0.6)

    resp = tc.get("/labeling/queue")
    assert resp.status_code == 200
    assert len(resp.json()) == 1  # only pending
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /home/leew4/volleyball-cv
PYTHONPATH=. DATABASE_URL=sqlite:////tmp/volleyball_cv_test_data/test.db \
  DATA_DIR=/tmp/volleyball_cv_test_data \
  /home/leew4/.local/bin/pytest tests/test_labeling_routes.py -v
```

Expected: `FAILED` — 404 on `/labeling/status`

- [ ] **Step 3: Create backend/routers/labeling.py**

```python
# backend/routers/labeling.py
from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.config import RETRAIN_THRESHOLD
from backend.database import get_db
from backend.models.match import FrameStatus, LabeledFrame, ModelVersion
from backend.schemas.match import LabeledFrameRead, LabelingStatus

router = APIRouter()
MIN_FRAMES = 200


@router.get("/labeling/status", response_model=LabelingStatus)
def labeling_status(db: Session = Depends(get_db)):
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
    last_model = db.query(ModelVersion).order_by(ModelVersion.created_at.desc()).first()

    new_labeled = 0
    last_trained_at_size = None
    if last_model:
        last_trained_at_size = last_model.dataset_size
        new_labeled = (
            db.query(LabeledFrame)
            .filter(
                LabeledFrame.review_status.in_([FrameStatus.annotated, FrameStatus.skipped]),
                LabeledFrame.created_at > last_model.created_at,
            )
            .count()
        )

    return LabelingStatus(
        frames_total=annotated + skipped + pending + missing,
        annotated=annotated,
        skipped=skipped,
        pending=pending,
        missing=missing,
        model_ready=annotated >= MIN_FRAMES,
        active_model_id=active.id if active else None,
        new_labeled_since_last_train=new_labeled,
        retrain_recommended=new_labeled >= RETRAIN_THRESHOLD,
        retrain_threshold=RETRAIN_THRESHOLD,
        last_trained_at_size=last_trained_at_size,
    )


@router.get("/labeling/queue", response_model=list[LabeledFrameRead])
def labeling_queue(db: Session = Depends(get_db)):
    return (
        db.query(LabeledFrame)
        .filter(
            LabeledFrame.review_status == FrameStatus.pending,
            LabeledFrame.pred_conf.isnot(None),
        )
        .order_by(LabeledFrame.pred_conf.asc())
        .all()
    )
```

- [ ] **Step 4: Register labeling router in main.py**

In `backend/main.py`, add after the existing router imports and includes:

```python
from backend.routers.labeling import router as labeling_router
# ...
app.include_router(labeling_router)
```

- [ ] **Step 5: Remove /bootstrap/status from bootstrap.py**

In `backend/routers/bootstrap.py`, delete the `bootstrap_status` endpoint (the `@router.get("/bootstrap/status", ...)` function and its decorator). The route is now served by `/labeling/status`.

- [ ] **Step 6: Update test_bootstrap_routes.py to remove the status test**

In `tests/test_bootstrap_routes.py`, find `test_bootstrap_status_counts_frames` and delete it (it will be covered by `test_labeling_routes.py`).

- [ ] **Step 7: Run new labeling route tests**

```bash
PYTHONPATH=. DATABASE_URL=sqlite:////tmp/volleyball_cv_test_data/test.db \
  DATA_DIR=/tmp/volleyball_cv_test_data \
  /home/leew4/.local/bin/pytest tests/test_labeling_routes.py -v
```

Expected: 4 tests pass.

- [ ] **Step 8: Run full suite**

```bash
PYTHONPATH=. DATABASE_URL=sqlite:////tmp/volleyball_cv_test_data/test.db \
  DATA_DIR=/tmp/volleyball_cv_test_data \
  /home/leew4/.local/bin/pytest tests/ -q
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add backend/routers/labeling.py backend/routers/bootstrap.py backend/main.py \
  tests/test_labeling_routes.py tests/test_bootstrap_routes.py
git commit -m "feat: add /labeling/status and /labeling/queue endpoints, replace /bootstrap/status"
```

---

## Task 5: Frontend types and API client

**Files:**
- Modify: `frontend/src/api/client.ts`

The types were already updated in Task 1. This task updates the API client to match.

- [ ] **Step 1: Write failing frontend test**

```typescript
// frontend/src/test/api.test.ts — create new file
import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('getLabelingStatus', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('calls /labeling/status', async () => {
    const mockStatus = {
      frames_total: 10, annotated: 5, skipped: 2, pending: 3, missing: 0,
      model_ready: false, active_model_id: null,
      new_labeled_since_last_train: 0, retrain_recommended: false,
      retrain_threshold: 50, last_trained_at_size: null,
    }
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockStatus),
    } as Response)

    const { getLabelingStatus } = await import('../api/client')
    const result = await getLabelingStatus()
    expect(fetch).toHaveBeenCalledWith('http://localhost:8000/labeling/status', undefined)
    expect(result.retrain_threshold).toBe(50)
  })
})

describe('getLabelingQueue', () => {
  it('calls /labeling/queue', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    } as Response))

    const { getLabelingQueue } = await import('../api/client')
    await getLabelingQueue()
    expect(fetch).toHaveBeenCalledWith('http://localhost:8000/labeling/queue', undefined)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /home/leew4/volleyball-cv/frontend
npm test -- --run src/test/api.test.ts 2>&1 | tail -15
```

Expected: `FAILED` — `getLabelingStatus is not a function`

- [ ] **Step 3: Update client.ts**

In `frontend/src/api/client.ts`:

1. Update the import line at the top — remove `BootstrapStatus`, add `LabelingStatus`:

```typescript
import type {
  AnnotateBbox, Job, LabeledFrame, LabelingStatus, Match, MatchCreate, ModelVersion,
  ProcessedVideo, Rally, RallyUpdate, ReconcileResult, TrainingRun, Video,
} from '../types'
```

2. Replace `getBootstrapStatus` with `getLabelingStatus` and add `getLabelingQueue`:

```typescript
export function getLabelingStatus(): Promise<LabelingStatus> {
  return request('/labeling/status')
}

export function getLabelingQueue(): Promise<LabeledFrame[]> {
  return request('/labeling/queue')
}
```

Delete the old `getBootstrapStatus` function.

- [ ] **Step 4: Run frontend tests**

```bash
cd /home/leew4/volleyball-cv/frontend
npm test -- --run 2>&1 | tail -15
```

Expected: all tests pass (the old ActiveLearning tests reference `getBootstrapStatus` — they will fail until Task 6 when we delete ActiveLearning.test.tsx; if they fail now that is expected and acceptable — proceed).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/test/api.test.ts
git commit -m "feat: add getLabelingStatus and getLabelingQueue API functions, remove getBootstrapStatus"
```

---

## Task 6: LabelingQueue view

**Files:**
- Create: `frontend/src/views/LabelingQueue.tsx`
- Modify: `frontend/src/App.tsx`
- Delete: `frontend/src/views/ActiveLearning.tsx`
- Delete: `frontend/src/test/ActiveLearning.test.tsx`
- Create: `frontend/src/test/LabelingQueue.test.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
// frontend/src/test/LabelingQueue.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import LabelingQueue, { PromotionPanel } from '../views/LabelingQueue'
import type { LabelingStatus, LabeledFrame, ModelVersion } from '../types'

vi.mock('../api/client', () => ({
  getLabelingStatus: vi.fn(),
  getLabelingQueue: vi.fn(),
  getFrames: vi.fn(),
  getFrameImageUrl: vi.fn((id: number) => `/frames/${id}`),
  annotateFrame: vi.fn().mockResolvedValue({}),
  skipFrame: vi.fn().mockResolvedValue({}),
  startTraining: vi.fn().mockResolvedValue({ run_id: 1 }),
  getTrainingRun: vi.fn(),
  getModels: vi.fn(),
  promoteModel: vi.fn(),
}))

import * as client from '../api/client'

const noModelStatus: LabelingStatus = {
  frames_total: 0, annotated: 0, skipped: 0, pending: 0, missing: 0,
  model_ready: false, active_model_id: null,
  new_labeled_since_last_train: 0, retrain_recommended: false,
  retrain_threshold: 50, last_trained_at_size: null,
}

const withModelStatus: LabelingStatus = {
  ...noModelStatus,
  active_model_id: 1,
  frames_total: 3, pending: 3,
}

function mockFrame(id: number, predConf: number | null = null): LabeledFrame {
  return {
    id, video_id: 1, frame_number: id * 10, timestamp: id * 0.5,
    img_path: `/frames/${id}.jpg`, label_path: `/labels/${id}.txt`,
    split: 'train' as const satisfies import('../types').FrameSplit,
    review_status: 'pending' as const satisfies import('../types').FrameStatus,
    pred_cx: predConf != null ? 0.5 : null,
    pred_cy: predConf != null ? 0.5 : null,
    pred_w: predConf != null ? 0.1 : null,
    pred_h: predConf != null ? 0.1 : null,
    pred_conf: predConf,
    created_at: '2026-01-01T00:00:00',
  }
}

describe('LabelingQueue — bootstrap mode', () => {
  beforeEach(() => {
    vi.mocked(client.getLabelingStatus).mockResolvedValue(noModelStatus)
    vi.mocked(client.getFrames).mockResolvedValue([])
    vi.mocked(client.getLabelingQueue).mockResolvedValue([])
  })

  it('shows bootstrap heading when no active model', async () => {
    render(<LabelingQueue />)
    await waitFor(() => {
      expect(screen.getByText(/Active Learning/i)).toBeInTheDocument()
    })
  })

  it('does not show retrain panel when no model', async () => {
    render(<LabelingQueue />)
    await waitFor(() => screen.getByText(/Active Learning/i))
    expect(screen.queryByText(/new frames/i)).not.toBeInTheDocument()
  })
})

describe('LabelingQueue — active review mode', () => {
  beforeEach(() => {
    vi.mocked(client.getLabelingStatus).mockResolvedValue(withModelStatus)
    vi.mocked(client.getFrames).mockResolvedValue([])
    vi.mocked(client.getLabelingQueue).mockResolvedValue([
      mockFrame(1, 0.5),
      mockFrame(2, 0.7),
    ])
  })

  it('shows retrain panel with counter when model exists', async () => {
    render(<LabelingQueue />)
    await waitFor(() => {
      expect(screen.getByText(/new frames/i)).toBeInTheDocument()
    })
  })

  it('retrain button not highlighted when below threshold', async () => {
    render(<LabelingQueue />)
    await waitFor(() => screen.getByRole('button', { name: /retrain/i }))
    const btn = screen.getByRole('button', { name: /retrain/i })
    expect(btn).not.toHaveClass('bg-green-600')
  })

  it('retrain button highlighted when recommended', async () => {
    vi.mocked(client.getLabelingStatus).mockResolvedValue({
      ...withModelStatus, retrain_recommended: true,
    })
    render(<LabelingQueue />)
    await waitFor(() => screen.getByRole('button', { name: /retrain/i }))
    expect(screen.getByRole('button', { name: /retrain/i })).toHaveClass('bg-green-600')
  })

  it('no-ball action calls skipFrame', async () => {
    render(<LabelingQueue />)
    await waitFor(() => screen.getByText(/No ball/i))
    fireEvent.click(screen.getByText(/No ball/i))
    await waitFor(() => {
      expect(client.skipFrame).toHaveBeenCalledWith(1)
    })
  })

  it('retrain button transitions to training phase', async () => {
    vi.mocked(client.getLabelingStatus).mockResolvedValue({
      ...withModelStatus, retrain_recommended: true,
    })
    vi.mocked(client.getTrainingRun).mockResolvedValue({
      id: 1, status: 'pending', base_model_id: null, new_model_id: null,
      frames_used: null, epochs: null, final_loss: null, duration_s: null,
      error: null, created_at: '2026-01-01T00:00:00',
    })
    render(<LabelingQueue />)
    await waitFor(() => screen.getByRole('button', { name: /retrain/i }))
    fireEvent.click(screen.getByRole('button', { name: /retrain/i }))
    await waitFor(() => {
      expect(client.startTraining).toHaveBeenCalled()
    })
  })
})

describe('PromotionPanel', () => {
  const newModel: ModelVersion = {
    id: 2, name: 'v2', weights_path: '/w.pt', dataset_size: 300,
    test_precision: 0.92, test_recall: 0.88, test_map50: 0.91,
    is_active: false, created_at: '2026-01-01T00:00:00',
  }
  const oldModel: ModelVersion = {
    ...newModel, id: 1, name: 'v1',
    test_precision: 0.88, test_recall: 0.85, test_map50: 0.87,
    is_active: true,
  }

  it('enables promote when net_delta > 0', () => {
    render(<PromotionPanel runId={1} oldModel={oldModel} newModel={newModel} onPromoted={() => {}} />)
    expect(screen.getByRole('button', { name: /promote/i })).not.toBeDisabled()
  })

  it('disables promote when net_delta <= 0', () => {
    const worseModel = { ...newModel, test_precision: 0.80, test_recall: 0.80, test_map50: 0.80 }
    render(<PromotionPanel runId={1} oldModel={oldModel} newModel={worseModel} onPromoted={() => {}} />)
    expect(screen.getByRole('button', { name: /promote/i })).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /home/leew4/volleyball-cv/frontend
npm test -- --run src/test/LabelingQueue.test.tsx 2>&1 | tail -15
```

Expected: `FAILED` — `Cannot find module '../views/LabelingQueue'`

- [ ] **Step 3: Create LabelingQueue.tsx**

```typescript
// frontend/src/views/LabelingQueue.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AnnotateBbox, LabeledFrame, LabelingStatus, ModelVersion, TrainingRun } from '../types'
import {
  annotateFrame, getLabelingStatus, getLabelingQueue, getFrames,
  getFrameImageUrl, getModels, getTrainingRun, promoteModel, skipFrame, startTraining,
} from '../api/client'

interface Rect { x: number; y: number; w: number; h: number }

export default function LabelingQueue() {
  const [status, setStatus] = useState<LabelingStatus | null>(null)
  const [bootstrapFrames, setBootstrapFrames] = useState<LabeledFrame[]>([])
  const [queueFrames, setQueueFrames] = useState<LabeledFrame[]>([])
  const [idx, setIdx] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const [drawing, setDrawing] = useState(false)
  const [startPt, setStartPt] = useState<{ x: number; y: number } | null>(null)
  const [phase, setPhase] = useState<'annotate' | 'training'>('annotate')
  const [runId, setRunId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  const isBootstrapMode = !status?.active_model_id
  const frames = isBootstrapMode ? bootstrapFrames : queueFrames
  const currentFrame: LabeledFrame | undefined = frames[idx]

  const refresh = useCallback(async () => {
    const [s, allPending, queue] = await Promise.all([
      getLabelingStatus(),
      getFrames({ status: 'pending' }),
      getLabelingQueue(),
    ])
    setStatus(s)
    setBootstrapFrames(allPending.filter(f => f.pred_conf === null))
    setQueueFrames(queue)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img || !currentFrame) return
    const ctx = canvas.getContext('2d')!
    img.onload = () => {
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      ctx.drawImage(img, 0, 0)
      if (!rect && currentFrame.pred_cx != null) {
        const px = (currentFrame.pred_cx - currentFrame.pred_w! / 2) * canvas.width
        const py = (currentFrame.pred_cy! - currentFrame.pred_h! / 2) * canvas.height
        const pw = currentFrame.pred_w! * canvas.width
        const ph = currentFrame.pred_h! * canvas.height
        ctx.strokeStyle = '#facc15'
        ctx.lineWidth = 2
        ctx.strokeRect(px, py, pw, ph)
      }
      if (rect) {
        ctx.strokeStyle = '#00ff00'
        ctx.lineWidth = 2
        ctx.strokeRect(rect.x, rect.y, rect.w, rect.h)
      }
    }
    img.src = getFrameImageUrl(currentFrame.id)
  }, [currentFrame, rect])

  const canvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    const bounds = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - bounds.left) * (canvas.width / bounds.width),
      y: (e.clientY - bounds.top) * (canvas.height / bounds.height),
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
      x: Math.min(startPt.x, pt.x), y: Math.min(startPt.y, pt.y),
      w: Math.abs(pt.x - startPt.x), h: Math.abs(pt.y - startPt.y),
    })
  }
  const onMouseUp = () => setDrawing(false)

  const confirm = async () => {
    if (!currentFrame) return
    const canvas = canvasRef.current!
    let bbox: AnnotateBbox
    if (rect) {
      bbox = {
        cx: (rect.x + rect.w / 2) / canvas.width,
        cy: (rect.y + rect.h / 2) / canvas.height,
        w: rect.w / canvas.width,
        h: rect.h / canvas.height,
      }
    } else if (currentFrame.pred_cx != null) {
      bbox = {
        cx: currentFrame.pred_cx,
        cy: currentFrame.pred_cy!,
        w: currentFrame.pred_w!,
        h: currentFrame.pred_h!,
      }
    } else {
      return
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

  const handleRetrain = async () => {
    try {
      const { run_id } = await startTraining(50)
      setRunId(run_id)
      setPhase('training')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to start training')
    }
  }

  const confirmRef = useRef(confirm)
  const noBallRef = useRef(noBall)
  const skipRef = useRef(skip)
  useEffect(() => {
    confirmRef.current = confirm
    noBallRef.current = noBall
    skipRef.current = skip
  })

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (phase !== 'annotate') return
      if (e.key === 'Enter') confirmRef.current()
      if (e.key === 'n' || e.key === 'N') noBallRef.current()
      if (e.key === 's' || e.key === 'S') skipRef.current()
      if (e.key === 'r' || e.key === 'R') setRect(null)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [phase])

  if (phase === 'training') {
    return <TrainingPhase runId={runId!} onBack={() => setPhase('annotate')} />
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Active Learning</h1>

      {error && <p className="text-red-500 mb-2">{error}</p>}

      {status?.active_model_id && (
        <RetrainPanel status={status} onRetrain={handleRetrain} />
      )}

      {status && isBootstrapMode && (
        <div className="flex items-center gap-4 mb-4">
          <span className="text-lg font-mono">
            {status.annotated} / {status.frames_total} frames annotated
          </span>
          <button
            onClick={handleRetrain}
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
            Frame {idx + 1} of {frames.length}
            {currentFrame.pred_conf != null && (
              <> — conf <span className="font-mono">{currentFrame.pred_conf.toFixed(2)}</span></>
            )}
            {' '}— {currentFrame.split} split — t={currentFrame.timestamp.toFixed(2)}s
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
              disabled={!rect && currentFrame.pred_cx == null}
              className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-40"
            >
              Confirm
            </button>
            <button onClick={noBall} className="px-4 py-2 bg-yellow-500 text-white rounded">
              No ball
            </button>
            <button onClick={skip} className="px-4 py-2 bg-gray-400 text-white rounded">
              Skip
            </button>
            <button onClick={() => setRect(null)} className="px-4 py-2 bg-red-400 text-white rounded">
              Redo
            </button>
          </div>
        </div>
      ) : (
        <p className="text-gray-500">
          {status?.frames_total === 0
            ? 'No frames extracted yet. Use the Extract Frames button to sample from a processed video.'
            : 'Queue empty — all pending frames reviewed.'}
        </p>
      )}
    </div>
  )
}

function RetrainPanel({ status, onRetrain }: { status: LabelingStatus; onRetrain: () => void }) {
  const recommended = status.retrain_recommended
  return (
    <div className="flex items-center gap-4 mb-4 p-3 rounded bg-gray-50 border border-gray-200">
      <span className="text-sm font-mono">
        {status.new_labeled_since_last_train} / {status.retrain_threshold} new frames
        {status.last_trained_at_size != null && (
          <> · last trained at {status.last_trained_at_size}</>
        )}
      </span>
      <button
        onClick={onRetrain}
        className={`px-4 py-2 rounded text-white ${recommended ? 'bg-green-600' : 'bg-gray-500'}`}
      >
        Retrain{recommended ? ' ↑' : ''}
      </button>
    </div>
  )
}

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
          <button onClick={onPromoted} className="px-4 py-2 bg-gray-400 text-white rounded">
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
        <PromotionPanel runId={runId} oldModel={oldModel} newModel={newModel} onPromoted={onBack} />
      )}
      {run?.status === 'done' && !newModel && (
        <p className="text-gray-500">Training complete — model version not found.</p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Update App.tsx**

In `frontend/src/App.tsx`, replace `ActiveLearning` import and route:

```typescript
// Remove:
import ActiveLearning from './views/ActiveLearning'

// Add:
import LabelingQueue from './views/LabelingQueue'
```

```tsx
// Replace:
<Route path="/active-learning" element={<ActiveLearning />} />

// With:
<Route path="/active-learning" element={<LabelingQueue />} />
```

- [ ] **Step 5: Delete old files**

```bash
rm frontend/src/views/ActiveLearning.tsx
rm frontend/src/test/ActiveLearning.test.tsx
```

- [ ] **Step 6: Run frontend tests**

```bash
cd /home/leew4/volleyball-cv/frontend
npm test -- --run 2>&1 | tail -20
```

Expected: all tests pass (30 old tests minus ActiveLearning tests + new LabelingQueue tests = net similar count).

- [ ] **Step 7: TypeScript check**

```bash
cd /home/leew4/volleyball-cv/frontend
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 8: Run full backend suite to confirm no regressions**

```bash
cd /home/leew4/volleyball-cv
PYTHONPATH=. DATABASE_URL=sqlite:////tmp/volleyball_cv_test_data/test.db \
  DATA_DIR=/tmp/volleyball_cv_test_data \
  /home/leew4/.local/bin/pytest tests/ -q
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/views/LabelingQueue.tsx frontend/src/App.tsx \
  frontend/src/test/LabelingQueue.test.tsx frontend/src/test/api.test.ts
git rm frontend/src/views/ActiveLearning.tsx frontend/src/test/ActiveLearning.test.tsx
git commit -m "feat: replace ActiveLearning with unified LabelingQueue view (bootstrap + active review + retrain panel)"
```
