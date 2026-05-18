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
