import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, type Exam, type Homework } from './db'
import { addDays, isoDate } from './dates'
import { deleteHomework, homeworkMinutesToday, isDueSoon, saveHomework } from './homework'
import { exportDoc, mergeDocs } from './sync'

const NOW = new Date(2026, 9, 28, 10, 0).getTime()
const inDays = (d: number) => isoDate(addDays(NOW, d))
const exam: Exam = { id: 'e1', profileId: 'p1', semesterId: 's1', name: 'ST', date: '2026-12-14', weight: 2, color: '#000', createdAt: 0 }
const hw = (over: Partial<Homework>): Homework => ({ id: 'h', profileId: 'p1', examId: 'e1', title: 'Blatt 1', description: '', due: inDays(5), minutes: 60, createdAt: 0, ...over })

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('Hausaufgaben planen', () => {
  it('ist ab drei Tagen vor der Abgabe fällig, erledigt nie', () => {
    expect(isDueSoon(hw({ due: inDays(4) }), NOW)).toBe(false)
    expect(isDueSoon(hw({ due: inDays(3) }), NOW)).toBe(true)
    expect(isDueSoon(hw({ due: inDays(-1) }), NOW)).toBe(true)
    expect(isDueSoon(hw({ due: inDays(1), doneAt: 1 }), NOW)).toBe(false)
  })
  it('verteilt die Dauer gleichmäßig auf die Tage bis zur Abgabe', () => {
    const list = [hw({ id: 'a', due: inDays(3), minutes: 90 }), hw({ id: 'b', due: inDays(0), minutes: 20 }), hw({ id: 'c', due: inDays(-2), minutes: 15 }), hw({ id: 'd', due: inDays(1), minutes: 50, doneAt: 1 })]
    expect(homeworkMinutesToday(list, NOW)).toBe(30 + 20 + 15)
  })
})

describe('Hausaufgaben speichern', () => {
  it('synchronisiert Hausaufgaben und überträgt Löschungen', async () => {
    await db.profiles.add({ id: 'p1', name: 'T', createdAt: 0, minutesMobile: 20, minutesDesk: 30, retention: 0.9, activeSemesterId: 's1' })
    await db.semesters.add({ id: 's1', profileId: 'p1', name: 'S5', createdAt: 0 })
    await db.exams.add(exam)
    const h = await saveHomework({ profileId: 'p1', examId: 'e1', title: 'Blatt 1', description: '', due: inDays(2), minutes: 30 })
    const before = await exportDoc('p1')
    expect(before.homework).toHaveLength(1)
    await deleteHomework(h)
    const after = await exportDoc('p1')
    expect(mergeDocs(before, after).homework).toHaveLength(0)
  })
})
