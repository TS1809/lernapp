import { expect, test } from '@playwright/test'
import { collectErrors, createExam, importPackage, onboard } from './helpers'

test('Karte überspringen: ohne Bewertung raus, kommt heute nicht wieder', async ({ page }) => {
  const errors = collectErrors(page)
  await onboard(page)
  await createExam(page, 'Technische Mechanik')
  await importPackage(page)

  // Zehn Karten extra, damit nach dem Überspringen noch Karten in der Sitzung sind
  await page.goto('./#/lernen/mobile?extra=10')
  const count = page.locator('.session-count')
  await expect(count).toHaveText(/^0\/\d+$/)
  const total = Number((await count.innerText()).split('/')[1])
  expect(total).toBeGreaterThan(1)
  const front = await page.locator('.flashcard').innerText()

  await page.getByRole('button', { name: 'Karte für heute auslassen' }).click()
  await expect(count).toHaveText(`0/${total - 1}`)
  await expect(page.locator('.flashcard')).not.toHaveText(front)

  // Neue Sitzung am selben Tag: Die übersprungene Karte fehlt weiterhin
  await page.goto('./#/')
  await page.goto('./#/lernen/mobile?extra=10')
  await expect(count).toHaveText(/^0\/\d+$/)
  const left = Number((await count.innerText()).split('/')[1])
  for (let i = 0; i < left; i++) {
    await expect(page.locator('.flashcard')).not.toHaveText(front)
    await page.getByRole('button', { name: 'Karte für heute auslassen' }).click()
  }
  await expect(page.getByText('Nichts fällig')).toBeVisible()
  expect(errors).toEqual([])
})
