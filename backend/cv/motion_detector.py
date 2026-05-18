# backend/cv/motion_detector.py
import cv2
import numpy as np

from backend.cv.detector import BaseDetector, RallySegment


class MotionDetector(BaseDetector):
    """
    Tier 1 rally detector using MOG2 background subtraction.

    roi: (x, y, w, h) crop applied to each frame before analysis.
         None = full frame. Define once from the frontend after first use.
    motion_threshold: fraction of pixels that must be foreground to count as motion.
    rally_start_frames: consecutive motion frames required to declare rally start (~1s at 30fps).
    rally_end_frames: consecutive quiet frames required to declare rally end (~2s at 30fps).
    warmup_frames: frames used to learn the initial background before freezing the model.
    """

    def __init__(
        self,
        roi: tuple[int, int, int, int] | None = None,
        motion_threshold: float = 0.01,
        rally_start_frames: int = 30,
        rally_end_frames: int = 60,
        warmup_frames: int = 60,
    ):
        self.roi = roi
        self.motion_threshold = motion_threshold
        self.rally_start_frames = rally_start_frames
        self.rally_end_frames = rally_end_frames
        self.warmup_frames = warmup_frames

    def detect(self, video_path: str) -> list[RallySegment]:
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"Cannot open video: {video_path}")
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        # history=warmup_frames so MOG2 converges to a stable background model quickly
        # rather than the default ~500-frame window; after warm-up we freeze with learningRate=0
        # so sustained foreground motion stays flagged instead of being absorbed into background.
        subtractor = cv2.createBackgroundSubtractorMOG2(history=self.warmup_frames, detectShadows=False)
        scores: list[float] = []
        frame_idx = 0

        while True:
            ret, frame = cap.read()
            if not ret:
                break
            if self.roi:
                x, y, w, h = self.roi
                frame = frame[y : y + h, x : x + w]
            # Warm-up: let MOG2 learn background; freeze after warmup_frames.
            learning_rate = -1 if frame_idx < self.warmup_frames else 0
            fg = subtractor.apply(frame, learningRate=learning_rate)
            scores.append(float(np.count_nonzero(fg)) / fg.size)
            frame_idx += 1

        cap.release()
        return self._segments_from_scores(scores, fps)

    def _segments_from_scores(self, scores: list[float], fps: float) -> list[RallySegment]:
        """State machine over per-frame motion scores → rally segments."""
        segments: list[RallySegment] = []
        state = "quiet"   # quiet | candidate_start | rally | candidate_end
        state_start = 0
        rally_start = 0.0

        for i, score in enumerate(scores):
            moving = score > self.motion_threshold

            if state == "quiet" and moving:
                state = "candidate_start"
                state_start = i

            elif state == "candidate_start":
                if not moving:
                    state = "quiet"
                elif (i - state_start) >= self.rally_start_frames:
                    state = "rally"
                    rally_start = state_start / fps

            elif state == "rally" and not moving:
                state = "candidate_end"
                state_start = i

            elif state == "candidate_end":
                if moving:
                    state = "rally"  # brief pause inside a rally
                elif (i - state_start) >= self.rally_end_frames:
                    segments.append(
                        RallySegment(start_time=rally_start, end_time=state_start / fps, confidence=1.0)
                    )
                    state = "quiet"

        if state in ("rally", "candidate_end"):
            segments.append(
                RallySegment(start_time=rally_start, end_time=len(scores) / fps, confidence=1.0)
            )

        return segments
