from sqlalchemy import inspect
from backend.database import engine


def test_tables_created():
    from backend.models import Match, Video, Job, Rally, ProcessedVideo  # noqa
    from backend.models.match import LabeledFrame, ModelVersion, TrainingRun  # noqa
    from backend.database import Base
    Base.metadata.create_all(engine)
    inspector = inspect(engine)
    tables = inspector.get_table_names()
    for name in ("matches", "videos", "jobs", "rallies", "processed_videos",
                 "labeled_frames", "model_versions", "training_runs"):
        assert name in tables, f"missing table: {name}"
