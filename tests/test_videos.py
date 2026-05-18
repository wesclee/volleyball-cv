import io


def _make_match(client):
    return client.post("/matches", json={"date": "2026-05-18"}).json()["id"]


def test_upload_video(client, tmp_path):
    match_id = _make_match(client)
    fake_video = b"fake video bytes"
    resp = client.post(
        f"/matches/{match_id}/videos",
        data={"set_number": "1"},
        files={"file": ("set1.mp4", io.BytesIO(fake_video), "video/mp4")},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["match_id"] == match_id
    assert data["set_number"] == 1
    assert data["status"] == "pending"


def test_upload_video_match_not_found(client):
    resp = client.post(
        "/matches/999/videos",
        data={"set_number": "1"},
        files={"file": ("set1.mp4", io.BytesIO(b"x"), "video/mp4")},
    )
    assert resp.status_code == 404


def test_upload_duplicate_set_number(client):
    match_id = _make_match(client)
    for _ in range(2):
        client.post(
            f"/matches/{match_id}/videos",
            data={"set_number": "1"},
            files={"file": ("set1.mp4", io.BytesIO(b"x"), "video/mp4")},
        )
    resp = client.get(f"/matches/{match_id}")
    # Both uploads accepted — set_number is not unique-constrained, coach may re-upload
    assert resp.status_code == 200
