// frontend/src/views/RallyReview.tsx
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getMatch, getMatchVideos, getRallies, patchRally } from '../api/client'
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
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const id = Number(matchId)
    getMatch(id).then(setMatch)
    getMatchVideos(id).then(async videos => {
      const withRallies = await Promise.all(
        videos.map(async video => ({ video, rallies: await getRallies(video.id) })),
      )
      setSets(withRallies)
    })
  }, [matchId])

  function selectRally(videoId: number, rally: Rally) {
    setActiveRally({ videoId, rallyId: rally.id })
    if (videoRef.current) {
      videoRef.current.currentTime = rally.start_time
    }
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

  async function handleTimestampBlur(rally: Rally, field: 'start_time' | 'end_time', value: string) {
    const num = parseFloat(value)
    if (isNaN(num) || num === rally[field]) return
    updateLocalRally(rally.id, { [field]: num })
    await patchRally(rally.id, { [field]: num })
  }

  const activeVideo = sets.find(s => s.video.id === activeRally?.videoId)?.video ?? sets[0]?.video

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <Link to="/" className="text-sm text-blue-600 hover:underline">← Back</Link>
      {match && (
        <h1 className="text-2xl font-bold mt-1 mb-4">
          {match.date}{match.opponent ? ` vs ${match.opponent}` : ''}
        </h1>
      )}

      {activeVideo && (
        <div className="mb-6">
          <video
            ref={videoRef}
            src={`${BACKEND}/uploads/${activeVideo.raw_path.split('/').pop()}`}
            controls
            className="w-full max-h-64 bg-black rounded"
          />
        </div>
      )}

      {sets.map(({ video, rallies }) => (
        <div key={video.id} className="mb-6">
          <h2 className="font-semibold text-lg mb-2">Set {video.set_number}</h2>
          {rallies.length === 0 ? (
            <p className="text-gray-500 text-sm">No rallies detected yet. Process the video first.</p>
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
                      <div className="flex items-center gap-1 text-sm text-gray-600">
                        <input
                          type="number"
                          step="0.1"
                          defaultValue={r.start_time}
                          onBlur={e => handleTimestampBlur(r, 'start_time', e.target.value)}
                          onClick={e => e.stopPropagation()}
                          className="w-20 border rounded px-1 py-0.5 text-xs"
                          aria-label="start time"
                        />
                        <span>–</span>
                        <input
                          type="number"
                          step="0.1"
                          defaultValue={r.end_time}
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
