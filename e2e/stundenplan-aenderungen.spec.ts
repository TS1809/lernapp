import { expect, test } from '@playwright/test'
import { collectErrors, onboard } from './helpers'

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,OPTIONS' }
const SIG = '2026-11-04|09:00|Mathe III'

test('Stundenplan-Änderungen: Banner, Gelesen, Deeplink öffnet die Vorlesung', async ({ page, context }) => {
  const errors = collectErrors(page)
  let cleared = false

  await context.route('https://dualis-relais.e25019.workers.dev/**', (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, headers: CORS })
    const url = route.request().url()
    if (url.includes('/changes/seen')) {
      cleared = true
      return route.fulfill({ headers: CORS, json: { ok: true } })
    }
    if (url.includes('/changes')) {
      const items = cleared
        ? []
        : [{ kind: 'changed', text: 'Geändert: Mi 04.11. 09:00 Mathe III (HOR-E10)', week: '2026-11-02', date: '2026-11-04', sig: SIG, at: Date.now() }]
      return route.fulfill({ headers: CORS, json: { items } })
    }
    if (url.includes('/timetable')) {
      return route.fulfill({
        headers: CORS,
        json: {
          week: '02.11.2026',
          count: 1,
          events: [
            { start: '2026-11-04T09:00', end: '2026-11-04T11:00', weekday: 'Mittwoch', shortName: 'Mathe III', fullName: 'ET2025 Mathematik 3', room: 'HOR-E10', isTest: false, lecturer: 'Prof. Geisel' },
          ],
        },
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

  // Dashboard: Änderungs-Banner im Stundenplan
  await page.goto('./')
  await expect(page.getByText('Stundenplan-Änderungen')).toBeVisible()
  await expect(page.getByText(/Geändert: .*Mathe III/)).toBeVisible()

  // Deeplink aus der Push-Benachrichtigung öffnet die betreffende Vorlesung
  await page.goto(`./#/?spweek=2026-11-02&spsig=${encodeURIComponent(SIG)}`)
  await expect(page.getByText('Prof. Geisel')).toBeVisible()
  await page.getByRole('button', { name: 'Schließen' }).click()

  // „Gelesen" entfernt das Banner
  await page.getByRole('button', { name: 'Gelesen' }).click()
  await expect(page.getByText('Stundenplan-Änderungen')).toHaveCount(0)
  expect(cleared).toBe(true)

  expect(errors).toEqual([])
})
