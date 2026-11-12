import { expect, test } from '@playwright/test'
import { collectErrors, countRows, createExam, importPackage, onboard, rate, revealCard } from './helpers'

test('Einrichten, Lernen, Rechenaufgabe prüfen und Karte melden', async ({ page }) => {
  const errors = collectErrors(page)
  await onboard(page, { kind: 'Dual' })
  await expect(page.locator('.page-header')).toContainText('dual')

  await createExam(page, 'Technische Mechanik')
  await importPackage(page)

  // Übersicht mit Lern-Widgets
  await page.goto('./#/')
  await expect(page.getByRole('link', { name: 'Unterwegs lernen' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Schreibtisch lernen' })).toBeVisible()
  await expect(page.locator('.widget', { hasText: 'Nächste Klausuren' })).toContainText('Technische Mechanik')

  // Karteikarte lernen und melden
  await page.getByRole('link', { name: 'Unterwegs lernen' }).click()
  await expect(page.locator('.session-count')).toHaveText(/^0\/\d+$/)
  await revealCard(page)
  await page.getByRole('button', { name: 'Karte melden' }).click()
  await page.getByRole('radio', { name: 'Unklar formuliert' }).click()
  await page.getByPlaceholder('Was stimmt nicht? (optional)').fill('Einheit fehlt')
  await page.getByRole('button', { name: 'Melden', exact: true }).click()
  await expect(page.locator('.flashcard')).toContainText('gemeldet')
  await rate(page, 'Gut')

  // Rechenaufgabe: richtiges und falsches Ergebnis
  await page.goto('./#/lernen/desk')
  await expect(page.locator('.flashcard')).toBeVisible()
  const inputs = page.locator('input[inputmode=decimal]')
  await expect(inputs.first()).toBeVisible()
  await inputs.nth(0).fill('159,2')
  if ((await inputs.count()) > 1) await inputs.nth(1).fill('5')
  await page.getByRole('button', { name: 'Lösung' }).first().click()
  await expect(page.locator('.flashcard')).toContainText('✓')
  if ((await inputs.count()) > 1) await expect(page.getByText('Ergebnis weicht ab')).toBeVisible()
  await rate(page, 'Nochmal')
  expect(await countRows(page, 'reviews')).toBe(2)

  // Meldung ist von der Prüfungsseite aus erreichbar und lässt sich exportieren
  await page.goto('./#/pruefungen')
  await page.locator('a.card.link').first().click()
  await page.getByRole('link', { name: /1 offene Meldung/ }).click()
  await expect(page.getByText('Unklar formuliert · Einheit fehlt')).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /Meldung exportieren/ }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^Meldungen_Technische_Mechanik_.*\.json$/)

  expect(errors).toEqual([])
})

test('Semesterart lässt sich ändern und wirkt auf den Lernplan', async ({ page }) => {
  const errors = collectErrors(page)
  await onboard(page, { kind: 'Regulär' })
  await createExam(page, 'Thermodynamik', 40)
  await importPackage(page)
  await createExam(page, 'Werkstoffkunde', 44)
  await importPackage(page, undefined, 'Werkstoffkunde')
  const deadline = async () => {
    await page.goto('./#/pruefungen')
    await page.locator('a.card.link', { hasText: 'Werkstoffkunde' }).click()
    return page.getByText(/Neuer Stoff bis/).textContent()
  }
  const regular = await deadline()

  // Einstellungen und Hilfe als Symbole oben rechts auf der Startseite
  await page.goto('./#/')
  await page.getByRole('link', { name: 'Hilfe' }).click()
  await expect(page.getByRole('heading', { name: 'Hilfe' })).toBeVisible()
  await page.goto('./#/')
  await page.getByRole('link', { name: 'Einstellungen' }).click()
  await page.getByRole('link', { name: 'Ändern' }).first().click()
  await page.getByRole('radio', { name: /^Dual/ }).click()
  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.getByRole('heading', { name: 'Einstellungen' })).toBeVisible()

  // Dual: neuer Stoff muss vor der ersten Klausur (Thermodynamik, in 40 Tagen) eingeführt sein –
  // für Werkstoffkunde (in 44 Tagen) also deutlich früher als regulär
  const dual = await deadline()
  expect(dual).not.toEqual(regular)
  expect(errors).toEqual([])
})
