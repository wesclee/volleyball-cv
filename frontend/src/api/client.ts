// frontend/src/api/client.ts
import type {
  AnnotateBbox, Job, LabeledFrame, LabelingStatus, Match, MatchCreate, ModelVersion, ProcessedVideo, Rally, RallyCreate, RallyUpdate, ReconcileResult, TrainingRun, Video,
} from '../types'

const BASE = 'http://localhost:8000'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, init)
  if (!r.ok) {
    const text = await r.text()
    throw new Error(`${r.status} ${text}`)
  }
  if (r.status === 204) {
    return undefined as T
  }
  return r.json() as Promise<T>
}

export function getMatches(): Promise<Match[]> {
  return request('/matches')
}

export function getMatch(matchId: number): Promise<Match> {
  return request(`/matches/${matchId}`)
}

export function createMatch(data: MatchCreate): Promise<Match> {
  return request('/matches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export function getMatchVideos(matchId: number): Promise<Video[]> {
  return request(`/matches/${matchId}/videos`)
}

export function getAllVideos(status?: string): Promise<Video[]> {
  return request(`/matches/videos${status ? `?status=${status}` : ''}`)
}

export function uploadVideo(
  matchId: number,
  setNumber: number,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<Video> {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('set_number', String(setNumber))
    form.append('file', file)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE}/matches/${matchId}/videos`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total * 100)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText) as Video)
      } else {
        reject(new Error(`${xhr.status} ${xhr.responseText}`))
      }
    }
    xhr.onerror = () => reject(new Error('Network error'))
    xhr.send(form)
  })
}

export function uploadTrainingVideo(
  file: File,
  label?: string,
  onProgress?: (pct: number) => void,
): Promise<Video> {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('file', file)
    if (label) form.append('label', label)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE}/bootstrap/training-videos`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total * 100)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText) as Video)
      } else {
        reject(new Error(`${xhr.status} ${xhr.responseText}`))
      }
    }
    xhr.onerror = () => reject(new Error('Network error'))
    xhr.send(form)
  })
}

export function getTrainingVideos(): Promise<Video[]> {
  return request('/bootstrap/training-videos')
}

export function deleteTrainingVideo(videoId: number): Promise<void> {
  return request(`/bootstrap/training-videos/${videoId}`, { method: 'DELETE' })
}

export function processVideo(videoId: number): Promise<Job> {
  return request(`/videos/${videoId}/process`, { method: 'POST' })
}

export function getJob(jobId: number): Promise<Job> {
  return request(`/jobs/${jobId}`)
}

export function getRallies(videoId: number): Promise<Rally[]> {
  return request(`/videos/${videoId}/rallies`)
}

export function createRally(videoId: number, data: RallyCreate): Promise<Rally> {
  return request(`/videos/${videoId}/rallies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export function patchRally(rallyId: number, data: RallyUpdate): Promise<Rally> {
  return request(`/rallies/${rallyId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export function deleteRally(rallyId: number): Promise<void> {
  return request(`/rallies/${rallyId}`, { method: 'DELETE' })
}

export function exportMatch(matchId: number): Promise<ProcessedVideo[]> {
  return request(`/matches/${matchId}/export`, { method: 'POST' })
}

export function getLabelingStatus(): Promise<LabelingStatus> {
  return request('/labeling/status')
}

export function getLabelingQueue(): Promise<LabeledFrame[]> {
  return request('/labeling/queue')
}

export function startExtraction(
  videoId: number,
  opts: { sample_rate?: number; max_frames?: number; split_train?: number; split_val?: number; split_test?: number; whole_video?: boolean } = {}
): Promise<{ video_id: number }> {
  return request(`/bootstrap/extract/${videoId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  })
}

export function getFrames(params: { status?: string; split?: string; video_id?: number; offset?: number; limit?: number } = {}): Promise<LabeledFrame[]> {
  const qs = new URLSearchParams(
    Object.fromEntries(
      Object.entries(params)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, String(value)]),
    ),
  ).toString()
  return request(`/bootstrap/frames${qs ? '?' + qs : ''}`)
}

export function getFrameImageUrl(frameId: number): string {
  return `http://localhost:8000/bootstrap/frames/${frameId}/image`
}

export function annotateFrame(frameId: number, bbox: AnnotateBbox): Promise<LabeledFrame> {
  return request(`/bootstrap/frames/${frameId}/annotate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bbox),
  })
}

export function skipFrame(frameId: number): Promise<LabeledFrame> {
  return request(`/bootstrap/frames/${frameId}/skip`, { method: 'POST' })
}

export function startTraining(epochs = 50): Promise<{ run_id: number }> {
  return request('/training/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ epochs }),
  })
}

export function getTrainingRun(runId: number): Promise<TrainingRun> {
  return request(`/training/runs/${runId}`)
}

export function getModels(): Promise<ModelVersion[]> {
  return request('/models')
}

export function promoteModel(modelId: number): Promise<ModelVersion> {
  return request(`/models/${modelId}/promote`, { method: 'POST' })
}

export function runReconcile(): Promise<ReconcileResult> {
  return request('/admin/reconcile', { method: 'POST' })
}
