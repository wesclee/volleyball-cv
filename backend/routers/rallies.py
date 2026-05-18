# backend/routers/rallies.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models.match import Rally, Video
from backend.schemas.match import RallyRead, RallyUpdate

router = APIRouter(tags=["rallies"])


@router.get("/videos/{video_id}/rallies", response_model=list[RallyRead])
def list_rallies(video_id: int, db: Session = Depends(get_db)):
    video = db.get(Video, video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    return db.query(Rally).filter(Rally.video_id == video_id).order_by(Rally.start_time).all()


@router.patch("/rallies/{rally_id}", response_model=RallyRead)
def update_rally(rally_id: int, body: RallyUpdate, db: Session = Depends(get_db)):
    rally = db.get(Rally, rally_id)
    if not rally:
        raise HTTPException(status_code=404, detail="Rally not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(rally, field, value)
    db.commit()
    db.refresh(rally)
    return rally
