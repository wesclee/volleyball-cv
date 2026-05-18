# backend/cv/detector.py
from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class RallySegment:
    start_time: float  # seconds from video start
    end_time: float    # seconds from video start
    confidence: float  # 0.0–1.0; Tier 1 always 1.0, Tier 2 uses model confidence


class BaseDetector(ABC):
    @abstractmethod
    def detect(self, video_path: str) -> list[RallySegment]:
        """Analyse video_path and return rally time segments."""
        ...
