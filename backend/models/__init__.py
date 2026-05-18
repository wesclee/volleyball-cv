# backend/models/__init__.py
from backend.models.match import (  # noqa: F401 — registers models with Base
    JobStatus,
    Match,
    Job,
    ProcessedVideo,
    Rally,
    Video,
    VideoStatus,
)
