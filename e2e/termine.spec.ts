import { expect, test } from '@playwright/test'
import { collectErrors, onboard } from './helpers'

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' }

test('Termine: anlegen und abstimmen', async ({ page, context }) => {
  const errors = collectErrors(page)
  const events: Array<Record<string, any>> = []

  await context.route('https://dualis-relais.e25019.workers.dev/**', (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: CORS })
    const url = req.url()
    if (url.includes('/timetable')) return route.fulfill({ headers: CORS, json: { week: '02.11.2026', count: 0, events: [] } })
    if (url.includes('/grades')) return route.fulfill({ headers: CORS, json: { semesters: [] } })
    let body: any = {}
    try {
      body = req.postDataJSON()
    } catch {
      body = {}
    }
    if (url.includes('/course/event/create')) {
      const e = { id: 'e' + (events.length + 1), createdBy: body.memberId, createdByName: body.name || 'Tester', createdAt: Date.now(), votes: {}, ...(body.event ?? {}) }
      events.push(e)
      return route.fulfill({ headers: CORS, json: { ok: true, event: e } })
    }
    if (url.includes('/course/event/vote')) {
      const e = events.find((x) => x.id === body.id)
      if (e) {
        if (body.vote === 'yes' || body.vote === 'no') e.votes[body.memberId] = body.vote
        else delete e.votes[body.memberId]
      }
      return route.fulfill({ headers: CORS, json: { ok: true, event: e } })
    }
    if (url.includes('/course/event/list')) {
      return route.fulfill({ headers: CORS, json: { ok: true, events, admins: ['d:e25019'], members: { 'd:e25019': 'Tester' } } })
    }
    if (url.includes('/course/')) {
      return route.fulfill({ headers: CORS, json: { ok: true, admin: true, admins: ['d:e25019'], members: { 'd:e25019': { name: 'Tester' } }, homework: [], gradeStats: { overall: { count: 0 }, semesters: {}, modules: {} } } })
    }
    return route.fulfill({ headers: CORS, json: { ok: true } })
  })

  await onboard(page)

  // Kurs über das DUALIS-Login (e25019 → e25) herstellen
  await page.goto('./#/einstellungen')
  await page.getByText('Stundenplan & Noten aus DUALIS anzeigen').click()
  await page.getByLabel('DUALIS-Benutzer').fill('e25019')
  await page.getByLabel('DUALIS-Passwort').fill('geheim')
  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.getByRole('button', { name: /Gespeichert/ })).toBeVisible()

  // Termine-Seite: Termin anlegen
  await page.goto('./#/termine')
  await page.getByPlaceholder(/Lerngruppe Konstruktionslehre/).fill('Lerngruppe Mathe')
  await page.locator('input[type=datetime-local]').fill('2027-01-15T14:00')
  await page.getByRole('button', { name: 'Termin anlegen' }).click()
  await expect(page.getByText('Lerngruppe Mathe')).toBeVisible()

  // Zusagen und prüfen, dass die eigene Stimme sichtbar ist
  await page.getByRole('button', { name: /Zusagen/ }).click()
  await expect(page.getByRole('button', { name: /Zusagen \(1\)/ })).toBeVisible()
  await expect(page.locator('.event-voters')).toContainText('Du')

  expect(errors).toEqual([])
})
