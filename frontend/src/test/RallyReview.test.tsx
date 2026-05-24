// frontend/src/test/RallyReview.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/client'
import RallyReview from '../views/RallyReview'
import type { Match, Rally, Video } from '../types'

vi.mock('../api/client')

const MATCH: Match = { id: 1, date: '2026-05-18', opponent: null, venue: null, notes: null, created_at: '' }
const VIDEO: Video = { id: 10, match_id: 1, set_number: 1, raw_path: '/uploads/s.mp4', status: 'done', duration: 600, created_at: '' }
const RALLY: Rally = { id: 20, video_id: 10, start_time: 30.0, end_time: 65.0, score_home: null, score_away: null, confidence: 1.0 }

function renderWithRoute(matchId = '1') {
  return render(
    <MemoryRouter initialEntries={[`/matches/${matchId}/rally-review`]}>
      <Routes>
        <Route path="/matches/:matchId/rally-review" element={<RallyReview />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RallyReview', () => {
  beforeEach(() => {
    vi.mocked(api.getMatch).mockResolvedValue(MATCH)
    vi.mocked(api.getMatchVideos).mockResolvedValue([VIDEO])
    vi.mocked(api.getRallies).mockResolvedValue([RALLY])
    vi.mocked(api.patchRally).mockResolvedValue({ ...RALLY, score_home: 1, score_away: 0 })
    vi.mocked(api.createRally).mockResolvedValue({ ...RALLY, id: 21, start_time: 70, end_time: 80 })
    vi.mocked(api.deleteRally).mockResolvedValue(undefined)
  })

  it('renders match title and set heading', async () => {
    renderWithRoute()
    await screen.findByText('2026-05-18')
    await screen.findByText(/set 1/i)
  })

  it('renders rally with timestamps as editable inputs', async () => {
    renderWithRoute()
    // Timestamps render inside <input type="number">, not as text nodes
    await screen.findByDisplayValue('30')
    expect(screen.getByDisplayValue('65')).toBeInTheDocument()
  })

  it('clicking Home Scored patches rally score_home', async () => {
    const user = userEvent.setup()
    renderWithRoute()
    await screen.findByDisplayValue('30')
    await user.click(screen.getByRole('button', { name: /home scored/i }))
    await waitFor(() => expect(api.patchRally).toHaveBeenCalledWith(20, expect.objectContaining({ score_home: 1 })))
  })

  it('clicking Away Scored patches rally score_away', async () => {
    const user = userEvent.setup()
    renderWithRoute()
    await screen.findByDisplayValue('30')
    await user.click(screen.getByRole('button', { name: /away scored/i }))
    await waitFor(() => expect(api.patchRally).toHaveBeenCalledWith(20, expect.objectContaining({ score_away: 1 })))
  })

  it('shows no rallies message when list is empty', async () => {
    vi.mocked(api.getRallies).mockResolvedValue([])
    renderWithRoute()
    await screen.findByText(/set 1/i)
    expect(screen.getByText(/no rallies labelled/i)).toBeInTheDocument()
  })

  it('creates a manual rally from marked start and end', async () => {
    const user = userEvent.setup()
    renderWithRoute()
    const video = await screen.findByRole('button', { name: /mark start/i })
    const media = document.querySelector('video') as HTMLVideoElement
    Object.defineProperty(media, 'currentTime', { value: 70, writable: true })
    await user.click(video)
    media.currentTime = 80
    await user.click(screen.getByRole('button', { name: /^mark end$/i }))
    await waitFor(() => expect(api.createRally).toHaveBeenCalledWith(10, { start_time: 70, end_time: 80 }))
  })

  it('deletes a bad rally', async () => {
    const user = userEvent.setup()
    renderWithRoute()
    await screen.findByDisplayValue('30')
    await user.click(screen.getByRole('button', { name: /delete/i }))
    await waitFor(() => expect(api.deleteRally).toHaveBeenCalledWith(20))
  })
})
