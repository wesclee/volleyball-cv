# Design Notes — 2026-05-19 (upload progress, UX fixes, E2E tests)

## Upload progress bar

`fetch` does not expose upload progress; replaced `uploadVideo` in `client.ts` with `XMLHttpRequest`, which fires `xhr.upload.onprogress`. Added an optional `onProgress?: (pct: number) => void` parameter. All other API functions stay on the `fetch`-based `request()` helper.

`UploadProcess.tsx` now passes a callback that updates the `progress` field on the set state. Progress is reset to `0` before transitioning to `'processing'` so the bar restarts cleanly. The JSX condition was widened from `processing || done` to `uploading || processing || done`, and the label ternary handles all three states: `Uploading… X%`, `Processing… X%`, `✓ Done`.

Testing XHR in Vitest requires `vi.stubGlobal('XMLHttpRequest', fn)` where `fn` is a regular function (not an arrow function) that returns a mock object — arrow functions cannot be used with `new`.

## Active Learning page bugs found and fixed

Two issues discovered during first real use:

1. **Extract Frames button was missing.** The empty-state message referenced it ("Use the Extract Frames button to…") but the button was never rendered. The fix required a new `GET /matches/videos?status=done` backend endpoint since `LabelingQueue` has no match context. The endpoint was added to `matches.py`. `LabelingQueue.tsx` now fetches processed videos on mount and renders an Extract Frames section per video in bootstrap mode only.

2. **SQLite schema out of sync.** The `pred_cx/cy/w/h/pred_conf` columns added to `LabeledFrame` in Plan 4 were not in the existing database. SQLAlchemy's `create_all` only creates missing tables, it doesn't add columns to existing ones. Solution: delete and recreate the database for dev. For production this would need Alembic migrations.

3. **Pydantic `model_ready` namespace warning.** Pydantic v2 protects the `model_` prefix. Fixed by adding `model_config = {"protected_namespaces": ()}` to `LabelingStatus`.

## Processing logs

`processor.py` now logs at INFO level: job start (with match/set context), detector selection, detection start/complete (rally count), export start/complete, frame queuing, job done/error (with full traceback on error). Uses `logging.getLogger(__name__)` pattern so log level is controllable per-module via standard Python logging config.

## Playwright E2E tests

Added `@playwright/test` with 38 tests across 5 spec files, all running against the Vite dev server with API calls mocked via `page.route()`. The tests are designed to catch UI discrepancies — elements referenced in text but not rendered, buttons missing from conditionally-rendered sections, state-dependent labels.

**Coverage per view:**
- `match-manager.spec.ts` — heading, form fields, empty state, match list with action links, nav
- `upload-process.spec.ts` — set cards, file inputs, disabled-until-file buttons, `Uploading… X%` label, navigation links
- `rally-review.spec.ts` — heading, set sections, timestamp inputs, score buttons, no-rallies state, navigation links
- `export.spec.ts` — heading, Generate Export button, description text, download links after export, empty-export state
- `active-learning.spec.ts` — bootstrap mode (no frames, Extract Frames button per video, annotation canvas, frame counter, Start Training), active review mode (retrain panel, queue frame with confidence, action buttons, queue-empty state), PromotionPanel (training run heading, metrics table, Promote button)

**Key fixture decisions:**
- All API responses mocked via `page.route('http://localhost:8000/**', ...)` — no backend required
- `mockAllVideos` uses `http://localhost:8000/matches/videos**` glob to match the `?status=done` query param
- Bootstrap frames mocked via `bootstrap/frames**` to handle both list and image sub-routes
- `reuseExistingServer: true` in playwright.config.ts — Playwright reuses an already-running Vite dev server rather than starting a new one

**Run with:** `npm run test:e2e` (from `frontend/`)
