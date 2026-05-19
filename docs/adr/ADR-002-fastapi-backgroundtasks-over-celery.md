# ADR-002: FastAPI BackgroundTasks over Celery

**Status:** Accepted  
**Date:** 2026-05-18

## Context

Video processing jobs (motion detection, YOLOv8 inference, ffmpeg export) are long-running and must not block HTTP responses. Options considered: FastAPI's built-in `BackgroundTasks`, Celery + Redis, or a thread/process pool.

The app runs on a single local machine with one user triggering jobs infrequently.

## Decision

Use FastAPI `BackgroundTasks` for all background job processing.

## Consequences

- No broker (Redis) or worker process required — simpler local setup.
- Jobs run in the same process as the FastAPI server; a crash kills in-progress jobs. Acceptable for local use where the user can re-trigger.
- `BackgroundTasks` runs synchronously inside `TestClient`, which simplifies integration tests — no async coordination needed.
- If the app ever needs concurrent multi-user job queues, Celery would be the natural replacement; the job processor interface is isolated enough to swap.
