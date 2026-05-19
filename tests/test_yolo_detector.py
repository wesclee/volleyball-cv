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


def test_detect_with_scores_returns_segments_and_scores(tmp_path):
    from unittest.mock import MagicMock, patch
    from backend.cv.yolo_detector import YoloDetector

    detector = YoloDetector("fake.pt", conf_threshold=0.25,
                            rally_start_frames=2, rally_end_frames=2)

    mock_result = MagicMock()
    mock_result.boxes.conf.tolist.return_value = [0.9]
    silent = MagicMock()
    silent.boxes = None

    mock_model = MagicMock()
    mock_model.predict.return_value = iter(
        [silent, silent, mock_result, mock_result, mock_result,
         silent, silent, mock_result, mock_result, mock_result]
    )

    with patch("backend.cv.yolo_detector.cv2.VideoCapture") as mock_cap_cls:
        mock_cap = MagicMock()
        mock_cap.isOpened.return_value = True
        mock_cap.get.return_value = 10.0
        mock_cap_cls.return_value = mock_cap
        detector._model = mock_model

        segments, scores = detector.detect_with_scores("fake.mp4")

    assert len(scores) == 10
    assert scores[0] == 0.0   # silent frame
    assert scores[2] == pytest.approx(0.9)  # detected frame
    assert len(segments) >= 1


def test_detect_calls_detect_with_scores(tmp_path):
    from unittest.mock import MagicMock, patch
    from backend.cv.yolo_detector import YoloDetector

    detector = YoloDetector("fake.pt")

    with patch.object(detector, "detect_with_scores", return_value=([], [0.1, 0.9])) as mock_dws:
        result = detector.detect("fake.mp4")

    mock_dws.assert_called_once_with("fake.mp4")
    assert result == []
