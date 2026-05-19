# tests/test_bootstrap_routes.py
import io
import pytest
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
