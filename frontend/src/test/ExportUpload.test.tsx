// frontend/src/test/ExportUpload.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/client'
import ExportUpload from '../views/ExportUpload'
import type { Match, ProcessedVideo } from '../types'

vi.mock('../api/client')

const MATCH: Match = { id: 1, date: '2026-05-18', opponent: 'Team A', venue: null, notes: null, created_at: '' }
const PV: ProcessedVideo = {
  id: 3,
  match_id: 1,
  output_path: '/data/exports/export_match1_set1.mp4',
  created_at: '',
}

function renderWithRoute(matchId = '1') {
  return render(
    <MemoryRouter initialEntries={[`/matches/${matchId}/export`]}>
      <Routes>
        <Route path="/matches/:matchId/export" element={<ExportUpload />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ExportUpload', () => {
  beforeEach(() => {
    vi.mocked(api.getMatch).mockResolvedValue(MATCH)
    vi.mocked(api.exportMatch).mockResolvedValue([PV])
  })

  it('shows match title and export button', async () => {
    renderWithRoute()
    await screen.findByText(/2026-05-18/)
    expect(screen.getByRole('button', { name: /generate export/i })).toBeInTheDocument()
  })

  it('clicking Generate Export calls exportMatch and shows download link', async () => {
    const user = userEvent.setup()
    renderWithRoute()
    await screen.findByText(/2026-05-18/)
    await user.click(screen.getByRole('button', { name: /generate export/i }))
    await waitFor(() => expect(api.exportMatch).toHaveBeenCalledWith(1))
    await screen.findByRole('link', { name: /download/i })
  })

  it('download link points to backend export file', async () => {
    const user = userEvent.setup()
    renderWithRoute()
    await screen.findByText(/2026-05-18/)
    await user.click(screen.getByRole('button', { name: /generate export/i }))
    const link = await screen.findByRole('link', { name: /download/i })
    expect(link).toHaveAttribute('href', expect.stringContaining('export_match1_set1.mp4'))
  })

  it('shows exporting state while request is in flight', async () => {
    vi.mocked(api.exportMatch).mockReturnValue(new Promise(() => {}))
    const user = userEvent.setup()
    renderWithRoute()
    await screen.findByText(/2026-05-18/)
    await user.click(screen.getByRole('button', { name: /generate export/i }))
    expect(screen.getByRole('button', { name: /exporting/i })).toBeDisabled()
  })
})
