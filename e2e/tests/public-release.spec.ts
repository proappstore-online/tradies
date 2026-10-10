import { expect, test } from '@playwright/test'

/**
 * Safe live-release smoke: it deliberately never signs in, creates data, or
 * sends a message. Authenticated marketplace journeys are deterministically
 * exercised in qa/actions.mjs with isolated SQLite identities.
 */
test('signed-out directory is keyboard usable and exposes only public discovery', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/Directory — Tradies/)
  await expect(page.locator('main')).toBeVisible()
  await expect(page.getByRole('search')).toBeVisible()
  await expect(page.getByLabel('Service area')).toBeVisible()
  await page.getByLabel('Service area').fill('Melbourne')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Directory' })).toBeVisible()

  // The filter submission above covers normal keyboard operation. The skip
  // control is separately checked as a focusable landmark target.
  await page.reload()
  const skip = page.getByText('Skip to content')
  await skip.focus()
  await expect(skip).toBeFocused()
})

test('signed-out private routes offer sign-in rather than data', async ({ page }) => {
  await page.goto('/#/quotes')
  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible()
  await expect(page.getByText(/Saving, enquiries, messages and your own listings need an account/)).toBeVisible()
})

test('public jobs remain usable on a narrow mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/jobs')
  await expect(page.getByRole('heading', { name: 'Jobs', exact: true })).toBeVisible()
  await expect(page.getByLabel('Filter jobs by trade')).toBeVisible()
  await expect(page.getByLabel('Filter jobs by location')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
})

test('signed-out public job details keep private address and contact fields out of the mobile UI', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/jobs')
  const firstJob = page.locator('a[href^="#/jobs/"]').first()
  if (!await firstJob.count()) {
    test.skip(true, 'No open public job is currently available for a read-only release smoke.')
    return
  }
  const href = await firstJob.getAttribute('href')
  await page.goto(`/${href}`)
  await expect(page.locator('input[aria-label="Exact address"], input[aria-label="Contact preference"]')).toHaveCount(0)
  await expect(page.getByText('Private details — visible only to you')).toHaveCount(0)
  await expect(page.getByText(/exact address and contact preferences are kept private/i)).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
})
