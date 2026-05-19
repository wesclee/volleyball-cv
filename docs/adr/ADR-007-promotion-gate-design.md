# ADR-007: Promotion gate — net mAP50 delta

**Status:** Accepted  
**Date:** 2026-05-19

## Context

After a YOLOv8 training run completes, the new model must be evaluated before replacing the active detector. Options for the promotion criterion:

- **Always promote:** simplest, but risks replacing a good model with a worse one.
- **Fixed threshold:** e.g., mAP50 ≥ 0.85. Hard to set without knowing the dataset; may never be reached on small initial datasets.
- **Delta-based:** promote only if the new model improves on the current one.

## Decision

Compute `net_delta = Δprecision + Δrecall + ΔmAP50` against the currently active model. Enable the Promote button only when `net_delta > 0`.

**Special case:** the first trained model (no active Tier 2 model yet) is always promotable regardless of delta.

## Consequences

- The active model can only be replaced by a strictly better one (across the combined metric), preventing regressions.
- A model that improves mAP50 but drops precision and recall by more will be blocked — the combined delta catches net-negative trades.
- The threshold is conservative: a tiny net improvement still triggers promotion. If this causes instability, a minimum delta floor (e.g., `net_delta > 0.02`) can be added.
- Users see a clear UI signal (Promote button enabled/disabled) without needing to interpret raw metric numbers.
