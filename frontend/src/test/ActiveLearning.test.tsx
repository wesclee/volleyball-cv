import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import ActiveLearning from '../views/ActiveLearning'
import type { FrameSplit } from '../types'

vi.mock('../api/client', () => ({
  getBootstrapStatus: vi.fn(),
  getFrames: vi.fn(),
  startExtraction: vi.fn(),
  annotateFrame: vi.fn(),
  skipFrame: vi.fn(),
  getFrameImageUrl: vi.fn((id: number) => `http://fake/frame/${id}`),
  startTraining: vi.fn(),
  getTrainingRun: vi.fn(),
  getModels: vi.fn(),
  promoteModel: vi.fn(),
  runReconcile: vi.fn(),
}))

import * as api from '../api/client'

const mockStatus = (overrides = {}) => ({
  frames_total: 0, annotated: 0, skipped: 0, pending: 0, missing: 0,
  model_ready: false, active_model_id: null, ...overrides,
})

const mockFrame = (overrides: Partial<Record<string, any>> = {}) => ({
  id: 1, video_id: 1, frame_number: 0, timestamp: 0.0,
  img_path: '/fake/frame.jpg', label_path: '/fake/label.txt',
  split: 'train' as const satisfies FrameSplit, review_status: 'pending' as const, created_at: '2026-05-19T00:00:00',
  ...overrides,
})

describe('ActiveLearning Phase A', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows frame count and progress', async () => {
    vi.mocked(api.getBootstrapStatus).mockResolvedValue(mockStatus({ annotated: 50, frames_total: 100 }))
    vi.mocked(api.getFrames).mockResolvedValue([mockFrame()])
    render(<ActiveLearning />)
    await waitFor(() => expect(screen.getByText(/50 \/ 100/)).toBeInTheDocument())
  })

  it('shows Start Training button only when model_ready is true', async () => {
    vi.mocked(api.getBootstrapStatus).mockResolvedValue(mockStatus({ annotated: 200, frames_total: 200, model_ready: true }))
    vi.mocked(api.getFrames).mockResolvedValue([])
    render(<ActiveLearning />)
    await waitFor(() => expect(screen.getByText('Start Training')).not.toBeDisabled())
  })

  it('Start Training button is disabled when model_ready is false', async () => {
    vi.mocked(api.getBootstrapStatus).mockResolvedValue(mockStatus({ annotated: 5, frames_total: 10, model_ready: false }))
    vi.mocked(api.getFrames).mockResolvedValue([mockFrame()])
    render(<ActiveLearning />)
    await waitFor(() => expect(screen.getByText('Start Training')).toBeDisabled())
  })

  it('clicking No ball calls skipFrame and loads next frame', async () => {
    vi.mocked(api.getBootstrapStatus).mockResolvedValue(mockStatus({ frames_total: 2, pending: 2 }))
    const frame1 = mockFrame({ id: 1 })
    const frame2 = mockFrame({ id: 2, frame_number: 1 })
    vi.mocked(api.getFrames).mockResolvedValue([frame1, frame2])
    vi.mocked(api.skipFrame).mockResolvedValue({ ...frame1, review_status: 'skipped' })

    render(<ActiveLearning />)
    await waitFor(() => screen.getByText('No ball'))
    fireEvent.click(screen.getByText('No ball'))
    await waitFor(() => expect(api.skipFrame).toHaveBeenCalledWith(1))
  })

  it('clicking Skip does not call annotateFrame or skipFrame', async () => {
    vi.mocked(api.getBootstrapStatus).mockResolvedValue(mockStatus({ frames_total: 1, pending: 1 }))
    vi.mocked(api.getFrames).mockResolvedValue([mockFrame()])
    render(<ActiveLearning />)
    await waitFor(() => screen.getByText('Skip'))
    fireEvent.click(screen.getByText('Skip'))
    expect(api.annotateFrame).not.toHaveBeenCalled()
    expect(api.skipFrame).not.toHaveBeenCalled()
  })
})

describe('ActiveLearning Phase B — promotion', () => {
  it('shows promotion table after training completes', async () => {
    const mockRun = {
      id: 1, status: 'done', base_model_id: null, new_model_id: 2,
      frames_used: 200, epochs: 50, final_loss: 0.05, duration_s: 300, error: null,
      created_at: '2026-05-19T00:00:00',
    }
    const mockNewModel = {
      id: 2, name: 'v1', weights_path: '/w.pt', dataset_size: 200,
      test_precision: 0.85, test_recall: 0.82, test_map50: 0.83,
      is_active: false, created_at: '2026-05-19T00:00:00',
    }
    vi.mocked(api.getTrainingRun).mockResolvedValue(mockRun as any)
    vi.mocked(api.getModels).mockResolvedValue([mockNewModel])
    vi.mocked(api.promoteModel).mockResolvedValue({ ...mockNewModel, is_active: true })

    const { PromotionPanel } = await import('../views/ActiveLearning')
    render(<PromotionPanel runId={1} oldModel={null} newModel={mockNewModel as any} onPromoted={() => {}} />)

    expect(screen.getByText(/0.85/)).toBeInTheDocument()
    expect(screen.getByText('Promote')).not.toBeDisabled()
  })

  it('disables Promote when net_delta is negative', async () => {
    const oldModel = {
      id: 1, name: 'old', weights_path: '/w.pt', dataset_size: 200,
      test_precision: 0.95, test_recall: 0.95, test_map50: 0.95,
      is_active: true, created_at: '2026-05-19T00:00:00',
    }
    const newModel = {
      id: 2, name: 'new', weights_path: '/w2.pt', dataset_size: 200,
      test_precision: 0.7, test_recall: 0.7, test_map50: 0.7,
      is_active: false, created_at: '2026-05-19T00:00:00',
    }

    const { PromotionPanel } = await import('../views/ActiveLearning')
    render(<PromotionPanel runId={1} oldModel={oldModel as any} newModel={newModel as any} onPromoted={() => {}} />)

    expect(screen.getByText('Promote')).toBeDisabled()
    expect(screen.getByText(/did not improve/i)).toBeInTheDocument()
  })
})
