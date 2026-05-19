# backend/training/reconciler.py
import re
from pathlib import Path

import cv2
from sqlalchemy.orm import Session

from backend.config import FRAMES_DIR, DATASET_DIR
from backend.models.match import FrameStatus, FrameSplit, LabeledFrame, Video

_YOLO_LINE_RE = re.compile(r"^0 [\d.]+ [\d.]+ [\d.]+ [\d.]+\s*$")


def reconcile(db: Session) -> dict[str, int]:
    counts = {"missing": 0, "restored": 0, "reregistered": 0, "malformed": 0, "split_conflicts": 0, "ok": 0}

    for frame in db.query(LabeledFrame).all():
        img_path = Path(frame.img_path)
        label_path = Path(frame.label_path)

        if not img_path.exists():
            frame.review_status = FrameStatus.missing
            counts["missing"] += 1
            continue

        if label_path.exists():
            content = label_path.read_text().strip()
            if content and not _YOLO_LINE_RE.match(content):
                label_path.unlink()
                frame.review_status = FrameStatus.pending
                counts["malformed"] += 1
            elif frame.review_status == FrameStatus.pending:
                frame.review_status = FrameStatus.annotated
                counts["restored"] += 1
            else:
                counts["ok"] += 1
        else:
            if frame.review_status == FrameStatus.annotated:
                frame.review_status = FrameStatus.pending
                counts["missing"] += 1
            else:
                counts["ok"] += 1

    db.commit()

    # Re-register orphaned JPEGs in data/frames/ that have no DB row
    known = {f.img_path for f in db.query(LabeledFrame).all()}
    for jpg in FRAMES_DIR.glob("frame_*.jpg"):
        if str(jpg) in known:
            continue
        parts = jpg.stem.split("_")
        if len(parts) != 3:
            continue
        try:
            video_id, frame_number = int(parts[1]), int(parts[2])
        except ValueError:
            continue
        video = db.get(Video, video_id)
        if not video:
            continue
        cap = cv2.VideoCapture(video.raw_path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        cap.release()
        label_path = DATASET_DIR / "labels" / "train" / f"{jpg.stem}.txt"
        db.add(LabeledFrame(
            video_id=video_id,
            frame_number=frame_number,
            timestamp=frame_number / fps,
            img_path=str(jpg),
            label_path=str(label_path),
            split=FrameSplit.train,
            review_status=FrameStatus.pending,
        ))
        counts["reregistered"] += 1

    db.commit()
    return counts
