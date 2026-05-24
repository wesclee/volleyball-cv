import { useEffect, useState } from 'react'
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom'
import { getLabelingStatus, getTrainingVideos } from './api/client'
import LabelingQueue from './views/LabelingQueue'
import ExportUpload from './views/ExportUpload'
import MatchManager from './views/MatchManager'
import RallyLabelTraining from './views/RallyLabelTraining'
import RallyReview from './views/RallyReview'
import UploadProcess from './views/UploadProcess'
import type { LabelingStatus, Video } from './types'

function NavItem({ to, label, end }: { to: string; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `block px-3 py-2 rounded text-sm ${isActive ? 'bg-blue-700 text-white' : 'text-gray-300 hover:text-white hover:bg-gray-700'}`
      }
    >
      {label}
    </NavLink>
  )
}

function DisabledNavItem({ label }: { label: string }) {
  return (
    <span className="block px-3 py-2 rounded text-sm text-gray-600 cursor-not-allowed" aria-disabled="true">
      {label}
    </span>
  )
}

function CvProgressPanel({ status, trainingVideos }: { status: LabelingStatus | null; trainingVideos: Video[] }) {
  const totalFrames = status?.frames_total ?? 0
  const reviewedFrames = (status?.annotated ?? 0) + (status?.skipped ?? 0)
  const uploadedVideoCount = Math.max(trainingVideos.length, status?.source_videos_total ?? 0)
  const labeledVideoCount = status?.source_videos_labeled ?? 0
  const hasTrainingFootage = trainingVideos.length > 0 || totalFrames > 0
  const hasBallModel = Boolean(status?.active_model_id)

  const steps = [
    { label: 'Add footage', state: hasTrainingFootage ? 'done' : 'current' },
    { label: 'Extract frames', state: totalFrames > 0 ? 'done' : hasTrainingFootage ? 'current' : 'next' },
    { label: 'Ball labels', state: hasBallModel ? 'done' : totalFrames > 0 ? 'current' : 'next' },
    { label: 'Train detector', state: hasBallModel ? 'done' : reviewedFrames > 0 ? 'current' : 'next' },
    { label: 'Rally labels', state: 'next' },
    { label: 'Combine signals', state: 'next' },
  ] as const

  const current = steps.find(step => step.state === 'current')?.label ?? 'Review labels'

  return (
    <section className="mt-4 border-t border-gray-700 pt-3">
      <div className="px-3 mb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">CV Progress</h2>
        <p className="mt-1 text-xs text-blue-200">Now: {current}</p>
        <p className="mt-1 text-xs text-gray-400">
          Angles: <span className="text-gray-200">{labeledVideoCount}</span> labelled / {uploadedVideoCount} uploaded
        </p>
      </div>
      <ol className="space-y-1">
        {steps.map((step, index) => (
          <li key={step.label} className="flex items-center gap-2 px-3 py-1.5 rounded">
            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-mono ${
              step.state === 'done'
                ? 'bg-green-600 text-white'
                : step.state === 'current'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300'
            }`}>
              {index + 1}
            </span>
            <span className={`text-xs ${
              step.state === 'current'
                ? 'text-white font-semibold'
                : step.state === 'done'
                  ? 'text-gray-200'
                  : 'text-gray-500'
            }`}>
              {step.label}
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-4 border-t border-gray-700 px-3 pt-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Label Types</h2>
        <div className="mt-2 space-y-2">
          <div>
            <p className="text-xs font-semibold text-gray-200">Ball labels</p>
            <p className="text-[11px] leading-snug text-gray-500">Frame boxes for training the ball detector.</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-200">Rally labels</p>
            <p className="text-[11px] leading-snug text-gray-500">Start/end times in Rally Review.</p>
          </div>
        </div>
      </div>
    </section>
  )
}

export default function App() {
  const [status, setStatus] = useState<LabelingStatus | null>(null)
  const [trainingVideos, setTrainingVideos] = useState<Video[]>([])

  useEffect(() => {
    Promise.all([getLabelingStatus(), getTrainingVideos()])
      .then(([labelingStatus, videos]) => {
        setStatus(labelingStatus)
        setTrainingVideos(videos)
      })
      .catch(() => {
        setStatus(null)
        setTrainingVideos([])
      })
  }, [])

  const hasBasicModel = Boolean(status?.active_model_id)

  return (
    <BrowserRouter>
      <div className="flex min-h-screen bg-gray-50">
        <nav className="w-56 bg-gray-900 p-3 flex flex-col gap-1 shrink-0">
          <span className="text-white font-bold text-sm mb-3 px-3">Volleyball CV</span>
          <div className="mb-3">
            <span className="block px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Training</span>
            <NavItem to="/active-learning" label="Ball Labels" />
            <NavItem to="/rally-labels" label="Rally Labels" />
          </div>
          <div>
            <span className="block px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Production</span>
            {hasBasicModel ? <NavItem to="/" label="Matches" end /> : <DisabledNavItem label="Matches" />}
          </div>
          <CvProgressPanel status={status} trainingVideos={trainingVideos} />
        </nav>
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<MatchManager />} />
            <Route path="/rally-labels" element={<RallyLabelTraining />} />
            <Route path="/matches/:matchId/upload" element={<UploadProcess />} />
            <Route path="/matches/:matchId/rally-review" element={<RallyReview />} />
            <Route path="/matches/:matchId/export" element={<ExportUpload />} />
            <Route path="/active-learning" element={<LabelingQueue />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
