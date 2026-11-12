import { expect, test } from '@playwright/test'
import { collectErrors, createExam, onboard } from './helpers'

test('Nächste Klausuren: nur die aktuelle Prüfungsphase, spätere Semester ausgeblendet', async ({ page }) => {
  const errors = collectErrors(page)
  await onboard(page)
  await createExam(page, 'Konstruktionslehre', 10)
  await createExam(page, 'Mathematik 3', 25)
  // Klausur eines späteren Semesters: beim Stundenplan-Import landet sie im aktiven
  // Semester, liegt aber zeitlich weit entfernt und soll hier nicht auftauchen.
  await createExam(page, 'Klausur 4. Semester', 200)

  await page.goto('./#/')
  const tile = page.getByRole('link', { name: 'Nächste Klausuren', exact: true })
  await expect(tile).toContainText('Konstruktionslehre')
  await expect(tile).toContainText('Mathematik 3')
  await expect(tile).toContainText(/in \d+ Tagen/)
  await expect(tile).not.toContainText('Klausur 4. Semester')

  expect(errors).toEqual([])
})
