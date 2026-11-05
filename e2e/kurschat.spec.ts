import { expect, test } from '@playwright/test'
import { collectErrors, onboard } from './helpers'

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' }

test('Kurschat: Nachricht senden, reagieren', async ({ page, context }) => {
  const errors = collectErrors(page)
  const msgs: Array<Record<string, any>> = []

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
    if (url.includes('/course/chat/send')) {
      const m = { id: 'm' + (msgs.length + 1), memberId: body.memberId, name: body.name || 'Tester', text: body.text, at: Date.now(), keep: false, reactions: {} }
      msgs.push(m)
      return route.fulfill({ headers: CORS, json: { ok: true, message: m } })
    }
    if (url.includes('/course/chat/react')) {
      const m = msgs.find((x) => x.id === body.id)
      if (m) {
        const set = new Set<string>(m.reactions[body.emoji] || [])
        if (body.on === false) set.delete(body.memberId)
        else set.add(body.memberId)
        if (set.size) m.reactions[body.emoji] = [...set]
        else delete m.reactions[body.emoji]
      }
      return route.fulfill({ headers: CORS, json: { ok: true, message: m } })
    }
    if (url.includes('/course/chat/list')) {
      return route.fulfill({ headers: CORS, json: { ok: true, messages: msgs, admins: ['d:e25019'] } })
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

  // Chat öffnen, Nachricht senden
  await page.goto('./#/kurschat')
  await page.getByPlaceholder(/Nachricht an den Kurs/).fill('Hallo Kurs')
  await page.getByRole('button', { name: 'Senden' }).click()
  await expect(page.getByText('Hallo Kurs')).toBeVisible()

  // Reaktion setzen
  await page.locator('.chat-react').filter({ hasText: '👍' }).click()
  await expect(page.locator('.chat-react.on')).toContainText('1')

  expect(errors).toEqual([])
})
