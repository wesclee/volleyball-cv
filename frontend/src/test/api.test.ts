// frontend/src/test/api.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getMatches, createMatch, getMatchVideos, getRallies, createRally, patchRally, deleteRally,
  exportMatch, getLabelingStatus, getLabelingQueue, getFrames, getTrainingVideos, deleteTrainingVideo,
  uploadVideo,
} from '../api/client'

describe('API client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function mockFetch(data: unknown, status = 200) {
    vi.mocked(fetch).mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(data),
      text: () => Promise.resolve(String(data)),
    } as Response)
  }

  it('getMatches — calls GET /matches', async () => {
    mockFetch([{ id: 1, date: '2026-05-18' }])
    const result = await getMatches()
    expect(fetch).toHaveBeenCalledWith('http://localhost:8000/matches', undefined)
    expect(result).toHaveLength(1)
  })

  it('createMatch — calls POST /matches with JSON body', async () => {
    mockFetch({ id: 2, date: '2026-05-18' })
    await createMatch({ date: '2026-05-18', opponent: 'Team A' })
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8000/matches',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: '2026-05-18', opponent: 'Team A' }),
      }),
    )
  })

  it('getMatchVideos — calls GET /matches/{id}/videos', async () => {
    mockFetch([])
    await getMatchVideos(3)
    expect(fetch).toHaveBeenCalledWith('http://localhost:8000/matches/3/videos', undefined)
  })

  it('getRallies — calls GET /videos/{id}/rallies', async () => {
    mockFetch([])
    await getRallies(5)
    expect(fetch).toHaveBeenCalledWith('http://localhost:8000/videos/5/rallies', undefined)
  })

  it('patchRally — calls PATCH /rallies/{id} with JSON body', async () => {
    mockFetch({ id: 1, score_home: 5 })
    await patchRally(1, { score_home: 5, score_away: 3 })
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8000/rallies/1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ score_home: 5, score_away: 3 }),
      }),
    )
  })

  it('createRally — calls POST /videos/{id}/rallies with JSON body', async () => {
    mockFetch({ id: 1, video_id: 5, start_time: 10, end_time: 20 })
    await createRally(5, { start_time: 10, end_time: 20 })
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8000/videos/5/rallies',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ start_time: 10, end_time: 20 }),
      }),
    )
  })

  it('deleteRally — calls DELETE /rallies/{id}', async () => {
    mockFetch('', 204)
    await deleteRally(1)
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8000/rallies/1',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('throws on non-ok response', async () => {
    mockFetch('Not Found', 404)
    await expect(getMatchVideos(999)).rejects.toThrow('404')
  })

  it('exportMatch — calls POST /matches/{id}/export', async () => {
    mockFetch([])
    await exportMatch(1)
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8000/matches/1/export',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('getLabelingStatus — calls GET /labeling/status', async () => {
    const mockStatus = {
      frames_total: 10, source_videos_total: 2, source_videos_labeled: 1,
      annotated: 5, skipped: 2, pending: 3, missing: 0,
      model_ready: false, active_model_id: null,
      new_labeled_since_last_train: 0, retrain_recommended: false,
      retrain_threshold: 50, last_trained_at_size: null,
    }
    mockFetch(mockStatus)
    const result = await getLabelingStatus()
    expect(fetch).toHaveBeenCalledWith('http://localhost:8000/labeling/status', undefined)
    expect(result.retrain_threshold).toBe(50)
  })

  it('getLabelingQueue — calls GET /labeling/queue', async () => {
    mockFetch([])
    await getLabelingQueue()
    expect(fetch).toHaveBeenCalledWith('http://localhost:8000/labeling/queue', undefined)
  })

  it('getFrames — includes pagination params', async () => {
    mockFetch([])
    await getFrames({ offset: 20, limit: 20 })
    expect(fetch).toHaveBeenCalledWith('http://localhost:8000/bootstrap/frames?offset=20&limit=20', undefined)
  })

  it('getTrainingVideos — calls GET /bootstrap/training-videos', async () => {
    mockFetch([])
    await getTrainingVideos()
    expect(fetch).toHaveBeenCalledWith('http://localhost:8000/bootstrap/training-videos', undefined)
  })

  it('deleteTrainingVideo — calls DELETE /bootstrap/training-videos/{id}', async () => {
    mockFetch('', 204)
    await deleteTrainingVideo(9)
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8000/bootstrap/training-videos/9',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  describe('uploadVideo', () => {
    const mockVideo = {
      id: 10, match_id: 1, set_number: 1, raw_path: '/x.mp4',
      status: 'pending', duration: null, created_at: '',
    }

    let mockXhr: {
      open: ReturnType<typeof vi.fn>
      send: ReturnType<typeof vi.fn>
      upload: { onprogress?: (e: Partial<ProgressEvent>) => void }
      onload?: () => void
      onerror?: () => void
      status: number
      responseText: string
    }

    beforeEach(() => {
      mockXhr = {
        open: vi.fn(),
        send: vi.fn(),
        upload: {},
        status: 200,
        responseText: JSON.stringify(mockVideo),
      }
      vi.stubGlobal('XMLHttpRequest', function (this: unknown) { return mockXhr })
    })

    it('sends POST to /matches/{id}/videos and resolves with video', async () => {
      const promise = uploadVideo(1, 1, new File([''], 'test.mp4'))
      mockXhr.onload?.()
      const result = await promise
      expect(mockXhr.open).toHaveBeenCalledWith('POST', 'http://localhost:8000/matches/1/videos')
      expect(mockXhr.send).toHaveBeenCalled()
      expect(result.id).toBe(10)
    })

    it('calls onProgress with correct percentage during upload', async () => {
      const onProgress = vi.fn()
      const promise = uploadVideo(1, 1, new File([''], 'test.mp4'), onProgress)
      mockXhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 } as ProgressEvent)
      mockXhr.onload?.()
      await promise
      expect(onProgress).toHaveBeenCalledWith(50)
    })

    it('rejects on non-2xx status', async () => {
      mockXhr.status = 422
      mockXhr.responseText = 'Unprocessable Entity'
      const promise = uploadVideo(1, 1, new File([''], 'test.mp4'))
      mockXhr.onload?.()
      await expect(promise).rejects.toThrow('422')
    })
  })
})
