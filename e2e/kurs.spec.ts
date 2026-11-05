import { expect, test } from '@playwright/test'
import { collectErrors, onboard } from './helpers'

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' }

test('Kurs-Hausaufgabe: teilen und als Kurs-Eintrag wiederfinden', async ({ page, context }) => {
  const errors = collectErrors(page)
  const courseHw: Array<Record<string, unknown>> = [] // „Server"-Speicher des Relais

  await context.route('https://dualis-relais.e25019.workers.dev/**', (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: CORS })
    const url = req.url()
    if (url.includes('/timetable')) {
      return route.fulfill({
        headers: CORS,
        json: {
          week: '02.11.2026',
          count: 1,
          events: [{ start: '2026-11-04T09:00', end: '2026-11-04T11:00', weekday: 'Mittwoch', shortName: 'Mathe III', fullName: 'ET2025 Mathematik 3', room: 'HOR-E10', isTest: true, lecturer: 'Prof. Geisel' }],
        },
      })
    }
    if (url.includes('/grades')) return route.fulfill({ headers: CORS, json: { semesters: [] } })
    if (url.includes('/course/homework')) {
      const body = req.postDataJSON() as { homework?: Record<string, unknown> }
      const hw = { id: 'h' + (courseHw.length + 1), createdByName: 'Tester', ...(body.homework ?? {}) }
      courseHw.push(hw)
      return route.fulfill({ headers: CORS, json: { ok: true, id: hw.id, homework: hw } })
    }
    if (url.includes('/course/sync')) {
      return route.fulfill({ headers: CORS, json: { ok: true, admin: true, admins: ['d:e25019'], members: { 'd:e25019': { name: 'Tester' } }, homework: courseHw, gradeStats: { overall: { count: 0 }, semesters: {}, modules: {} } } })
    }
    return route.fulfill({ headers: CORS, json: { ok: true } })
  })

  await onboard(page)

  // Stundenplan einrichten → legt beim Dashboard-Besuch die Prüfung „Mathematik 3" an
  await page.goto('./#/einstellungen')
  await page.getByText('Stundenplan & Noten aus DUALIS anzeigen').click()
  await page.getByLabel('DUALIS-Benutzer').fill('e25019')
  await page.getByLabel('DUALIS-Passwort').fill('geheim')
  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.getByRole('button', { name: /Gespeichert/ })).toBeVisible()

  // Kurs verbinden (Kürzel aus dem Login „e25019" → „e25")
  await page.getByLabel('Kurs-Kürzel').fill('e25')
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click()
  await expect(page.getByText(/Admin dieses Kurses/)).toBeVisible()

  // Dashboard öffnen → Plan lädt, Prüfung „Mathematik 3" wird übernommen
  await page.goto('./')
  await expect(page.getByText('Mathe III')).toBeVisible()
  await page.goto('./#/pruefungen')
  await expect(page.getByText('Mathematik 3')).toBeVisible()

  // Hausaufgabe anlegen und für den Kurs teilen
  await page.goto('./#/hausaufgabe/neu')
  await page.getByLabel('Prüfung').selectOption({ label: 'Mathematik 3' })
  await page.getByLabel('Titel').fill('Übungsblatt 1')
  await page.getByLabel('Geschätzte Dauer (Minuten)').fill('45')
  await page.getByText(/Für den ganzen Kurs/).click()
  await page.getByRole('button', { name: 'Speichern' }).click()

  // Erscheint in der Hausaufgabenliste als Kurs-Eintrag (mit „Kurs"-Markierung)
  await expect(page.getByText('Übungsblatt 1').first()).toBeVisible()
  await expect(page.getByText('Kurs', { exact: true }).first()).toBeVisible()
  expect(courseHw.length).toBe(1)
  expect((courseHw[0] as { subject?: string }).subject).toBe('Mathematik 3')

  expect(errors).toEqual([])
})
