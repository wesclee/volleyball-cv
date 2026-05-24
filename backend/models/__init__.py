# backend/models/__init__.py
from backend.models.match import (  # noqa: F401 — registers models with Base
    FrameSplit,
    FrameStatus,
    JobStatus,
    LabeledFrame,
    Match,
    Job,
    ModelVersion,
    ProcessedVideo,
    Rally,
    RallyModelVersion,
    RallyScanRun,
    RallyTrainingRun,
    TrainingRun,
    TrainingStatus,
    Video,
    VideoStatus,
)
