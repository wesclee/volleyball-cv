import io


def _setup(client):
    match_id = client.post("/matches", json={"date": "2026-05-18"}).json()["id"]
    video_resp = client.post(
        f"/matches/{match_id}/videos",
        data={"set_number": "1"},
        files={"file": ("s.mp4", io.BytesIO(b"x"), "video/mp4")},
    )
    return match_id, video_resp.json()["id"]


def _seed_rally(db, video_id):
    from backend.models.match import Rally
    rally = Rally(video_id=video_id, start_time=10.0, end_time=25.0, confidence=1.0)
    db.add(rally)
    db.commit()
    db.refresh(rally)
    return rally


def test_list_rallies_empty(client):
    _, video_id = _setup(client)
    resp = client.get(f"/videos/{video_id}/rallies")
    assert resp.status_code == 200
    assert resp.json() == []


def test_list_rallies(client):
    from backend.database import SessionLocal
    from backend.models.match import Rally
    _, video_id = _setup(client)
    with SessionLocal() as db:
        # Seed in reverse order to verify endpoint sorts correctly
        db.add(Rally(video_id=video_id, start_time=30.0, end_time=45.0, confidence=1.0))
        db.add(Rally(video_id=video_id, start_time=5.0, end_time=20.0, confidence=1.0))
        db.commit()
    resp = client.get(f"/videos/{video_id}/rallies")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    assert data[0]["start_time"] == 5.0
    assert data[1]["start_time"] == 30.0


def test_patch_rally_score(client):
    from backend.database import SessionLocal
    _, video_id = _setup(client)
    with SessionLocal() as db:
        rally = _seed_rally(db, video_id)
        rally_id = rally.id
    resp = client.patch(f"/rallies/{rally_id}", json={"score_home": 5, "score_away": 3})
    assert resp.status_code == 200
    data = resp.json()
    assert data["score_home"] == 5
    assert data["score_away"] == 3


def test_patch_rally_not_found(client):
    resp = client.patch("/rallies/999", json={"score_home": 1})
    assert resp.status_code == 404
