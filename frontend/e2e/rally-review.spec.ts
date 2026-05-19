import { test, expect } from '@playwright/test'
import { MATCH, RALLY, VIDEO, mockMatchDetail, mockMatchVideos, mockRallies } from './fixtures'

test.describe('RallyReview', () => {
  test.beforeEach(async ({ page }) => {
    await mockMatchDetail(page)
    await mockMatchVideos(page)
    await mockRallies(page)
  })

  test('shows match date and opponent in heading', async ({ page }) => {
    await page.goto(`/matches/${MATCH.id}/rally-review`)

    await expect(page.getByRole('heading', { name: /2026-05-18.*Rivals/i })).toBeVisible()
  })

  test('shows set section for each video', async ({ page }) => {
    await page.goto(`/matches/${MATCH.id}/rally-review`)

    await expect(page.getByText(`Set ${VIDEO.set_number}`)).toBeVisible()
  })

  test('shows rally with start and end time inputs', async ({ page }) => {
    await page.goto(`/matches/${MATCH.id}/rally-review`)

    await expect(page.getByLabel('start time').first()).toBeVisible()
    await expect(page.getByLabel('end time').first()).toBeVisible()
    await expect(page.getByLabel('start time').first()).toHaveValue(String(RALLY.start_time))
    await expect(page.getByLabel('end time').first()).toHaveValue(String(RALLY.end_time))
  })

  test('shows Home Scored and Away Scored buttons for each rally', async ({ page }) => {
    await page.goto(`/matches/${MATCH.id}/rally-review`)

    await expect(page.getByRole('button', { name: /home scored/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /away scored/i })).toBeVisible()
  })

  test('shows no rallies message when video has no rallies', async ({ page }) => {
    await mockRallies(page, VIDEO.id, [])
    await page.goto(`/matches/${MATCH.id}/rally-review`)

    await expect(page.getByText(/no rallies detected yet/i)).toBeVisible()
  })

  test('shows Go to Export link', async ({ page }) => {
    await page.goto(`/matches/${MATCH.id}/rally-review`)

    await expect(page.getByRole('link', { name: /go to export/i })).toBeVisible()
  })

  test('shows Back link', async ({ page }) => {
    await page.goto(`/matches/${MATCH.id}/rally-review`)

    await expect(page.getByRole('link', { name: /← back/i })).toBeVisible()
  })
})
