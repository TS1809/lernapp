import { describe, expect, it } from 'vitest'
import { dayShare, weekShares } from './dayProgress'
import type { Snapshot } from './db'

const snap = (examId: string, date: string, done?: number, left?: number): Snapshot => ({
  id: `${examId}:${date}`, profileId: 'p', examId, date, total: 10, introduced: 5, secure: 2, done, left,
})

describe('Tagespensum der Lernserie', () => {
  it('Anteil des Pensums; ohne Pensum voll, wenn gelernt wurde', () => {
    expect(dayShare(3, 1, 3)).toBe(0.75)
    expect(dayShare(4, 0, 4)).toBe(1)
    expect(dayShare(0, 0, 2)).toBe(1)
    expect(dayShare(0, 0, 0)).toBe(0)
  })

  it('heute aus dem Plan, frühere Tage aus den Tageswerten aller Prüfungen, alte Tage relativ zum stärksten', () => {
    const dates = ['2026-11-01', '2026-11-02', '2026-11-03']
    const snapshots = [snap('a', '2026-11-02', 6, 0), snap('b', '2026-11-02', 2, 2), snap('a', '2026-11-01')]
    expect(weekShares(dates, snapshots, [10, 8, 4], { date: '2026-11-03', share: 1 })).toEqual([1, 0.8, 1])
    expect(weekShares(dates, [], [10, 5, 0], { date: '2026-11-03', share: 0 })).toEqual([1, 0.5, 0])
  })
})
