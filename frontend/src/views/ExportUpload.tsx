import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { exportMatch, getMatch } from '../api/client'
import type { Match, ProcessedVideo } from '../types'

const BACKEND = 'http://localhost:8000'

export default function ExportUpload() {
  const { matchId } = useParams<{ matchId: string }>()
  const [match, setMatch] = useState<Match | null>(null)
  const [exporting, setExporting] = useState(false)
  const [results, setResults] = useState<ProcessedVideo[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getMatch(Number(matchId)).then(setMatch)
  }, [matchId])

  async function handleExport() {
    setExporting(true)
    setError(null)
    try {
      const pvs = await exportMatch(Number(matchId))
      setResults(pvs)
    } catch (err) {
      setError(String(err))
    } finally {
      setExporting(false)
    }
  }

  function downloadUrl(pv: ProcessedVideo): string {
    const filename = pv.output_path.split('/').pop()!
    return `${BACKEND}/exports/${filename}`
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <Link to="/" className="text-sm text-blue-600 hover:underline">← Back</Link>
      {match && (
        <h1 className="text-2xl font-bold mt-1 mb-6">
          Export — {match.date}{match.opponent ? ` vs ${match.opponent}` : ''}
        </h1>
      )}

      <p className="text-sm text-gray-600 mb-4">
        Generates a trimmed MP4 per set using the current rally timestamps.
        Previously exported files are replaced.
      </p>

      <button
        onClick={handleExport}
        disabled={exporting}
        className="bg-blue-600 text-white px-5 py-2 rounded font-medium disabled:opacity-50 hover:bg-blue-700"
      >
        {exporting ? 'Exporting…' : 'Generate Export'}
      </button>

      {error && <p className="mt-4 text-red-600 text-sm">Error: {error}</p>}

      {results !== null && (
        <div className="mt-6">
          {results.length === 0 ? (
            <p className="text-gray-500 text-sm">No sets with rallies found. Process videos and assign rallies first.</p>
          ) : (
            <ul className="space-y-2">
              {results.map(pv => (
                <li key={pv.id} className="border rounded-lg p-3 bg-white flex justify-between items-center">
                  <span className="text-sm text-gray-700">{pv.output_path.split('/').pop()}</span>
                  <a
                    href={downloadUrl(pv)}
                    download
                    className="text-blue-600 hover:underline text-sm font-medium"
                  >
                    Download
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
