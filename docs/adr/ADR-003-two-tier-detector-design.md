# ADR-003: Two-tier detector design (MOG2 → YOLOv8)

**Status:** Accepted  
**Date:** 2026-05-18

## Context

Rally detection requires identifying when the ball is in play. A trained YOLOv8 model gives the best accuracy but requires labelled training data that doesn't exist on first use. A pure manual-labelling approach blocks the user from getting any value until labelling is complete.

## Decision

Implement two interchangeable detector tiers behind a common interface:

- **Tier 1 (MOG2):** OpenCV background subtraction. Works immediately with no training data. Accuracy ~75–85%. Used as default until a trained model is promoted.
- **Tier 2 (YOLOv8):** Fine-tuned on the user's own footage. Replaces Tier 1 once the bootstrap training cycle completes.

The active detector is a runtime config value; switching tiers requires no code change.

## Consequences

- The app is useful from the first match, before any labelling work is done.
- MOG2 uses `learningRate=0` after a warmup period to prevent players being absorbed into the background model.
- The swappable interface means Tier 1 and Tier 2 are tested and deployed independently.
- A third tier (e.g., a larger YOLO model) can be added without touching the pipeline.
