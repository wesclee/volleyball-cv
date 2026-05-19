# tests/test_processor_active_learning.py
import pytest
from unittest.mock import MagicMock, patch
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
