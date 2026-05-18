import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createMatch, getMatches } from '../api/client'
import type { Match, MatchCreate } from '../types'

export default function MatchManager() {
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(true)
  const [date, setDate] = useState('')
  const [opponent, setOpponent] = useState('')
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    getMatches()
      .then(setMatches)
      .finally(() => setLoading(false))
  }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    try {
      const body: MatchCreate = { date }
      if (opponent.trim()) body.opponent = opponent.trim()
      const match = await createMatch(body)
      navigate(`/matches/${match.id}/upload`)
    } finally {
      setCreating(false)
    }
  }

  if (loading) return <p className="p-6 text-gray-500">Loading…</p>

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Matches</h1>

      <form onSubmit={handleCreate} className="mb-8 flex flex-wrap gap-2 items-end">
        <div className="flex flex-col gap-1">
          <label htmlFor="date" className="text-xs text-gray-600 font-medium">Date</label>
          <input
            id="date"
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            required
            className="border rounded px-3 py-1.5 text-sm"
          />
        </div>
        <input
          type="text"
          placeholder="Opponent (optional)"
          value={opponent}
          onChange={e => setOpponent(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={creating}
          className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm font-medium disabled:opacity-50 hover:bg-blue-700"
        >
          {creating ? 'Creating…' : 'New Match'}
        </button>
      </form>

      {matches.length === 0 ? (
        <p className="text-gray-500">No matches yet. Create one above.</p>
      ) : (
        <ul className="space-y-2">
          {matches.map(m => (
            <li key={m.id} className="border rounded-lg p-4 bg-white flex justify-between items-center">
              <div>
                <span className="font-semibold">{m.date}</span>
                {m.opponent && <span className="ml-2 text-gray-500 text-sm">vs {m.opponent}</span>}
              </div>
              <div className="flex gap-3 text-sm">
                <Link to={`/matches/${m.id}/upload`} className="text-blue-600 hover:underline">
                  Upload
                </Link>
                <Link to={`/matches/${m.id}/rally-review`} className="text-blue-600 hover:underline">
                  Rally Review
                </Link>
                <Link to={`/matches/${m.id}/export`} className="text-blue-600 hover:underline">
                  Export
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
