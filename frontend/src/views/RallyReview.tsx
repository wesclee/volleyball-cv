// frontend/src/views/RallyReview.tsx
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { createRally, deleteRally, getMatch, getMatchVideos, getRallies, patchRally } from '../api/client'
import type { Match, Rally, Video } from '../types'

const BACKEND = 'http://localhost:8000'

interface VideoWithRallies {
  video: Video
  rallies: Rally[]
}

export default function RallyReview() {
  const { matchId } = useParams<{ matchId: string }>()
  const [match, setMatch] = useState<Match | null>(null)
  const [sets, setSets] = useState<VideoWithRallies[]>([])
  const [activeRally, setActiveRally] = useState<{ videoId: number; rallyId: number } | null>(null)
  const [activeVideoId, setActiveVideoId] = useState<number | null>(null)
  const [draftStart, setDraftStart] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [previewingRallyId, setPreviewingRallyId] = useState<number | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const id = Number(matchId)
    getMatch(id).then(setMatch)
    getMatchVideos(id).then(async videos => {
      const withRallies = await Promise.all(
        videos.map(async video => ({ video, rallies: await getRallies(video.id) })),
      )
      setSets(withRallies)
      setActiveVideoId(withRallies[0]?.video.id ?? null)
    })
  }, [matchId])

  function selectRally(videoId: number, rally: Rally) {
    setActiveVideoId(videoId)
    setActiveRally({ videoId, rallyId: rally.id })
    setPreviewingRallyId(null)
    if (videoRef.current) {
      videoRef.current.currentTime = rally.start_time
    }
  }

  function selectVideo(videoId: number) {
    setActiveVideoId(videoId)
    setActiveRally(null)
    setDraftStart(null)
    setPreviewingRallyId(null)
  }

  function updateLocalRally(rallyId: number, patch: Partial<Rally>) {
    setSets(prev => prev.map(s => ({
      ...s,
      rallies: s.rallies.map(r => r.id === rallyId ? { ...r, ...patch } : r),
    })))
  }

  async function scoreHome(rally: Rally) {
    const next = (rally.score_home ?? 0) + 1
    updateLocalRally(rally.id, { score_home: next })
    await patchRally(rally.id, { score_home: next })
  }

  async function scoreAway(rally: Rally) {
    const next = (rally.score_away ?? 0) + 1
    updateLocalRally(rally.id, { score_away: next })
    await patchRally(rally.id, { score_away: next })
  }

  function handleTimestampPreview(field: 'start_time' | 'end_time', value: string) {
    const num = parseFloat(value)
    if (isNaN(num) || !videoRef.current) return
    videoRef.current.currentTime = Math.max(0, num)
    if (field === 'start_time') {
      videoRef.current.pause()
      setPreviewingRallyId(null)
    }
  }

  async function handleTimestampBlur(rally: Rally, field: 'start_time' | 'end_time', value: string) {
    const num = parseFloat(value)
    if (isNaN(num) || num === rally[field]) return
    setError(null)
    try {
      const updated = await patchRally(rally.id, { [field]: num })
      updateLocalRally(rally.id, updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update rally time.')
    }
  }

  function currentTime() {
    return Number((videoRef.current?.currentTime ?? 0).toFixed(2))
  }

  function markStart() {
    setDraftStart(currentTime())
    setPreviewingRallyId(null)
    setError(null)
  }

  async function markEnd() {
    if (activeVideoId == null || draftStart == null) return
    const endTime = currentTime()
    if (endTime <= draftStart) {
      setError('End must be after start.')
      return
    }
    try {
      const rally = await createRally(activeVideoId, { start_time: draftStart, end_time: endTime })
      setSets(prev => prev.map(s => (
        s.video.id === activeVideoId
          ? { ...s, rallies: [...s.rallies, rally].sort((a, b) => a.start_time - b.start_time) }
          : s
      )))
      setActiveRally({ videoId: activeVideoId, rallyId: rally.id })
      if (videoRef.current) {
        videoRef.current.currentTime = rally.start_time
      }
      setDraftStart(null)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create rally.')
    }
  }

  async function removeRally(rally: Rally) {
    await deleteRally(rally.id)
    setSets(prev => prev.map(s => ({
      ...s,
      rallies: s.rallies.filter(r => r.id !== rally.id),
    })))
    if (activeRally?.rallyId === rally.id) {
      setActiveRally(null)
    }
  }

  function seek(deltaSeconds: number) {
    if (!videoRef.current) return
    videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime + deltaSeconds)
  }

  const activeRallyData = sets
    .find(s => s.video.id === activeRally?.videoId)
    ?.rallies.find(r => r.id === activeRally?.rallyId)

  async function playSelectedRally(rally = activeRallyData) {
    if (!videoRef.current || !rally) return
    setPreviewingRallyId(rally.id)
    videoRef.current.currentTime = rally.start_time
    await videoRef.current.play()
  }

  function stopPreview() {
    setPreviewingRallyId(null)
    videoRef.current?.pause()
  }

  useEffect(() => {
    const video = videoRef.current
    if (!video || !activeRallyData || previewingRallyId !== activeRallyData.id) return
    const previewVideo = video
    function onTimeUpdate() {
      if (previewVideo.currentTime >= activeRallyData!.end_time) {
        previewVideo.pause()
        previewVideo.currentTime = activeRallyData!.end_time
        setPreviewingRallyId(null)
      }
    }
    previewVideo.addEventListener('timeupdate', onTimeUpdate)
    return () => previewVideo.removeEventListener('timeupdate', onTimeUpdate)
  }, [activeRallyData, previewingRallyId])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return
      if (e.key.toLowerCase() === 's') markStart()
      if (e.key.toLowerCase() === 'e') void markEnd()
      if (e.key === 'ArrowLeft') seek(e.shiftKey ? -5 : -0.5)
      if (e.key === 'ArrowRight') seek(e.shiftKey ? 5 : 0.5)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const activeVideo = sets.find(s => s.video.id === activeVideoId)?.video ?? sets[0]?.video

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Link to="/" className="text-sm text-blue-600 hover:underline">← Back</Link>
      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600 mt-3">Rally labels</p>
      {match && (
        <h1 className="text-2xl font-bold mt-1 mb-4">
          {match.date}{match.opponent ? ` vs ${match.opponent}` : ''}
        </h1>
      )}

      {activeVideo && (
        <div className="mb-6">
          <div className={`rounded border-4 overflow-hidden ${
            activeRallyData ? 'border-purple-500' : 'border-gray-300'
          }`}>
          <video
            ref={videoRef}
            src={`${BACKEND}/uploads/${activeVideo.raw_path.split('/').pop()}`}
            controls
            className="w-full max-h-96 bg-black block"
          />
          </div>
          <div className={`mt-2 inline-flex rounded px-3 py-1 text-xs font-medium ${
            activeRallyData ? 'bg-purple-50 text-purple-700' : 'bg-gray-100 text-gray-600'
          }`}>
            {activeRallyData
              ? `Rally selected: ${activeRallyData.start_time.toFixed(2)}s-${activeRallyData.end_time.toFixed(2)}s`
              : 'Full video'}
          </div>
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <button onClick={() => seek(-5)} className="border rounded px-3 py-1 text-sm">-5s</button>
            <button onClick={() => seek(-0.5)} className="border rounded px-3 py-1 text-sm">-0.5s</button>
            <button onClick={markStart} className="bg-blue-600 hover:bg-blue-700 text-white rounded px-4 py-1.5 text-sm font-medium">
              Mark Start{draftStart != null ? ` (${draftStart.toFixed(2)}s)` : ''}
            </button>
            <button
              onClick={() => void markEnd()}
              disabled={draftStart == null}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded px-4 py-1.5 text-sm font-medium"
            >
              Mark End
            </button>
            <button onClick={() => seek(0.5)} className="border rounded px-3 py-1 text-sm">+0.5s</button>
            <button onClick={() => seek(5)} className="border rounded px-3 py-1 text-sm">+5s</button>
            {activeRallyData && (
              <>
                <button onClick={() => void playSelectedRally()} className="bg-purple-600 hover:bg-purple-700 text-white rounded px-4 py-1.5 text-sm font-medium">
                  Play Rally
                </button>
                {previewingRallyId === activeRallyData.id && (
                  <button onClick={stopPreview} className="border rounded px-3 py-1 text-sm">
                    Stop
                  </button>
                )}
              </>
            )}
            {error && <span className="text-sm text-red-600">{error}</span>}
          </div>
        </div>
      )}

      {sets.map(({ video, rallies }) => (
        <div key={video.id} className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <h2 className="font-semibold text-lg">Set {video.set_number}</h2>
            <button
              onClick={() => selectVideo(video.id)}
              className={`text-xs rounded px-3 py-1 border ${activeVideo?.id === video.id ? 'bg-blue-50 border-blue-400 text-blue-700' : 'bg-white hover:border-blue-300'}`}
            >
              Label This Set
            </button>
          </div>
          {rallies.length === 0 ? (
            <p className="text-gray-500 text-sm">No rallies labelled yet.</p>
          ) : (
            <ul className="space-y-2">
              {rallies.map(r => {
                const isActive = activeRally?.rallyId === r.id
                return (
                  <li
                    key={r.id}
                    className={`border rounded-lg p-3 bg-white cursor-pointer ${isActive ? 'ring-2 ring-blue-500' : 'hover:border-blue-300'}`}
                    onClick={() => selectRally(video.id, r)}
                  >
                    <div className="flex items-center gap-3 flex-wrap">
                      <button
                        onClick={e => { e.stopPropagation(); selectRally(video.id, r); void playSelectedRally(r) }}
                        className="bg-purple-600 hover:bg-purple-700 text-white px-3 py-1 rounded text-xs font-medium"
                        aria-label={`play rally ${r.id}`}
                      >
                        Play
                      </button>
                      <div className="flex items-center gap-1 text-sm text-gray-600">
                        <input
                          type="number"
                          step="0.5"
                          defaultValue={r.start_time}
                          onChange={e => handleTimestampPreview('start_time', e.target.value)}
                          onBlur={e => handleTimestampBlur(r, 'start_time', e.target.value)}
                          onClick={e => e.stopPropagation()}
                          className="w-20 border rounded px-1 py-0.5 text-xs"
                          aria-label="start time"
                        />
                        <span>–</span>
                        <input
                          type="number"
                          step="0.5"
                          defaultValue={r.end_time}
                          onChange={e => handleTimestampPreview('end_time', e.target.value)}
                          onBlur={e => handleTimestampBlur(r, 'end_time', e.target.value)}
                          onClick={e => e.stopPropagation()}
                          className="w-20 border rounded px-1 py-0.5 text-xs"
                          aria-label="end time"
                        />
                        <span className="ml-1 text-gray-400">s</span>
                      </div>
                      <div className="flex gap-2 ml-auto">
                        <button
                          onClick={e => { e.stopPropagation(); scoreHome(r) }}
                          className="bg-green-100 hover:bg-green-200 text-green-800 px-3 py-1 rounded text-xs font-medium"
                        >
                          Home Scored {r.score_home != null ? `(${r.score_home})` : ''}
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); scoreAway(r) }}
                          className="bg-orange-100 hover:bg-orange-200 text-orange-800 px-3 py-1 rounded text-xs font-medium"
                        >
                          Away Scored {r.score_away != null ? `(${r.score_away})` : ''}
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); void removeRally(r) }}
                          className="bg-red-50 hover:bg-red-100 text-red-700 px-3 py-1 rounded text-xs font-medium"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ))}

      <div className="mt-4">
        <Link to={`/matches/${matchId}/export`} className="text-blue-600 hover:underline text-sm">
          Go to Export →
        </Link>
      </div>
    </div>
  )
}
