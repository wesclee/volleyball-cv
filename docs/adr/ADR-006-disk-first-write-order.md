# ADR-006: Disk-first write order for frame extraction

**Status:** Accepted  
**Date:** 2026-05-19

## Context

When the bootstrap pipeline extracts frames and writes annotation files, two side effects must succeed: writing the file to disk and recording the path in the database. If these happen in the wrong order, a failure between the two steps can leave the system in an unrecoverable or misleading state.

## Decision

Always write to disk before writing to the database.

- If the disk write succeeds and the DB write fails: the file exists, the job can be retried, no DB record points to a missing file.
- If the disk write fails: nothing reaches the DB, the failure is clean.

The inverse order (DB first, then disk) would create DB records pointing to files that don't yet exist, which is harder to recover from.

## Consequences

- Failed jobs leave orphaned files on disk. A cleanup utility or retry mechanism is needed to reconcile these.
- The DB never contains a record for a file that doesn't exist on disk.
- This pattern must be followed consistently across all frame extraction and annotation write paths.
