import { test, expect } from '@playwright/test'
import { MATCH, PROCESSED_VIDEO, mockMatchDetail } from './fixtures'

test.describe('ExportUpload', () => {
  test.beforeEach(async ({ page }) => {
    await mockMatchDetail(page)
  })

  test('shows Export heading with match date and opponent', async ({ page }) => {
    await page.goto(`/matches/${MATCH.id}/export`)

    await expect(page.getByRole('heading', { name: /export.*2026-05-18.*rivals/i })).toBeVisible()
  })

  test('shows Generate Export button', async ({ page }) => {
    await page.goto(`/matches/${MATCH.id}/export`)

    await expect(page.getByRole('button', { name: /generate export/i })).toBeVisible()
  })

  test('shows description text about trimmed MP4', async ({ page }) => {
    await page.goto(`/matches/${MATCH.id}/export`)

    await expect(page.getByText(/trimmed mp4/i)).toBeVisible()
  })

  test('shows download links after successful export', async ({ page }) => {
    await page.route(`http://localhost:8000/matches/${MATCH.id}/export`, route =>
      route.fulfill({ json: [PROCESSED_VIDEO] }),
    )

    await page.goto(`/matches/${MATCH.id}/export`)
    await page.getByRole('button', { name: /generate export/i }).click()

    await expect(page.getByRole('link', { name: /download/i })).toBeVisible()
    await expect(page.getByText('export_match1_set1_vid1.mp4')).toBeVisible()
  })

  test('shows no sets message when export returns empty', async ({ page }) => {
    await page.route(`http://localhost:8000/matches/${MATCH.id}/export`, route =>
      route.fulfill({ json: [] }),
    )

    await page.goto(`/matches/${MATCH.id}/export`)
    await page.getByRole('button', { name: /generate export/i }).click()

    await expect(page.getByText(/no sets with rallies/i)).toBeVisible()
  })

  test('shows Back link', async ({ page }) => {
    await page.goto(`/matches/${MATCH.id}/export`)

    await expect(page.getByRole('link', { name: /← back/i })).toBeVisible()
  })
})
