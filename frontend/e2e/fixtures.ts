import type { Page } from '@playwright/test'

const API = 'http://localhost:8000'

export const MATCH = {
  id: 1,
  date: '2026-05-18',
  opponent: 'Rivals',
  venue: null,
  notes: null,
  created_at: '2026-05-18T10:00:00',
}

export const VIDEO = {
  id: 1,
  match_id: 1,
  set_number: 1,
  raw_path: '/data/uploads/set1.mp4',
  status: 'done',
  duration: 1200.0,
  created_at: '2026-05-18T10:00:00',
}

export const JOB = {
  id: 1,
  video_id: 1,
  status: 'done',
  progress_pct: 100.0,
  error: null,
  created_at: '2026-05-18T10:00:00',
}

export const RALLY = {
  id: 1,
  video_id: 1,
  start_time: 10.5,
  end_time: 25.3,
  score_home: null,
  score_away: null,
  confidence: 0.9,
}

export const PROCESSED_VIDEO = {
  id: 1,
  match_id: 1,
  output_path: '/data/exports/export_match1_set1_vid1.mp4',
  created_at: '2026-05-18T11:00:00',
}

export const LABELING_STATUS_NO_MODEL = {
  frames_total: 0,
  annotated: 0,
  skipped: 0,
  pending: 0,
  missing: 0,
  model_ready: false,
  active_model_id: null,
  new_labeled_since_last_train: 0,
  retrain_recommended: false,
  retrain_threshold: 50,
  last_trained_at_size: null,
}

export const LABELING_STATUS_WITH_MODEL = {
  frames_total: 300,
  annotated: 250,
  skipped: 10,
  pending: 40,
  missing: 0,
  model_ready: true,
  active_model_id: 2,
  new_labeled_since_last_train: 60,
  retrain_recommended: true,
  retrain_threshold: 50,
  last_trained_at_size: 200,
}

export const LABELED_FRAME = {
  id: 1,
  video_id: 1,
  frame_number: 300,
  timestamp: 10.0,
  img_path: '/data/frames/frame_1_300.jpg',
  label_path: '/data/dataset/labels/train/frame_1_300.txt',
  split: 'train',
  review_status: 'pending',
  pred_cx: 0.5,
  pred_cy: 0.5,
  pred_w: 0.1,
  pred_h: 0.1,
  pred_conf: 0.65,
  created_at: '2026-05-18T10:30:00',
}

export const BOOTSTRAP_FRAME = {
  ...LABELED_FRAME,
  pred_cx: null,
  pred_cy: null,
  pred_w: null,
  pred_h: null,
  pred_conf: null,
}

export const MODEL_VERSION = {
  id: 2,
  name: 'yolov8n_v2',
  weights_path: '/data/models/v2.pt',
  dataset_size: 200,
  test_precision: 0.85,
  test_recall: 0.80,
  test_map50: 0.82,
  is_active: true,
  created_at: '2026-05-18T09:00:00',
}

// Mock all API routes needed for a page.
// Each helper takes a page and optional overrides.

export async function mockMatchList(page: Page, matches = [MATCH]) {
  await page.route(`${API}/matches`, route => {
    if (route.request().method() === 'GET') {
      route.fulfill({ json: matches })
    } else {
      route.fulfill({ json: MATCH })
    }
  })
}

export async function mockMatchDetail(page: Page, match = MATCH) {
  await page.route(`${API}/matches/${match.id}`, route =>
    route.fulfill({ json: match }),
  )
}

export async function mockMatchVideos(page: Page, matchId = 1, videos = [VIDEO]) {
  await page.route(`${API}/matches/${matchId}/videos`, route =>
    route.fulfill({ json: videos }),
  )
}

export async function mockAllVideos(page: Page, videos = [VIDEO]) {
  await page.route(`${API}/matches/videos**`, route =>
    route.fulfill({ json: videos }),
  )
}

export async function mockRallies(page: Page, videoId = 1, rallies = [RALLY]) {
  await page.route(`${API}/videos/${videoId}/rallies`, route =>
    route.fulfill({ json: rallies }),
  )
}

export async function mockLabelingStatus(page: Page, status = LABELING_STATUS_NO_MODEL) {
  await page.route(`${API}/labeling/status`, route =>
    route.fulfill({ json: status }),
  )
}

export async function mockLabelingQueue(page: Page, frames = [] as typeof LABELED_FRAME[]) {
  await page.route(`${API}/labeling/queue`, route =>
    route.fulfill({ json: frames }),
  )
}

export async function mockBootstrapFrames(page: Page, frames = [] as typeof BOOTSTRAP_FRAME[]) {
  await page.route(`${API}/bootstrap/frames**`, route => {
    if (route.request().url().includes('/image')) {
      route.fulfill({ body: Buffer.alloc(0), contentType: 'image/jpeg' })
    } else {
      route.fulfill({ json: frames })
    }
  })
}

export async function mockUploadVideo(page: Page, matchId = 1) {
  await page.route(`${API}/matches/${matchId}/videos`, route => {
    if (route.request().method() === 'POST') {
      route.fulfill({ json: VIDEO })
    } else {
      route.fulfill({ json: [VIDEO] })
    }
  })
}

export async function mockProcessVideo(page: Page, videoId = 1) {
  await page.route(`${API}/videos/${videoId}/process`, route =>
    route.fulfill({ json: JOB }),
  )
  await page.route(`${API}/jobs/${JOB.id}`, route =>
    route.fulfill({ json: JOB }),
  )
}
