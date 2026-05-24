from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


def ensure_schema_compatibility(engine: Engine) -> None:
    inspector = inspect(engine)
    table_names = inspector.get_table_names()

    if "videos" in table_names:
        video_columns = {column["name"] for column in inspector.get_columns("videos")}
        if "content_hash" not in video_columns:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE videos ADD COLUMN content_hash VARCHAR(64)"))

    if "rallies" not in inspector.get_table_names():
        rally_columns = set()
    else:
        rally_columns = {column["name"] for column in inspector.get_columns("rallies")}

    training_run_columns = set()
    if "training_runs" in table_names:
        training_run_columns = {column["name"] for column in inspector.get_columns("training_runs")}

    with engine.begin() as conn:
        if "rallies" in table_names and "split" not in rally_columns:
            conn.execute(text("ALTER TABLE rallies ADD COLUMN split VARCHAR(5)"))
        if "training_runs" in table_names and "progress_pct" not in training_run_columns:
            conn.execute(text("ALTER TABLE training_runs ADD COLUMN progress_pct FLOAT DEFAULT 0.0"))
        if "training_runs" in table_names and "stop_requested" not in training_run_columns:
            conn.execute(text("ALTER TABLE training_runs ADD COLUMN stop_requested BOOLEAN DEFAULT 0"))
