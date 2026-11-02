import { expect, test } from '@playwright/test'
import { collectErrors, createExam, importPackage, onboard, rate, revealCard } from './helpers'

test('Lernserie: Der Balken für heute ist voll, wenn das Pensum geschafft ist', async ({ page }) => {
  const errors = collectErrors(page)
  await onboard(page)
  await createExam(page, 'Technische Mechanik')
  await importPackage(page)

  const todayBar = page.locator('.widget', { hasText: 'Lernserie' }).locator('.daybar-fill').last()
  await page.goto('./#/')
  await expect(todayBar).toHaveAttribute('style', /height: 0%/)

  // Ganzes Pensum unterwegs lernen
  await page.goto('./#/lernen/mobile')
  const count = page.locator('.session-count')
  await expect(count).toHaveText(/^0\/\d+$/)
  const done = page.getByText('Geschafft!')
  for (let i = 0; i < 30; i++) {
    await expect(page.locator('.flashcard').or(done).first()).toBeVisible()
    if (await done.isVisible()) break
    const before = await count.innerText()
    await revealCard(page)
    await rate(page, 'Einfach')
    await expect(count).not.toHaveText(before)
  }
  await expect(done).toBeVisible()

  await page.goto('./#/')
  await expect(todayBar).toHaveAttribute('style', /height: 100%/)
  expect(errors).toEqual([])
})
