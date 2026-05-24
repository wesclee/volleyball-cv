// frontend/src/views/RallyReview.tsx
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { createRally, deleteRally, getAudioPeaks, getMatch, getMatchVideos, getRallies, getRallyScan, patchRally, startRallyScan } from '../api/client'
import type { Match, Rally, RallyPrediction, RallyScanRun, Video } from '../types'

const BACKEND = 'http://localhost:8000'
const FRAME_STEP_SECONDS = 1 / 30

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
  const [currentTimestamp, setCurrentTimestamp] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  const [audioPeaks, setAudioPeaks] = useState<number[]>([])
  const [audioStatus, setAudioStatus] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle')
  const [scanStatus, setScanStatus] = useState<'idle' | 'scanning' | 'done'>('idle')
  const [scanRunId, setScanRunId] = useState<number | null>(null)
  const [scanResult, setScanResult] = useState<RallyScanRun | null>(null)
  const [savingPredictionKey, setSavingPredictionKey] = useState<string | null>(null)
  const [timelineZoom, setTimelineZoom] = useState(1)
  const [timelineWindowStart, setTimelineWindowStart] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [previousFrameKey, setPreviousFrameKey] = useState('ArrowLeft')
  const [nextFrameKey, setNextFrameKey] = useState('ArrowRight')
  const [playPauseKey, setPlayPauseKey] = useState(' ')
  const [capturingKey, setCapturingKey] = useState<'previous' | 'next' | 'playPause' | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const editorTimelineRef = useRef<HTMLDivElement>(null)
  const audioTimelineRef = useRef<HTMLDivElement>(null)

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
    const score = nextScoreForRally(ralliesForVideo(rally.video_id), rally, 'home')
    updateLocalRally(rally.id, score)
    await patchRally(rally.id, score)
  }

  async function scoreAway(rally: Rally) {
    const score = nextScoreForRally(ralliesForVideo(rally.video_id), rally, 'away')
    updateLocalRally(rally.id, score)
    await patchRally(rally.id, score)
  }

  function ralliesForVideo(videoId: number) {
    return sets.find(s => s.video.id === videoId)?.rallies ?? []
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

  async function updateSelectedBoundaryFromCurrentTime(field: 'start_time' | 'end_time') {
    if (!activeRallyData) return false
    const num = currentTime()
    setError(null)
    try {
      const updated = await patchRally(activeRallyData.id, { [field]: num })
      updateLocalRally(activeRallyData.id, updated)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update rally time.')
      return false
    }
  }

  function currentTime() {
    return Number((videoRef.current?.currentTime ?? 0).toFixed(2))
  }

  async function markStart() {
    if (activeRallyData) {
      await updateSelectedBoundaryFromCurrentTime('start_time')
      return
    }
    setDraftStart(currentTime())
    setPreviewingRallyId(null)
    setError(null)
  }

  async function markEnd() {
    if (activeRallyData) {
      await updateSelectedBoundaryFromCurrentTime('end_time')
      return
    }
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

  async function runRallyScan() {
    if (!activeVideo) return
    setError(null)
    setScanStatus('scanning')
    setScanResult(null)
    try {
      const result = await startRallyScan(activeVideo.id, {
        window_s: 8,
        step_s: 2,
        max_predictions: 40,
      })
      setScanRunId(result.scan_id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not scan video.')
      setScanStatus('idle')
    }
  }

  async function savePrediction(prediction: RallyPrediction) {
    if (!activeVideo) return
    const key = predictionKey(prediction)
    setSavingPredictionKey(key)
    setError(null)
    try {
      const rally = await createRally(activeVideo.id, {
        start_time: Number(prediction.start_time.toFixed(3)),
        end_time: Number(prediction.end_time.toFixed(3)),
      })
      setSets(prev => prev.map(s => (
        s.video.id === activeVideo.id
          ? { ...s, rallies: [...s.rallies, rally].sort((a, b) => a.start_time - b.start_time) }
          : s
      )))
      setScanResult(prev => prev ? {
        ...prev,
        predictions: prev.predictions.filter(item => predictionKey(item) !== key),
      } : prev)
      setActiveRally({ videoId: activeVideo.id, rallyId: rally.id })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save prediction.')
    } finally {
      setSavingPredictionKey(null)
    }
  }

  function seek(deltaSeconds: number) {
    if (!videoRef.current) return
    videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime + deltaSeconds)
  }

  function stepFrame(direction: -1 | 1) {
    if (!videoRef.current) return
    videoRef.current.pause()
    setPreviewingRallyId(null)
    const nextTime = Math.min(
      duration || Number.POSITIVE_INFINITY,
      Math.max(0, videoRef.current.currentTime + direction * FRAME_STEP_SECONDS),
    )
    videoRef.current.currentTime = nextTime
    syncRallySelectionForTime(nextTime)
  }

  async function togglePlayback() {
    if (!videoRef.current) return
    if (videoRef.current.paused) {
      await videoRef.current.play()
    } else {
      videoRef.current.pause()
    }
  }

  function scrubTo(value: string) {
    const time = Number(value)
    if (!videoRef.current || Number.isNaN(time)) return
    videoRef.current.currentTime = time
    syncRallySelectionForTime(time)
  }

  function updateVolume(value: string) {
    const nextVolume = Math.min(1, Math.max(0, Number(value)))
    if (Number.isNaN(nextVolume)) return
    setVolume(nextVolume)
    setIsMuted(nextVolume === 0)
    if (videoRef.current) {
      videoRef.current.volume = nextVolume
      videoRef.current.muted = nextVolume === 0
    }
  }

  function toggleMute() {
    const nextMuted = !isMuted
    const nextVolume = !nextMuted && volume === 0 ? 0.5 : volume
    setIsMuted(nextMuted)
    setVolume(nextVolume)
    if (videoRef.current) {
      videoRef.current.muted = nextMuted
      videoRef.current.volume = nextVolume
    }
  }

  function seekToTime(time: number) {
    if (!videoRef.current) return
    const nextTime = Math.min(duration || Number.POSITIVE_INFINITY, Math.max(0, time))
    videoRef.current.currentTime = nextTime
    syncRallySelectionForTime(nextTime)
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
      if (e.key.toLowerCase() === 's') void markStart()
      if (e.key.toLowerCase() === 'e') void markEnd()
      if (e.key === playPauseKey) {
        e.preventDefault()
        void togglePlayback()
      }
      if (e.key === previousFrameKey) {
        e.preventDefault()
        if (e.shiftKey) seek(-5)
        else stepFrame(-1)
      }
      if (e.key === nextFrameKey) {
        e.preventDefault()
        if (e.shiftKey) seek(5)
        else stepFrame(1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const activeVideo = sets.find(s => s.video.id === activeVideoId)?.video ?? sets[0]?.video
  const activeVideoUrl = activeVideo ? `${BACKEND}/uploads/${activeVideo.raw_path.split('/').pop()}` : ''
  const activeVideoRallies = useMemo(
    () => [...(sets.find(s => s.video.id === activeVideo?.id)?.rallies ?? [])].sort((a, b) => a.start_time - b.start_time),
    [sets, activeVideo?.id],
  )
  const editorDuration = duration || activeVideo?.duration || 0
  const unmarkedSections = useMemo(
    () => buildUnmarkedSections(activeVideoRallies, editorDuration),
    [activeVideoRallies, editorDuration],
  )
  const latestLabelEnd = activeVideoRallies.at(-1)?.end_time ?? 0
  const timelineWindowDuration = editorDuration ? editorDuration / timelineZoom : 0
  const timelineWindowEnd = Math.min(editorDuration, timelineWindowStart + timelineWindowDuration)
  const visibleRulerTicks = useMemo(
    () => buildRulerTicks(timelineWindowStart, timelineWindowEnd, 6),
    [timelineWindowStart, timelineWindowEnd],
  )

  function syncRallySelectionForTime(time: number) {
    setCurrentTimestamp(time)
    if (!activeVideo) return
    const matchingRally = activeVideoRallies.find(r => time >= r.start_time && time <= r.end_time)
    if (matchingRally) {
      if (activeRally?.rallyId !== matchingRally.id || activeRally?.videoId !== activeVideo.id) {
        setActiveRally({ videoId: activeVideo.id, rallyId: matchingRally.id })
      }
      return
    }
    if (activeRally?.videoId === activeVideo.id) {
      setActiveRally(null)
    }
  }

  function seekToNextUnmarked() {
    const nextGap = unmarkedSections.find(section => section.start > currentTimestamp + 0.001)
    if (nextGap) seekToTime(nextGap.start)
  }

  function clampTimelineStart(start: number, zoom = timelineZoom) {
    if (!editorDuration) return 0
    const windowDuration = editorDuration / zoom
    return Math.min(Math.max(0, start), Math.max(0, editorDuration - windowDuration))
  }

  function setTimelineZoomAround(value: string) {
    const nextZoom = Math.min(20, Math.max(1, Number(value)))
    if (!editorDuration || Number.isNaN(nextZoom)) return
    const oldDuration = editorDuration / timelineZoom
    const focus = currentTimestamp >= timelineWindowStart && currentTimestamp <= timelineWindowEnd
      ? currentTimestamp
      : timelineWindowStart + oldDuration / 2
    const nextDuration = editorDuration / nextZoom
    setTimelineZoom(nextZoom)
    setTimelineWindowStart(clampTimelineStart(focus - nextDuration / 2, nextZoom))
  }

  function panTimeline(direction: -1 | 1) {
    if (!editorDuration) return
    setTimelineWindowStart(start => clampTimelineStart(start + direction * timelineWindowDuration * 0.6))
  }

  function fitTimeline() {
    setTimelineZoom(1)
    setTimelineWindowStart(0)
  }

  function handleEditorScrub(event: MouseEvent<HTMLDivElement>) {
    if (!editorTimelineRef.current || !editorDuration) return
    const rect = editorTimelineRef.current.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    seekToTime(timelineWindowStart + ratio * timelineWindowDuration)
  }

  function handleAudioScrub(event: MouseEvent<HTMLDivElement>) {
    if (!audioTimelineRef.current || !editorDuration) return
    const rect = audioTimelineRef.current.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    seekToTime(timelineWindowStart + ratio * timelineWindowDuration)
  }

  useEffect(() => {
    if (!activeVideo?.id) return
    let cancelled = false
    async function loadAudioPeaks() {
      setAudioStatus('loading')
      setAudioPeaks([])
      try {
        const response = await getAudioPeaks(activeVideo!.id, 240)
        if (cancelled) return
        setAudioPeaks(response.peaks)
        setAudioStatus(response.peaks.length > 0 ? 'ready' : 'unavailable')
      } catch {
        if (!cancelled) {
          setAudioStatus('unavailable')
          setAudioPeaks([])
        }
      }
    }
    void loadAudioPeaks()
    return () => {
      cancelled = true
    }
  }, [activeVideo?.id])

  useEffect(() => {
    setTimelineZoom(1)
    setTimelineWindowStart(0)
    setScanResult(null)
    setScanRunId(null)
    setScanStatus('idle')
  }, [activeVideo?.id])

  useEffect(() => {
    if (!scanRunId) return
    let cancelled = false
    let interval: number | undefined
    const poll = async () => {
      try {
        const run = await getRallyScan(scanRunId)
        if (cancelled) return
        setScanResult(run)
        if (run.status === 'done') {
          setScanStatus('done')
          if (interval) window.clearInterval(interval)
        }
        if (run.status === 'error') {
          setScanStatus('idle')
          setError(run.error || 'Rally scan failed.')
          if (interval) window.clearInterval(interval)
        }
      } catch (e) {
        if (!cancelled) {
          setScanStatus('idle')
          setError(e instanceof Error ? e.message : 'Could not get scan progress.')
        }
      }
    }
    void poll()
    interval = window.setInterval(() => {
      void poll()
    }, 1500)
    return () => {
      cancelled = true
      if (interval) window.clearInterval(interval)
    }
  }, [scanRunId])

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
            activeRallyData ? 'border-purple-500' : 'border-yellow-400'
          }`}>
          <video
            ref={videoRef}
            src={activeVideoUrl}
            onTimeUpdate={e => syncRallySelectionForTime(e.currentTarget.currentTime)}
            onSeeked={e => syncRallySelectionForTime(e.currentTarget.currentTime)}
            onLoadedMetadata={e => {
              setDuration(e.currentTarget.duration || 0)
              syncRallySelectionForTime(e.currentTarget.currentTime)
            }}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => setIsPlaying(false)}
            className="w-full max-h-96 bg-black block"
          />
          </div>
          <div className="mt-2 rounded border border-gray-200 bg-white px-3 py-2">
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => void togglePlayback()}
                className="w-16 rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
              >
                {isPlaying ? 'Pause' : 'Play'}
              </button>
              <button onClick={() => void markStart()} className="bg-blue-600 hover:bg-blue-700 text-white rounded px-4 py-1.5 text-sm font-medium">
                Mark Start{!activeRallyData && draftStart != null ? ` (${draftStart.toFixed(2)}s)` : ''}
              </button>
              <button
                onClick={() => void markEnd()}
                disabled={!activeRallyData && draftStart == null}
                className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded px-4 py-1.5 text-sm font-medium"
              >
                Mark End
              </button>
              <button
                onClick={() => activeRallyData && seekToTime(activeRallyData.start_time)}
                disabled={!activeRallyData}
                className="rounded border border-purple-300 px-3 py-1.5 text-sm font-medium text-purple-700 hover:bg-purple-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
                aria-label="jump to rally start"
                title={activeRallyData ? 'Jump to selected rally start' : 'Select a rally to jump to its start'}
              >
                ← Rally Start
              </button>
              <button
                onClick={toggleMute}
                className="w-16 rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                aria-label={isMuted ? 'unmute video' : 'mute video'}
              >
                {isMuted || volume === 0 ? 'Muted' : 'Vol'}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={isMuted ? 0 : volume}
                onChange={e => updateVolume(e.target.value)}
                className="h-2 w-24 accent-purple-600"
                aria-label="video volume"
              />
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.001}
                value={Math.min(currentTimestamp, duration || currentTimestamp)}
                onChange={e => scrubTo(e.target.value)}
                className="h-2 flex-1 accent-purple-600"
                aria-label="video timeline"
              />
              <span className="w-32 text-right font-mono text-xs text-gray-600">
                {currentTimestamp.toFixed(3)}s / {duration ? duration.toFixed(3) : '0.000'}s
              </span>
              <span className={`rounded px-2 py-1 text-xs font-medium ${
                activeRallyData ? 'bg-purple-50 text-purple-700' : 'bg-yellow-50 text-yellow-700'
              }`}>
                {activeRallyData
                  ? `Rally ${activeRallyData.start_time.toFixed(2)}s-${activeRallyData.end_time.toFixed(2)}s`
                  : 'Unmarked'}
              </span>
              <button
                onClick={() => setSettingsOpen(open => !open)}
                className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                Settings
              </button>
            </div>
          </div>
          {settingsOpen && (
            <div className="mt-2 rounded border border-gray-200 bg-white p-3">
              <h2 className="mb-2 text-sm font-semibold text-gray-800">Keybinds</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <KeybindControl
                  label="Play / pause"
                  value={playPauseKey}
                  capturing={capturingKey === 'playPause'}
                  onCaptureStart={() => setCapturingKey('playPause')}
                  onCapture={key => { setPlayPauseKey(key); setCapturingKey(null) }}
                />
                <KeybindControl
                  label="Back one frame"
                  value={previousFrameKey}
                  capturing={capturingKey === 'previous'}
                  onCaptureStart={() => setCapturingKey('previous')}
                  onCapture={key => { setPreviousFrameKey(key); setCapturingKey(null) }}
                />
                <KeybindControl
                  label="Forward one frame"
                  value={nextFrameKey}
                  capturing={capturingKey === 'next'}
                  onCaptureStart={() => setCapturingKey('next')}
                  onCapture={key => { setNextFrameKey(key); setCapturingKey(null) }}
                />
              </div>
            </div>
          )}
          <div className="mt-3 rounded border border-gray-200 bg-white p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-gray-800">Timeline Editor</h2>
                <p className="text-xs text-gray-500">
                  Showing {timelineWindowStart.toFixed(2)}s-{timelineWindowEnd.toFixed(2)}s · zoom {timelineZoom.toFixed(1)}x
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => panTimeline(-1)}
                  disabled={timelineWindowStart <= 0}
                  className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
                >
                  ←
                </button>
                <button
                  onClick={fitTimeline}
                  className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                >
                  Fit
                </button>
                <button
                  onClick={() => panTimeline(1)}
                  disabled={timelineWindowEnd >= editorDuration}
                  className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
                >
                  →
                </button>
                <span className="text-xs text-gray-500">Zoom</span>
                <input
                  type="range"
                  min={1}
                  max={20}
                  step={0.25}
                  value={timelineZoom}
                  onChange={e => setTimelineZoomAround(e.target.value)}
                  className="h-2 w-32 accent-cyan-500"
                  aria-label="timeline zoom"
                />
                <span className="font-mono text-xs text-gray-500">{currentTimestamp.toFixed(3)}s</span>
              </div>
            </div>
            <div className="relative mb-1 h-5 rounded bg-gray-100 text-[10px] text-gray-500">
              {visibleRulerTicks.map(tick => (
                <div
                  key={tick}
                  className="absolute top-0 h-full border-l border-gray-300 pl-1"
                  style={{ left: `${toWindowPercent(tick, timelineWindowStart, timelineWindowDuration)}%` }}
                >
                  {tick.toFixed(1)}s
                </div>
              ))}
            </div>
            <p className="mb-1 text-xs font-medium text-gray-600">Audio Levels</p>
            <div
              ref={audioTimelineRef}
              onClick={handleAudioScrub}
              className="relative h-16 cursor-pointer overflow-hidden rounded bg-gray-950"
              aria-label="audio levels timeline"
              role="slider"
              aria-valuemin={0}
              aria-valuemax={editorDuration}
              aria-valuenow={currentTimestamp}
            >
              {audioStatus === 'ready' && audioPeaks.length > 0 ? (
                audioPeaks.map((peak, index) => {
                  const bucketStart = index / audioPeaks.length * editorDuration
                  const bucketEnd = (index + 1) / audioPeaks.length * editorDuration
                  if (!rangesOverlap(bucketStart, bucketEnd, timelineWindowStart, timelineWindowEnd)) return null
                  return (
                    <div
                      key={`${index}-${peak}`}
                      className="absolute bottom-2 min-w-px rounded-t bg-cyan-300"
                      style={{
                        left: `${toWindowPercent(bucketStart, timelineWindowStart, timelineWindowDuration)}%`,
                        width: `${Math.max(0.25, toWindowWidth(bucketStart, bucketEnd, timelineWindowStart, timelineWindowEnd, timelineWindowDuration))}%`,
                        height: `${Math.max(2, peak * 86)}%`,
                      }}
                      title={`${bucketStart.toFixed(3)}s`}
                    />
                  )
                })
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-gray-300">
                  {audioStatus === 'loading' ? 'Loading audio levels...' : 'Audio levels unavailable'}
                </div>
              )}
              {isInWindow(currentTimestamp, timelineWindowStart, timelineWindowEnd) && (
                <div
                  className="pointer-events-none absolute bottom-0 top-0 w-0.5 bg-white"
                  style={{ left: `${toWindowPercent(currentTimestamp, timelineWindowStart, timelineWindowDuration)}%` }}
                />
              )}
              {draftStart != null && !activeRallyData && isInWindow(draftStart, timelineWindowStart, timelineWindowEnd) && (
                <div
                  className="pointer-events-none absolute bottom-0 top-0 w-0.5 bg-blue-400"
                  style={{ left: `${toWindowPercent(draftStart, timelineWindowStart, timelineWindowDuration)}%` }}
                />
              )}
            </div>
            <div className="mb-2 mt-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-gray-800">Rally Timeline</h2>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                  <span>{activeVideoRallies.length} marked · {unmarkedSections.length} unmarked</span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-3 rounded-sm bg-purple-300" /> Marked
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-3 rounded-sm bg-yellow-200" /> Unmarked
                  </span>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => void runRallyScan()}
                  disabled={scanStatus === 'scanning'}
                  className="rounded border border-emerald-300 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:cursor-wait disabled:border-gray-200 disabled:text-gray-400"
                >
                  {scanStatus === 'scanning' ? 'Scanning...' : 'Scan with Model'}
                </button>
                <button
                  onClick={seekToNextUnmarked}
                  disabled={!unmarkedSections.some(section => section.start > currentTimestamp + 0.001)}
                  className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
                >
                  Next Unmarked
                </button>
                <button
                  onClick={() => seekToTime(latestLabelEnd)}
                  disabled={activeVideoRallies.length === 0}
                  className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
                >
                  Last Label End
                </button>
              </div>
            </div>
            <div
              ref={editorTimelineRef}
              onClick={handleEditorScrub}
              className="relative h-14 cursor-pointer rounded bg-yellow-100"
              aria-label="rally editor timeline"
              role="slider"
              aria-valuemin={0}
              aria-valuemax={editorDuration}
              aria-valuenow={currentTimestamp}
            >
              {unmarkedSections.map(section => (
                rangesOverlap(section.start, section.end, timelineWindowStart, timelineWindowEnd) && (
                <div
                  key={`gap-${section.start}-${section.end}`}
                  className="absolute top-0 h-full border-x border-yellow-300 bg-yellow-100"
                  style={{
                    left: `${toWindowPercent(section.start, timelineWindowStart, timelineWindowDuration)}%`,
                    width: `${toWindowWidth(section.start, section.end, timelineWindowStart, timelineWindowEnd, timelineWindowDuration)}%`,
                  }}
                  title={`Unmarked ${section.start.toFixed(3)}s-${section.end.toFixed(3)}s`}
                />
                )
              ))}
              {activeVideoRallies.map((rally, index) => {
                const isActive = activeRallyData?.id === rally.id
                if (!rangesOverlap(rally.start_time, rally.end_time, timelineWindowStart, timelineWindowEnd)) return null
                return (
                  <button
                    key={rally.id}
                    type="button"
                    onClick={event => {
                      event.stopPropagation()
                      selectRally(activeVideo!.id, rally)
                    }}
                    className={`absolute top-1 h-12 rounded-sm border text-[10px] font-semibold ${
                      isActive
                        ? 'z-10 border-purple-900 bg-purple-600 text-white'
                        : 'border-purple-300 bg-purple-200 text-purple-900 hover:bg-purple-300'
                    }`}
                    style={{
                      left: `${toWindowPercent(rally.start_time, timelineWindowStart, timelineWindowDuration)}%`,
                      width: `${Math.max(0.8, toWindowWidth(rally.start_time, rally.end_time, timelineWindowStart, timelineWindowEnd, timelineWindowDuration))}%`,
                    }}
                    title={`Rally ${index + 1}: ${rally.start_time.toFixed(3)}s-${rally.end_time.toFixed(3)}s`}
                  >
                    {index + 1}
                  </button>
                )
              })}
              {scanResult?.predictions.map(prediction => {
                if (!rangesOverlap(prediction.start_time, prediction.end_time, timelineWindowStart, timelineWindowEnd)) return null
                return (
                  <button
                    key={predictionKey(prediction)}
                    type="button"
                    onClick={event => {
                      event.stopPropagation()
                      seekToTime(prediction.start_time)
                    }}
                    className="absolute top-1 h-12 rounded-sm border border-emerald-500 bg-emerald-300/70 text-[10px] font-semibold text-emerald-950 hover:bg-emerald-300"
                    style={{
                      left: `${toWindowPercent(prediction.start_time, timelineWindowStart, timelineWindowDuration)}%`,
                      width: `${Math.max(0.8, toWindowWidth(prediction.start_time, prediction.end_time, timelineWindowStart, timelineWindowEnd, timelineWindowDuration))}%`,
                    }}
                    title={`Prediction ${(prediction.confidence * 100).toFixed(1)}%: ${prediction.start_time.toFixed(3)}s-${prediction.end_time.toFixed(3)}s`}
                  >
                    {(prediction.confidence * 100).toFixed(0)}%
                  </button>
                )
              })}
              {isInWindow(currentTimestamp, timelineWindowStart, timelineWindowEnd) && (
                <div
                  className="pointer-events-none absolute top-0 h-full w-0.5 bg-gray-900"
                  style={{ left: `${toWindowPercent(currentTimestamp, timelineWindowStart, timelineWindowDuration)}%` }}
                >
                  <span className="absolute left-1 top-0 rounded bg-gray-900 px-1 py-0.5 font-mono text-[10px] text-white">
                    {currentTimestamp.toFixed(3)}s
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <button onClick={() => seek(-5)} className="border rounded px-3 py-1 text-sm">-5s</button>
            <button onClick={() => seek(-0.5)} className="border rounded px-3 py-1 text-sm">-0.5s</button>
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
          {scanResult && (
            <div className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Model predictions</p>
                  <p className="text-xs text-emerald-700">
                    {scanResult.status === 'done'
                      ? `${scanResult.predictions.length} candidates from model ${scanResult.model_id}; scanned ${scanResult.windows_scanned} windows.`
                      : `Scanning model ${scanResult.model_id}: ${scanResult.progress_pct.toFixed(0)}% · ${scanResult.windows_scanned} windows scanned.`}
                  </p>
                </div>
              </div>
              {scanResult.status !== 'done' && (
                <div className="mb-3 h-2 overflow-hidden rounded bg-emerald-100">
                  <div className="h-full rounded bg-emerald-600 transition-all" style={{ width: `${Math.max(0, Math.min(100, scanResult.progress_pct))}%` }} />
                </div>
              )}
              {scanResult.status === 'done' && scanResult.predictions.length === 0 ? (
                <p className="text-sm text-emerald-700">No rally candidates passed the threshold.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {scanResult.predictions.map(prediction => {
                    const key = predictionKey(prediction)
                    return (
                      <div key={key} className="flex flex-wrap items-center justify-between gap-2 rounded bg-white px-3 py-2 text-sm">
                        <button
                          onClick={() => seekToTime(prediction.start_time)}
                          className="font-mono text-xs text-gray-800 hover:text-emerald-700"
                        >
                          {prediction.start_time.toFixed(3)}s-{prediction.end_time.toFixed(3)}s
                        </button>
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800">
                            {(prediction.confidence * 100).toFixed(1)}%
                          </span>
                          <button
                            onClick={() => void savePrediction(prediction)}
                            disabled={savingPredictionKey === key}
                            className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            {savingPredictionKey === key ? 'Saving...' : 'Save'}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {sets.map(({ video, rallies }) => {
        const scoreBlocks = buildScoreBlocks(rallies)
        const finalScore = scoreBlocks.at(-1)
        const selectedBlock = scoreBlocks.find(block => activeRally?.videoId === video.id && activeRally.rallyId === block.rally.id)
        return (
        <div key={video.id} className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <h2 className="font-semibold text-lg">Set {video.set_number}</h2>
            {finalScore && (
              <span className="rounded bg-gray-100 px-2 py-1 font-mono text-xs font-semibold text-gray-700">
                {finalScore.home}-{finalScore.away}
              </span>
            )}
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
            <div className="rounded border border-gray-200 bg-white p-3">
              <div className="mb-3 flex flex-wrap gap-2">
                {scoreBlocks.map(block => {
                  const isActive = activeRally?.rallyId === block.rally.id
                  return (
                    <button
                      key={block.rally.id}
                      type="button"
                      onClick={() => selectRally(video.id, block.rally)}
                      className={`h-12 min-w-12 rounded border px-2 text-left transition ${
                        block.scorer === 'home'
                          ? 'border-green-300 bg-green-100 text-green-900 hover:bg-green-200'
                          : block.scorer === 'away'
                            ? 'border-orange-300 bg-orange-100 text-orange-900 hover:bg-orange-200'
                            : 'border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100'
                      } ${isActive ? 'ring-2 ring-blue-500' : ''}`}
                      title={`Rally ${block.index}: ${block.rally.start_time.toFixed(3)}s-${block.rally.end_time.toFixed(3)}s`}
                    >
                      <span className="block text-[10px] font-semibold leading-none">R{block.index}</span>
                      <span className="block font-mono text-sm font-bold">{block.home}-{block.away}</span>
                    </button>
                  )
                })}
              </div>
              <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-green-200" /> Home scored</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-orange-200" /> Away scored</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-gray-100" /> Score unmarked</span>
              </div>
              {selectedBlock ? (
                <div className="mt-3 rounded border border-blue-200 bg-blue-50 p-3">
                  <div className="mb-3 flex flex-wrap items-center gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Selected rally</p>
                      <p className="font-mono text-sm font-bold text-gray-900">
                        R{selectedBlock.index} · {selectedBlock.home}-{selectedBlock.away}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 text-sm text-gray-600">
                      <input
                        type="number"
                        step="0.5"
                        value={selectedBlock.rally.start_time}
                        onChange={e => handleTimestampPreview('start_time', e.target.value)}
                        onBlur={e => handleTimestampBlur(selectedBlock.rally, 'start_time', e.target.value)}
                        className="w-24 border rounded px-2 py-1 text-xs"
                        aria-label="start time"
                      />
                      <span>-</span>
                      <input
                        type="number"
                        step="0.5"
                        value={selectedBlock.rally.end_time}
                        onChange={e => handleTimestampPreview('end_time', e.target.value)}
                        onBlur={e => handleTimestampBlur(selectedBlock.rally, 'end_time', e.target.value)}
                        className="w-24 border rounded px-2 py-1 text-xs"
                        aria-label="end time"
                      />
                      <span className="ml-1 text-gray-400">s</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => void playSelectedRally(selectedBlock.rally)}
                      className="bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded text-xs font-medium"
                      aria-label={`play rally ${selectedBlock.rally.id}`}
                    >
                      Play
                    </button>
                    <button
                      onClick={() => void scoreHome(selectedBlock.rally)}
                      className="bg-green-100 hover:bg-green-200 text-green-800 px-3 py-1.5 rounded text-xs font-medium"
                    >
                      Home Scored
                    </button>
                    <button
                      onClick={() => void scoreAway(selectedBlock.rally)}
                      className="bg-orange-100 hover:bg-orange-200 text-orange-800 px-3 py-1.5 rounded text-xs font-medium"
                    >
                      Away Scored
                    </button>
                    <button
                      onClick={() => void removeRally(selectedBlock.rally)}
                      className="bg-red-50 hover:bg-red-100 text-red-700 px-3 py-1.5 rounded text-xs font-medium"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500">
                  Select a rally block to edit its score, time, or delete it.
                </div>
              )}
            </div>
          )}
        </div>
      )})}

      <div className="mt-4">
        <Link to={`/matches/${matchId}/export`} className="text-blue-600 hover:underline text-sm">
          Go to Export →
        </Link>
      </div>
    </div>
  )
}

function toWindowPercent(value: number, windowStart: number, windowDuration: number) {
  if (!windowDuration || windowDuration <= 0) return 0
  return Math.min(100, Math.max(0, ((value - windowStart) / windowDuration) * 100))
}

function toWindowWidth(start: number, end: number, windowStart: number, windowEnd: number, windowDuration: number) {
  if (!windowDuration || windowDuration <= 0) return 0
  const visibleStart = Math.max(start, windowStart)
  const visibleEnd = Math.min(end, windowEnd)
  return Math.max(0, ((visibleEnd - visibleStart) / windowDuration) * 100)
}

function rangesOverlap(start: number, end: number, windowStart: number, windowEnd: number) {
  return start < windowEnd && end > windowStart
}

function isInWindow(time: number, windowStart: number, windowEnd: number) {
  return time >= windowStart && time <= windowEnd
}

function predictionKey(prediction: RallyPrediction) {
  return `${prediction.source_model_id}-${prediction.start_time.toFixed(3)}-${prediction.end_time.toFixed(3)}`
}

function buildRulerTicks(start: number, end: number, count: number) {
  if (end <= start || count <= 1) return [start]
  const step = (end - start) / (count - 1)
  return Array.from({ length: count }, (_, index) => start + step * index)
}

function buildUnmarkedSections(rallies: Rally[], duration: number) {
  if (!duration || duration <= 0) return []
  const sections: Array<{ start: number; end: number }> = []
  let cursor = 0
  for (const rally of rallies) {
    if (rally.start_time > cursor) {
      sections.push({ start: cursor, end: rally.start_time })
    }
    cursor = Math.max(cursor, rally.end_time)
  }
  if (cursor < duration) {
    sections.push({ start: cursor, end: duration })
  }
  return sections
}

function buildScoreBlocks(rallies: Rally[]) {
  let home = 0
  let away = 0
  return [...rallies]
    .sort((a, b) => a.start_time - b.start_time)
    .map((rally, index) => {
      const previousHome = home
      const previousAway = away
      let scorer: 'home' | 'away' | null = null

      if (rally.score_home != null && rally.score_away != null) {
        home = rally.score_home
        away = rally.score_away
        if (home > previousHome && away === previousAway) scorer = 'home'
        else if (away > previousAway && home === previousHome) scorer = 'away'
        else if (home > previousHome || away > previousAway) {
          scorer = home - previousHome >= away - previousAway ? 'home' : 'away'
        }
      } else if (rally.score_home != null) {
        home += 1
        scorer = 'home'
      } else if (rally.score_away != null) {
        away += 1
        scorer = 'away'
      }

      return {
        rally,
        index: index + 1,
        scorer,
        home,
        away,
      }
    })
}

function nextScoreForRally(rallies: Rally[], rally: Rally, scorer: 'home' | 'away') {
  const sorted = [...rallies].sort((a, b) => a.start_time - b.start_time)
  const rallyIndex = sorted.findIndex(candidate => candidate.id === rally.id)
  const previousBlocks = buildScoreBlocks(rallyIndex > 0 ? sorted.slice(0, rallyIndex) : [])
  const previous = previousBlocks.at(-1)
  const home = previous?.home ?? 0
  const away = previous?.away ?? 0

  return scorer === 'home'
    ? { score_home: home + 1, score_away: away }
    : { score_home: home, score_away: away + 1 }
}

function KeybindControl({
  label,
  value,
  capturing,
  onCaptureStart,
  onCapture,
}: {
  label: string
  value: string
  capturing: boolean
  onCaptureStart: () => void
  onCapture: (key: string) => void
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-gray-700">{label}</span>
      <button
        type="button"
        onClick={onCaptureStart}
        onKeyDown={e => {
          if (!capturing) return
          e.preventDefault()
          e.stopPropagation()
          onCapture(e.key)
        }}
        className={`rounded border px-3 py-2 text-left font-mono text-xs ${
          capturing ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-300 bg-gray-50 text-gray-700'
        }`}
      >
        {capturing ? 'Press a key...' : formatKeyName(value)}
      </button>
    </label>
  )
}

function formatKeyName(key: string) {
  return key === ' ' ? 'Space' : key
}
