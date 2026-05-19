import { useCallback, useEffect, useRef, useState } from 'react'
import type { AnnotateBbox, BootstrapStatus, LabeledFrame } from '../types'
import {
  annotateFrame, getBootstrapStatus, getFrameImageUrl, getFrames,
  skipFrame, startExtraction, startTraining,
} from '../api/client'

interface Rect { x: number; y: number; w: number; h: number }

export default function ActiveLearning() {
  const [status, setStatus] = useState<BootstrapStatus | null>(null)
  const [frames, setFrames] = useState<LabeledFrame[]>([])
  const [idx, setIdx] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const [drawing, setDrawing] = useState(false)
  const [startPt, setStartPt] = useState<{ x: number; y: number } | null>(null)
  const [phase, setPhase] = useState<'annotate' | 'training'>('annotate')
  const [runId, setRunId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  const refresh = useCallback(async () => {
    const [s, f] = await Promise.all([
      getBootstrapStatus(),
      getFrames({ status: 'pending' }),
    ])
    setStatus(s)
    setFrames(f)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const currentFrame: LabeledFrame | undefined = frames[idx]

  useEffect(() => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img || !currentFrame) return
    const ctx = canvas.getContext('2d')!
    img.onload = () => {
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      ctx.drawImage(img, 0, 0)
      if (rect) {
        ctx.strokeStyle = '#00ff00'
        ctx.lineWidth = 2
        ctx.strokeRect(rect.x, rect.y, rect.w, rect.h)
      }
    }
    img.src = getFrameImageUrl(currentFrame.id)
  }, [currentFrame, rect])

  const canvasCoords = (e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const canvas = canvasRef.current!
    const bounds = canvas.getBoundingClientRect()
    const scaleX = canvas.width / bounds.width
    const scaleY = canvas.height / bounds.height
    return {
      x: (e.clientX - bounds.left) * scaleX,
      y: (e.clientY - bounds.top) * scaleY,
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
      x: Math.min(startPt.x, pt.x),
      y: Math.min(startPt.y, pt.y),
      w: Math.abs(pt.x - startPt.x),
      h: Math.abs(pt.y - startPt.y),
    })
  }

  const onMouseUp = () => setDrawing(false)

  const confirm = async () => {
    if (!currentFrame || !rect) return
    const canvas = canvasRef.current!
    const bbox: AnnotateBbox = {
      cx: (rect.x + rect.w / 2) / canvas.width,
      cy: (rect.y + rect.h / 2) / canvas.height,
      w: rect.w / canvas.width,
      h: rect.h / canvas.height,
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

  const handleStartTraining = async () => {
    try {
      const { run_id } = await startTraining(50)
      setRunId(run_id)
      setPhase('training')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to start training')
    }
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (phase !== 'annotate') return
      if (e.key === 'Enter') confirm()
      if (e.key === 'n' || e.key === 'N') noBall()
      if (e.key === 's' || e.key === 'S') skip()
      if (e.key === 'r' || e.key === 'R') setRect(null)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  if (phase === 'training') {
    return <TrainingPhase runId={runId!} onBack={() => setPhase('annotate')} />
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Active Learning — Bootstrap</h1>

      {error && <p className="text-red-500 mb-2">{error}</p>}

      {status && (
        <div className="flex items-center gap-4 mb-4">
          <span className="text-lg font-mono">
            {status.annotated} / {status.frames_total} frames annotated
          </span>
          <button
            onClick={handleStartTraining}
            disabled={!status.model_ready}
            className="px-4 py-2 bg-green-600 text-white rounded disabled:opacity-40"
          >
            Start Training
          </button>
        </div>
      )}

      {currentFrame ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-500">
            Frame {idx + 1} of {frames.length} — {currentFrame.split} split —
            t={currentFrame.timestamp.toFixed(2)}s
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
              disabled={!rect}
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
            : 'All pending frames reviewed.'}
        </p>
      )}
    </div>
  )
}

function TrainingPhase({ runId, onBack }: { runId: number; onBack: () => void }) {
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Training</h1>
      <p className="text-gray-500">Training run #{runId} started. See Phase B for progress.</p>
      <button onClick={onBack} className="mt-4 px-4 py-2 bg-gray-600 text-white rounded">
        Back
      </button>
    </div>
  )
}
