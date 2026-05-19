# ADR-004: Hybrid storage — disk for frames/annotations, DB for metadata

**Status:** Accepted  
**Date:** 2026-05-19

## Context

The bootstrap and active learning flows require storing extracted video frames and YOLO annotation files (`.txt` bounding-box labels). These could be stored as BLOBs in SQLite or as files on disk alongside a DB record pointing to them.

## Decision

Store frames as JPEG files and annotations as YOLO `.txt` files on disk under a structured `DATA_DIR`. The database stores only job state, metadata, and file paths — not file content.

**Write order:** disk first, then DB. If a DB write fails after a disk write, the file remains and the job can be retried. If a disk write fails, nothing is committed to the DB.

**Source of truth split:**
- Disk is authoritative for annotation content.
- DB is authoritative for job state and processing metadata.

## Consequences

- Frame files are human-inspectable and compatible with standard YOLO tooling without extraction.
- Avoids BLOB size limits and SQLite performance degradation at scale.
- Disk-first write order means partial failures leave recoverable state rather than corrupt DB records.
- Deleting a match must clean up both DB rows and disk files; a utility or cascade is required to keep them in sync.
