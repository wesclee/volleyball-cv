import ffmpeg

from backend.config import EXPORTS_DIR
from backend.cv.detector import RallySegment


def cut_and_join(video_path: str, segments: list[RallySegment], output_filename: str) -> str:
    """
    Cut segments from video_path and concatenate them into a single output file.
    Returns the absolute path of the output file.
    """
    if not segments:
        raise ValueError("No segments to cut")

    output_path = str(EXPORTS_DIR / output_filename)
    streams = []

    for seg in segments:
        clip = ffmpeg.input(video_path, ss=seg.start_time, to=seg.end_time)
        streams.extend([clip.video, clip.audio])

    concat = ffmpeg.concat(*streams, v=1, a=1)
    ffmpeg.output(concat, output_path).overwrite_output().run(quiet=True)

    return output_path
