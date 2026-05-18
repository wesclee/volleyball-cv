# tests/test_motion_detector.py
import subprocess
import tempfile
from pathlib import Path

import pytest


def make_synthetic_video(path: str, fps: float = 30.0) -> None:
    """
    Creates a 10-second video:
    - 0–2s:  static blue frame (no motion)
    - 2–7s:  moving white circle on black (motion = rally)
    - 7–10s: static blue frame (no motion)
    """
    filter_graph = (
        "color=c=blue:s=320x240:r=30:d=2[quiet1];"
        "color=c=black:s=320x240:r=30:d=5,"
        "drawbox=x='mod(t*80\\,260)':y=100:w=40:h=40:color=white:t=fill[motion];"
        "color=c=blue:s=320x240:r=30:d=3[quiet2];"
        "[quiet1][motion][quiet2]concat=n=3:v=1:a=0[v]"
    )
    subprocess.run(
        ["ffmpeg", "-y", "-filter_complex", filter_graph, "-map", "[v]",
         "-c:v", "libx264", "-an", path],
        check=True, capture_output=True,
    )


@pytest.fixture
def synthetic_video(tmp_path):
    path = str(tmp_path / "test.mp4")
    make_synthetic_video(path)
    return path


def test_detects_one_rally(synthetic_video):
    from backend.cv.motion_detector import MotionDetector
    detector = MotionDetector()
    segments = detector.detect(synthetic_video)
    assert len(segments) == 1


def test_rally_timing_approximate(synthetic_video):
    from backend.cv.motion_detector import MotionDetector
    detector = MotionDetector()
    segments = detector.detect(synthetic_video)
    seg = segments[0]
    # Rally starts around t=2s, ends around t=7s — allow 1.5s tolerance
    assert 0.5 <= seg.start_time <= 3.5
    assert 5.5 <= seg.end_time <= 8.5
    assert seg.confidence == 1.0


def test_static_video_no_rallies(tmp_path):
    path = str(tmp_path / "static.mp4")
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=blue:s=320x240:r=30:d=5",
         "-c:v", "libx264", "-an", path],
        check=True, capture_output=True,
    )
    from backend.cv.motion_detector import MotionDetector
    detector = MotionDetector()
    assert detector.detect(path) == []
