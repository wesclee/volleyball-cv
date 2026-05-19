# backend/routers/matches.py
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models.match import Match, Video
from backend.schemas.match import MatchCreate, MatchRead, ProcessedVideoRead, VideoRead

router = APIRouter(prefix="/matches", tags=["matches"])


@router.post("", response_model=MatchRead, status_code=status.HTTP_201_CREATED)
def create_match(body: MatchCreate, db: Session = Depends(get_db)):
    match = Match(**body.model_dump())
    db.add(match)
    db.commit()
    db.refresh(match)
    return match


@router.get("", response_model=list[MatchRead])
def list_matches(db: Session = Depends(get_db)):
    return db.query(Match).all()


@router.get("/{match_id}", response_model=MatchRead)
def get_match(match_id: int, db: Session = Depends(get_db)):
    match = db.get(Match, match_id)
    if not match:
        raise HTTPException(status_code=404, detail="Match not found")
    return match


@router.get("/videos", response_model=list[VideoRead])
def list_all_videos(status: str | None = None, db: Session = Depends(get_db)):
    q = db.query(Video)
    if status:
        from backend.models.match import VideoStatus
        q = q.filter(Video.status == VideoStatus(status))
    return q.order_by(Video.id).all()


@router.get("/{match_id}/videos", response_model=list[VideoRead])
def list_match_videos(match_id: int, db: Session = Depends(get_db)):
    match = db.get(Match, match_id)
    if not match:
        raise HTTPException(status_code=404, detail="Match not found")
    return db.query(Video).filter(Video.match_id == match_id).order_by(Video.set_number).all()


@router.post("/{match_id}/export", response_model=list[ProcessedVideoRead])
def export_match(match_id: int, db: Session = Depends(get_db)):
    """
    Re-runs the editor for each set using the current (possibly user-adjusted)
    rally timestamps. Creates a fresh ProcessedVideo record per set.
    Returns the list of output file records.
    """
    from backend.cv.detector import RallySegment
    from backend.editor.ffmpeg_editor import cut_and_join
    from backend.models.match import ProcessedVideo, Rally, Video

    match = db.get(Match, match_id)
    if not match:
        raise HTTPException(status_code=404, detail="Match not found")

    results = []
    videos = db.query(Video).filter(Video.match_id == match_id).order_by(Video.set_number).all()
    for video in videos:
        rallies = db.query(Rally).filter(Rally.video_id == video.id).order_by(Rally.start_time).all()
        if not rallies:
            continue
        segments = [RallySegment(r.start_time, r.end_time, r.confidence) for r in rallies]
        filename = f"export_match{match_id}_set{video.set_number}.mp4"
        output_path = cut_and_join(video.raw_path, segments, filename)
        pv = ProcessedVideo(match_id=match_id, output_path=output_path)
        db.add(pv)
        db.commit()
        db.refresh(pv)
        results.append(pv)
    return results
