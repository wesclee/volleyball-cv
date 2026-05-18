import subprocess
from pathlib import Path

import pytest


def make_video_with_audio(path: str, duration: float = 10.0) -> None:
    subprocess.run(
        ["ffmpeg", "-y",
         "-f", "lavfi", "-i", f"color=c=blue:s=320x240:r=30:d={duration}",
         "-f", "lavfi", "-i", f"anullsrc=r=44100:cl=stereo",
         "-t", str(duration), "-c:v", "libx264", "-c:a", "aac",
         path],
        check=True, capture_output=True,
    )


def get_duration(path: str) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", path],
        capture_output=True, text=True, check=True,
    )
    return float(result.stdout.strip())


@pytest.fixture
def source_video(tmp_path):
    p = str(tmp_path / "source.mp4")
    make_video_with_audio(p, duration=10.0)
    return p


def test_cut_single_segment(source_video, tmp_path, monkeypatch):
    monkeypatch.setattr("backend.editor.ffmpeg_editor.EXPORTS_DIR", tmp_path)

    from backend.cv.detector import RallySegment
    from backend.editor.ffmpeg_editor import cut_and_join

    segments = [RallySegment(start_time=2.0, end_time=5.0, confidence=1.0)]
    out = cut_and_join(source_video, segments, "test_out.mp4")

    assert Path(out).exists()
    assert get_duration(out) == pytest.approx(3.0, abs=0.5)


def test_cut_multiple_segments(source_video, tmp_path, monkeypatch):
    monkeypatch.setattr("backend.editor.ffmpeg_editor.EXPORTS_DIR", tmp_path)

    from backend.cv.detector import RallySegment
    from backend.editor.ffmpeg_editor import cut_and_join

    segments = [
        RallySegment(start_time=1.0, end_time=3.0, confidence=1.0),
        RallySegment(start_time=6.0, end_time=8.0, confidence=1.0),
    ]
    out = cut_and_join(source_video, segments, "test_multi.mp4")

    assert Path(out).exists()
    assert get_duration(out) == pytest.approx(4.0, abs=0.5)


def test_no_segments_raises(source_video, tmp_path, monkeypatch):
    monkeypatch.setattr("backend.editor.ffmpeg_editor.EXPORTS_DIR", tmp_path)

    from backend.editor.ffmpeg_editor import cut_and_join

    with pytest.raises(ValueError, match="No segments"):
        cut_and_join(source_video, [], "empty.mp4")
