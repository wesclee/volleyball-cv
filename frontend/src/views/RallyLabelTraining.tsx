import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  buildRallyTrainingDataset,
  getRallyFootage,
  getRallyModels,
  getRallyTrainingDataset,
  getRallyTrainingRun,
  startRallyTraining,
  stopRallyTrainingRun,
  uploadRallyFootage,
} from '../api/client'
import type { RallyDataset, RallyFootage, RallyModelVersion, RallyTrainingRun } from '../types'

interface RallyLabelStats {
  totalRallies: number
  totalFootage: number
  labelledFootage: number
}

export default function RallyLabelTraining() {
  const [footage, setFootage] = useState<RallyFootage[]>([])
  const [stats, setStats] = useState<RallyLabelStats>({ totalRallies: 0, totalFootage: 0, labelledFootage: 0 })
  const [loading, setLoading] = useState(true)
  const [label, setLabel] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [creating, setCreating] = useState(false)
  const [buildingDataset, setBuildingDataset] = useState(false)
  const [dataset, setDataset] = useState<RallyDataset | null>(null)
  const [rallyRunId, setRallyRunId] = useState<number | null>(null)
  const [rallyRun, setRallyRun] = useState<RallyTrainingRun | null>(null)
  const [rallyModels, setRallyModels] = useState<RallyModelVersion[]>([])
  const [epochs, setEpochs] = useState(25)
  const [splitTrain, setSplitTrain] = useState(0.8)
  const [splitVal, setSplitVal] = useState(0.1)
  const [splitTest, setSplitTest] = useState(0.1)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    Promise.all([
      getRallyFootage(),
      getRallyTrainingDataset().catch(() => null),
      getRallyModels().catch(() => []),
    ])
      .then(([items, latestDataset, models]) => {
        setFootage(items)
        setStats(statsFromFootage(items))
        setDataset(latestDataset)
        setRallyModels(models)
      })
      .catch(err => setError(String(err)))
      .finally(() => setLoading(false))
  }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!file) {
      setError('Choose a video file first.')
      return
    }
    setCreating(true)
    setError(null)
    setUploadProgress(0)
    try {
      const item = await uploadRallyFootage(file, label.trim() || undefined, setUploadProgress)
      setFootage(prev => {
        const next = [item, ...prev]
        setStats(statsFromFootage(next))
        return next
      })
      setLabel('')
      setFile(null)
      navigate(`/matches/${item.match.id}/rally-review`)
    } catch (err) {
      setError(String(err))
    } finally {
      setCreating(false)
    }
  }

  async function handleBuildDataset() {
    setBuildingDataset(true)
    setError(null)
    try {
      const result = await buildRallyTrainingDataset({
        split_train: splitTrain,
        split_val: splitVal,
        split_test: splitTest,
        min_gap_s: 1,
      })
      setDataset(result)
    } catch (err) {
      setError(String(err))
    } finally {
      setBuildingDataset(false)
    }
  }

  async function handleStartTraining() {
    setError(null)
    try {
      const { run_id } = await startRallyTraining(epochs)
      setRallyRunId(run_id)
    } catch (err) {
      setError(String(err))
    }
  }

  async function handleStopTraining() {
    if (!rallyRunId) return
    setError(null)
    try {
      const updated = await stopRallyTrainingRun(rallyRunId)
      setRallyRun(updated)
    } catch (err) {
      setError(String(err))
    }
  }

  useEffect(() => {
    if (!rallyRunId) return
    let cancelled = false
    let interval: number | undefined
    const poll = async () => {
      const run = await getRallyTrainingRun(rallyRunId)
      if (cancelled) return
      setRallyRun(run)
      if (['done', 'error', 'cancelled'].includes(run.status)) {
        if (interval) window.clearInterval(interval)
        getRallyModels().then(models => {
          if (!cancelled) setRallyModels(models)
        })
      }
    }
    void poll()
    interval = window.setInterval(() => {
      void poll()
    }, 1500)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [rallyRunId])

  if (loading) return <p className="p-6 text-gray-500">Loading...</p>

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">Rally labels</p>
      <h1 className="text-2xl font-bold mt-1 mb-6">Rally Boundary Training</h1>

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium text-gray-500">Rallies labelled</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{stats.totalRallies}</p>
        </div>
        <div className="rounded border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium text-gray-500">Camera footages</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{stats.totalFootage}</p>
        </div>
        <div className="rounded border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium text-gray-500">Footages with labels</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{stats.labelledFootage}</p>
        </div>
      </div>

      <form onSubmit={handleCreate} className="mb-8 flex flex-wrap gap-2 items-end">
        <div className="flex flex-col gap-1">
          <label htmlFor="rally-video" className="text-xs text-gray-600 font-medium">Video file</label>
          <input
            id="rally-video"
            type="file"
            accept="video/*"
            onChange={e => setFile(e.target.files?.[0] ?? null)}
            className="max-w-64 text-sm"
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
          disabled={creating || !file}
          className="bg-emerald-600 text-white px-4 py-1.5 rounded text-sm font-medium disabled:opacity-50 hover:bg-emerald-700"
        >
          {creating ? `Uploading ${Math.round(uploadProgress)}%` : 'Add Footage'}
        </button>
      </form>

      <div className="mb-8 rounded border border-gray-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-800">Rally Boundary Dataset</h2>
            <p className="text-xs text-gray-500">Build train/val/test files from saved rally labels.</p>
          </div>
          <button
            onClick={handleBuildDataset}
            disabled={buildingDataset || stats.totalRallies === 0}
            className="rounded bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {buildingDataset ? 'Building...' : 'Build Dataset'}
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
            Train
            <input type="number" min={0} max={1} step={0.05} value={splitTrain} onChange={e => setSplitTrain(Number(e.target.value))} className="rounded border px-2 py-1 text-sm" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
            Val
            <input type="number" min={0} max={1} step={0.05} value={splitVal} onChange={e => setSplitVal(Number(e.target.value))} className="rounded border px-2 py-1 text-sm" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
            Test
            <input type="number" min={0} max={1} step={0.05} value={splitTest} onChange={e => setSplitTest(Number(e.target.value))} className="rounded border px-2 py-1 text-sm" />
          </label>
        </div>
        {dataset && (
          <div className="mt-4 rounded bg-emerald-50 p-3 text-sm text-emerald-900">
            <div className="grid gap-2 sm:grid-cols-3">
              <DatasetMetric label="Manual rallies" value={dataset.positive_rallies} />
              <DatasetMetric label="Non-rally gaps" value={dataset.negative_gaps} />
              <DatasetMetric label="Training examples" value={dataset.positive_rallies + dataset.negative_gaps} />
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <DatasetMetric label="Train examples" value={dataset.counts.train ?? 0} />
              <DatasetMetric label="Val examples" value={dataset.counts.val ?? 0} />
              <DatasetMetric label="Test examples" value={dataset.counts.test ?? 0} />
            </div>
            <div className="mt-3 border-t border-emerald-100 pt-2 text-xs text-emerald-700">
              <span>{dataset.dataset_path}</span>
              {dataset.built_at && <span className="block">Last built {new Date(dataset.built_at).toLocaleString()}.</span>}
            </div>
          </div>
        )}
      </div>

      <div className="mb-8 rounded border border-gray-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-800">Rally Boundary Model</h2>
            <p className="text-xs text-gray-500">Train separately from the ball detector. mAP50 uses temporal overlap with labelled rally ranges.</p>
          </div>
          <div className="flex items-end gap-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
              Epochs
              <input type="number" min={1} max={500} value={epochs} onChange={e => setEpochs(Number(e.target.value))} className="w-20 rounded border px-2 py-1 text-sm" />
            </label>
            <button
              onClick={handleStartTraining}
              disabled={!dataset || (rallyRun?.status === 'pending' || rallyRun?.status === 'running' || rallyRun?.status === 'stopping')}
              className="rounded bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              Start Training
            </button>
          </div>
        </div>

        {rallyRun && ['pending', 'running', 'stopping'].includes(rallyRun.status) && (
          <div className="rounded bg-blue-50 p-3 text-sm text-blue-800">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">Rally training run #{rallyRun.id} · {rallyRun.status}</span>
              <button
                onClick={handleStopTraining}
                disabled={rallyRun.status === 'stopping'}
                className="rounded bg-white px-3 py-1 text-xs font-medium text-blue-700 ring-1 ring-blue-200 hover:bg-blue-100 disabled:opacity-50"
              >
                Safe Stop
              </button>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded bg-blue-100">
              <div className="h-full rounded bg-blue-600 transition-all" style={{ width: `${Math.max(0, Math.min(100, rallyRun.progress_pct))}%` }} />
            </div>
            <p className="mt-1 text-xs text-blue-600">{rallyRun.progress_pct.toFixed(0)}% complete.</p>
          </div>
        )}

        {rallyRun?.status === 'error' && (
          <div className="rounded bg-red-50 p-3 text-sm text-red-700">
            <p className="font-semibold">Rally training failed</p>
            <pre className="mt-1 max-h-40 overflow-auto text-xs">{rallyRun.error}</pre>
          </div>
        )}

        {rallyRun?.status === 'cancelled' && (
          <div className="rounded bg-gray-50 p-3 text-sm text-gray-700">Rally training was stopped. Labels and dataset files were kept.</div>
        )}

        {rallyModels.length > 0 && (
          <div className="mt-3 overflow-hidden rounded border border-gray-100">
            <div className="grid grid-cols-5 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-500">
              <span>Model</span>
              <span>Examples</span>
              <span>mAP50</span>
              <span>Mean tIoU</span>
              <span>Created</span>
            </div>
            {rallyModels.slice(0, 5).map(model => (
              <div key={model.id} className="grid grid-cols-5 border-t border-gray-100 px-3 py-2 text-xs text-gray-700">
                <span className="font-medium text-gray-900">{model.name}</span>
                <span>{model.dataset_size}</span>
                <span>{formatMetric(model.test_map50)}</span>
                <span>{formatMetric(model.mean_temporal_iou)}</span>
                <span>{new Date(model.created_at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {footage.length === 0 ? (
        <p className="text-gray-500">No rally-label footage yet.</p>
      ) : (
        <ul className="space-y-2">
          {footage.map((item, index) => (
            <li key={item.video.id} className="border rounded-lg p-4 bg-white flex justify-between items-center">
              <div>
                <span className="font-semibold">Footage {index + 1}</span>
                {item.match.opponent && <span className="ml-2 text-gray-500 text-sm">{item.match.opponent}</span>}
                <span className="ml-2 text-xs text-gray-400">{item.rally_count} rallies</span>
              </div>
              <Link to={`/matches/${item.match.id}/rally-review`} className="text-sm font-medium text-emerald-700 hover:underline">
                Label Rallies
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function statsFromFootage(footage: RallyFootage[]): RallyLabelStats {
  return {
    totalRallies: footage.reduce((sum, item) => sum + item.rally_count, 0),
    totalFootage: footage.length,
    labelledFootage: footage.filter(item => item.rally_count > 0).length,
  }
}

function DatasetMetric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase text-emerald-700">{label}</p>
      <p className="text-xl font-bold text-emerald-950">{value}</p>
    </div>
  )
}

function formatMetric(value: number | null) {
  if (value == null) return '-'
  return `${(value * 100).toFixed(1)}%`
}
