// frontend/src/test/UploadProcess.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/client'
import UploadProcess from '../views/UploadProcess'
import type { Job, Match, Video } from '../types'

vi.mock('../api/client')

const MATCH: Match = { id: 1, date: '2026-05-18', opponent: 'Team A', venue: null, notes: null, created_at: '' }
const VIDEO: Video = { id: 10, match_id: 1, set_number: 1, raw_path: '/tmp/x.mp4', status: 'pending', duration: null, created_at: '' }
const JOB_DONE: Job = { id: 5, video_id: 10, status: 'done', progress_pct: 100, error: null, created_at: '' }

function renderWithRoute(matchId = '1') {
  return render(
    <MemoryRouter initialEntries={[`/matches/${matchId}/upload`]}>
      <Routes>
        <Route path="/matches/:matchId/upload" element={<UploadProcess />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('UploadProcess', () => {
  beforeEach(() => {
    vi.mocked(api.getMatch).mockResolvedValue(MATCH)
    vi.mocked(api.uploadVideo).mockResolvedValue(VIDEO)
    vi.mocked(api.processVideo).mockResolvedValue({ ...JOB_DONE, status: 'pending', progress_pct: 0 })
    vi.mocked(api.getJob).mockResolvedValue(JOB_DONE)
  })

  it('shows match title and three set panels', async () => {
    renderWithRoute()
    await screen.findByText(/2026-05-18/)
    expect(screen.getAllByRole('heading', { level: 2, name: /set [123]/i })).toHaveLength(3)
  })

  it('upload button is disabled with no file selected', async () => {
    renderWithRoute()
    await screen.findByText(/2026-05-18/)
    const buttons = screen.getAllByRole('button', { name: /upload/i })
    expect(buttons[0]).toBeDisabled()
  })

  it('uploads file and shows progress bar', async () => {
    const user = userEvent.setup()
    renderWithRoute()
    await screen.findByText(/2026-05-18/)

    const file = new File(['video'], 'set1.mp4', { type: 'video/mp4' })
    const inputs = screen.getAllByLabelText(/set [123]/i)
    await user.upload(inputs[0], file)

    const button = screen.getAllByRole('button', { name: /upload/i })[0]
    await user.click(button)

    await waitFor(() => expect(api.uploadVideo).toHaveBeenCalledWith(1, 1, file, expect.any(Function)))
    await waitFor(() => expect(api.processVideo).toHaveBeenCalledWith(10))
  })

  it('shows upload progress bar with percentage during upload', async () => {
    let resolveUpload!: (v: typeof VIDEO) => void
    vi.mocked(api.uploadVideo).mockImplementation((_mid, _sn, _file, onProgress) => {
      onProgress?.(60)
      return new Promise(res => { resolveUpload = res })
    })

    const user = userEvent.setup()
    renderWithRoute()
    await screen.findByText(/2026-05-18/)

    const file = new File(['video'], 'set1.mp4', { type: 'video/mp4' })
    await user.upload(screen.getAllByLabelText(/set [123]/i)[0], file)
    await user.click(screen.getAllByRole('button', { name: /upload/i })[0])

    await waitFor(() => {
      expect(screen.getByText(/Uploading… 60%/i)).toBeInTheDocument()
    })

    resolveUpload(VIDEO)
  })

  it('shows processing bar after upload completes', async () => {
    const user = userEvent.setup()
    renderWithRoute()
    await screen.findByText(/2026-05-18/)

    const file = new File(['video'], 'set1.mp4', { type: 'video/mp4' })
    await user.upload(screen.getAllByLabelText(/set [123]/i)[0], file)
    await user.click(screen.getAllByRole('button', { name: /upload/i })[0])

    await waitFor(() => {
      expect(screen.getByText(/Processing…/i)).toBeInTheDocument()
    })
  })
})
