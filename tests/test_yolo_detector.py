# tests/test_yolo_detector.py
import pytest
from unittest.mock import MagicMock, patch


def _make_result(conf: float):
    result = MagicMock()
    result.boxes = MagicMock()
    result.boxes.conf.tolist.return_value = [conf] if conf > 0 else []
    return result


@patch("backend.cv.yolo_detector.cv2.VideoCapture")
def test_detect_returns_rally_when_ball_detected(mock_cap_cls):
    mock_cap = MagicMock()
    mock_cap.isOpened.return_value = True
    mock_cap.get.return_value = 30.0
    mock_cap_cls.return_value = mock_cap

    mock_model = MagicMock()
    # 100 frames with ball (conf=0.9), then 100 quiet frames
    mock_model.predict.return_value = iter(
        [_make_result(0.9)] * 100 + [_make_result(0.0)] * 100
    )

    from backend.cv.yolo_detector import YoloDetector
    detector = YoloDetector.__new__(YoloDetector)
    detector.weights_path = "fake.pt"
    detector.conf_threshold = 0.25
    detector.rally_start_frames = 30
    detector.rally_end_frames = 60
    detector._model = mock_model

    segments = detector.detect("fake.mp4")

    assert len(segments) == 1
    assert segments[0].start_time == pytest.approx(0.0, abs=0.1)
    assert segments[0].confidence == pytest.approx(0.9)


@patch("backend.cv.yolo_detector.cv2.VideoCapture")
def test_detect_returns_empty_when_no_ball(mock_cap_cls):
    mock_cap = MagicMock()
    mock_cap.isOpened.return_value = True
    mock_cap.get.return_value = 30.0
    mock_cap_cls.return_value = mock_cap

    mock_model = MagicMock()
    mock_model.predict.return_value = iter([_make_result(0.0)] * 50)

    from backend.cv.yolo_detector import YoloDetector
    detector = YoloDetector.__new__(YoloDetector)
    detector.weights_path = "fake.pt"
    detector.conf_threshold = 0.25
    detector.rally_start_frames = 30
    detector.rally_end_frames = 60
    detector._model = mock_model

    segments = detector.detect("fake.mp4")

    assert segments == []


@patch("backend.cv.yolo_detector.cv2.VideoCapture")
def test_detect_raises_on_bad_video(mock_cap_cls):
    mock_cap = MagicMock()
    mock_cap.isOpened.return_value = False
    mock_cap_cls.return_value = mock_cap

    from backend.cv.yolo_detector import YoloDetector
    detector = YoloDetector.__new__(YoloDetector)
    detector.weights_path = "fake.pt"
    detector.conf_threshold = 0.25
    detector.rally_start_frames = 30
    detector.rally_end_frames = 60
    detector._model = MagicMock()

    with pytest.raises(ValueError, match="Cannot open video"):
        detector.detect("nonexistent.mp4")
