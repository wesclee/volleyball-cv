// frontend/src/test/MatchManager.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/client'
import MatchManager from '../views/MatchManager'
import type { Match } from '../types'

vi.mock('../api/client')

const MATCH: Match = {
  id: 1,
  date: '2026-05-18',
  opponent: 'Team A',
  venue: null,
  notes: null,
  created_at: '2026-05-18T00:00:00',
}

describe('MatchManager', () => {
  beforeEach(() => {
    vi.mocked(api.getMatches).mockResolvedValue([MATCH])
    vi.mocked(api.createMatch).mockResolvedValue({ ...MATCH, id: 2, date: '2026-06-01' })
  })

  it('renders a list of matches', async () => {
    render(<MemoryRouter><MatchManager /></MemoryRouter>)
    await screen.findByText('2026-05-18')
    expect(screen.getByText('vs Team A')).toBeInTheDocument()
  })

  it('shows empty state when no matches', async () => {
    vi.mocked(api.getMatches).mockResolvedValue([])
    render(<MemoryRouter><MatchManager /></MemoryRouter>)
    await screen.findByText(/no matches yet/i)
  })

  it('creates a match and navigates on submit', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><MatchManager /></MemoryRouter>)
    await screen.findByText('2026-05-18')

    await user.type(screen.getByPlaceholderText(/opponent/i), 'Rivals')
    const dateInput = screen.getByLabelText(/date/i)
    await user.type(dateInput, '2026-06-01')
    await user.click(screen.getByRole('button', { name: /new match/i }))

    await waitFor(() => expect(api.createMatch).toHaveBeenCalledWith(
      expect.objectContaining({ opponent: 'Rivals' }),
    ))
  })

  it('shows Upload and Rally Review links per match', async () => {
    render(<MemoryRouter><MatchManager /></MemoryRouter>)
    await screen.findByText('2026-05-18')
    expect(screen.getByRole('link', { name: /upload/i })).toHaveAttribute('href', '/matches/1/upload')
    expect(screen.getByRole('link', { name: /rally review/i })).toHaveAttribute('href', '/matches/1/rally-review')
  })
})
