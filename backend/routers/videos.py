# backend/routers/videos.py
import shutil
import subprocess
from array import array
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, Form, HTTPException, Query, UploadFile, status
from sqlalchemy.orm import Session

from backend.config import DATABASE_URL, UPLOADS_DIR
from backend.database import get_db
from backend.jobs.processor import process_video as run_processing
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
def process_video(
    video_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    video = db.get(Video, video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    job = Job(video_id=video_id)
    db.add(job)
    video.status = VideoStatus.processing
    db.commit()
    db.refresh(job)

    background_tasks.add_task(run_processing, job.id, DATABASE_URL)
    return job


@router.get("/videos/{video_id}/audio-peaks")
def audio_peaks(
    video_id: int,
    buckets: int = Query(default=240, ge=32, le=1200),
    db: Session = Depends(get_db),
):
    video = db.get(Video, video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    peaks = extract_audio_peaks(Path(video.raw_path), buckets)
    return {"video_id": video_id, "buckets": len(peaks), "peaks": peaks}


def extract_audio_peaks(video_path: Path, buckets: int) -> list[float]:
    command = [
        "ffmpeg",
        "-v", "error",
        "-i", str(video_path),
        "-vn",
        "-ac", "1",
        "-ar", "8000",
        "-f", "f32le",
        "pipe:1",
    ]
    try:
        result = subprocess.run(command, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except (subprocess.CalledProcessError, FileNotFoundError, PermissionError):
        return []

    samples = array("f")
    samples.frombytes(result.stdout)
    if not samples:
        return []

    samples_per_bucket = max(1, len(samples) // buckets)
    peaks: list[float] = []
    max_peak = 0.0
    for bucket in range(buckets):
        start = bucket * samples_per_bucket
        end = len(samples) if bucket == buckets - 1 else min(len(samples), start + samples_per_bucket)
        peak = max((abs(sample) for sample in samples[start:end]), default=0.0)
        peaks.append(peak)
        max_peak = max(max_peak, peak)

    if max_peak == 0:
        return peaks
    return [peak / max_peak for peak in peaks]
