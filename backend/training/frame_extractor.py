# backend/training/frame_extractor.py
import random
from pathlib import Path

import cv2
from sqlalchemy.orm import Session

from backend.config import FRAMES_DIR, DATASET_DIR
from backend.models.match import FrameSplit, FrameStatus, LabeledFrame, Rally, Video


def extract_frames(
    video_id: int,
    db: Session,
    sample_rate: int = 30,
    max_frames: int = 500,
    split_ratios: dict[str, float] | None = None,
) -> int:
    if split_ratios is None:
        split_ratios = {"train": 0.8, "val": 0.1, "test": 0.1}

    video = db.get(Video, video_id)
    if not video:
        raise ValueError(f"Video {video_id} not found")

    rallies = db.query(Rally).filter_by(video_id=video_id).all()
    if not rallies:
        raise ValueError(f"No rallies found for video {video_id}")

    FRAMES_DIR.mkdir(parents=True, exist_ok=True)
    for split in ("train", "val", "test"):
        (DATASET_DIR / "labels" / split).mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(video.raw_path)
    if not cap.isOpened():
        raise ValueError(f"Cannot open video: {video.raw_path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0

    candidates: list[int] = []
    for rally in rallies:
        start_f = int(rally.start_time * fps)
        end_f = int(rally.end_time * fps)
        candidates.extend(range(start_f, end_f, sample_rate))

    candidates = sorted(set(candidates))
    if len(candidates) > max_frames:
        candidates = sorted(random.sample(candidates, max_frames))

    shuffled = candidates[:]
    random.shuffle(shuffled)
    n = len(shuffled)
    n_train = int(n * split_ratios["train"])
    n_val = int(n * split_ratios["val"])
    assignments = (
        [FrameSplit.train] * n_train
        + [FrameSplit.val] * n_val
        + [FrameSplit.test] * (n - n_train - n_val)
    )
    split_map = dict(zip(shuffled, assignments))

    extracted = 0
    for frame_idx in candidates:
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ret, frame = cap.read()
        if not ret:
            continue

        img_path = FRAMES_DIR / f"frame_{video_id}_{frame_idx}.jpg"
        assigned_split = split_map[frame_idx]
        label_path = DATASET_DIR / "labels" / assigned_split.value / f"frame_{video_id}_{frame_idx}.txt"

        cv2.imwrite(str(img_path), frame)
        db.add(LabeledFrame(
            video_id=video_id,
            frame_number=frame_idx,
            timestamp=frame_idx / fps,
            img_path=str(img_path),
            label_path=str(label_path),
            split=assigned_split,
            review_status=FrameStatus.pending,
        ))
        extracted += 1

    cap.release()
    db.commit()
    return extracted
