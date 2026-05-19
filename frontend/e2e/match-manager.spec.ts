import { test, expect } from '@playwright/test'
import { MATCH, mockMatchList } from './fixtures'

test.describe('MatchManager', () => {
  test('shows heading and create-match form fields', async ({ page }) => {
    await mockMatchList(page, [])
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'Matches' })).toBeVisible()
    await expect(page.getByLabel('Date')).toBeVisible()
    await expect(page.getByLabel('Opponent')).toBeVisible()
    await expect(page.getByRole('button', { name: 'New Match' })).toBeVisible()
  })

  test('shows empty state when no matches exist', async ({ page }) => {
    await mockMatchList(page, [])
    await page.goto('/')

    await expect(page.getByText('No matches yet')).toBeVisible()
  })

  test('shows match list with date, opponent and action links', async ({ page }) => {
    await mockMatchList(page)
    await page.goto('/')

    await expect(page.getByText(MATCH.date)).toBeVisible()
    await expect(page.getByText(`vs ${MATCH.opponent}`)).toBeVisible()
    await expect(page.getByRole('link', { name: 'Upload' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Rally Review' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Export' })).toBeVisible()
  })

  test('nav shows Matches and Active Learning links', async ({ page }) => {
    await mockMatchList(page, [])
    await page.goto('/')

    await expect(page.getByRole('link', { name: 'Matches' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Active Learning' })).toBeVisible()
  })
})
