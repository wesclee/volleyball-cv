# ADR-001: SQLite over a network database

**Status:** Accepted  
**Date:** 2026-05-18

## Context

The app needs persistent storage for matches, videos, jobs, rallies, and export records. Common choices are SQLite (file-based, no server) or a network database such as PostgreSQL.

The app is a single-user local tool with no concurrent writers and no remote access requirement.

## Decision

Use SQLite via SQLAlchemy 2.0 (`mapped_column` style).

## Consequences

- No database server process to manage or include in Docker Compose.
- Zero connection overhead; the DB file lives alongside the app data.
- SQLAlchemy's ORM abstracts the engine, so migrating to PostgreSQL later is a config change.
- SQLite's write-lock behaviour is acceptable for single-user use; it would become a bottleneck under concurrent writes.
