# backend/main.py
from contextlib import asynccontextmanager

from fastapi import FastAPI

import backend.models  # noqa — registers all ORM models with Base
from backend.database import Base, engine
from backend.routers import matches, videos, jobs, rallies


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    yield


app = FastAPI(title="Volleyball CV", lifespan=lifespan)
app.include_router(matches.router)
app.include_router(videos.router)
app.include_router(jobs.router)
app.include_router(rallies.router)
