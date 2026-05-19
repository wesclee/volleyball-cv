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
    # Background processor runs synchronously in test client — invalid video causes error
    assert resp.json()["status"] == "error"
    assert resp.json()["error"] is not None


def test_get_job_not_found(client):
    resp = client.get("/jobs/999")
    assert resp.status_code == 404


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
