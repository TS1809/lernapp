import { expect, test } from '@playwright/test'
import { collectErrors, createExam, isoIn, onboard } from './helpers'

test('Hausaufgaben anlegen und erledigen', async ({ page }) => {
  const errors = collectErrors(page)
  await onboard(page)
  await createExam(page, 'Steuerungstechnik')

  // Fällige Hausaufgabe über die Prüfungsseite anlegen
  await page.getByRole('link', { name: 'Hausaufgabe hinzufügen' }).click()
  await page.getByPlaceholder('z. B. Übungsblatt 3, Aufgabe 2').fill('KV-Diagramm Blatt 2')
  await page.getByPlaceholder(/Aufgabenstellung/).fill('Vereinfache $Y = X_1 X_2 + X_1 \\overline{X_2}$')
  await page.locator('input[type=date]').fill(isoIn(2))
  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.getByRole('heading', { name: 'KV-Diagramm Blatt 2' })).toBeVisible()

  // Noch nicht fällige Hausaufgabe direkt von der Startseite aus eintragen
  await page.goto('./#/')
  await page.getByRole('link', { name: 'Hausaufgabe eintragen' }).click()
  await page.getByPlaceholder('z. B. Übungsblatt 3, Aufgabe 2').fill('SCL-Ampel')
  await page.locator('input[type=date]').fill(isoIn(14))
  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.getByRole('heading', { name: 'SCL-Ampel' })).toBeVisible()

  // Startseite: Hausaufgaben-Widget zeigt beide offen
  await page.goto('./#/')
  await expect(page.getByRole('link', { name: 'Hausaufgaben: 2 offen' })).toBeVisible()

  // Eine Hausaufgabe öffnen, abhaken mit Lösung
  await page.getByRole('link', { name: 'Hausaufgaben: 2 offen' }).click()
  await page.getByRole('link', { name: /KV-Diagramm Blatt 2/ }).click()
  await page.getByRole('button', { name: 'Abhaken' }).click()
  await page.getByPlaceholder('Ergebnis oder Notizen (optional)').fill('Y = X1')
  await page.getByRole('button', { name: 'Erledigt' }).click()

  // Danach ist auf der Startseite nur noch eine offen
  await page.goto('./#/')
  await expect(page.getByRole('link', { name: 'Hausaufgaben: 1 offen' })).toBeVisible()

  expect(errors).toEqual([])
})
