import { expect, test } from '@playwright/test'
import { collectErrors, onboard } from './helpers'

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,OPTIONS' }

test('Stundenplan auf dem Dashboard, Noten als Kachel', async ({ page, context }) => {
  const errors = collectErrors(page)

  // Fest hinterlegtes Relais simulieren (inkl. CORS-Preflight), damit kein echter DUALIS-Abruf nötig ist.
  await context.route('https://dualis-relais.e25019.workers.dev/**', (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, headers: CORS })
    const url = route.request().url()
    if (url.includes('/timetable')) {
      return route.fulfill({
        headers: CORS,
        json: {
          week: '02.11.2026',
          count: 1,
          events: [
            { start: '2026-11-04T09:00', end: '2026-11-04T11:00', weekday: 'Mittwoch', shortName: 'Mathe III', fullName: 'ET2025 Mathematik 3', room: 'HOR-E10', isTest: true, lecturer: 'Prof. Geisel' },
          ],
        },
      })
    }
    return route.fulfill({
      headers: CORS,
      json: {
        semesters: [{ semester: 'WiSe 2025/26', modules: [{ code: 'T4EIT1001', name: 'Mathematik I', grade: '2,0', credits: '5,0', status: 'bestanden' }] }],
      },
    })
  })

  await onboard(page)

  // Einrichten unter Einstellungen – nur das DUALIS-Login
  await page.goto('./#/einstellungen')
  await page.getByText('Stundenplan & Noten aus DUALIS anzeigen').click()
  await page.getByLabel('DUALIS-Benutzer').fill('e25019')
  await page.getByLabel('DUALIS-Passwort').fill('geheim')
  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.getByRole('button', { name: /Gespeichert/ })).toBeVisible()

  // Dashboard: Stundenplan steht ohne Klick unter den Kacheln
  await page.goto('./')
  await expect(page.getByText('Mathe III')).toBeVisible()
  await expect(page.getByText(/Prüfung/).first()).toBeVisible()
  // Termin anklickbar: Detail mit Dozent
  await page.getByText('Mathe III').click()
  await expect(page.getByText('Prof. Geisel')).toBeVisible()
  await page.getByRole('button', { name: 'Schließen' }).click()

  // Noten-Kachel führt auf die Noten-Seite
  await page.getByRole('link', { name: 'Noten' }).click()
  await expect(page.getByText('Gesamtschnitt (gewichtet nach Credits)')).toBeVisible()
  await expect(page.getByText('Mathematik I')).toBeVisible()
  await expect(page.getByText('2,0', { exact: true })).toBeVisible()

  // Die als Prüfung markierte Vorlesung wird automatisch in die Prüfungsübersicht übernommen
  await page.goto('./#/pruefungen')
  await expect(page.getByText('ET2025 Mathematik 3')).toBeVisible()

  expect(errors).toEqual([])
})
