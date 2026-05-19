# backend/jobs/processor.py
import traceback
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from backend.cv.motion_detector import MotionDetector
from backend.cv.yolo_detector import YoloDetector
from backend.cv.detector import RallySegment
from backend.editor.ffmpeg_editor import cut_and_join
from backend.models.match import Job, JobStatus, ModelVersion, ProcessedVideo, Rally, Video, VideoStatus


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

            job.status = JobStatus.running
            db.commit()

            try:
                _run_pipeline(video, job, db)
                job.status = JobStatus.done
                job.progress_pct = 100.0
                video.status = VideoStatus.done
            except Exception:
                job.status = JobStatus.error
                job.error = traceback.format_exc()[:2000]
                video.status = VideoStatus.error

            db.commit()
    finally:
        engine.dispose()


def _run_pipeline(video: Video, job: Job, db: Session) -> None:
    active_model = db.query(ModelVersion).filter_by(is_active=True).first()
    detector = YoloDetector(active_model.weights_path) if active_model else MotionDetector()

    job.progress_pct = 10.0
    db.commit()

    segments: list[RallySegment] = detector.detect(video.raw_path)

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

    output_filename = f"processed_match{video.match_id}_set{video.set_number}_vid{video.id}.mp4"
    output_path = cut_and_join(video.raw_path, segments, output_filename)

    db.add(ProcessedVideo(match_id=video.match_id, output_path=output_path))

    job.progress_pct = 95.0
    db.commit()
