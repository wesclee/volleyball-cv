# tests/conftest.py
import os
import sys
from pathlib import Path

# Set env vars before any backend imports so config.py picks them up
os.environ["DATABASE_URL"] = "sqlite:////tmp/volleyball_cv_test.db"
os.environ["DATA_DIR"] = "/tmp/volleyball_cv_test_data"

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def clean_db():
    from backend.database import Base, engine
    import backend.models  # noqa — registers all models
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)
    engine.dispose()
    db_path = Path("/tmp/volleyball_cv_test.db")
    if db_path.exists():
        db_path.unlink()


@pytest.fixture
def client(clean_db):
    from backend.main import app
    with TestClient(app) as c:
        yield c


import shutil  # noqa: E402


@pytest.fixture(autouse=True)
def clean_data_dirs():
    yield
    data_dir = Path("/tmp/volleyball_cv_test_data")
    if data_dir.exists():
        shutil.rmtree(data_dir, ignore_errors=True)
    # Recreate expected subdirs so subsequent tests that import config.py (already
    # cached in sys.modules) still find the directories they need.
    for subdir in ("uploads", "exports", "frames", "dataset", "models"):
        (data_dir / subdir).mkdir(parents=True, exist_ok=True)
