// frontend/src/views/LabelingQueue.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AnnotateBbox, LabeledFrame, LabelingStatus, ModelVersion, TrainingRun, Video } from '../types'
import {
  annotateFrame, getAllVideos, getLabelingStatus, getLabelingQueue, getFrames,
  getFrameImageUrl, getModels, getTrainingRun, promoteModel, skipFrame, startExtraction, startTraining,
} from '../api/client'

interface Rect { x: number; y: number; w: number; h: number }

export default function LabelingQueue() {
  const [status, setStatus] = useState<LabelingStatus | null>(null)
  const [bootstrapFrames, setBootstrapFrames] = useState<LabeledFrame[]>([])
  const [queueFrames, setQueueFrames] = useState<LabeledFrame[]>([])
  const [idx, setIdx] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const [drawing, setDrawing] = useState(false)
  const [startPt, setStartPt] = useState<{ x: number; y: number } | null>(null)
  const [runId, setRunId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [processedVideos, setProcessedVideos] = useState<Video[]>([])
  const [extracting, setExtracting] = useState<number | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  const isBootstrapMode = !status?.active_model_id
  const frames = isBootstrapMode ? bootstrapFrames : queueFrames
  const currentFrame: LabeledFrame | undefined = frames[idx]

  const refresh = useCallback(async () => {
    const [s, allPending, queue, videos] = await Promise.all([
      getLabelingStatus(),
      getFrames({ status: 'pending' }),
      getLabelingQueue(),
      getAllVideos('done'),
    ])
    setStatus(s)
    setBootstrapFrames(allPending.filter(f => f.pred_conf === null))
    setQueueFrames(queue)
    setProcessedVideos(videos)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img || !currentFrame) return
    const ctx = canvas.getContext('2d')!
    img.onload = () => {
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      ctx.drawImage(img, 0, 0)
      if (!rect && currentFrame.pred_cx != null) {
        const px = (currentFrame.pred_cx - currentFrame.pred_w! / 2) * canvas.width
        const py = (currentFrame.pred_cy! - currentFrame.pred_h! / 2) * canvas.height
        const pw = currentFrame.pred_w! * canvas.width
        const ph = currentFrame.pred_h! * canvas.height
        ctx.strokeStyle = '#facc15'
        ctx.lineWidth = 2
        ctx.strokeRect(px, py, pw, ph)
      }
      if (rect) {
        ctx.strokeStyle = '#00ff00'
        ctx.lineWidth = 2
        ctx.strokeRect(rect.x, rect.y, rect.w, rect.h)
      }
    }
    img.src = getFrameImageUrl(currentFrame.id)
  }, [currentFrame, rect])

  const canvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    const bounds = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - bounds.left) * (canvas.width / bounds.width),
      y: (e.clientY - bounds.top) * (canvas.height / bounds.height),
    }
  }

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setDrawing(true)
    setStartPt(canvasCoords(e))
    setRect(null)
  }
  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drawing || !startPt) return
    const pt = canvasCoords(e)
    setRect({
      x: Math.min(startPt.x, pt.x), y: Math.min(startPt.y, pt.y),
      w: Math.abs(pt.x - startPt.x), h: Math.abs(pt.y - startPt.y),
    })
  }
  const onMouseUp = () => setDrawing(false)

  const confirm = async () => {
    if (!currentFrame) return
    const canvas = canvasRef.current!
    let bbox: AnnotateBbox
    if (rect) {
      bbox = {
        cx: (rect.x + rect.w / 2) / canvas.width,
        cy: (rect.y + rect.h / 2) / canvas.height,
        w: rect.w / canvas.width,
        h: rect.h / canvas.height,
      }
    } else if (currentFrame.pred_cx != null) {
      bbox = {
        cx: currentFrame.pred_cx,
        cy: currentFrame.pred_cy!,
        w: currentFrame.pred_w!,
        h: currentFrame.pred_h!,
      }
    } else {
      return
    }
    await annotateFrame(currentFrame.id, bbox)
    setRect(null)
    setIdx(i => i + 1)
    await refresh()
  }

  const noBall = async () => {
    if (!currentFrame) return
    await skipFrame(currentFrame.id)
    setRect(null)
    setIdx(i => i + 1)
    await refresh()
  }

  const skip = () => {
    setRect(null)
    setIdx(i => i + 1)
  }

  const handleExtract = async (videoId: number) => {
    setExtracting(videoId)
    try {
      await startExtraction(videoId)
      await refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Extraction failed')
    } finally {
      setExtracting(null)
    }
  }

  const handleRetrain = async () => {
    try {
      const { run_id } = await startTraining(50)
      setRunId(run_id)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to start training')
    }
  }

  const confirmRef = useRef(confirm)
  const noBallRef = useRef(noBall)
  const skipRef = useRef(skip)
  useEffect(() => {
    confirmRef.current = confirm
    noBallRef.current = noBall
    skipRef.current = skip
  })

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter') confirmRef.current()
      if (e.key === 'n' || e.key === 'N') noBallRef.current()
      if (e.key === 's' || e.key === 'S') skipRef.current()
      if (e.key === 'r' || e.key === 'R') setRect(null)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Active Learning</h1>

      {error && <p className="text-red-500 mb-2">{error}</p>}

      {runId !== null && (
        <TrainingPanel runId={runId} onDone={() => { setRunId(null); refresh() }} />
      )}

      {status?.active_model_id && (
        <RetrainPanel status={status} onRetrain={handleRetrain} />
      )}

      {status && isBootstrapMode && (
        <div className="flex items-center gap-4 mb-4">
          <span className="text-lg font-mono">
            {status.annotated} / {status.frames_total} frames annotated
          </span>
          <button
            onClick={handleRetrain}
            disabled={!status.model_ready}
            className="px-4 py-2 bg-green-600 text-white rounded disabled:opacity-40"
          >
            Start Training
          </button>
        </div>
      )}

      {isBootstrapMode && processedVideos.length > 0 && (
        <div className="mb-4 p-3 rounded bg-gray-50 border border-gray-200">
          <p className="text-sm font-semibold mb-2">Extract frames from processed videos</p>
          <div className="flex flex-col gap-2">
            {processedVideos.map(v => (
              <div key={v.id} className="flex items-center gap-3">
                <span className="text-sm font-mono">Video {v.id} — match {v.match_id} set {v.set_number}</span>
                <button
                  onClick={() => handleExtract(v.id)}
                  disabled={extracting === v.id}
                  className="px-3 py-1 bg-blue-600 text-white text-sm rounded disabled:opacity-40"
                >
                  {extracting === v.id ? 'Extracting…' : 'Extract Frames'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {currentFrame ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-500">
            Frame {idx + 1} of {frames.length}
            {currentFrame.pred_conf != null && (
              <> — conf <span className="font-mono">{currentFrame.pred_conf.toFixed(2)}</span></>
            )}
            {' '}— {currentFrame.split} split — t={currentFrame.timestamp.toFixed(2)}s
          </p>
          <div className="relative border border-gray-300 rounded overflow-hidden" style={{ maxWidth: 640 }}>
            <img ref={imgRef} alt="frame" className="hidden" />
            <canvas
              ref={canvasRef}
              style={{ width: '100%', cursor: 'crosshair', display: 'block' }}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={confirm}
              disabled={!rect && currentFrame.pred_cx == null}
              className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-40"
            >
              Confirm
            </button>
            <button onClick={noBall} className="px-4 py-2 bg-yellow-500 text-white rounded">
              No ball
            </button>
            <button onClick={skip} className="px-4 py-2 bg-gray-400 text-white rounded">
              Skip
            </button>
            <button onClick={() => setRect(null)} className="px-4 py-2 bg-red-400 text-white rounded">
              Redo
            </button>
          </div>
        </div>
      ) : (
        <p className="text-gray-500">
          {status?.frames_total === 0
            ? 'No frames extracted yet. Use the Extract Frames button to sample from a processed video.'
            : 'Queue empty — all pending frames reviewed.'}
        </p>
      )}
    </div>
  )
}

function RetrainPanel({ status, onRetrain }: { status: LabelingStatus; onRetrain: () => void }) {
  const recommended = status.retrain_recommended
  return (
    <div className="flex items-center gap-4 mb-4 p-3 rounded bg-gray-50 border border-gray-200">
      <span className="text-sm font-mono">
        {status.new_labeled_since_last_train} / {status.retrain_threshold} new frames
        {status.last_trained_at_size != null && (
          <> · last trained at {status.last_trained_at_size}</>
        )}
      </span>
      <button
        onClick={onRetrain}
        className={`px-4 py-2 rounded text-white ${recommended ? 'bg-green-600' : 'bg-gray-500'}`}
      >
        Retrain{recommended ? ' ↑' : ''}
      </button>
    </div>
  )
}

export function PromotionPanel({
  runId,
  oldModel,
  newModel,
  onPromoted,
}: {
  runId: number
  oldModel: ModelVersion | null
  newModel: ModelVersion
  onPromoted: () => void
}) {
  const [promoting, setPromoting] = useState(false)
  const [promoted, setPromoted] = useState(false)

  const netDelta = oldModel
    ? (newModel.test_precision ?? 0) - (oldModel.test_precision ?? 0)
    + (newModel.test_recall ?? 0) - (oldModel.test_recall ?? 0)
    + (newModel.test_map50 ?? 0) - (oldModel.test_map50 ?? 0)
    : 1

  const canPromote = netDelta > 0

  const handlePromote = async () => {
    setPromoting(true)
    await promoteModel(newModel.id)
    setPromoted(true)
    setPromoting(false)
    onPromoted()
  }

  const fmt = (v: number | null) => v != null ? v.toFixed(3) : '—'
  const diff = (n: number | null, o: number | null) => {
    if (n == null || o == null) return ''
    const d = n - o
    return d >= 0 ? `+${d.toFixed(3)}` : d.toFixed(3)
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Test Set Evaluation</h2>
      <table className="border-collapse text-sm w-full max-w-lg">
        <thead>
          <tr className="bg-gray-100">
            <th className="border p-2 text-left">Metric</th>
            {oldModel && <th className="border p-2">Old model</th>}
            <th className="border p-2">New model</th>
            {oldModel && <th className="border p-2">Change</th>}
          </tr>
        </thead>
        <tbody>
          {(['test_precision', 'test_recall', 'test_map50'] as const).map(key => (
            <tr key={key}>
              <td className="border p-2 font-mono">{key.replace('test_', '')}</td>
              {oldModel && <td className="border p-2 text-center">{fmt(oldModel[key])}</td>}
              <td className="border p-2 text-center">{fmt(newModel[key])}</td>
              {oldModel && (
                <td className={`border p-2 text-center ${
                  (newModel[key] ?? 0) >= (oldModel[key] ?? 0) ? 'text-green-600' : 'text-red-600'
                }`}>
                  {diff(newModel[key], oldModel[key])}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {oldModel && (
        <p className={`font-mono text-sm ${canPromote ? 'text-green-700' : 'text-red-700'}`}>
          Net delta: {netDelta >= 0 ? '+' : ''}{netDelta.toFixed(4)} —{' '}
          {canPromote ? 'Model improved overall' : 'Model did not improve overall'}
        </p>
      )}
      {promoted ? (
        <p className="text-green-700 font-semibold">Model promoted successfully.</p>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={handlePromote}
            disabled={!canPromote || promoting}
            className="px-4 py-2 bg-green-600 text-white rounded disabled:opacity-40"
          >
            Promote
          </button>
          <button onClick={onPromoted} className="px-4 py-2 bg-gray-400 text-white rounded">
            Discard
          </button>
        </div>
      )}
    </div>
  )
}

function TrainingPanel({ runId, onDone }: { runId: number; onDone: () => void }) {
  const [run, setRun] = useState<TrainingRun | null>(null)
  const [models, setModels] = useState<ModelVersion[]>([])

  useEffect(() => {
    if (!run || run.status === 'running' || run.status === 'pending') {
      const id = setInterval(async () => {
        const r = await getTrainingRun(runId)
        setRun(r)
        if (r.status === 'done' || r.status === 'error') {
          clearInterval(id)
          const ms = await getModels()
          setModels(ms)
        }
      }, 3000)
      getTrainingRun(runId).then(r => {
        setRun(r)
        if (r.status === 'done' || r.status === 'error') {
          getModels().then(setModels)
        }
      })
      return () => clearInterval(id)
    }
  }, [runId])

  const newModel = run?.new_model_id ? models.find(m => m.id === run.new_model_id) : undefined
  const oldModel = models.find(m => m.is_active && m.id !== run?.new_model_id) ?? null

  if (!run || run.status === 'pending' || run.status === 'running') {
    return (
      <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded flex items-center gap-3">
        <span className="text-blue-700 font-medium">Training run #{runId}</span>
        <span className="text-blue-600 font-mono text-sm">{run?.status ?? 'starting…'}</span>
        <span className="text-blue-500 text-sm">— you can keep annotating</span>
      </div>
    )
  }

  if (run.status === 'error') {
    return (
      <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded">
        <p className="text-red-700 font-semibold">Training run #{runId} failed</p>
        <pre className="text-xs text-red-600 mt-1 overflow-auto">{run.error}</pre>
        <button onClick={onDone} className="mt-2 px-3 py-1 bg-gray-600 text-white text-sm rounded">Dismiss</button>
      </div>
    )
  }

  if (run.status === 'done' && newModel) {
    return (
      <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded">
        <PromotionPanel runId={runId} oldModel={oldModel} newModel={newModel} onPromoted={onDone} />
      </div>
    )
  }

  return null
}
