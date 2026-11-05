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
    if (url.includes('/course/')) {
      return route.fulfill({
        headers: CORS,
        json: {
          ok: true,
          admin: false,
          admins: [],
          members: {},
          homework: [],
          gradeStats: {
            overall: { count: 3, avg: 1.8, min: 1.3, max: 2.3 },
            semesters: { 'WiSe 2025/26': { count: 3, avg: 1.8, min: 1.3, max: 2.0 } },
            modules: { t4eit1001: { count: 3, avg: 1.5, min: 1.0, max: 2.0 } },
          },
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
  // Kurs-Schnitt steht jetzt neben der eigenen Note (farbig), nicht mehr unter der Modulbeschreibung
  await expect(page.getByText('Kurs Ø 1,50 (3)')).toBeVisible() // Modul: Kurs-Schnitt rechts neben der Note
  await expect(page.getByText(/Bandbreite 1,00.2,00/)).toBeVisible() // Modul: Bandbreite
  await expect(page.getByText('Kurs Ø 1,80 (3)')).toBeVisible() // Semester: Kurs-Schnitt jetzt rechts
  await expect(page.getByText(/Bandbreite 1,30.2,00/)).toBeVisible() // Semester: Bandbreite rechts
  await expect(page.getByText(/Kurs \(3\): Ø 1,80 · Bandbreite/)).toBeVisible() // Gesamtschnitt-Block

  // Die als Prüfung markierte Vorlesung wird automatisch in die Prüfungsübersicht übernommen –
  // ohne das Kurs-/Jahrgangskürzel „ET2025“ (fullName war „ET2025 Mathematik 3“).
  await page.goto('./#/pruefungen')
  await expect(page.getByText('Mathematik 3', { exact: true })).toBeVisible()
  await expect(page.getByText('ET2025 Mathematik 3')).toHaveCount(0)

  expect(errors).toEqual([])
})
