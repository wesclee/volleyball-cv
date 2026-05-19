import { test, expect } from '@playwright/test'
import {
  BOOTSTRAP_FRAME, LABELED_FRAME, LABELING_STATUS_NO_MODEL,
  LABELING_STATUS_WITH_MODEL, MODEL_VERSION, VIDEO,
  mockAllVideos, mockBootstrapFrames, mockLabelingQueue,
  mockLabelingStatus,
} from './fixtures'

test.describe('Active Learning — bootstrap mode (no model)', () => {
  test.beforeEach(async ({ page }) => {
    await mockLabelingStatus(page, LABELING_STATUS_NO_MODEL)
    await mockLabelingQueue(page, [])
  })

  test('shows Active Learning heading', async ({ page }) => {
    await mockBootstrapFrames(page, [])
    await mockAllVideos(page, [])
    await page.goto('/active-learning')

    await expect(page.getByRole('heading', { name: 'Active Learning' })).toBeVisible()
  })

  test('shows no-frames message when no frames extracted and no processed videos', async ({ page }) => {
    await mockBootstrapFrames(page, [])
    await mockAllVideos(page, [])
    await page.goto('/active-learning')

    await expect(page.getByText(/no frames extracted yet/i)).toBeVisible()
  })

  test('shows Extract Frames button for each processed video', async ({ page }) => {
    await mockBootstrapFrames(page, [])
    await mockAllVideos(page, [VIDEO])
    await page.goto('/active-learning')

    await expect(page.getByRole('button', { name: /extract frames/i })).toBeVisible()
    await expect(page.getByText(`Video ${VIDEO.id}`)).toBeVisible()
    await expect(page.getByText(`match ${VIDEO.match_id}`)).toBeVisible()
    await expect(page.getByText(`set ${VIDEO.set_number}`)).toBeVisible()
  })

  test('does not show Extract Frames section when no processed videos', async ({ page }) => {
    await mockBootstrapFrames(page, [])
    await mockAllVideos(page, [])
    await page.goto('/active-learning')

    await expect(page.getByRole('button', { name: /extract frames/i })).not.toBeVisible()
  })

  test('shows annotation canvas and controls when bootstrap frames exist', async ({ page }) => {
    await mockBootstrapFrames(page, [BOOTSTRAP_FRAME])
    await mockAllVideos(page, [])
    await page.goto('/active-learning')

    await expect(page.getByRole('button', { name: /confirm/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /no ball/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /skip/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /redo/i })).toBeVisible()
  })

  test('shows frame counter when frames are present', async ({ page }) => {
    await mockBootstrapFrames(page, [BOOTSTRAP_FRAME])
    await mockAllVideos(page, [])
    await page.goto('/active-learning')

    await expect(page.getByText(/frame 1 of 1/i)).toBeVisible()
  })

  test('shows annotated/total count and Start Training button', async ({ page }) => {
    await mockBootstrapFrames(page, [])
    await mockAllVideos(page, [])
    await mockLabelingStatus(page, { ...LABELING_STATUS_NO_MODEL, frames_total: 300, annotated: 150 })
    await page.goto('/active-learning')

    await expect(page.getByText(/150 \/ 300/)).toBeVisible()
    await expect(page.getByRole('button', { name: /start training/i })).toBeVisible()
  })

  test('Start Training button is disabled until model_ready is true', async ({ page }) => {
    await mockBootstrapFrames(page, [])
    await mockAllVideos(page, [])
    await mockLabelingStatus(page, { ...LABELING_STATUS_NO_MODEL, model_ready: false })
    await page.goto('/active-learning')

    await expect(page.getByRole('button', { name: /start training/i })).toBeDisabled()
  })
})

test.describe('Active Learning — active review mode (model exists)', () => {
  test.beforeEach(async ({ page }) => {
    await mockLabelingStatus(page, LABELING_STATUS_WITH_MODEL)
    await mockBootstrapFrames(page, [])
    await mockAllVideos(page, [])
  })

  test('shows retrain panel with frame counter', async ({ page }) => {
    await mockLabelingQueue(page, [])
    await page.goto('/active-learning')

    await expect(page.getByText(/60 \/ 50 new frames/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /retrain/i })).toBeVisible()
  })

  test('retrain button is highlighted when retrain_recommended', async ({ page }) => {
    await mockLabelingQueue(page, [])
    await page.goto('/active-learning')

    const btn = page.getByRole('button', { name: /retrain/i })
    await expect(btn).toHaveClass(/bg-green-600/)
  })

  test('shows queue frame with predicted confidence', async ({ page }) => {
    await mockLabelingQueue(page, [LABELED_FRAME])
    await page.route('http://localhost:8000/bootstrap/frames/*/image', route =>
      route.fulfill({ body: Buffer.alloc(0), contentType: 'image/jpeg' }),
    )
    await page.goto('/active-learning')

    await expect(page.getByText(/conf 0\.65/i)).toBeVisible()
  })

  test('shows Confirm No ball Skip Redo buttons for queue frame', async ({ page }) => {
    await mockLabelingQueue(page, [LABELED_FRAME])
    await page.route('http://localhost:8000/bootstrap/frames/*/image', route =>
      route.fulfill({ body: Buffer.alloc(0), contentType: 'image/jpeg' }),
    )
    await page.goto('/active-learning')

    await expect(page.getByRole('button', { name: /confirm/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /no ball/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /skip/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /redo/i })).toBeVisible()
  })

  test('shows queue empty message when all frames reviewed', async ({ page }) => {
    await mockLabelingQueue(page, [])
    await page.goto('/active-learning')

    await expect(page.getByText(/queue empty/i)).toBeVisible()
  })

  test('does not show Extract Frames section in active mode', async ({ page }) => {
    await mockLabelingQueue(page, [])
    await mockAllVideos(page, [VIDEO])
    await page.goto('/active-learning')

    await expect(page.getByRole('button', { name: /extract frames/i })).not.toBeVisible()
  })
})

test.describe('Active Learning — PromotionPanel', () => {
  test('shows training run heading and metrics table after starting training', async ({ page }) => {
    await mockLabelingStatus(page, { ...LABELING_STATUS_NO_MODEL, frames_total: 300, annotated: 250, model_ready: true })
    await mockBootstrapFrames(page, [])
    await mockAllVideos(page, [])
    await mockLabelingQueue(page, [])
    await page.route('http://localhost:8000/training/run', route =>
      route.fulfill({ json: { run_id: 1 } }),
    )
    await page.route('http://localhost:8000/training/runs/1', route =>
      route.fulfill({ json: { id: 1, status: 'done', new_model_id: 2, base_model_id: null, frames_used: 200, epochs: 50, final_loss: 0.1, duration_s: 300, error: null, created_at: '' } }),
    )
    await page.route('http://localhost:8000/models', route =>
      route.fulfill({ json: [MODEL_VERSION] }),
    )

    await page.goto('/active-learning')
    await page.getByRole('button', { name: /start training/i }).click()

    await expect(page.getByRole('heading', { name: /training run #1/i })).toBeVisible()
    await expect(page.getByText(/test set evaluation/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /promote/i })).toBeVisible()
  })
})
