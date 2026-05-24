# backend/routers/rallies.py
import json
import shutil
import traceback
from datetime import date

from pathlib import Path

import cv2
from fastapi import APIRouter, BackgroundTasks, Depends, Form, HTTPException, Query, UploadFile, status
from sqlalchemy.orm import Session

from backend.config import DATABASE_URL, DATASET_DIR, UPLOADS_DIR
from backend.database import get_db
from backend.models.match import JobStatus, Match, Rally, RallyModelVersion, RallyScanRun, RallyTrainingRun, TrainingStatus, Video, VideoStatus
from backend.schemas.match import (
    RallyCreate,
    RallyDatasetRead,
    RallyDatasetRequest,
    RallyFootageRead,
    RallyModelVersionRead,
    RallyScanRead,
    RallyScanRunRead,
    RallyRead,
    RallyTrainingRunRead,
    RallyTrainingRunRequest,
    RallyUpdate,
)
from backend.training.rally_dataset import build_rally_boundary_dataset
from backend.training.rally_trainer import run_rally_training, scan_video_for_rallies
from backend.upload_hashes import backfill_video_hashes, find_duplicate_video, hash_upload

router = APIRouter(tags=["rallies"])
RALLY_FOOTAGE_NOTE = "Rally boundary training footage."


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


@router.get("/rally-labels/footage", response_model=list[RallyFootageRead])
def list_rally_footage(db: Session = Depends(get_db)):
    videos = (
        db.query(Video)
        .join(Match)
        .order_by(Video.created_at.desc())
        .all()
    )
    items = []
    for video in videos:
        rally_count = db.query(Rally).filter(Rally.video_id == video.id).count()
        if video.match.notes == RALLY_FOOTAGE_NOTE or rally_count > 0:
            items.append({"match": video.match, "video": video, "rally_count": rally_count})
    return items


@router.post("/rally-labels/footage", response_model=RallyFootageRead, status_code=status.HTTP_201_CREATED)
def upload_rally_footage(
    file: UploadFile,
    label: str | None = Form(None),
    db: Session = Depends(get_db),
):
    content_hash = hash_upload(file)
    backfill_video_hashes(db, RALLY_FOOTAGE_NOTE)
    duplicate = find_duplicate_video(db, content_hash, RALLY_FOOTAGE_NOTE)
    if duplicate:
        raise HTTPException(
            status_code=409,
            detail=f"this footage is already uploaded as video {duplicate.id}",
        )

    match = Match(
        date=date.today().isoformat(),
        opponent=label or "Rally footage",
        venue=None,
        notes=RALLY_FOOTAGE_NOTE,
    )
    db.add(match)
    db.flush()

    dest = UPLOADS_DIR / f"rally_match{match.id}_{file.filename}"
    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    video = Video(
        match_id=match.id,
        set_number=1,
        raw_path=str(dest),
        content_hash=content_hash,
        status=VideoStatus.done,
    )
    db.add(video)
    db.commit()
    db.refresh(match)
    db.refresh(video)
    return {"match": match, "video": video, "rally_count": 0}


@router.post("/rally-labels/training-dataset", response_model=RallyDatasetRead)
def create_rally_training_dataset(
    body: RallyDatasetRequest,
    db: Session = Depends(get_db),
):
    ratios = {"train": body.split_train, "val": body.split_val, "test": body.split_test}
    if abs(sum(ratios.values()) - 1.0) > 0.001:
        raise HTTPException(status_code=422, detail="split ratios must sum to 1.0")
    labelled_count = db.query(Rally).count()
    if labelled_count == 0:
        raise HTTPException(status_code=422, detail="need at least one labelled rally")
    return build_rally_boundary_dataset(db, ratios, body.min_gap_s)


@router.get("/rally-labels/training-dataset", response_model=RallyDatasetRead)
def get_rally_training_dataset():
    manifest_path = DATASET_DIR / "rally_boundaries" / "manifest.json"
    if not manifest_path.exists():
        raise HTTPException(status_code=404, detail="rally boundary dataset has not been built yet")
    return json.loads(manifest_path.read_text())


@router.post("/rally-labels/training/run", status_code=202)
def start_rally_training_run(
    body: RallyTrainingRunRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    manifest_path = DATASET_DIR / "rally_boundaries" / "manifest.json"
    if not manifest_path.exists():
        raise HTTPException(status_code=422, detail="build the rally boundary dataset before training")
    manifest = json.loads(manifest_path.read_text())
    if manifest.get("counts", {}).get("train", 0) == 0 or manifest.get("counts", {}).get("test", 0) == 0:
        raise HTTPException(status_code=422, detail="need train and test rally examples before training")
    in_progress = db.query(RallyTrainingRun).filter(
        RallyTrainingRun.status.in_([TrainingStatus.pending, TrainingStatus.running, TrainingStatus.stopping])
    ).first()
    if in_progress:
        raise HTTPException(status_code=409, detail="a rally training run is already in progress")
    run = RallyTrainingRun(status=TrainingStatus.pending, epochs=body.epochs)
    db.add(run)
    db.commit()
    db.refresh(run)
    background_tasks.add_task(run_rally_training, run.id, body.epochs, DATABASE_URL)
    return {"run_id": run.id}


@router.get("/rally-labels/training/runs/{run_id}", response_model=RallyTrainingRunRead)
def get_rally_training_run(run_id: int, db: Session = Depends(get_db)):
    run = db.get(RallyTrainingRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="rally training run not found")
    return run


@router.post("/rally-labels/training/runs/{run_id}/stop", response_model=RallyTrainingRunRead)
def stop_rally_training_run(run_id: int, db: Session = Depends(get_db)):
    run = db.get(RallyTrainingRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="rally training run not found")
    if run.status not in (TrainingStatus.pending, TrainingStatus.running, TrainingStatus.stopping):
        return run
    run.stop_requested = True
    run.status = TrainingStatus.stopping
    db.commit()
    db.refresh(run)
    return run


@router.get("/rally-labels/models", response_model=list[RallyModelVersionRead])
def list_rally_models(db: Session = Depends(get_db)):
    return db.query(RallyModelVersion).order_by(RallyModelVersion.created_at.desc()).all()


def _find_rally_model(db: Session, model_id: int | None) -> RallyModelVersion | None:
    return db.get(RallyModelVersion, model_id) if model_id else (
        db.query(RallyModelVersion)
        .order_by(RallyModelVersion.is_active.desc(), RallyModelVersion.created_at.desc())
        .first()
    )


def _rally_scan_read(scan: RallyScanRun) -> dict:
    predictions = json.loads(scan.predictions_json) if scan.predictions_json else []
    return {
        "id": scan.id,
        "video_id": scan.video_id,
        "model_id": scan.model_id,
        "status": scan.status,
        "progress_pct": scan.progress_pct,
        "window_s": scan.window_s,
        "step_s": scan.step_s,
        "threshold": scan.threshold,
        "max_predictions": scan.max_predictions,
        "windows_scanned": scan.windows_scanned,
        "predictions": predictions,
        "error": scan.error,
        "created_at": scan.created_at,
    }


def _run_rally_scan(scan_id: int, db_url: str) -> None:
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    engine = create_engine(db_url, connect_args={"check_same_thread": False})
    try:
        with sessionmaker(bind=engine)() as db:
            scan = db.get(RallyScanRun, scan_id)
            if not scan:
                return
            scan.status = JobStatus.running
            scan.progress_pct = 1.0
            db.commit()
            try:
                video = db.get(Video, scan.video_id)
                model = db.get(RallyModelVersion, scan.model_id)
                if not video or not model:
                    raise ValueError("video or rally model not found")
                duration = video.duration or _probe_video_duration(video.raw_path)
                if not duration or duration <= 0:
                    raise ValueError("video duration is unknown")
                if video.duration != duration:
                    video.duration = duration
                    db.commit()
                model_path = Path(model.model_path)
                if not model_path.exists():
                    raise ValueError("rally model file not found")
                model_data = json.loads(model_path.read_text())

                def update_progress(progress_pct: float, windows_scanned: int) -> None:
                    db.refresh(scan)
                    scan.progress_pct = max(scan.progress_pct or 0.0, progress_pct)
                    scan.windows_scanned = windows_scanned
                    db.commit()

                predictions, windows_scanned, selected_threshold = scan_video_for_rallies(
                    video_id=video.id,
                    video_path=video.raw_path,
                    duration_s=duration,
                    model_id=model.id,
                    model=model_data,
                    window_s=scan.window_s,
                    step_s=scan.step_s,
                    threshold=scan.threshold,
                    max_predictions=scan.max_predictions,
                    progress_callback=update_progress,
                )
                scan.status = JobStatus.done
                scan.progress_pct = 100.0
                scan.windows_scanned = windows_scanned
                scan.threshold = selected_threshold
                scan.predictions_json = json.dumps(predictions)
                db.commit()
            except Exception:
                scan.status = JobStatus.error
                scan.error = traceback.format_exc()[:2000]
                db.commit()
    finally:
        engine.dispose()


@router.post("/videos/{video_id}/rally-scan-jobs", status_code=202)
def start_rally_scan_job(
    video_id: int,
    background_tasks: BackgroundTasks,
    model_id: int | None = Query(default=None),
    window_s: float = Query(default=8.0, ge=2.0, le=30.0),
    step_s: float = Query(default=2.0, ge=0.5, le=10.0),
    threshold: float | None = Query(default=None, ge=0.0, le=1.0),
    max_predictions: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    video = db.get(Video, video_id)
    if not video:
        raise HTTPException(status_code=404, detail="video not found")
    model = _find_rally_model(db, model_id)
    if not model:
        raise HTTPException(status_code=422, detail="train a rally boundary model before scanning")
    in_progress = db.query(RallyScanRun).filter(
        RallyScanRun.video_id == video_id,
        RallyScanRun.status.in_([JobStatus.pending, JobStatus.running]),
    ).first()
    if in_progress:
        return {"scan_id": in_progress.id}
    scan = RallyScanRun(
        video_id=video.id,
        model_id=model.id,
        status=JobStatus.pending,
        window_s=window_s,
        step_s=step_s,
        threshold=threshold,
        max_predictions=max_predictions,
    )
    db.add(scan)
    db.commit()
    db.refresh(scan)
    background_tasks.add_task(_run_rally_scan, scan.id, DATABASE_URL)
    return {"scan_id": scan.id}


@router.get("/rally-scan-jobs/{scan_id}", response_model=RallyScanRunRead)
def get_rally_scan_job(scan_id: int, db: Session = Depends(get_db)):
    scan = db.get(RallyScanRun, scan_id)
    if not scan:
        raise HTTPException(status_code=404, detail="rally scan job not found")
    return _rally_scan_read(scan)


@router.post("/videos/{video_id}/rally-scan", response_model=RallyScanRead)
def scan_video_with_rally_model(
    video_id: int,
    model_id: int | None = Query(default=None),
    window_s: float = Query(default=8.0, ge=2.0, le=30.0),
    step_s: float = Query(default=2.0, ge=0.5, le=10.0),
    threshold: float | None = Query(default=None, ge=0.0, le=1.0),
    max_predictions: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    video = db.get(Video, video_id)
    if not video:
        raise HTTPException(status_code=404, detail="video not found")
    duration = video.duration or _probe_video_duration(video.raw_path)
    if not duration or duration <= 0:
        raise HTTPException(status_code=422, detail="video duration is unknown")
    if video.duration != duration:
        video.duration = duration
        db.commit()
    model = _find_rally_model(db, model_id)
    if not model:
        raise HTTPException(status_code=422, detail="train a rally boundary model before scanning")
    model_path = Path(model.model_path)
    if not model_path.exists():
        raise HTTPException(status_code=404, detail="rally model file not found")
    model_data = json.loads(model_path.read_text())
    predictions, windows_scanned, selected_threshold = scan_video_for_rallies(
        video_id=video.id,
        video_path=video.raw_path,
        duration_s=duration,
        model_id=model.id,
        model=model_data,
        window_s=window_s,
        step_s=step_s,
        threshold=threshold,
        max_predictions=max_predictions,
    )
    return {
        "video_id": video.id,
        "model_id": model.id,
        "model_name": model.name,
        "window_s": window_s,
        "step_s": step_s,
        "threshold": selected_threshold,
        "windows_scanned": windows_scanned,
        "predictions": predictions,
    }


def _probe_video_duration(path: str) -> float | None:
    capture = cv2.VideoCapture(path)
    if not capture.isOpened():
        return None
    try:
        fps = capture.get(cv2.CAP_PROP_FPS)
        frames = capture.get(cv2.CAP_PROP_FRAME_COUNT)
        if fps and fps > 0 and frames and frames > 0:
            return float(frames / fps)
        return None
    finally:
        capture.release()


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
