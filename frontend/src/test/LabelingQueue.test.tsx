// frontend/src/test/LabelingQueue.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import LabelingQueue, { PromotionPanel } from '../views/LabelingQueue'
import type { LabelingStatus, LabeledFrame, ModelVersion } from '../types'

vi.mock('../api/client', () => ({
  getLabelingStatus: vi.fn(),
  getLabelingQueue: vi.fn(),
  getFrames: vi.fn(),
  getAllVideos: vi.fn().mockResolvedValue([]),
  getTrainingVideos: vi.fn().mockResolvedValue([]),
  getFrameImageUrl: vi.fn((id: number) => `/frames/${id}`),
  annotateFrame: vi.fn().mockResolvedValue({}),
  skipFrame: vi.fn().mockResolvedValue({}),
  uploadTrainingVideo: vi.fn().mockResolvedValue({ id: 9 }),
  deleteTrainingVideo: vi.fn().mockResolvedValue(undefined),
  startExtraction: vi.fn().mockResolvedValue({ video_id: 1 }),
  startTraining: vi.fn().mockResolvedValue({ run_id: 1 }),
  getTrainingRun: vi.fn(),
  getModels: vi.fn(),
  promoteModel: vi.fn(),
}))

import * as client from '../api/client'

const noModelStatus: LabelingStatus = {
  frames_total: 0, source_videos_total: 0, source_videos_labeled: 0,
  annotated: 0, skipped: 0, pending: 0, missing: 0,
  model_ready: false, active_model_id: null,
  new_labeled_since_last_train: 0, retrain_recommended: false,
  retrain_threshold: 50, last_trained_at_size: null,
}

const withModelStatus: LabelingStatus = {
  ...noModelStatus,
  active_model_id: 1,
  frames_total: 3, pending: 3,
}

function mockFrame(id: number, predConf: number | null = null): LabeledFrame {
  return {
    id, video_id: 1, frame_number: id * 10, timestamp: id * 0.5,
    img_path: `/frames/${id}.jpg`, label_path: `/labels/${id}.txt`,
    split: 'train',
    review_status: 'pending',
    pred_cx: predConf != null ? 0.5 : null,
    pred_cy: predConf != null ? 0.5 : null,
    pred_w: predConf != null ? 0.1 : null,
    pred_h: predConf != null ? 0.1 : null,
    pred_conf: predConf,
    label_cx: null,
    label_cy: null,
    label_w: null,
    label_h: null,
    created_at: '2026-01-01T00:00:00',
  }
}

describe('LabelingQueue — bootstrap mode', () => {
  beforeEach(() => {
    vi.mocked(client.getLabelingStatus).mockResolvedValue(noModelStatus)
    vi.mocked(client.getFrames).mockResolvedValue([])
    vi.mocked(client.getLabelingQueue).mockResolvedValue([])
  })

  it('shows ball labeling heading when no active model', async () => {
    render(<LabelingQueue />)
    await waitFor(() => {
      expect(screen.getByText(/Ball Detection Training/i)).toBeInTheDocument()
    })
  })

  it('does not show retrain panel when no model', async () => {
    render(<LabelingQueue />)
    await waitFor(() => screen.getByText(/Ball Detection Training/i))
    expect(screen.queryByText(/new frames/i)).not.toBeInTheDocument()
  })
})

describe('LabelingQueue — active review mode', () => {
  beforeEach(() => {
    vi.mocked(client.getLabelingStatus).mockResolvedValue(withModelStatus)
    vi.mocked(client.getFrames).mockResolvedValue([])
    vi.mocked(client.getLabelingQueue).mockResolvedValue([
      mockFrame(1, 0.5),
      mockFrame(2, 0.7),
    ])
  })

  it('shows retrain panel with counter when model exists', async () => {
    render(<LabelingQueue />)
    await waitFor(() => {
      expect(screen.getByText(/new frames/i)).toBeInTheDocument()
    })
  })

  it('retrain button not highlighted when below threshold', async () => {
    render(<LabelingQueue />)
    await waitFor(() => screen.getByRole('button', { name: /retrain/i }))
    const btn = screen.getByRole('button', { name: /retrain/i })
    expect(btn).not.toHaveClass('bg-green-600')
  })

  it('retrain button highlighted when recommended', async () => {
    vi.mocked(client.getLabelingStatus).mockResolvedValue({
      ...withModelStatus, retrain_recommended: true,
    })
    render(<LabelingQueue />)
    await waitFor(() => screen.getByRole('button', { name: /retrain/i }))
    expect(screen.getByRole('button', { name: /retrain/i })).toHaveClass('bg-green-600')
  })

  it('no-ball action calls skipFrame', async () => {
    render(<LabelingQueue />)
    await waitFor(() => screen.getByText(/No ball/i))
    fireEvent.click(screen.getByText(/No ball/i))
    await waitFor(() => {
      expect(client.skipFrame).toHaveBeenCalledWith(1)
    })
  })

  it('can switch to all frames and shows frame id/status', async () => {
    vi.mocked(client.getFrames).mockImplementation((params = {}) => {
      if ('offset' in params || 'limit' in params) {
        return Promise.resolve([{ ...mockFrame(8, null), review_status: 'annotated', label_cx: 0.5, label_cy: 0.5, label_w: 0.1, label_h: 0.1 }])
      }
      return Promise.resolve([])
    })
    render(<LabelingQueue />)
    await waitFor(() => screen.getByRole('button', { name: /all frames/i }))
    fireEvent.click(screen.getByRole('button', { name: /all frames/i }))
    await waitFor(() => {
      expect(screen.getByText('8')).toBeInTheDocument()
      expect(screen.getByText(/annotated/i)).toBeInTheDocument()
    })
  })

  it('deletes training footage', async () => {
    vi.mocked(client.getTrainingVideos).mockResolvedValue([
      { id: 9, match_id: 2, set_number: 1, raw_path: '/uploads/t.mp4', status: 'done', duration: null, created_at: '' },
    ])
    render(<LabelingQueue />)
    await waitFor(() => screen.getByText(/training footage/i))
    fireEvent.click(screen.getByRole('button', { name: /delete/i }))
    await waitFor(() => {
      expect(client.deleteTrainingVideo).toHaveBeenCalledWith(9)
    })
  })

  it('retrain button transitions to training phase', async () => {
    vi.mocked(client.getLabelingStatus).mockResolvedValue({
      ...withModelStatus, retrain_recommended: true,
    })
    vi.mocked(client.getTrainingRun).mockResolvedValue({
      id: 1, status: 'pending', base_model_id: null, new_model_id: null,
      frames_used: null, epochs: null, final_loss: null, duration_s: null,
      error: null, created_at: '2026-01-01T00:00:00',
    })
    render(<LabelingQueue />)
    await waitFor(() => screen.getByRole('button', { name: /retrain/i }))
    fireEvent.click(screen.getByRole('button', { name: /retrain/i }))
    await waitFor(() => {
      expect(client.startTraining).toHaveBeenCalled()
    })
  })
})

describe('PromotionPanel', () => {
  const newModel: ModelVersion = {
    id: 2, name: 'v2', weights_path: '/w.pt', dataset_size: 300,
    test_precision: 0.92, test_recall: 0.88, test_map50: 0.91,
    is_active: false, created_at: '2026-01-01T00:00:00',
  }
  const oldModel: ModelVersion = {
    ...newModel, id: 1, name: 'v1',
    test_precision: 0.88, test_recall: 0.85, test_map50: 0.87,
    is_active: true,
  }

  it('enables promote when net_delta > 0', () => {
    render(<PromotionPanel runId={1} oldModel={oldModel} newModel={newModel} onPromoted={() => {}} />)
    expect(screen.getByRole('button', { name: /promote/i })).not.toBeDisabled()
  })

  it('disables promote when net_delta <= 0', () => {
    const worseModel = { ...newModel, test_precision: 0.80, test_recall: 0.80, test_map50: 0.80 }
    render(<PromotionPanel runId={1} oldModel={oldModel} newModel={worseModel} onPromoted={() => {}} />)
    expect(screen.getByRole('button', { name: /promote/i })).toBeDisabled()
  })
})
