# backend/schemas/match.py
from datetime import datetime
from backend.models.match import JobStatus, VideoStatus
from pydantic import BaseModel


class MatchCreate(BaseModel):
    date: str
    opponent: str | None = None
    venue: str | None = None
    notes: str | None = None


class MatchRead(BaseModel):
    id: int
    date: str
    opponent: str | None
    venue: str | None
    notes: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class VideoRead(BaseModel):
    id: int
    match_id: int
    set_number: int
    raw_path: str
    status: VideoStatus
    duration: float | None
    created_at: datetime

    model_config = {"from_attributes": True}


class JobRead(BaseModel):
    id: int
    video_id: int
    status: JobStatus
    progress_pct: float
    error: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class RallyRead(BaseModel):
    id: int
    video_id: int
    start_time: float
    end_time: float
    score_home: int | None
    score_away: int | None
    confidence: float

    model_config = {"from_attributes": True}


class RallyUpdate(BaseModel):
    score_home: int | None = None
    score_away: int | None = None
    start_time: float | None = None
    end_time: float | None = None


class ProcessedVideoRead(BaseModel):
    id: int
    match_id: int
    output_path: str
    created_at: datetime

    model_config = {"from_attributes": True}
