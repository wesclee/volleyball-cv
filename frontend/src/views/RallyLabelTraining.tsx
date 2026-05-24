import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createMatch, getMatches } from '../api/client'
import type { Match, MatchCreate } from '../types'

export default function RallyLabelTraining() {
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(true)
  const [date, setDate] = useState('')
  const [label, setLabel] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    getMatches()
      .then(setMatches)
      .catch(err => setError(String(err)))
      .finally(() => setLoading(false))
  }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setError(null)
    try {
      const body: MatchCreate = {
        date,
        notes: 'Rally boundary training footage.',
      }
      if (label.trim()) body.opponent = label.trim()
      const match = await createMatch(body)
      navigate(`/matches/${match.id}/upload`)
    } catch (err) {
      setError(String(err))
    } finally {
      setCreating(false)
    }
  }

  if (loading) return <p className="p-6 text-gray-500">Loading...</p>

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">Rally labels</p>
      <h1 className="text-2xl font-bold mt-1 mb-6">Rally Boundary Training</h1>

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      <form onSubmit={handleCreate} className="mb-8 flex flex-wrap gap-2 items-end">
        <div className="flex flex-col gap-1">
          <label htmlFor="rally-date" className="text-xs text-gray-600 font-medium">Date</label>
          <input
            id="rally-date"
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            required
            className="border rounded px-3 py-1.5 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="rally-label" className="text-xs text-gray-600 font-medium">Footage label</label>
          <input
            id="rally-label"
            type="text"
            placeholder="camera angle, venue, team"
            value={label}
            onChange={e => setLabel(e.target.value)}
            className="border rounded px-3 py-1.5 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={creating}
          className="bg-emerald-600 text-white px-4 py-1.5 rounded text-sm font-medium disabled:opacity-50 hover:bg-emerald-700"
        >
          {creating ? 'Creating...' : 'Add Footage'}
        </button>
      </form>

      {matches.length === 0 ? (
        <p className="text-gray-500">No rally-label footage yet.</p>
      ) : (
        <ul className="space-y-2">
          {matches.map(m => (
            <li key={m.id} className="border rounded-lg p-4 bg-white flex justify-between items-center">
              <div>
                <span className="font-semibold">{m.date}</span>
                {m.opponent && <span className="ml-2 text-gray-500 text-sm">{m.opponent}</span>}
              </div>
              <div className="flex gap-3 text-sm">
                <Link to={`/matches/${m.id}/upload`} className="text-emerald-700 hover:underline">
                  Upload
                </Link>
                <Link to={`/matches/${m.id}/rally-review`} className="text-emerald-700 hover:underline">
                  Label Rallies
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
