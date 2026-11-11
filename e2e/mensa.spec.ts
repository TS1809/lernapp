import { expect, test } from '@playwright/test'
import { collectErrors, onboard } from './helpers'

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,OPTIONS' }
const MENU = [
  { category: 'VEGANER RENNER', name: 'Kichererbsen-Curry mit Duftreis', prices: ['2,99', '5,99', '6,49'], icons: ['VG', 'VR'] },
  { category: 'HAUPTGERICHT', name: 'Hähnchenbrustfilet Piccata Milanese', prices: ['5,10', '8,10', '8,60'], icons: ['G'] },
]

test('Mensa Horb: Speiseplan + Campus-Ausgrauen', async ({ page, context }) => {
  const errors = collectErrors(page)

  await context.route('https://dualis-relais.e25019.workers.dev/**', (route) => {
    const url = route.request().url()
    if (url.includes('/mensa')) {
      const date = new URL(url).searchParams.get('date') || ''
      return route.fulfill({ headers: CORS, json: { date, items: MENU } })
    }
    if (url.includes('/timetable')) {
      // Nur am Mittwoch (11.11., aktuelle Woche) eine Vorlesung im Hauptgebäude → an dem Tag am Campus.
      return route.fulfill({
        headers: CORS,
        json: { week: '09.11.2026', count: 1, events: [{ start: '2026-11-11T09:00', end: '2026-11-11T11:00', weekday: 'Mittwoch', shortName: 'Mathe III', fullName: 'Mathematik 3', room: 'HOR-A101', isTest: false }] },
      })
    }
    if (url.includes('/course/')) {
      return route.fulfill({ headers: CORS, json: { ok: true, admin: false, admins: [], members: {}, homework: [], gradeStats: { overall: { count: 0 }, semesters: {}, modules: {} } } })
    }
    return route.fulfill({ headers: CORS, json: { semesters: [] } })
  })

  await onboard(page)
  await page.goto('./#/einstellungen')
  await page.getByText('Stundenplan & Noten aus DUALIS anzeigen').click()
  await page.getByLabel('DUALIS-Benutzer').fill('e25019')
  await page.getByLabel('DUALIS-Passwort').fill('geheim')
  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.getByRole('button', { name: /Gespeichert/ })).toBeVisible()

  // Dashboard besuchen, damit die Stundenplan-Woche im Zwischenspeicher landet (für die Campus-Erkennung)
  await page.goto('./')
  await expect(page.getByText('Mathe III')).toBeVisible()

  // Mensa-Seite
  await page.goto('./#/mensa')
  await expect(page.getByText('Kichererbsen-Curry mit Duftreis')).toBeVisible()
  await expect(page.getByText('€ 5,10 / 8,10 / 8,60')).toBeVisible()
  await expect(page.getByText('vegan').first()).toBeVisible()

  // Freie Tage sind ausgegraut
  await expect(page.locator('.mensa-day.off').first()).toBeVisible()
  // Montag (frei) wählen → Hinweis
  await page.locator('.mensa-day').filter({ hasText: 'Mo' }).click()
  await expect(page.getByText(/nicht am Campus/)).toBeVisible()

  expect(errors).toEqual([])
})
