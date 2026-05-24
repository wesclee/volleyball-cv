# backend/schemas/match.py
from datetime import datetime
from backend.models.match import FrameSplit, FrameStatus, JobStatus, TrainingStatus, VideoStatus
from pydantic import BaseModel, Field


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


class RallyFootageRead(BaseModel):
    match: MatchRead
    video: VideoRead
    rally_count: int


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
    split: FrameSplit | None
    confidence: float

    model_config = {"from_attributes": True}


class RallyUpdate(BaseModel):
    score_home: int | None = None
    score_away: int | None = None
    start_time: float | None = None
    end_time: float | None = None


class RallyCreate(BaseModel):
    start_time: float = Field(ge=0.0)
    end_time: float = Field(ge=0.0)


class ProcessedVideoRead(BaseModel):
    id: int
    match_id: int
    output_path: str
    created_at: datetime

    model_config = {"from_attributes": True}


class LabeledFrameRead(BaseModel):
    id: int
    video_id: int
    frame_number: int
    timestamp: float
    img_path: str
    label_path: str
    split: FrameSplit
    review_status: FrameStatus
    pred_cx: float | None
    pred_cy: float | None
    pred_w: float | None
    pred_h: float | None
    pred_conf: float | None
    label_cx: float | None
    label_cy: float | None
    label_w: float | None
    label_h: float | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ModelVersionRead(BaseModel):
    id: int
    name: str
    weights_path: str
    dataset_size: int
    test_precision: float | None
    test_recall: float | None
    test_map50: float | None
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class TrainingRunRead(BaseModel):
    id: int
    status: TrainingStatus
    progress_pct: float
    stop_requested: bool
    base_model_id: int | None
    new_model_id: int | None
    frames_used: int | None
    epochs: int | None
    final_loss: float | None
    duration_s: float | None
    error: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class BootstrapExtractRequest(BaseModel):
    sample_rate: int = 30
    max_frames: int = 500
    split_train: float = 0.8
    split_val: float = 0.1
    split_test: float = 0.1
    whole_video: bool = False


class AnnotateRequest(BaseModel):
    cx: float = Field(ge=0.0, le=1.0)
    cy: float = Field(ge=0.0, le=1.0)
    w: float = Field(gt=0.0, le=1.0)
    h: float = Field(gt=0.0, le=1.0)


class TrainingRunRequest(BaseModel):
    epochs: int = 50


class RallyDatasetRequest(BaseModel):
    split_train: float = 0.8
    split_val: float = 0.1
    split_test: float = 0.1
    min_gap_s: float = Field(default=1.0, ge=0.0)


class RallyDatasetRead(BaseModel):
    task: str
    labels: list[str]
    split_ratios: dict[str, float]
    counts: dict[str, int]
    positive_rallies: int
    negative_gaps: int
    dataset_path: str
    split_source: str | None = None
    built_at: str | None = None


class RallyTrainingRunRequest(BaseModel):
    epochs: int = Field(default=25, ge=1, le=500)


class RallyTrainingRunRead(BaseModel):
    id: int
    status: TrainingStatus
    progress_pct: float
    stop_requested: bool
    new_model_id: int | None
    examples_used: int | None
    epochs: int | None
    final_loss: float | None
    duration_s: float | None
    error: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class RallyModelVersionRead(BaseModel):
    model_config = {"from_attributes": True, "protected_namespaces": ()}

    id: int
    name: str
    model_path: str
    dataset_size: int
    test_precision: float | None
    test_recall: float | None
    test_map50: float | None
    mean_temporal_iou: float | None
    is_active: bool
    created_at: datetime


class RallyPredictionRead(BaseModel):
    start_time: float
    end_time: float
    confidence: float
    source_model_id: int


class RallyScanRead(BaseModel):
    model_config = {"protected_namespaces": ()}

    video_id: int
    model_id: int
    model_name: str
    window_s: float
    step_s: float
    threshold: float
    windows_scanned: int
    predictions: list[RallyPredictionRead]


class RallyScanRunRead(BaseModel):
    model_config = {"protected_namespaces": ()}

    id: int
    video_id: int
    model_id: int
    status: JobStatus
    progress_pct: float
    window_s: float
    step_s: float
    threshold: float | None
    max_predictions: int
    windows_scanned: int
    predictions: list[RallyPredictionRead]
    error: str | None
    created_at: datetime



class ReconcileResult(BaseModel):
    missing: int
    restored: int
    reregistered: int
    malformed: int
    ok: int


class LabelingStatus(BaseModel):
    model_config = {"protected_namespaces": ()}

    frames_total: int
    source_videos_total: int
    source_videos_labeled: int
    annotated: int
    skipped: int
    pending: int
    missing: int
    model_ready: bool
    active_model_id: int | None
    new_labeled_since_last_train: int
    retrain_recommended: bool
    retrain_threshold: int
    last_trained_at_size: int | None
