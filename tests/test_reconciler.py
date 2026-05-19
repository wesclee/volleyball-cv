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
