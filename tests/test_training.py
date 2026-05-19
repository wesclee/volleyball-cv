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
