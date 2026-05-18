# backend/routers/videos.py
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from backend.config import UPLOADS_DIR
from backend.database import get_db
from backend.models.match import Job, Match, Video, VideoStatus
from backend.schemas.match import JobRead, VideoRead

router = APIRouter(tags=["videos"])


@router.post("/matches/{match_id}/videos", response_model=VideoRead, status_code=status.HTTP_201_CREATED)
def upload_video(
    match_id: int,
    set_number: int = Form(...),
    file: UploadFile = ...,
    db: Session = Depends(get_db),
):
    match = db.get(Match, match_id)
    if not match:
        raise HTTPException(status_code=404, detail="Match not found")

    dest = UPLOADS_DIR / f"match{match_id}_set{set_number}_{file.filename}"
    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    video = Video(match_id=match_id, set_number=set_number, raw_path=str(dest), status=VideoStatus.pending)
    db.add(video)
    db.commit()
    db.refresh(video)
    return video


@router.post("/videos/{video_id}/process", response_model=JobRead, status_code=status.HTTP_202_ACCEPTED)
def process_video(video_id: int, db: Session = Depends(get_db)):
    video = db.get(Video, video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    job = Job(video_id=video_id)
    db.add(job)
    video.status = VideoStatus.processing
    db.commit()
    db.refresh(job)

    # Background task wired in Task 9 — returns job immediately
    return job
