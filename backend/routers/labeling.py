# backend/routers/labeling.py
from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.config import RETRAIN_THRESHOLD
from backend.database import get_db
from backend.models.match import FrameStatus, LabeledFrame, ModelVersion
from backend.schemas.match import LabeledFrameRead, LabelingStatus

router = APIRouter()
MIN_FRAMES = 200


@router.get("/labeling/status", response_model=LabelingStatus)
def labeling_status(db: Session = Depends(get_db)):
    counts = dict(
        db.query(LabeledFrame.review_status, func.count(LabeledFrame.id))
        .group_by(LabeledFrame.review_status)
        .all()
    )
    annotated = counts.get(FrameStatus.annotated, 0)
    skipped = counts.get(FrameStatus.skipped, 0)
    pending = counts.get(FrameStatus.pending, 0)
    missing = counts.get(FrameStatus.missing, 0)

    active = db.query(ModelVersion).filter_by(is_active=True).first()
    last_model = db.query(ModelVersion).order_by(ModelVersion.created_at.desc()).first()

    new_labeled = 0
    last_trained_at_size = None
    if last_model:
        last_trained_at_size = last_model.dataset_size
        new_labeled = (
            db.query(LabeledFrame)
            .filter(
                LabeledFrame.review_status.in_([FrameStatus.annotated, FrameStatus.skipped]),
                LabeledFrame.created_at > last_model.created_at,
            )
            .count()
        )

    return LabelingStatus(
        frames_total=annotated + skipped + pending + missing,
        annotated=annotated,
        skipped=skipped,
        pending=pending,
        missing=missing,
        model_ready=annotated >= MIN_FRAMES,
        active_model_id=active.id if active else None,
        new_labeled_since_last_train=new_labeled,
        retrain_recommended=new_labeled >= RETRAIN_THRESHOLD,
        retrain_threshold=RETRAIN_THRESHOLD,
        last_trained_at_size=last_trained_at_size,
    )


@router.get("/labeling/queue", response_model=list[LabeledFrameRead])
def labeling_queue(db: Session = Depends(get_db)):
    return (
        db.query(LabeledFrame)
        .filter(
            LabeledFrame.review_status == FrameStatus.pending,
            LabeledFrame.pred_conf.isnot(None),
        )
        .order_by(LabeledFrame.pred_conf.asc())
        .all()
    )
