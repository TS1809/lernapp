import { describe, expect, it } from 'vitest'
import { studyDate, studyDayStart } from './dates'

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime()

describe('Lerntag ab 4:00 Uhr', () => {
  it('ordnet die Zeit nach Mitternacht dem Vortag zu', () => {
    expect(studyDate(at(10, 1, 30))).toBe('2026-11-09')
    expect(studyDate(at(10, 4))).toBe('2026-11-10')
    expect(studyDayStart(at(10, 23))).toBe(at(10, 4))
  })
})
