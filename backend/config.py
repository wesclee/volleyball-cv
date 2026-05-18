# backend/config.py
import os
from pathlib import Path

DATA_DIR = Path(os.getenv("DATA_DIR", str(Path(__file__).parent.parent / "data")))
UPLOADS_DIR = DATA_DIR / "uploads"
EXPORTS_DIR = DATA_DIR / "exports"
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DATA_DIR}/volleyball_cv.db")

UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
