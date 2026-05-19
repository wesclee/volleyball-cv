// frontend/src/test/api.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getMatches, createMatch, getMatchVideos, getRallies, patchRally, exportMatch, getLabelingStatus, getLabelingQueue } from '../api/client'

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
      frames_total: 10, annotated: 5, skipped: 2, pending: 3, missing: 0,
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
})
