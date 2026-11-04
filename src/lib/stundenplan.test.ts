import { describe, expect, it } from 'vitest'
import { average, creditNum, fmtGrade, gradeNum, isoOf, minutesOf, mondayOf, type GradeModule } from './stundenplan'

describe('Noten-Auswertung', () => {
  it('liest Zahlennoten, ignoriert Text', () => {
    expect(gradeNum('1,6')).toBe(1.6)
    expect(gradeNum('1.0')).toBe(1)
    expect(gradeNum('bestanden')).toBeNull()
    expect(gradeNum('noch nicht gesetzt')).toBeNull()
    expect(gradeNum(undefined)).toBeNull()
  })

  it('liest Credits', () => {
    expect(creditNum('5,0')).toBe(5)
    expect(creditNum('20,0')).toBe(20)
    expect(creditNum('')).toBe(0)
    expect(creditNum(null)).toBe(0)
  })

  it('gewichtet den Schnitt nach Credits und überspringt unbenotete Module', () => {
    const mods: GradeModule[] = [
      { grade: '1,0', credits: '5,0' },
      { grade: '2,0', credits: '5,0' },
      { grade: 'bestanden', credits: '20,0' }, // zählt nicht in den Schnitt
      { grade: 'noch nicht gesetzt', credits: '5,0' },
    ]
    expect(average(mods)).toBeCloseTo(1.5, 5)
  })

  it('gibt null, wenn keine Zahlennote dabei ist', () => {
    expect(average([{ grade: 'bestanden', credits: '5,0' }])).toBeNull()
    expect(average([])).toBeNull()
  })

  it('formatiert den Schnitt deutsch', () => {
    expect(fmtGrade(1.5)).toBe('1,50')
    expect(fmtGrade(null)).toBe('–')
  })
})

describe('Datum und Zeit', () => {
  it('bestimmt den Montag der Woche', () => {
    expect(isoOf(mondayOf(new Date(2026, 10, 4)))).toBe('2026-11-02') // Mittwoch → Montag
    expect(isoOf(mondayOf(new Date(2026, 10, 2)))).toBe('2026-11-02') // Montag bleibt
    expect(isoOf(mondayOf(new Date(2026, 10, 8)))).toBe('2026-11-02') // Sonntag → Montag
  })

  it('rechnet die Startzeit in Minuten um', () => {
    expect(minutesOf('2026-11-02T08:00')).toBe(480)
    expect(minutesOf('2026-11-02T13:30')).toBe(810)
  })
})
