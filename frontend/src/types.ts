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
  confidence: number
}

export interface RallyUpdate {
  score_home?: number | null
  score_away?: number | null
  start_time?: number
  end_time?: number
}

export interface ProcessedVideo {
  id: number
  match_id: number
  output_path: string
  created_at: string
}

export type FrameSplit = 'train' | 'val' | 'test'
export type FrameStatus = 'pending' | 'annotated' | 'skipped' | 'missing'
export type TrainingStatus = 'pending' | 'running' | 'done' | 'error'

export interface LabeledFrame {
  id: number
  video_id: number
  frame_number: number
  timestamp: number
  img_path: string
  label_path: string
  split: FrameSplit
  review_status: FrameStatus
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
  base_model_id: number | null
  new_model_id: number | null
  frames_used: number | null
  epochs: number | null
  final_loss: number | null
  duration_s: number | null
  error: string | null
  created_at: string
}

export interface BootstrapStatus {
  frames_total: number
  annotated: number
  skipped: number
  pending: number
  missing: number
  model_ready: boolean
  active_model_id: number | null
}

export interface ReconcileResult {
  missing: number
  restored: number
  reregistered: number
  malformed: number
  split_conflicts: number
  ok: number
}

export interface AnnotateBbox {
  cx: number
  cy: number
  w: number
  h: number
}
