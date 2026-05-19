# Product Requirements Document — Volleyball CV
_Version 1.0 — 2026-05-19 — covers Plans 1–3_

---

## Overview

Volleyball CV is a local web app that automatically detects rallies in raw match recordings, cuts dead time, tracks scores, and exports a clean MP4 ready for YouTube. It eliminates the manual editing work after every match.

**Problem:** Raw volleyball recordings are 60–90% dead time (timeouts, rotations, serves being retrieved). Manually cutting footage is tedious and delays VOD publishing. Existing tools require cloud upload or manual timeline editing.

---

## User

**Primary user:** Solo volleyball player recording personal matches from a fixed tripod camera. Runs the app locally; no cloud accounts needed beyond YouTube upload. Technically comfortable — can run `docker-compose up` and use a local web UI.

**Hardware context:** GTX 1080 (8GB VRAM), local machine. Processing time matters but sub-hour per match is acceptable.

---

## Features

### P0 — Must have (Plans 1–3)

- Upload 1–3 MP4 set recordings per match
- Tier 1 rally detection via MOG2 motion analysis (~75–85% accuracy)
- Tier 2 rally detection via fine-tuned YOLOv8 (replaces Tier 1 once trained)
- Bootstrap labeling UI — draw bounding boxes on sampled frames to seed initial YOLOv8 training
- Background job pipeline — process videos without blocking the UI
- Rally review — adjust start/end timestamps, assign scores per rally
- Export — stitch rallies into trimmed MP4 with score overlay

### P1 — Important, deferrable (Plans 4–5)

- Active learning loop — confidence-based frame routing, keyboard-driven review, retrain cycle
- YouTube OAuth2 upload direct from the app

### P2 — Nice to have (post-Plan 5)

- Court ROI mask setup UI
- Automatic score detection

---

## Success Metrics

| Metric | Target |
|---|---|
| Rally detection precision (Tier 2, post-bootstrap) | ≥ 90% |
| End-to-end processing time (upload → export-ready) | < 10 min per set |
| UI interactions to reach export | ≤ 5 from match creation |
| Bootstrap labeling session | Completable in one sitting (~200–500 frames) |
| Model improvement after retrain | Net positive mAP50 delta |

---

## Out of Scope

- Cloud hosting or multi-user support
- Support for non-volleyball sports
- Mobile or tablet UI
- Real-time processing (batch only)
- Player tracking or statistics beyond rally detection
