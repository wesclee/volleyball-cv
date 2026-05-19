# backend/cv/yolo_detector.py
import cv2

from backend.cv.detector import BaseDetector, RallySegment


class YoloDetector(BaseDetector):
    """
    Tier 2 rally detector using a fine-tuned YOLOv8 ball detection model.
    Ball detected (conf >= conf_threshold) maps to motion; absence maps to quiet.
    """

    def __init__(
        self,
        weights_path: str,
        conf_threshold: float = 0.25,
        rally_start_frames: int = 30,
        rally_end_frames: int = 60,
    ):
        self.weights_path = weights_path
        self.conf_threshold = conf_threshold
        self.rally_start_frames = rally_start_frames
        self.rally_end_frames = rally_end_frames
        self._model = None

    def _load(self) -> None:
        if self._model is None:
            from ultralytics import YOLO
            self._model = YOLO(self.weights_path)

    def detect_with_scores(self, video_path: str) -> tuple[list[RallySegment], list[float]]:
        self._load()
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"Cannot open video: {video_path}")
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        cap.release()

        scores: list[float] = []
        for result in self._model.predict(source=video_path, stream=True, verbose=False):
            confs = (
                [c for c in result.boxes.conf.tolist() if c >= self.conf_threshold]
                if result.boxes
                else []
            )
            scores.append(max(confs) if confs else 0.0)

        return self._segments_from_scores(scores, fps), scores

    def detect(self, video_path: str) -> list[RallySegment]:
        segments, _ = self.detect_with_scores(video_path)
        return segments

    def _segments_from_scores(self, scores: list[float], fps: float) -> list[RallySegment]:
        segments: list[RallySegment] = []
        state = "quiet"
        state_start = 0
        rally_start = 0.0
        peak_conf = 0.0

        for i, score in enumerate(scores):
            moving = score >= self.conf_threshold
            if moving:
                peak_conf = max(peak_conf, score)

            if state == "quiet" and moving:
                state = "candidate_start"
                state_start = i
                peak_conf = score

            elif state == "candidate_start":
                if not moving:
                    state = "quiet"
                    peak_conf = 0.0
                elif (i - state_start) >= self.rally_start_frames:
                    state = "rally"
                    rally_start = state_start / fps

            elif state == "rally" and not moving:
                state = "candidate_end"
                state_start = i

            elif state == "candidate_end":
                if moving:
                    state = "rally"
                    peak_conf = max(peak_conf, score)
                elif (i - state_start) >= self.rally_end_frames:
                    segments.append(RallySegment(
                        start_time=rally_start,
                        end_time=state_start / fps,
                        confidence=peak_conf,
                    ))
                    state = "quiet"
                    peak_conf = 0.0

        if state in ("rally", "candidate_end"):
            segments.append(RallySegment(
                start_time=rally_start,
                end_time=len(scores) / fps,
                confidence=peak_conf,
            ))

        return segments
