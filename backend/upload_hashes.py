import hashlib
from pathlib import Path

from fastapi import UploadFile
from sqlalchemy.orm import Session

from backend.models.match import Match, Video


def hash_upload(file: UploadFile) -> str:
    digest = hashlib.sha256()
    while chunk := file.file.read(1024 * 1024):
        digest.update(chunk)
    file.file.seek(0)
    return digest.hexdigest()


def hash_file(path: str) -> str | None:
    raw_path = Path(path)
    if not raw_path.exists() or not raw_path.is_file():
        return None

    digest = hashlib.sha256()
    with raw_path.open("rb") as f:
        while chunk := f.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def backfill_video_hashes(db: Session, match_note: str) -> None:
    videos = (
        db.query(Video)
        .join(Match)
        .filter(Match.notes == match_note, Video.content_hash.is_(None))
        .all()
    )
    changed = False
    for video in videos:
        content_hash = hash_file(video.raw_path)
        if content_hash:
            video.content_hash = content_hash
            changed = True
    if changed:
        db.commit()


def find_duplicate_video(db: Session, content_hash: str, match_note: str) -> Video | None:
    return (
        db.query(Video)
        .join(Match)
        .filter(Match.notes == match_note, Video.content_hash == content_hash)
        .order_by(Video.created_at.asc())
        .first()
    )
