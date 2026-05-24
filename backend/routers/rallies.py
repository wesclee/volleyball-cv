# backend/routers/rallies.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models.match import Rally, Video
from backend.schemas.match import RallyCreate, RallyRead, RallyUpdate

router = APIRouter(tags=["rallies"])


def _find_overlapping_rally(
    db: Session,
    video_id: int,
    start_time: float,
    end_time: float,
    exclude_rally_id: int | None = None,
) -> Rally | None:
    q = db.query(Rally).filter(
        Rally.video_id == video_id,
        Rally.start_time < end_time,
        Rally.end_time > start_time,
    )
    if exclude_rally_id is not None:
        q = q.filter(Rally.id != exclude_rally_id)
    return q.first()


def _validate_rally_range(
    db: Session,
    video_id: int,
    start_time: float,
    end_time: float,
    exclude_rally_id: int | None = None,
) -> None:
    if end_time <= start_time:
        raise HTTPException(status_code=400, detail="end_time must be greater than start_time")
    overlapping = _find_overlapping_rally(db, video_id, start_time, end_time, exclude_rally_id)
    if overlapping:
        raise HTTPException(
            status_code=409,
            detail=(
                "rally overlaps existing rally "
                f"{overlapping.id} ({overlapping.start_time:.2f}s-{overlapping.end_time:.2f}s)"
            ),
        )


@router.get("/videos/{video_id}/rallies", response_model=list[RallyRead])
def list_rallies(video_id: int, db: Session = Depends(get_db)):
    video = db.get(Video, video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    return db.query(Rally).filter(Rally.video_id == video_id).order_by(Rally.start_time).all()


@router.post("/videos/{video_id}/rallies", response_model=RallyRead)
def create_rally(video_id: int, body: RallyCreate, db: Session = Depends(get_db)):
    video = db.get(Video, video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    _validate_rally_range(db, video_id, body.start_time, body.end_time)

    rally = Rally(
        video_id=video_id,
        start_time=body.start_time,
        end_time=body.end_time,
        confidence=1.0,
    )
    db.add(rally)
    db.commit()
    db.refresh(rally)
    return rally


@router.patch("/rallies/{rally_id}", response_model=RallyRead)
def update_rally(rally_id: int, body: RallyUpdate, db: Session = Depends(get_db)):
    rally = db.get(Rally, rally_id)
    if not rally:
        raise HTTPException(status_code=404, detail="Rally not found")

    patch = body.model_dump(exclude_none=True)
    next_start = patch.get("start_time", rally.start_time)
    next_end = patch.get("end_time", rally.end_time)
    if "start_time" in patch or "end_time" in patch:
        _validate_rally_range(db, rally.video_id, next_start, next_end, exclude_rally_id=rally.id)

    for field, value in patch.items():
        setattr(rally, field, value)
    db.commit()
    db.refresh(rally)
    return rally


@router.delete("/rallies/{rally_id}", status_code=204)
def delete_rally(rally_id: int, db: Session = Depends(get_db)):
    rally = db.get(Rally, rally_id)
    if not rally:
        raise HTTPException(status_code=404, detail="Rally not found")
    db.delete(rally)
    db.commit()
