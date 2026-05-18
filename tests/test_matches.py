# tests/test_matches.py
import io


def test_create_match(client):
    resp = client.post("/matches", json={"date": "2026-05-18", "opponent": "Team A"})
    assert resp.status_code == 201
    data = resp.json()
    assert data["date"] == "2026-05-18"
    assert data["opponent"] == "Team A"
    assert "id" in data


def test_list_matches(client):
    client.post("/matches", json={"date": "2026-05-18"})
    client.post("/matches", json={"date": "2026-05-19"})
    resp = client.get("/matches")
    assert resp.status_code == 200
    assert len(resp.json()) == 2


def test_get_match(client):
    create = client.post("/matches", json={"date": "2026-05-18"})
    match_id = create.json()["id"]
    resp = client.get(f"/matches/{match_id}")
    assert resp.status_code == 200
    assert resp.json()["id"] == match_id


def test_get_match_not_found(client):
    resp = client.get("/matches/999")
    assert resp.status_code == 404


def test_list_match_videos(client):
    match_id = client.post("/matches", json={"date": "2026-05-18"}).json()["id"]
    # No videos yet
    resp = client.get(f"/matches/{match_id}/videos")
    assert resp.status_code == 200
    assert resp.json() == []

    # Upload a video
    client.post(
        f"/matches/{match_id}/videos",
        data={"set_number": "1"},
        files={"file": ("s.mp4", io.BytesIO(b"x"), "video/mp4")},
    )
    resp = client.get(f"/matches/{match_id}/videos")
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["set_number"] == 1


def test_list_match_videos_not_found(client):
    resp = client.get("/matches/999/videos")
    assert resp.status_code == 404
