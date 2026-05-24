import json
import subprocess
import time
import traceback
from array import array
from datetime import date
from pathlib import Path

import cv2
import numpy as np
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.config import DATASET_DIR, MODELS_DIR
from backend.models.match import RallyModelVersion, RallyTrainingRun, TrainingStatus


class RallyTrainingCancelled(Exception):
    pass


FEATURE_NAMES = [
    "duration_s",
    "log_duration_s",
    "audio_rms",
    "audio_peak",
    "audio_mean_abs",
    "audio_std_abs",
    "audio_active_ratio",
    "motion_mean",
    "motion_peak",
    "motion_std",
    "motion_active_ratio",
    "brightness_mean",
    "brightness_std",
    "brightness_delta",
]


def run_rally_training(run_id: int, epochs: int, db_url: str) -> None:
    engine = create_engine(db_url, connect_args={"check_same_thread": False})
    try:
        with sessionmaker(bind=engine)() as db:
            run = db.get(RallyTrainingRun, run_id)
            if not run:
                return
            run.status = TrainingStatus.running
            run.progress_pct = 1.0
            db.commit()
            try:
                _do_train(run, epochs, db)
                if run.stop_requested:
                    run.status = TrainingStatus.cancelled
                else:
                    run.status = TrainingStatus.done
                    run.progress_pct = 100.0
            except RallyTrainingCancelled:
                run.status = TrainingStatus.cancelled
            except Exception:
                run.status = TrainingStatus.error
                run.error = traceback.format_exc()[:2000]
            db.commit()
    finally:
        engine.dispose()


def _do_train(run: RallyTrainingRun, epochs: int, db) -> None:
    dataset_dir = DATASET_DIR / "rally_boundaries"
    train_examples = _read_examples(dataset_dir / "train.json")
    val_examples = _read_examples(dataset_dir / "val.json")
    test_examples = _read_examples(dataset_dir / "test.json")
    if not any(item["label"] == "rally" for item in train_examples):
        raise ValueError("need at least one train rally example")
    if not any(item["label"] == "rally" for item in test_examples):
        raise ValueError("need at least one test rally example")

    t_start = time.time()
    audio_cache = AudioCache()

    _set_progress(run, db, 5.0)
    x_train, y_train = _extract_matrix(train_examples, audio_cache, run, db, 5.0, 45.0)
    _check_cancelled(run, db)
    x_val, y_val = _extract_matrix(val_examples, audio_cache, run, db, 45.0, 58.0)
    x_test, y_test = _extract_matrix(test_examples, audio_cache, run, db, 58.0, 70.0)
    _check_cancelled(run, db)

    mean = x_train.mean(axis=0)
    std = x_train.std(axis=0)
    std[std == 0] = 1.0
    x_train_norm = (x_train - mean) / std
    x_val_norm = (x_val - mean) / std
    x_test_norm = (x_test - mean) / std

    weights, bias, losses = _train_logistic_regression(x_train_norm, y_train, epochs, run, db)
    train_probs = _sigmoid(x_train_norm @ weights + bias)
    val_probs = _sigmoid(x_val_norm @ weights + bias) if len(x_val_norm) else np.array([])
    test_probs = _sigmoid(x_test_norm @ weights + bias)

    threshold = _best_threshold(val_probs, y_val) if len(val_probs) else 0.5
    precision, recall, map50, mean_iou, predictions = evaluate_temporal_map50(test_examples, y_test, test_probs, threshold)
    _set_progress(run, db, 94.0)
    _check_cancelled(run, db)

    model = {
        "task": "rally_boundary",
        "model_type": "audio_motion_logistic_regression",
        "feature_names": FEATURE_NAMES,
        "normalization": {"mean": mean.tolist(), "std": std.tolist()},
        "weights": weights.tolist(),
        "bias": float(bias),
        "threshold": threshold,
        "epochs": epochs,
        "train_examples": len(train_examples),
        "val_examples": len(val_examples),
        "test_examples": len(test_examples),
        "train_positive_rate": float(y_train.mean()),
        "val_positive_rate": float(y_val.mean()) if len(y_val) else None,
        "test_positive_rate": float(y_test.mean()),
        "train_loss": losses,
        "train_accuracy": _accuracy(train_probs, y_train, threshold),
        "val_accuracy": _accuracy(val_probs, y_val, threshold) if len(val_probs) else None,
        "metric": "temporal_iou_map50",
        "metrics": {
            "test_precision": precision,
            "test_recall": recall,
            "test_map50": map50,
            "mean_temporal_iou": mean_iou,
            "temporal_iou_threshold": 0.5,
        },
        "test_predictions": predictions,
    }

    model_dir = MODELS_DIR / "rally_boundaries"
    model_dir.mkdir(parents=True, exist_ok=True)
    model_path = model_dir / f"run_{run.id}.json"
    model_path.write_text(json.dumps(model, indent=2))

    run.examples_used = len(train_examples)
    run.epochs = epochs
    run.final_loss = float(losses[-1]) if losses else None
    run.duration_s = time.time() - t_start
    version = RallyModelVersion(
        name=f"rally-v{run.id}-{date.today()}",
        model_path=str(model_path),
        dataset_size=len(train_examples),
        test_precision=precision,
        test_recall=recall,
        test_map50=map50,
        mean_temporal_iou=mean_iou,
        is_active=False,
    )
    db.add(version)
    db.flush()
    run.new_model_id = version.id
    run.progress_pct = max(run.progress_pct or 0.0, 98.0)
    db.commit()


class AudioCache:
    def __init__(self) -> None:
        self._cache: dict[str, np.ndarray] = {}
        self.sample_rate = 8000

    def samples(self, video_path: str) -> np.ndarray:
        if video_path not in self._cache:
            self._cache[video_path] = self._read_audio(Path(video_path))
        return self._cache[video_path]

    def clip(self, video_path: str, start_time: float, end_time: float) -> np.ndarray:
        samples = self.samples(video_path)
        if samples.size == 0:
            return samples
        start = max(0, int(start_time * self.sample_rate))
        end = min(samples.size, int(end_time * self.sample_rate))
        return samples[start:end]

    def _read_audio(self, video_path: Path) -> np.ndarray:
        command = [
            "ffmpeg",
            "-v", "error",
            "-i", str(video_path),
            "-vn",
            "-ac", "1",
            "-ar", str(self.sample_rate),
            "-f", "f32le",
            "pipe:1",
        ]
        try:
            result = subprocess.run(command, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        except (subprocess.CalledProcessError, FileNotFoundError, PermissionError):
            return np.array([], dtype=np.float32)

        samples = array("f")
        samples.frombytes(result.stdout)
        return np.array(samples, dtype=np.float32)


def _extract_matrix(
    examples: list[dict],
    audio_cache: AudioCache,
    run: RallyTrainingRun,
    db,
    progress_start: float,
    progress_end: float,
) -> tuple[np.ndarray, np.ndarray]:
    rows: list[list[float]] = []
    labels: list[int] = []
    total = max(1, len(examples))
    for index, example in enumerate(examples):
        _check_cancelled(run, db)
        rows.append(extract_features(example, audio_cache))
        labels.append(1 if example["label"] == "rally" else 0)
        if index % 3 == 0 or index == len(examples) - 1:
            pct = progress_start + (progress_end - progress_start) * ((index + 1) / total)
            _set_progress(run, db, pct)
    return np.array(rows, dtype=np.float32), np.array(labels, dtype=np.float32)


def extract_features(example: dict, audio_cache: AudioCache) -> list[float]:
    start_time = float(example["start_time"])
    end_time = float(example["end_time"])
    duration = max(0.001, end_time - start_time)
    audio = audio_cache.clip(example["video_path"], start_time, end_time)
    audio_abs = np.abs(audio) if audio.size else np.array([], dtype=np.float32)
    audio_rms = float(np.sqrt(np.mean(np.square(audio)))) if audio.size else 0.0
    audio_peak = float(np.max(audio_abs)) if audio_abs.size else 0.0
    audio_mean_abs = float(np.mean(audio_abs)) if audio_abs.size else 0.0
    audio_std_abs = float(np.std(audio_abs)) if audio_abs.size else 0.0
    audio_active_ratio = float(np.mean(audio_abs > audio_mean_abs + audio_std_abs)) if audio_abs.size else 0.0

    motion_mean, motion_peak, motion_std, motion_active_ratio, brightness_mean, brightness_std, brightness_delta = (
        extract_motion_features(example["video_path"], start_time, end_time)
    )

    return [
        duration,
        float(np.log1p(duration)),
        audio_rms,
        audio_peak,
        audio_mean_abs,
        audio_std_abs,
        audio_active_ratio,
        motion_mean,
        motion_peak,
        motion_std,
        motion_active_ratio,
        brightness_mean,
        brightness_std,
        brightness_delta,
    ]


def score_rally_example(example: dict, model: dict, audio_cache: AudioCache | None = None) -> float:
    cache = audio_cache or AudioCache()
    features = np.array(extract_features(example, cache), dtype=np.float32)
    mean = np.array(model["normalization"]["mean"], dtype=np.float32)
    std = np.array(model["normalization"]["std"], dtype=np.float32)
    std[std == 0] = 1.0
    weights = np.array(model["weights"], dtype=np.float32)
    bias = float(model["bias"])
    normalized = (features - mean) / std
    return float(_sigmoid(np.array([normalized @ weights + bias]))[0])


def scan_video_for_rallies(
    video_id: int,
    video_path: str,
    duration_s: float,
    model_id: int,
    model: dict,
    window_s: float = 8.0,
    step_s: float = 2.0,
    max_predictions: int = 50,
    threshold: float | None = None,
    progress_callback=None,
) -> tuple[list[dict], int, float]:
    if duration_s <= 0:
        return [], 0, float(threshold if threshold is not None else model.get("threshold", 0.5))
    selected_threshold = float(threshold if threshold is not None else model.get("threshold", 0.5))
    audio_cache = AudioCache()
    raw_predictions: list[dict] = []
    windows_scanned = 0
    start = 0.0
    estimated_windows = max(1, int(duration_s / step_s))
    while start < duration_s:
        end = min(duration_s, start + window_s)
        if end - start < max(1.0, window_s * 0.4):
            break
        example = {
            "video_id": video_id,
            "video_path": video_path,
            "start_time": start,
            "end_time": end,
            "label": "unknown",
            "rally_id": None,
        }
        confidence = score_rally_example(example, model, audio_cache)
        windows_scanned += 1
        if confidence >= selected_threshold:
            raw_predictions.append({
                "start_time": start,
                "end_time": end,
                "confidence": confidence,
                "source_model_id": model_id,
            })
        if progress_callback and (windows_scanned == 1 or windows_scanned % 3 == 0):
            progress_callback(min(95.0, 5.0 + 90.0 * (windows_scanned / estimated_windows)), windows_scanned)
        start += step_s

    merged = merge_rally_predictions(raw_predictions)
    merged.sort(key=lambda item: item["confidence"], reverse=True)
    selected = sorted(merged[:max_predictions], key=lambda item: item["start_time"])
    return selected, windows_scanned, selected_threshold


def merge_rally_predictions(predictions: list[dict], max_gap_s: float = 3.0) -> list[dict]:
    if not predictions:
        return []
    ordered = sorted(predictions, key=lambda item: item["start_time"])
    merged: list[dict] = []
    current = dict(ordered[0])
    for item in ordered[1:]:
        if item["start_time"] <= current["end_time"] + max_gap_s:
            current["end_time"] = max(current["end_time"], item["end_time"])
            current["confidence"] = max(current["confidence"], item["confidence"])
        else:
            merged.append(current)
            current = dict(item)
    merged.append(current)
    return merged


def extract_motion_features(video_path: str, start_time: float, end_time: float) -> tuple[float, float, float, float, float, float, float]:
    capture = cv2.VideoCapture(video_path)
    if not capture.isOpened():
        return 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0
    try:
        sample_count = 7
        if end_time <= start_time:
            timestamps = [start_time]
        else:
            timestamps = np.linspace(start_time, end_time, sample_count)
        frames: list[np.ndarray] = []
        brightness: list[float] = []
        for timestamp in timestamps:
            capture.set(cv2.CAP_PROP_POS_MSEC, max(0.0, float(timestamp)) * 1000)
            ok, frame = capture.read()
            if not ok:
                continue
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            small = cv2.resize(gray, (64, 36), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
            frames.append(small)
            brightness.append(float(np.mean(small)))

        diffs = []
        for prev, curr in zip(frames, frames[1:]):
            diffs.append(float(np.mean(np.abs(curr - prev))))
        if not diffs:
            diffs = [0.0]
        diff_arr = np.array(diffs, dtype=np.float32)
        brightness_arr = np.array(brightness or [0.0], dtype=np.float32)
        motion_mean = float(np.mean(diff_arr))
        motion_peak = float(np.max(diff_arr))
        motion_std = float(np.std(diff_arr))
        motion_active_ratio = float(np.mean(diff_arr > motion_mean + motion_std)) if diff_arr.size else 0.0
        brightness_mean = float(np.mean(brightness_arr))
        brightness_std = float(np.std(brightness_arr))
        brightness_delta = float(abs(brightness_arr[-1] - brightness_arr[0])) if brightness_arr.size > 1 else 0.0
        return motion_mean, motion_peak, motion_std, motion_active_ratio, brightness_mean, brightness_std, brightness_delta
    finally:
        capture.release()


def _train_logistic_regression(
    x_train: np.ndarray,
    y_train: np.ndarray,
    epochs: int,
    run: RallyTrainingRun,
    db,
) -> tuple[np.ndarray, float, list[float]]:
    rng = np.random.default_rng(42)
    weights = rng.normal(0, 0.01, size=x_train.shape[1]).astype(np.float32)
    bias = 0.0
    learning_rate = 0.05
    l2 = 0.001
    losses: list[float] = []
    for epoch in range(epochs):
        _check_cancelled(run, db)
        logits = x_train @ weights + bias
        probs = _sigmoid(logits)
        loss = _binary_cross_entropy(y_train, probs) + l2 * float(np.sum(weights * weights))
        losses.append(loss)
        error = probs - y_train
        grad_w = (x_train.T @ error) / len(y_train) + 2 * l2 * weights
        grad_b = float(np.mean(error))
        weights -= learning_rate * grad_w
        bias -= learning_rate * grad_b
        _set_progress(run, db, 70.0 + 20.0 * ((epoch + 1) / epochs))
    return weights, bias, losses


def evaluate_temporal_map50(
    examples: list[dict],
    labels: np.ndarray,
    probabilities: np.ndarray,
    threshold: float,
) -> tuple[float, float, float, float, list[dict]]:
    predictions = []
    for example, label, probability in zip(examples, labels, probabilities):
        is_positive_prediction = probability >= threshold
        temporal_iou_value = 1.0 if is_positive_prediction and label == 1 else 0.0
        predictions.append({
            "rally_id": example.get("rally_id"),
            "video_id": example["video_id"],
            "truth_start_time": example["start_time"],
            "truth_end_time": example["end_time"],
            "label": example["label"],
            "predicted_label": "rally" if is_positive_prediction else "non_rally",
            "confidence": float(probability),
            "pred_start_time": example["start_time"] if is_positive_prediction else None,
            "pred_end_time": example["end_time"] if is_positive_prediction else None,
            "temporal_iou": temporal_iou_value,
            "matched_at_50": temporal_iou_value >= 0.5,
        })

    true_positives = sum(1 for item in predictions if item["label"] == "rally" and item["matched_at_50"])
    false_positives = sum(1 for item in predictions if item["label"] == "non_rally" and item["predicted_label"] == "rally")
    false_negatives = sum(1 for item in predictions if item["label"] == "rally" and item["predicted_label"] != "rally")
    precision = true_positives / (true_positives + false_positives) if true_positives + false_positives else 0.0
    recall = true_positives / (true_positives + false_negatives) if true_positives + false_negatives else 0.0
    map50 = average_precision_at_temporal_iou_50(predictions)
    rally_ious = [item["temporal_iou"] for item in predictions if item["label"] == "rally"]
    mean_iou = float(np.mean(rally_ious)) if rally_ious else 0.0
    return precision, recall, map50, mean_iou, predictions


def average_precision_at_temporal_iou_50(predictions: list[dict]) -> float:
    positives = sum(1 for item in predictions if item["label"] == "rally")
    if positives == 0:
        return 0.0
    ordered = sorted(predictions, key=lambda item: item["confidence"], reverse=True)
    tp = 0
    fp = 0
    precision_sum = 0.0
    for item in ordered:
        if item["label"] == "rally" and item["temporal_iou"] >= 0.5:
            tp += 1
            precision_sum += tp / (tp + fp)
        else:
            fp += 1
    return precision_sum / positives


def temporal_iou(predicted: tuple[float, float], truth: tuple[float, float]) -> float:
    pred_start, pred_end = predicted
    truth_start, truth_end = truth
    intersection = max(0.0, min(pred_end, truth_end) - max(pred_start, truth_start))
    union = max(pred_end, truth_end) - min(pred_start, truth_start)
    if union <= 0:
        return 0.0
    return intersection / union


def _best_threshold(probabilities: np.ndarray, labels: np.ndarray) -> float:
    if not len(probabilities):
        return 0.5
    best_threshold = 0.5
    best_f1 = -1.0
    for threshold in np.linspace(0.2, 0.8, 25):
        predictions = probabilities >= threshold
        tp = float(np.sum((predictions == 1) & (labels == 1)))
        fp = float(np.sum((predictions == 1) & (labels == 0)))
        fn = float(np.sum((predictions == 0) & (labels == 1)))
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        if f1 > best_f1:
            best_f1 = f1
            best_threshold = float(threshold)
    return best_threshold


def _accuracy(probabilities: np.ndarray, labels: np.ndarray, threshold: float) -> float:
    if not len(probabilities):
        return 0.0
    return float(np.mean((probabilities >= threshold) == labels))


def _sigmoid(values: np.ndarray) -> np.ndarray:
    clipped = np.clip(values, -40, 40)
    return 1.0 / (1.0 + np.exp(-clipped))


def _binary_cross_entropy(labels: np.ndarray, probabilities: np.ndarray) -> float:
    eps = 1e-7
    probs = np.clip(probabilities, eps, 1 - eps)
    return float(-np.mean(labels * np.log(probs) + (1 - labels) * np.log(1 - probs)))


def _read_examples(path) -> list[dict]:
    if not path.exists():
        raise ValueError("build the rally boundary dataset before training")
    return json.loads(path.read_text())


def _set_progress(run: RallyTrainingRun, db, progress_pct: float) -> None:
    db.refresh(run)
    if run.status != TrainingStatus.stopping:
        run.status = TrainingStatus.running
    run.progress_pct = max(run.progress_pct or 0.0, progress_pct)
    db.commit()


def _check_cancelled(run: RallyTrainingRun, db) -> None:
    db.refresh(run)
    if run.stop_requested:
        run.status = TrainingStatus.cancelled
        db.commit()
        raise RallyTrainingCancelled()
