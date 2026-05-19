import { test, expect } from '@playwright/test'
import { MATCH, mockMatchDetail, mockMatchVideos } from './fixtures'

test.describe('UploadProcess', () => {
  test.beforeEach(async ({ page }) => {
    await mockMatchDetail(page)
    await mockMatchVideos(page)
  })

  test('shows match date and opponent in heading', async ({ page }) => {
    await page.goto(`/matches/${MATCH.id}/upload`)

    await expect(page.getByRole('heading', { name: /2026-05-18.*Rivals/i })).toBeVisible()
  })

  test('shows three set cards with file inputs and upload buttons', async ({ page }) => {
    await page.goto(`/matches/${MATCH.id}/upload`)

    for (const n of [1, 2, 3]) {
      await expect(page.getByRole('heading', { name: `Set ${n}` })).toBeVisible()
      await expect(page.getByLabel(`Set ${n}`)).toBeVisible()
      await expect(page.getByRole('button', { name: /upload.*process/i }).nth(n - 1)).toBeVisible()
    }
  })

  test('upload buttons are disabled until a file is selected', async ({ page }) => {
    await page.goto(`/matches/${MATCH.id}/upload`)

    const buttons = page.getByRole('button', { name: /upload.*process/i })
    await expect(buttons.nth(0)).toBeDisabled()
    await expect(buttons.nth(1)).toBeDisabled()
    await expect(buttons.nth(2)).toBeDisabled()
  })

  test('shows progress bar label Uploading… when status is uploading', async ({ page }) => {
    // Intercept the XHR upload and stall it so we can observe uploading state
    await page.route(`http://localhost:8000/matches/${MATCH.id}/videos`, async route => {
      if (route.request().method() === 'POST') {
        // Stall long enough to observe the uploading state
        await new Promise(r => setTimeout(r, 2000))
        route.fulfill({ json: { id: 1, match_id: 1, set_number: 1, raw_path: '/x.mp4', status: 'pending', duration: null, created_at: '' } })
      } else {
        route.fulfill({ json: [] })
      }
    })

    await page.goto(`/matches/${MATCH.id}/upload`)

    const fileInput = page.getByLabel('Set 1')
    await fileInput.setInputFiles({
      name: 'set1.mp4',
      mimeType: 'video/mp4',
      buffer: Buffer.from('video content'),
    })

    const uploadBtn = page.getByRole('button', { name: /upload.*process/i }).first()
    await uploadBtn.click()

    await expect(page.getByText(/Uploading…/)).toBeVisible({ timeout: 3000 })
  })

  test('shows Go to Rally Review link', async ({ page }) => {
    await page.goto(`/matches/${MATCH.id}/upload`)

    await expect(page.getByRole('link', { name: /go to rally review/i })).toBeVisible()
  })

  test('shows Back link', async ({ page }) => {
    await page.goto(`/matches/${MATCH.id}/upload`)

    await expect(page.getByRole('link', { name: /← back/i })).toBeVisible()
  })
})
