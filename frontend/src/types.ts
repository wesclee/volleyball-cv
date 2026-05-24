// frontend/src/types.ts

export interface Match {
  id: number
  date: string
  opponent: string | null
  venue: string | null
  notes: string | null
  created_at: string
}

export interface MatchCreate {
  date: string
  opponent?: string
  venue?: string
  notes?: string
}

export interface Video {
  id: number
  match_id: number
  set_number: number
  raw_path: string
  status: 'pending' | 'processing' | 'done' | 'error'
  duration: number | null
  created_at: string
}

export interface RallyFootage {
  match: Match
  video: Video
  rally_count: number
}

export interface RallyDataset {
  task: string
  labels: string[]
  split_ratios: Record<string, number>
  counts: Record<string, number>
  positive_rallies: number
  negative_gaps: number
  dataset_path: string
  split_source?: string | null
  built_at?: string | null
}

export interface RallyModelVersion {
  id: number
  name: string
  model_path: string
  dataset_size: number
  test_precision: number | null
  test_recall: number | null
  test_map50: number | null
  mean_temporal_iou: number | null
  is_active: boolean
  created_at: string
}

export interface RallyTrainingRun {
  id: number
  status: TrainingStatus
  progress_pct: number
  stop_requested: boolean
  new_model_id: number | null
  examples_used: number | null
  epochs: number | null
  final_loss: number | null
  duration_s: number | null
  error: string | null
  created_at: string
}

export interface RallyPrediction {
  start_time: number
  end_time: number
  confidence: number
  source_model_id: number
}

export interface RallyScanResult {
  video_id: number
  model_id: number
  model_name: string
  window_s: number
  step_s: number
  threshold: number
  windows_scanned: number
  predictions: RallyPrediction[]
}

export interface RallyScanRun {
  id: number
  video_id: number
  model_id: number
  status: 'pending' | 'running' | 'done' | 'error'
  progress_pct: number
  window_s: number
  step_s: number
  threshold: number | null
  max_predictions: number
  windows_scanned: number
  predictions: RallyPrediction[]
  error: string | null
  created_at: string
}

export interface Job {
  id: number
  video_id: number
  status: 'pending' | 'running' | 'done' | 'error'
  progress_pct: number
  error: string | null
  created_at: string
}

export interface Rally {
  id: number
  video_id: number
  start_time: number
  end_time: number
  score_home: number | null
  score_away: number | null
  split: FrameSplit | null
  confidence: number
}

export interface RallyUpdate {
  score_home?: number | null
  score_away?: number | null
  start_time?: number
  end_time?: number
}

export interface RallyCreate {
  start_time: number
  end_time: number
}

export interface ProcessedVideo {
  id: number
  match_id: number
  output_path: string
  created_at: string
}

export type FrameSplit = 'train' | 'val' | 'test'
export type FrameStatus = 'pending' | 'annotated' | 'skipped' | 'missing'
export type TrainingStatus = 'pending' | 'running' | 'stopping' | 'cancelled' | 'done' | 'error'

export interface LabeledFrame {
  id: number
  video_id: number
  frame_number: number
  timestamp: number
  img_path: string
  label_path: string
  split: FrameSplit
  review_status: FrameStatus
  pred_cx: number | null
  pred_cy: number | null
  pred_w: number | null
  pred_h: number | null
  pred_conf: number | null
  label_cx: number | null
  label_cy: number | null
  label_w: number | null
  label_h: number | null
  created_at: string
}

export interface ModelVersion {
  id: number
  name: string
  weights_path: string
  dataset_size: number
  test_precision: number | null
  test_recall: number | null
  test_map50: number | null
  is_active: boolean
  created_at: string
}

export interface TrainingRun {
  id: number
  status: TrainingStatus
  progress_pct: number
  stop_requested: boolean
  base_model_id: number | null
  new_model_id: number | null
  frames_used: number | null
  epochs: number | null
  final_loss: number | null
  duration_s: number | null
  error: string | null
  created_at: string
}

export interface LabelingStatus {
  frames_total: number
  source_videos_total: number
  source_videos_labeled: number
  annotated: number
  skipped: number
  pending: number
  missing: number
  model_ready: boolean
  active_model_id: number | null
  new_labeled_since_last_train: number
  retrain_recommended: boolean
  retrain_threshold: number
  last_trained_at_size: number | null
}

export interface ReconcileResult {
  missing: number
  restored: number
  reregistered: number
  malformed: number
  ok: number
}

export interface AnnotateBbox {
  cx: number
  cy: number
  w: number
  h: number
}
