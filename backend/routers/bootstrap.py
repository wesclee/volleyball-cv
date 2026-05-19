# backend/routers/bootstrap.py
import logging
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
    LabeledFrameRead,
    ModelVersionRead,
    ReconcileResult,
    TrainingRunRead,
    TrainingRunRequest,
)
from backend.training.frame_extractor import extract_frames
from backend.training.reconciler import reconcile
from backend.training.trainer import run_training


router = APIRouter()
MIN_FRAMES = 200


def _extraction_task(video_id: int, sample_rate: int, max_frames: int,
                     split_ratios: dict, db_url: str) -> None:
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


@router.post("/bootstrap/frames/{frame_id}/annotate", response_model=LabeledFrameRead)
def annotate_frame(frame_id: int, body: AnnotateRequest, db: Session = Depends(get_db)):
    frame = db.get(LabeledFrame, frame_id)
    if not frame:
        raise HTTPException(status_code=404, detail="frame not found")
    label_path = Path(frame.label_path)
    label_path.parent.mkdir(parents=True, exist_ok=True)
    label_path.write_text(f"0 {body.cx:.6f} {body.cy:.6f} {body.w:.6f} {body.h:.6f}\n")
    frame.review_status = FrameStatus.annotated
    db.commit()
    db.refresh(frame)
    return frame


@router.post("/bootstrap/frames/{frame_id}/skip", response_model=LabeledFrameRead)
def skip_frame(frame_id: int, db: Session = Depends(get_db)):
    frame = db.get(LabeledFrame, frame_id)
    if not frame:
        raise HTTPException(status_code=404, detail="frame not found")
    label_path = Path(frame.label_path)
    label_path.parent.mkdir(parents=True, exist_ok=True)
    label_path.write_text("")
    frame.review_status = FrameStatus.skipped
    db.commit()
    db.refresh(frame)
    return frame



@router.post("/admin/reconcile", response_model=ReconcileResult)
def run_reconcile(db: Session = Depends(get_db)):
    return reconcile(db)


@router.post("/training/run", status_code=202)
def start_training_run(
    body: TrainingRunRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    annotated_count = db.query(LabeledFrame).filter_by(review_status=FrameStatus.annotated).count()
    if annotated_count < MIN_FRAMES:
        raise HTTPException(
            status_code=422,
            detail=f"need at least {MIN_FRAMES} annotated frames, have {annotated_count}",
        )
    in_progress = db.query(TrainingRun).filter(
        TrainingRun.status.in_([TrainingStatus.pending, TrainingStatus.running])
    ).first()
    if in_progress:
        raise HTTPException(status_code=409, detail="a training run is already in progress")
    run = TrainingRun(status=TrainingStatus.pending, epochs=body.epochs)
    db.add(run)
    db.commit()
    db.refresh(run)
    background_tasks.add_task(run_training, run.id, body.epochs, DATABASE_URL)
    return {"run_id": run.id}


@router.get("/training/runs/{run_id}", response_model=TrainingRunRead)
def get_training_run(run_id: int, db: Session = Depends(get_db)):
    run = db.get(TrainingRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="training run not found")
    return run


@router.get("/models", response_model=list[ModelVersionRead])
def list_models(db: Session = Depends(get_db)):
    return db.query(ModelVersion).order_by(ModelVersion.created_at.desc()).all()


@router.post("/models/{model_id}/promote", response_model=ModelVersionRead)
def promote_model(model_id: int, db: Session = Depends(get_db)):
    new_model = db.get(ModelVersion, model_id)
    if not new_model:
        raise HTTPException(status_code=404, detail="model not found")
    old_model = db.query(ModelVersion).filter_by(is_active=True).first()
    if old_model and old_model.id != model_id:
        net_delta = (
            (new_model.test_precision or 0.0) - (old_model.test_precision or 0.0)
            + (new_model.test_recall or 0.0) - (old_model.test_recall or 0.0)
            + (new_model.test_map50 or 0.0) - (old_model.test_map50 or 0.0)
        )
        if net_delta <= 0:
            raise HTTPException(
                status_code=409,
                detail=f"model did not improve overall (net_delta={net_delta:.4f})",
            )
        old_model.is_active = False
    new_model.is_active = True
    db.commit()
    db.refresh(new_model)
    return new_model
