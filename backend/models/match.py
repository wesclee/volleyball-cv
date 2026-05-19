# backend/models/match.py
import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum as SAEnum, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.database import Base


class VideoStatus(str, enum.Enum):
    pending = "pending"
    processing = "processing"
    done = "done"
    error = "error"


class JobStatus(str, enum.Enum):
    pending = "pending"
    running = "running"
    done = "done"
    error = "error"


class FrameSplit(str, enum.Enum):
    train = "train"
    val = "val"
    test = "test"


class FrameStatus(str, enum.Enum):
    pending = "pending"
    annotated = "annotated"
    skipped = "skipped"
    missing = "missing"


class TrainingStatus(str, enum.Enum):
    pending = "pending"
    running = "running"
    done = "done"
    error = "error"


class Match(Base):
    __tablename__ = "matches"
    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[str] = mapped_column(String(20))
    opponent: Mapped[str | None] = mapped_column(String(200))
    venue: Mapped[str | None] = mapped_column(String(200))
    notes: Mapped[str | None] = mapped_column(String(2000))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    videos: Mapped[list["Video"]] = relationship(back_populates="match", cascade="all, delete-orphan")
    processed_videos: Mapped[list["ProcessedVideo"]] = relationship(back_populates="match", cascade="all, delete-orphan")


class Video(Base):
    __tablename__ = "videos"
    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id"))
    set_number: Mapped[int] = mapped_column(Integer)
    raw_path: Mapped[str] = mapped_column(String(500))
    status: Mapped[VideoStatus] = mapped_column(SAEnum(VideoStatus), default=VideoStatus.pending)
    duration: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    match: Mapped["Match"] = relationship(back_populates="videos")
    rallies: Mapped[list["Rally"]] = relationship(back_populates="video", cascade="all, delete-orphan")
    jobs: Mapped[list["Job"]] = relationship(back_populates="video", cascade="all, delete-orphan")
    labeled_frames: Mapped[list["LabeledFrame"]] = relationship(back_populates="video", cascade="all, delete-orphan")


class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[int] = mapped_column(primary_key=True)
    video_id: Mapped[int] = mapped_column(ForeignKey("videos.id"))
    status: Mapped[JobStatus] = mapped_column(SAEnum(JobStatus), default=JobStatus.pending)
    progress_pct: Mapped[float] = mapped_column(Float, default=0.0)
    error: Mapped[str | None] = mapped_column(String(2000))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    video: Mapped["Video"] = relationship(back_populates="jobs")


class Rally(Base):
    __tablename__ = "rallies"
    id: Mapped[int] = mapped_column(primary_key=True)
    video_id: Mapped[int] = mapped_column(ForeignKey("videos.id"))
    start_time: Mapped[float] = mapped_column(Float)
    end_time: Mapped[float] = mapped_column(Float)
    score_home: Mapped[int | None] = mapped_column(Integer)
    score_away: Mapped[int | None] = mapped_column(Integer)
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    video: Mapped["Video"] = relationship(back_populates="rallies")


class ProcessedVideo(Base):
    __tablename__ = "processed_videos"
    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id"))
    output_path: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    match: Mapped["Match"] = relationship(back_populates="processed_videos")


class LabeledFrame(Base):
    __tablename__ = "labeled_frames"
    id: Mapped[int] = mapped_column(primary_key=True)
    video_id: Mapped[int] = mapped_column(ForeignKey("videos.id"))
    frame_number: Mapped[int] = mapped_column(Integer)
    timestamp: Mapped[float] = mapped_column(Float)
    img_path: Mapped[str] = mapped_column(String(500))
    label_path: Mapped[str] = mapped_column(String(500))
    split: Mapped[FrameSplit] = mapped_column(SAEnum(FrameSplit))
    review_status: Mapped[FrameStatus] = mapped_column(SAEnum(FrameStatus), default=FrameStatus.pending)
    pred_cx: Mapped[float | None] = mapped_column(Float, nullable=True)
    pred_cy: Mapped[float | None] = mapped_column(Float, nullable=True)
    pred_w: Mapped[float | None] = mapped_column(Float, nullable=True)
    pred_h: Mapped[float | None] = mapped_column(Float, nullable=True)
    pred_conf: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    video: Mapped["Video"] = relationship(back_populates="labeled_frames")


class ModelVersion(Base):
    __tablename__ = "model_versions"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    weights_path: Mapped[str] = mapped_column(String(500))
    dataset_size: Mapped[int] = mapped_column(Integer)
    test_precision: Mapped[float | None] = mapped_column(Float)
    test_recall: Mapped[float | None] = mapped_column(Float)
    test_map50: Mapped[float | None] = mapped_column(Float)
    is_active: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class TrainingRun(Base):
    __tablename__ = "training_runs"
    id: Mapped[int] = mapped_column(primary_key=True)
    status: Mapped[TrainingStatus] = mapped_column(SAEnum(TrainingStatus), default=TrainingStatus.pending)
    base_model_id: Mapped[int | None] = mapped_column(ForeignKey("model_versions.id"), nullable=True)
    new_model_id: Mapped[int | None] = mapped_column(ForeignKey("model_versions.id"), nullable=True)
    frames_used: Mapped[int | None] = mapped_column(Integer)
    epochs: Mapped[int | None] = mapped_column(Integer)
    final_loss: Mapped[float | None] = mapped_column(Float)
    duration_s: Mapped[float | None] = mapped_column(Float)
    error: Mapped[str | None] = mapped_column(String(2000))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
