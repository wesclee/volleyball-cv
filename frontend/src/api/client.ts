// frontend/src/api/client.ts
import type { Job, Match, MatchCreate, ProcessedVideo, Rally, RallyUpdate, Video } from '../types'

const BASE = 'http://localhost:8000'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, init)
  if (!r.ok) {
    const text = await r.text()
    throw new Error(`${r.status} ${text}`)
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

export function uploadVideo(matchId: number, setNumber: number, file: File): Promise<Video> {
  const form = new FormData()
  form.append('set_number', String(setNumber))
  form.append('file', file)
  return request(`/matches/${matchId}/videos`, { method: 'POST', body: form })
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

export function patchRally(rallyId: number, data: RallyUpdate): Promise<Rally> {
  return request(`/rallies/${rallyId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export function exportMatch(matchId: number): Promise<ProcessedVideo[]> {
  return request(`/matches/${matchId}/export`, { method: 'POST' })
}
