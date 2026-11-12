import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, type Exam, type Homework, type Reminder } from './db'
import { applyDoc, exportDoc, mergeDocs, parseSyncDoc, type SyncDoc } from './sync'
import { addDays, isoDate } from './dates'
import {
  completeReminder, deleteReminder, homeworkReminderDate, isDueReminder, isOpenReminder, isRecentlyDone, postponeReminder, purgeDoneReminders, reopenReminder, saveReminder,
} from './reminders'

const P = 'p1'
const NOW = Date.parse('2026-10-29T10:00:00')
const exam: Exam = { id: 'e1', profileId: P, semesterId: 's1', name: 'Maschinendynamik', date: '2027-02-01', weight: 2, color: '#000', createdAt: 0, profile: { slug: 'maschinendynamik' } }
const hw: Homework = { id: 'h1', profileId: P, examId: 'e1', title: 'Blatt 3', description: '', due: '2026-11-05', minutes: 60, createdAt: 0 }
const reminder = (over: Partial<Reminder> = {}): Reminder => ({ id: 'r1', profileId: P, title: 'Feedback geben', date: '2026-10-29', createdAt: 0, ...over })

beforeEach(async () => {
  await db.delete()
  await db.open()
  await db.profiles.add({ id: P, name: 'Test', createdAt: 0, minutesMobile: 20, minutesDesk: 30, retention: 0.9, activeSemesterId: 's1' })
  await db.semesters.add({ id: 's1', profileId: P, name: 'S5', createdAt: 0 })
  await db.exams.add(exam)
})

describe('Erinnerungen', () => {
  it('sind ab ihrem Tag fällig und mit erledigter Hausaufgabe ebenfalls erledigt', () => {
    const open = new Map([[hw.id, hw]])
    const done = new Map([[hw.id, { ...hw, doneAt: 1 }]])
    expect(isDueReminder(reminder({ date: '2026-10-30' }), open, NOW)).toBe(false)
    expect(isDueReminder(reminder({ date: '2026-10-29' }), open, NOW)).toBe(true)
    expect(isDueReminder(reminder({ date: '2026-10-20' }), open, NOW)).toBe(true)
    expect(isOpenReminder(reminder({ doneAt: 5 }), open)).toBe(false)
    expect(isOpenReminder(reminder({ homeworkId: 'h1' }), open)).toBe(true)
    expect(isOpenReminder(reminder({ homeworkId: 'h1' }), done)).toBe(false)
  })

  it('schlägt zu einer Hausaufgabe zwei Tage vor der Abgabe vor, frühestens heute', () => {
    expect(homeworkReminderDate(hw, NOW)).toBe('2026-11-03')
    expect(homeworkReminderDate({ ...hw, due: '2026-10-30' }, NOW)).toBe('2026-10-29')
  })

  it('lassen sich abhaken, verschieben und löschen (Löschung wird synchronisiert)', async () => {
    const r = await saveReminder({ profileId: P, title: 'Altklausur anfragen', date: '2026-10-29' })
    await completeReminder(r, NOW)
    expect((await db.reminders.get(r.id))!.doneAt).toBe(NOW)
    await postponeReminder((await db.reminders.get(r.id))!, 2, NOW)
    const moved = (await db.reminders.get(r.id))!
    expect(moved.date).toBe(isoDate(addDays(NOW, 2)))
    expect(moved.doneAt).toBeUndefined()
    await deleteReminder(moved)
    expect(await db.reminders.get(r.id)).toBeUndefined()
    expect(await db.tombstones.get(`reminders:${r.id}`)).toBeTruthy()
  })

  it('werden mit Dropbox abgeglichen – auch mit Ständen älterer App-Versionen ohne Erinnerungen', async () => {
    await saveReminder({ id: 'r-local', profileId: P, title: 'Lokal', date: '2026-11-01' })
    const local = await exportDoc(P)
    expect(local.reminders).toHaveLength(1)
    // Stand eines Geräts mit alter App: kein Feld „reminders“
    const { reminders: _r, ...oldDoc } = JSON.parse(JSON.stringify(local)) as SyncDoc
    const merged = mergeDocs(local, parseSyncDoc(oldDoc))
    expect(merged.reminders?.map((r) => r.id)).toEqual(['r-local'])
    const fromOld = mergeDocs(parseSyncDoc(oldDoc), parseSyncDoc(oldDoc))
    await applyDoc(fromOld, parseSyncDoc(oldDoc))
    expect(await db.reminders.get('r-local')).toBeTruthy()

    // Neuere Änderung gewinnt, Löschung wird übertragen
    const other = JSON.parse(JSON.stringify(local)) as SyncDoc
    other.reminders![0] = { ...other.reminders![0], title: 'Geändert', updatedAt: (other.reminders![0].updatedAt ?? 0) + 10 }
    expect(mergeDocs(local, other).reminders![0].title).toBe('Geändert')
    // Löschung schlägt den älteren Stand eines anderen Geräts
    await deleteReminder((await db.reminders.get('r-local'))!)
    expect(mergeDocs(await exportDoc(P), local).reminders).toHaveLength(0)
  })

  it('bleiben erledigt eine Woche sichtbar, lassen sich rückgängig machen und werden danach gelöscht', async () => {
    const day = 864e5
    await db.homework.add({ ...hw, doneAt: NOW - 8 * day })
    const a = await saveReminder({ profileId: P, title: 'Gerade erledigt', date: '2026-10-29' })
    const b = await saveReminder({ profileId: P, title: 'Vor 8 Tagen erledigt', date: '2026-10-20' })
    const c = await saveReminder({ profileId: P, title: 'Über Hausaufgabe erledigt', date: '2026-10-20', homeworkId: 'h1' })
    const d = await saveReminder({ profileId: P, title: 'Offen', date: '2026-10-20' })
    await completeReminder(a, NOW - 6 * day)
    await completeReminder(b, NOW - 8 * day)
    const homework = new Map([[hw.id, { ...hw, doneAt: NOW - 8 * day }]])
    expect(isRecentlyDone((await db.reminders.get(a.id))!, homework, NOW)).toBe(true)
    expect(isRecentlyDone((await db.reminders.get(b.id))!, homework, NOW)).toBe(false)

    // Versehentlich abgehakt → rückgängig
    await reopenReminder((await db.reminders.get(a.id))!)
    expect(isOpenReminder((await db.reminders.get(a.id))!, homework)).toBe(true)
    await completeReminder((await db.reminders.get(a.id))!, NOW - 6 * day)

    expect(await purgeDoneReminders(P, NOW)).toBe(2)
    expect((await db.reminders.toArray()).map((r) => r.title).sort()).toEqual(['Gerade erledigt', 'Offen'])
    expect(await db.tombstones.get(`reminders:${b.id}`)).toBeTruthy()
    expect(await db.tombstones.get(`reminders:${c.id}`)).toBeTruthy()
    expect(d.id).toBeTruthy()
  })
})
