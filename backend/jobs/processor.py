# backend/jobs/processor.py
import logging
import traceback
from pathlib import Path

log = logging.getLogger(__name__)

import cv2
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from backend.config import ACTIVE_HIGH_CONF, ACTIVE_LOW_CONF, DATASET_DIR, FRAMES_DIR
from backend.cv.motion_detector import MotionDetector
from backend.cv.yolo_detector import YoloDetector
from backend.cv.detector import RallySegment
from backend.editor.ffmpeg_editor import cut_and_join
from backend.models.match import (
    FrameStatus, FrameSplit, Job, JobStatus, LabeledFrame, ModelVersion,
    ProcessedVideo, Rally, Video, VideoStatus,
)


def process_video(job_id: int, db_url: str) -> None:
    """
    Runs inside a FastAPI BackgroundTask. Opens its own DB session because
    FastAPI's request-scoped session has already closed by the time this runs.
    """
    engine = create_engine(db_url, connect_args={"check_same_thread": False})
    try:
        SessionLocal = sessionmaker(bind=engine)

        with SessionLocal() as db:
            job = db.get(Job, job_id)
            if not job:
                return

            video = db.get(Video, job.video_id)
            if not video:
                job.status = JobStatus.error
                job.error = f"Video {job.video_id} not found"
                db.commit()
                return

            log.info("job %d started — video %d (match %d set %d)", job_id, video.id, video.match_id, video.set_number)
            job.status = JobStatus.running
            db.commit()

            try:
                _run_pipeline(video, job, db)
                job.status = JobStatus.done
                job.progress_pct = 100.0
                video.status = VideoStatus.done
                log.info("job %d done", job_id)
            except Exception:
                tb = traceback.format_exc()
                log.error("job %d failed:\n%s", job_id, tb)
                job.status = JobStatus.error
                job.error = tb[:2000]
                video.status = VideoStatus.error

            db.commit()
    finally:
        engine.dispose()


def _queue_uncertain_frames(
    video: Video,
    scores: list[float],
    detector: YoloDetector,
    db: Session,
) -> None:
    existing = {
        f.frame_number
        for f in db.query(LabeledFrame).filter_by(video_id=video.id).all()
    }
    uncertain = sorted(
        [
            (i, score) for i, score in enumerate(scores)
            if ACTIVE_LOW_CONF <= score <= ACTIVE_HIGH_CONF and i not in existing
        ],
        key=lambda x: x[1],
    )
    if not uncertain:
        return

    FRAMES_DIR.mkdir(parents=True, exist_ok=True)
    (DATASET_DIR / "labels" / "train").mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(video.raw_path)
    if not cap.isOpened():
        return
    try:
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        for frame_idx, score in uncertain:
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
            ret, frame_data = cap.read()
            if not ret:
                continue
            img_path = FRAMES_DIR / f"frame_{video.id}_{frame_idx}.jpg"
            cv2.imwrite(str(img_path), frame_data)

            pred_cx = pred_cy = pred_w = pred_h = None
            results = list(detector._model.predict(source=str(img_path), verbose=False))
            if results and results[0].boxes and len(results[0].boxes) > 0:
                xywhn = results[0].boxes[0].xywhn[0].tolist()
                pred_cx, pred_cy, pred_w, pred_h = xywhn

            label_path = DATASET_DIR / "labels" / "train" / f"frame_{video.id}_{frame_idx}.txt"
            db.add(LabeledFrame(
                video_id=video.id,
                frame_number=frame_idx,
                timestamp=frame_idx / fps,
                img_path=str(img_path),
                label_path=str(label_path),
                split=FrameSplit.train,
                review_status=FrameStatus.pending,
                pred_cx=pred_cx,
                pred_cy=pred_cy,
                pred_w=pred_w,
                pred_h=pred_h,
                pred_conf=score,
            ))
        db.commit()
    finally:
        cap.release()


def _run_pipeline(video: Video, job: Job, db: Session) -> None:
    active_model = db.query(ModelVersion).filter_by(is_active=True).first()

    if active_model:
        log.info("job %d using YoloDetector (model %d)", job.id, active_model.id)
        detector = YoloDetector(active_model.weights_path)
    else:
        log.info("job %d using MotionDetector (no trained model)", job.id)
        detector = MotionDetector()

    job.progress_pct = 10.0
    db.commit()

    log.info("job %d detection started — %s", job.id, video.raw_path)
    if isinstance(detector, YoloDetector):
        segments, scores = detector.detect_with_scores(video.raw_path)
    else:
        segments = detector.detect(video.raw_path)
        scores = []

    log.info("job %d detection complete — %d rallies found", job.id, len(segments))
    job.progress_pct = 60.0
    db.commit()

    for seg in segments:
        db.add(Rally(
            video_id=video.id,
            start_time=seg.start_time,
            end_time=seg.end_time,
            confidence=seg.confidence,
        ))
    db.commit()

    job.progress_pct = 70.0
    db.commit()

    log.info("job %d export started", job.id)
    output_filename = f"processed_match{video.match_id}_set{video.set_number}_vid{video.id}.mp4"
    output_path = cut_and_join(video.raw_path, segments, output_filename)
    db.add(ProcessedVideo(match_id=video.match_id, output_path=output_path))
    log.info("job %d export complete — %s", job.id, output_path)

    job.progress_pct = 90.0
    db.commit()

    if scores and isinstance(detector, YoloDetector):
        log.info("job %d queuing uncertain frames", job.id)
        _queue_uncertain_frames(video, scores, detector, db)
        log.info("job %d frame queuing complete", job.id)

    job.progress_pct = 95.0
    db.commit()
