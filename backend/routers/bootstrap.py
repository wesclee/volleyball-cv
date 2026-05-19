# backend/routers/bootstrap.py
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from backend.config import DATABASE_URL
from backend.database import get_db
from backend.models.match import FrameStatus, FrameSplit, LabeledFrame, ModelVersion, TrainingRun, TrainingStatus
from backend.schemas.match import (
    AnnotateRequest,
    BootstrapExtractRequest,
    BootstrapStatus,
    LabeledFrameRead,
    ModelVersionRead,
    ReconcileResult,
    TrainingRunRead,
    TrainingRunRequest,
)
from backend.training.frame_extractor import extract_frames
from backend.training.reconciler import reconcile

# from backend.training.trainer import run_training  # added in Task 8


def run_training(*args, **kwargs):
    raise NotImplementedError("trainer not yet implemented")


router = APIRouter()
MIN_FRAMES = 200


def _extraction_task(video_id: int, sample_rate: int, max_frames: int,
                     split_ratios: dict, db_url: str) -> None:
    import logging
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    engine = create_engine(db_url, connect_args={"check_same_thread": False})
    try:
        with sessionmaker(bind=engine)() as db:
            extract_frames(video_id, db, sample_rate, max_frames, split_ratios)
    except Exception as exc:
        logging.getLogger(__name__).error("extraction failed for video %s: %s", video_id, exc)
    finally:
        engine.dispose()


@router.post("/bootstrap/extract/{video_id}", status_code=202)
def start_extraction(
    video_id: int,
    body: BootstrapExtractRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    ratios = {"train": body.split_train, "val": body.split_val, "test": body.split_test}
    if abs(sum(ratios.values()) - 1.0) > 0.001:
        raise HTTPException(status_code=422, detail="split ratios must sum to 1.0")
    background_tasks.add_task(
        _extraction_task, video_id, body.sample_rate, body.max_frames, ratios, DATABASE_URL
    )
    return {"video_id": video_id}


@router.get("/bootstrap/frames", response_model=list[LabeledFrameRead])
def list_frames(
    status: str | None = None,
    split: str | None = None,
    db: Session = Depends(get_db),
):
    q = db.query(LabeledFrame)
    if status:
        try:
            q = q.filter(LabeledFrame.review_status == FrameStatus(status))
        except ValueError:
            raise HTTPException(status_code=422, detail=f"invalid status: {status}")
    if split:
        try:
            q = q.filter(LabeledFrame.split == FrameSplit(split))
        except ValueError:
            raise HTTPException(status_code=422, detail=f"invalid split: {split}")
    return q.all()


@router.get("/bootstrap/frames/{frame_id}/image")
def get_frame_image(frame_id: int, db: Session = Depends(get_db)):
    frame = db.get(LabeledFrame, frame_id)
    if not frame:
        raise HTTPException(status_code=404, detail="frame not found")
    if not Path(frame.img_path).exists():
        raise HTTPException(status_code=404, detail="image file not found on disk")
    return FileResponse(frame.img_path, media_type="image/jpeg")
