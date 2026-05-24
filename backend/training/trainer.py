# backend/training/trainer.py
import os
import shutil
import time
import traceback
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.config import DATASET_DIR, MODELS_DIR
from backend.models.match import FrameStatus, FrameSplit, LabeledFrame, ModelVersion, TrainingRun, TrainingStatus
from backend.training.reconciler import reconcile


class TrainingCancelled(Exception):
    pass


def run_training(run_id: int, epochs: int, db_url: str) -> None:
    engine = create_engine(db_url, connect_args={"check_same_thread": False})
    try:
        with sessionmaker(bind=engine)() as db:
            run = db.get(TrainingRun, run_id)
            if not run:
                return
            run.status = TrainingStatus.running
            run.progress_pct = 1.0
            db.commit()
            try:
                _do_train(run, epochs, db)
                if run.stop_requested:
                    run.status = TrainingStatus.cancelled
                    run.progress_pct = min(run.progress_pct or 0.0, 99.0)
                else:
                    run.status = TrainingStatus.done
                    run.progress_pct = 100.0
            except TrainingCancelled:
                run.status = TrainingStatus.cancelled
            except Exception:
                run.status = TrainingStatus.error
                run.error = traceback.format_exc()[:2000]
            db.commit()
    finally:
        engine.dispose()


def _do_train(run: TrainingRun, epochs: int, db) -> None:
    from ultralytics import YOLO
    import datetime

    reconcile(db)
    _check_cancelled(run, db)
    _set_progress(run, db, 5.0)

    for split in ("train", "val", "test"):
        (DATASET_DIR / "images" / split).mkdir(parents=True, exist_ok=True)
        (DATASET_DIR / "labels" / split).mkdir(parents=True, exist_ok=True)

    frames = db.query(LabeledFrame).filter(
        LabeledFrame.review_status.in_([FrameStatus.annotated, FrameStatus.skipped])
    ).all()

    frames_used = 0
    for index, frame in enumerate(frames):
        _check_cancelled(run, db)
        img_src = Path(frame.img_path)
        if not img_src.exists():
            continue
        split_val = frame.split.value
        img_dst = DATASET_DIR / "images" / split_val / img_src.name
        if img_src.resolve() != img_dst.resolve():
            shutil.copy2(img_src, img_dst)
        label_src = Path(frame.label_path)
        label_dst = DATASET_DIR / "labels" / split_val / label_src.name
        if label_src.exists():
            if label_src.resolve() != label_dst.resolve():
                shutil.copy2(label_src, label_dst)
        else:
            label_dst.write_text("")
        if frame.split == FrameSplit.train:
            frames_used += 1
        if frames and index % 25 == 0:
            _set_progress(run, db, 5.0 + 15.0 * ((index + 1) / len(frames)))

    run.frames_used = frames_used
    run.progress_pct = 20.0
    db.commit()
    _check_cancelled(run, db)

    yaml_path = DATASET_DIR / "data.yaml"
    yaml_path.write_text(
        f"path: {DATASET_DIR}\n"
        "train: images/train\n"
        "val: images/val\n"
        "test: images/test\n"
        "nc: 1\n"
        "names: [ball]\n"
    )

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    t_start = time.time()
    model = YOLO("yolov8n.pt")

    def on_train_epoch_end(trainer):
        epoch_index = getattr(trainer, "epoch", 0) + 1
        _set_progress(run, db, min(90.0, 20.0 + 70.0 * (epoch_index / max(epochs, 1))))
        _check_cancelled(run, db)

    model.add_callback("on_train_epoch_end", on_train_epoch_end)
    results = model.train(
        data=str(yaml_path),
        epochs=epochs,
        imgsz=640,
        device=os.getenv("YOLO_DEVICE", "cpu"),
        project=str(MODELS_DIR),
        name=f"run_{run.id}",
        exist_ok=True,
    )
    _check_cancelled(run, db)
    _set_progress(run, db, 92.0)

    best_weights = MODELS_DIR / f"run_{run.id}" / "weights" / "best.pt"
    eval_model = YOLO(str(best_weights))
    metrics = eval_model.val(data=str(yaml_path), split="test", verbose=False)
    _check_cancelled(run, db)
    _set_progress(run, db, 97.0)

    run.epochs = epochs
    run.final_loss = float(results.results_dict.get("train/box_loss", 0.0))
    run.duration_s = time.time() - t_start

    mv = ModelVersion(
        name=f"v{run.id}-{datetime.date.today()}",
        weights_path=str(best_weights),
        dataset_size=frames_used,
        test_precision=float(metrics.box.mp),
        test_recall=float(metrics.box.mr),
        test_map50=float(metrics.box.map50),
        is_active=False,
    )
    db.add(mv)
    db.flush()
    run.new_model_id = mv.id
    db.commit()


def _set_progress(run: TrainingRun, db, progress_pct: float) -> None:
    db.refresh(run)
    if run.status != TrainingStatus.stopping:
        run.status = TrainingStatus.running
    run.progress_pct = max(run.progress_pct or 0.0, progress_pct)
    db.commit()


def _check_cancelled(run: TrainingRun, db) -> None:
    db.refresh(run)
    if run.stop_requested:
        run.status = TrainingStatus.cancelled
        db.commit()
        raise TrainingCancelled()
