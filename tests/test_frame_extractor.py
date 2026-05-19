# tests/test_frame_extractor.py
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
