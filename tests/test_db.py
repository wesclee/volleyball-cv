import pytest
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
