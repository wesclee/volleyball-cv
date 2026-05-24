# backend/routers/bootstrap.py
import logging
import shutil
import threading
from datetime import date
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from backend.config import DATABASE_URL, UPLOADS_DIR
from backend.database import get_db
from backend.models.match import FrameStatus, FrameSplit, LabeledFrame, Match, ModelVersion, TrainingRun, TrainingStatus, Video, VideoStatus
from backend.schemas.match import (
    AnnotateRequest,
    BootstrapExtractRequest,
    LabeledFrameRead,
    ModelVersionRead,
    ReconcileResult,
    TrainingRunRead,
    TrainingRunRequest,
    VideoRead,
)
from backend.training.frame_extractor import extract_frames
from backend.training.reconciler import reconcile
from backend.training.trainer import run_training
from backend.upload_hashes import backfill_video_hashes, find_duplicate_video, hash_upload


router = APIRouter()
MIN_FRAMES = 200
TRAINING_MATCH_NOTE = "Created from Active Learning for frame extraction and labeling."


def _extraction_task(video_id: int, sample_rate: int, max_frames: int,
                     split_ratios: dict, whole_video: bool, db_url: str) -> None:
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    engine = create_engine(db_url, connect_args={"check_same_thread": False})
    try:
        with sessionmaker(bind=engine)() as db:
            extract_frames(video_id, db, sample_rate, max_frames, split_ratios, whole_video)
    except Exception as exc:
        logging.getLogger(__name__).error("extraction failed for video %s: %s", video_id, exc)
    finally:
        engine.dispose()


def _start_extraction(video_id: int, sample_rate: int, max_frames: int,
                      split_ratios: dict, whole_video: bool) -> None:
    thread = threading.Thread(
        target=_extraction_task,
        args=(video_id, sample_rate, max_frames, split_ratios, whole_video, DATABASE_URL),
        daemon=True,
    )
    thread.start()


@router.post("/bootstrap/extract/{video_id}", status_code=202)
def start_extraction(
    video_id: int,
    body: BootstrapExtractRequest,
    db: Session = Depends(get_db),
):
    video = db.get(Video, video_id)
    if not video:
        raise HTTPException(status_code=404, detail="video not found")
    ratios = {"train": body.split_train, "val": body.split_val, "test": body.split_test}
    if abs(sum(ratios.values()) - 1.0) > 0.001:
        raise HTTPException(status_code=422, detail="split ratios must sum to 1.0")
    raw_path = Path(video.raw_path)
    if raw_path.exists() and raw_path.stat().st_size > 64:
        _start_extraction(video_id, body.sample_rate, body.max_frames, ratios, body.whole_video)
    else:
        logging.getLogger(__name__).warning("extraction skipped for invalid video %s: %s", video_id, video.raw_path)
    return {"video_id": video_id}


@router.post("/bootstrap/training-videos", response_model=VideoRead, status_code=status.HTTP_201_CREATED)
def upload_training_video(
    file: UploadFile,
    label: str | None = Form(None),
    db: Session = Depends(get_db),
):
    content_hash = hash_upload(file)
    backfill_video_hashes(db, TRAINING_MATCH_NOTE)
    duplicate = find_duplicate_video(db, content_hash, TRAINING_MATCH_NOTE)
    if duplicate:
        raise HTTPException(
            status_code=409,
            detail=f"this training footage is already uploaded as video {duplicate.id}",
        )

    training_match = Match(
        date=date.today().isoformat(),
        opponent=label or "Training footage",
        venue=None,
        notes=TRAINING_MATCH_NOTE,
    )
    db.add(training_match)
    db.flush()

    dest = UPLOADS_DIR / f"training_match{training_match.id}_{file.filename}"
    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    video = Video(
        match_id=training_match.id,
        set_number=1,
        raw_path=str(dest),
        content_hash=content_hash,
        status=VideoStatus.done,
    )
    db.add(video)
    db.commit()
    db.refresh(video)
    return video


@router.get("/bootstrap/training-videos", response_model=list[VideoRead])
def list_training_videos(db: Session = Depends(get_db)):
    return (
        db.query(Video)
        .join(Match)
        .filter(Match.notes == TRAINING_MATCH_NOTE)
        .order_by(Video.created_at.desc())
        .all()
    )


@router.delete("/bootstrap/training-videos/{video_id}", status_code=204)
def delete_training_video(video_id: int, db: Session = Depends(get_db)):
    video = db.get(Video, video_id)
    if not video:
        raise HTTPException(status_code=404, detail="video not found")
    match = db.get(Match, video.match_id)
    if not match or match.notes != TRAINING_MATCH_NOTE:
        raise HTTPException(status_code=400, detail="not a training video")

    for frame in db.query(LabeledFrame).filter_by(video_id=video_id).all():
        for path in (frame.img_path, frame.label_path):
            try:
                Path(path).unlink()
            except FileNotFoundError:
                pass

    try:
        Path(video.raw_path).unlink()
    except FileNotFoundError:
        pass

    db.delete(video)
    db.flush()
    remaining = db.query(Video).filter_by(match_id=match.id).count()
    if remaining == 0:
        db.delete(match)
    db.commit()


@router.get("/bootstrap/frames", response_model=list[LabeledFrameRead])
def list_frames(
    status: str | None = None,
    split: str | None = None,
    video_id: int | None = None,
    offset: int = 0,
    limit: int | None = None,
    db: Session = Depends(get_db),
):
    q = db.query(LabeledFrame)
    if video_id:
        q = q.filter(LabeledFrame.video_id == video_id)
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
    q = q.order_by(LabeledFrame.id).offset(offset)
    if limit is not None:
        q = q.limit(limit)
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
        TrainingRun.status.in_([TrainingStatus.pending, TrainingStatus.running, TrainingStatus.stopping])
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


@router.post("/training/runs/{run_id}/stop", response_model=TrainingRunRead)
def stop_training_run(run_id: int, db: Session = Depends(get_db)):
    run = db.get(TrainingRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="training run not found")
    if run.status not in (TrainingStatus.pending, TrainingStatus.running, TrainingStatus.stopping):
        return run
    run.stop_requested = True
    run.status = TrainingStatus.stopping
    db.commit()
    db.refresh(run)
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
