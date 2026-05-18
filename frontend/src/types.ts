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
