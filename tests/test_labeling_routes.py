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
