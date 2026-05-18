# backend/main.py
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import backend.models  # noqa — registers all ORM models with Base
from backend.config import EXPORTS_DIR, UPLOADS_DIR
from backend.database import Base, engine
from backend.routers import matches, videos, jobs, rallies


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    yield


app = FastAPI(title="Volleyball CV", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")
app.mount("/exports", StaticFiles(directory=str(EXPORTS_DIR)), name="exports")

app.include_router(matches.router)
app.include_router(videos.router)
app.include_router(jobs.router)
app.include_router(rallies.router)
