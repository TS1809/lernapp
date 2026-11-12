import { expect, test } from '@playwright/test'
import { collectErrors, createExam, importPackage, onboard, rate, revealCard } from './helpers'

test('Unterwegs-Widget führt zur Fachauswahl, empfiehlt ein Fach und lernt nur dieses', async ({ page }) => {
  const errors = collectErrors(page)
  await onboard(page)
  await createExam(page, 'Thermodynamik', 20)
  await importPackage(page, undefined, 'Thermodynamik')
  await createExam(page, 'Werkstoffkunde', 50)
  await importPackage(page, undefined, 'Werkstoffkunde')

  // Startseite: keine Kacheln pro Fach, sondern ein Widget mit Empfehlung
  await page.goto('./#/')
  await expect(page.getByRole('link', { name: /^(Thermodynamik|Werkstoffkunde).*lernen$/ })).toHaveCount(0)
  // Nächste Klausuren je Prüfung
  const progress = page.getByRole('link', { name: 'Nächste Klausuren' })
  await expect(progress).toContainText('Thermodynamik')
  await expect(progress).toContainText('Werkstoffkunde')
  await expect(progress).toContainText(/in \d+ Tagen/)
  const widget = page.getByRole('link', { name: 'Unterwegs lernen', exact: true })
  // Empfohlen ist das Fach mit dem meisten offenen Pensum (die nähere Klausur führt mehr neue Karten ein)
  await expect(widget).toContainText('Empfohlen: Thermodynamik')
  await widget.click()

  // Auswahl: alle Fächer oder ein einzelnes
  await expect(page.getByRole('heading', { name: 'Unterwegs lernen' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Alle Fächer lernen' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Thermodynamik lernen' })).toContainText('Empfohlen')
  await expect(page.getByRole('link', { name: 'Werkstoffkunde lernen' })).not.toContainText('Empfohlen')

  // Nur Werkstoffkunde lernen
  await page.getByRole('link', { name: 'Werkstoffkunde lernen' }).click()
  const meta = page.locator('.flashcard .meta')
  for (let i = 0; i < 2; i++) {
    await expect(meta).toContainText('Werkstoffkunde')
    await expect(meta).not.toContainText('Thermodynamik')
    await revealCard(page)
    await rate(page, 'Gut')
  }

  // Am Ende wird das nächste Fach angeboten
  await expect(page.getByRole('heading', { name: 'Geschafft!' })).toBeVisible()
  await page.getByRole('link', { name: /Weiter mit Thermodynamik/ }).click()
  await expect(meta).toContainText('Thermodynamik')

  expect(errors).toEqual([])
})
