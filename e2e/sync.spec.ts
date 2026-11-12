import { expect, test } from '@playwright/test'
import { collectErrors, connectDropbox, countRows, createExam, newDropbox, onboard, useFakeDropbox } from './helpers'

test('Zwei Geräte über Dropbox: verbinden, übernehmen, abgleichen, sichern', async ({ browser }) => {
  const box = newDropbox()

  // Gerät A: Profil anlegen, Prüfung eintragen, verbinden
  const ctxA = await browser.newContext()
  await useFakeDropbox(ctxA, box)
  const a = await ctxA.newPage()
  const errorsA = collectErrors(a)
  await onboard(a)
  await createExam(a, 'Technische Mechanik')
  await connectDropbox(a)
  const files = [...box.files.keys()]
  expect(files.some((f) => f.startsWith('/sync/'))).toBe(true)
  expect(files.some((f) => f.startsWith('/backups/'))).toBe(true)

  // Gerät B: Profil aus Dropbox übernehmen
  const ctxB = await browser.newContext()
  await useFakeDropbox(ctxB, box)
  const b = await ctxB.newPage()
  const errorsB = collectErrors(b)
  await b.goto('./')
  await b.getByRole('button', { name: /Profil von einem anderen Gerät laden/ }).click()
  await b.getByRole('button', { name: 'Übernehmen' }).click()
  await expect(b.locator('.widget').first()).toBeVisible()
  await expect(b.locator('.page-header')).toContainText('synchronisiert')
  expect(await countRows(b, 'exams')).toBe(1)

  // B trägt eine weitere Prüfung ein, A übernimmt den Stand
  await createExam(b, 'Thermodynamik')
  await b.goto('./#/einstellungen')
  await b.getByRole('button', { name: 'Jetzt abgleichen' }).click()
  await expect(b.getByText(/Zuletzt abgeglichen/)).toBeVisible()
  await a.getByRole('button', { name: 'Jetzt abgleichen' }).click()
  await expect.poll(() => countRows(a, 'exams')).toBe(2)

  // Ohne Änderungen fragt der Abgleich nur die Dateiversion ab – es werden keine Daten übertragen
  await expect(a.getByRole('button', { name: 'Jetzt abgleichen' })).toBeEnabled()
  box.requests.length = 0
  await a.getByRole('button', { name: 'Jetzt abgleichen' }).click()
  await expect.poll(() => box.requests.length).toBeGreaterThan(0)
  await a.waitForTimeout(500)
  // (ein automatischer Abgleich kann zeitgleich laufen – entscheidend ist: kein Up-/Download)
  expect(box.requests.some((r) => r.startsWith('files/upload') || r.startsWith('files/download'))).toBe(false)

  // Wochensicherung ist sichtbar
  await a.getByRole('button', { name: 'Wochensicherungen anzeigen' }).click()
  await expect(a.getByRole('button', { name: 'Wiederherstellen' })).toBeVisible()

  expect([...errorsA, ...errorsB]).toEqual([])
  await ctxA.close()
  await ctxB.close()
})
