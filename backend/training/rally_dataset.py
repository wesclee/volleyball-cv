import json
from datetime import datetime
from pathlib import Path

from backend.config import DATASET_DIR
from backend.models.match import FrameSplit, Rally, Video


SPLITS = ("train", "val", "test")


def _split_value(split: FrameSplit | str) -> str:
    return split.value if isinstance(split, FrameSplit) else split


def _assign_missing_rally_splits(db, split_ratios: dict[str, float]) -> None:
    rallies = db.query(Rally).order_by(Rally.id).all()
    split_counts = {split: 0 for split in SPLITS}

    for rally in rallies:
        if rally.split:
            split_counts[_split_value(rally.split)] += 1

    for rally in rallies:
        if rally.split:
            continue
        available_splits = [split for split in SPLITS if split_ratios[split] > 0]
        selected = min(
            available_splits,
            key=lambda split: (split_counts[split] / split_ratios[split], SPLITS.index(split)),
        )
        rally.split = FrameSplit(selected)
        split_counts[selected] += 1

    db.commit()


def build_rally_boundary_dataset(
    db,
    split_ratios: dict[str, float],
    min_gap_s: float = 1.0,
) -> dict:
    dataset_dir = DATASET_DIR / "rally_boundaries"
    dataset_dir.mkdir(parents=True, exist_ok=True)

    _assign_missing_rally_splits(db, split_ratios)

    videos = db.query(Video).order_by(Video.id).all()
    split_examples: dict[str, list[dict]] = {split: [] for split in SPLITS}
    for video in videos:
        rallies = db.query(Rally).filter(Rally.video_id == video.id).order_by(Rally.start_time).all()
        if not rallies:
            continue
        for rally in rallies:
            split = _split_value(rally.split)
            split_examples[split].append({
                "video_id": video.id,
                "video_path": video.raw_path,
                "start_time": rally.start_time,
                "end_time": rally.end_time,
                "label": "rally",
                "rally_id": rally.id,
                "split": split,
            })

        cursor = 0.0
        cursor_split = _split_value(rallies[0].split)
        for index, rally in enumerate(rallies):
            rally_split = _split_value(rally.split)
            if rally.start_time - cursor >= min_gap_s:
                split_examples[cursor_split].append({
                    "video_id": video.id,
                    "video_path": video.raw_path,
                    "start_time": cursor,
                    "end_time": rally.start_time,
                    "label": "non_rally",
                    "rally_id": None,
                    "split": cursor_split,
                })
            cursor = max(cursor, rally.end_time)
            cursor_split = rally_split
            if index == len(rallies) - 1 and video.duration and video.duration - cursor >= min_gap_s:
                split_examples[rally_split].append({
                    "video_id": video.id,
                    "video_path": video.raw_path,
                    "start_time": cursor,
                    "end_time": video.duration,
                    "label": "non_rally",
                    "rally_id": None,
                    "split": rally_split,
                })

    for items in split_examples.values():
        items.sort(key=lambda item: (item["video_id"], item["start_time"], item["end_time"], item["label"]))

    for split, items in split_examples.items():
        (dataset_dir / f"{split}.json").write_text(json.dumps(items, indent=2))

    examples = [item for items in split_examples.values() for item in items]
    manifest = {
        "task": "rally_boundary",
        "labels": ["non_rally", "rally"],
        "split_ratios": split_ratios,
        "counts": {split: len(items) for split, items in split_examples.items()},
        "positive_rallies": sum(1 for item in examples if item["label"] == "rally"),
        "negative_gaps": sum(1 for item in examples if item["label"] == "non_rally"),
        "dataset_path": str(dataset_dir),
        "split_source": "persisted_rally_split",
        "built_at": datetime.utcnow().isoformat(),
    }
    (dataset_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    return manifest
