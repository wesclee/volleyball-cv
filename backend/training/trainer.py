# backend/training/trainer.py
import shutil
import time
import traceback
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.config import DATASET_DIR, MODELS_DIR
from backend.models.match import FrameStatus, FrameSplit, LabeledFrame, ModelVersion, TrainingRun, TrainingStatus
from backend.training.reconciler import reconcile


def run_training(run_id: int, epochs: int, db_url: str) -> None:
    engine = create_engine(db_url, connect_args={"check_same_thread": False})
    try:
        with sessionmaker(bind=engine)() as db:
            run = db.get(TrainingRun, run_id)
            if not run:
                return
            run.status = TrainingStatus.running
            db.commit()
            try:
                _do_train(run, epochs, db)
                run.status = TrainingStatus.done
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

    for split in ("train", "val", "test"):
        (DATASET_DIR / "images" / split).mkdir(parents=True, exist_ok=True)
        (DATASET_DIR / "labels" / split).mkdir(parents=True, exist_ok=True)

    frames = db.query(LabeledFrame).filter(
        LabeledFrame.review_status.in_([FrameStatus.annotated, FrameStatus.skipped])
    ).all()

    frames_used = 0
    for frame in frames:
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

    run.frames_used = frames_used
    db.commit()

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
    results = model.train(
        data=str(yaml_path),
        epochs=epochs,
        imgsz=640,
        device=0,
        project=str(MODELS_DIR),
        name=f"run_{run.id}",
        exist_ok=True,
    )

    best_weights = MODELS_DIR / f"run_{run.id}" / "weights" / "best.pt"
    eval_model = YOLO(str(best_weights))
    metrics = eval_model.val(data=str(yaml_path), split="test", verbose=False)

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
