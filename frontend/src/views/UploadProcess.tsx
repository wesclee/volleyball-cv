import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getJob, getMatch, processVideo, uploadVideo } from '../api/client'
import type { Match } from '../types'

type SetStatus = 'idle' | 'uploading' | 'processing' | 'done' | 'error'

interface SetState {
  setNumber: 1 | 2 | 3
  file: File | null
  status: SetStatus
  progress: number
  error: string | null
}

const INITIAL_SETS: SetState[] = [
  { setNumber: 1, file: null, status: 'idle', progress: 0, error: null },
  { setNumber: 2, file: null, status: 'idle', progress: 0, error: null },
  { setNumber: 3, file: null, status: 'idle', progress: 0, error: null },
]

export default function UploadProcess() {
  const { matchId } = useParams<{ matchId: string }>()
  const [match, setMatch] = useState<Match | null>(null)
  const [sets, setSets] = useState<SetState[]>(INITIAL_SETS)
  const timers = useRef<Record<number, ReturnType<typeof setInterval>>>({})

  useEffect(() => {
    getMatch(Number(matchId)).then(setMatch)
    return () => { Object.values(timers.current).forEach(clearInterval) }
  }, [matchId])

  function setSetField<K extends keyof SetState>(n: 1 | 2 | 3, key: K, val: SetState[K]) {
    setSets(prev => prev.map(s => s.setNumber === n ? { ...s, [key]: val } : s))
  }

  async function handleProcess(setNumber: 1 | 2 | 3) {
    const s = sets.find(s => s.setNumber === setNumber)!
    if (!s.file) return
    setSetField(setNumber, 'status', 'uploading')
    setSetField(setNumber, 'error', null)
    try {
      const video = await uploadVideo(
        Number(matchId),
        setNumber,
        s.file,
        pct => setSetField(setNumber, 'progress', pct),
      )
      setSetField(setNumber, 'progress', 0)
      setSetField(setNumber, 'status', 'processing')
      const job = await processVideo(video.id)
      const poll = setInterval(async () => {
        const updated = await getJob(job.id)
        setSetField(setNumber, 'progress', updated.progress_pct)
        if (updated.status === 'done') {
          setSetField(setNumber, 'status', 'done')
          clearInterval(timers.current[setNumber])
        } else if (updated.status === 'error') {
          setSetField(setNumber, 'status', 'error')
          setSetField(setNumber, 'error', updated.error)
          clearInterval(timers.current[setNumber])
        }
      }, 2000)
      timers.current[setNumber] = poll
    } catch (err) {
      setSetField(setNumber, 'status', 'error')
      setSetField(setNumber, 'error', String(err))
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <Link to="/" className="text-sm text-blue-600 hover:underline">← Back</Link>
      {match && (
        <h1 className="text-2xl font-bold mt-1 mb-6">
          {match.date}{match.opponent ? ` vs ${match.opponent}` : ''}
        </h1>
      )}

      <div className="space-y-4">
        {sets.map(s => (
          <div key={s.setNumber} className="border rounded-lg p-4 bg-white">
            <h2 className="font-semibold mb-3">Set {s.setNumber}</h2>
            <div className="flex gap-2 items-center flex-wrap">
              <label htmlFor={`file-${s.setNumber}`} className="sr-only">
                Set {s.setNumber}
              </label>
              <input
                id={`file-${s.setNumber}`}
                type="file"
                accept="video/*"
                aria-label={`Set ${s.setNumber}`}
                disabled={s.status !== 'idle'}
                onChange={e => setSetField(s.setNumber, 'file', e.target.files?.[0] ?? null)}
                className="text-sm"
              />
              <button
                onClick={() => handleProcess(s.setNumber)}
                disabled={!s.file || s.status !== 'idle'}
                className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm font-medium disabled:opacity-40 hover:bg-blue-700"
              >
                Upload &amp; Process
              </button>
            </div>

            {(s.status === 'uploading' || s.status === 'processing' || s.status === 'done') && (
              <div className="mt-3">
                <div className="h-2 bg-gray-200 rounded overflow-hidden">
                  <div
                    className={`h-full rounded transition-all duration-300 ${s.status === 'done' ? 'bg-green-500' : 'bg-blue-500'}`}
                    style={{ width: `${s.progress}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {s.status === 'done'
                    ? '✓ Done'
                    : s.status === 'uploading'
                    ? `Uploading… ${Math.round(s.progress)}%`
                    : `Processing… ${Math.round(s.progress)}%`}
                </p>
              </div>
            )}
            {s.status === 'error' && (
              <p className="mt-2 text-sm text-red-600">Error: {s.error ?? 'Unknown error'}</p>
            )}
          </div>
        ))}
      </div>

      <div className="mt-6">
        <Link to={`/matches/${matchId}/rally-review`} className="text-blue-600 hover:underline text-sm">
          Go to Rally Review →
        </Link>
      </div>
    </div>
  )
}
