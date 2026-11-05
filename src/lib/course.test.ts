import { describe, expect, it } from 'vitest'
import { courseFromUser, sanitizeCourse } from './course'

describe('Kurs aus DUALIS-Login ableiten', () => {
  it('nimmt Buchstaben + Jahrgang, lässt die laufende Nummer weg', () => {
    expect(courseFromUser('e25019')).toBe('e25') // ET2025
    expect(courseFromUser('E25001')).toBe('e25') // Großschreibung egal
    expect(courseFromUser('w24003')).toBe('w24') // Wirtschaft 2024
    expect(courseFromUser('tinf22015')).toBe('tinf22') // längeres Kürzel
  })

  it('liefert leer bei fehlendem/unpassendem Login', () => {
    expect(courseFromUser('')).toBe('')
    expect(courseFromUser(undefined)).toBe('')
    expect(courseFromUser('12345')).toBe('') // ohne führende Buchstaben
  })
})

describe('Kurs-Kürzel säubern', () => {
  it('akzeptiert kurze alphanumerische Kürzel, kleingeschrieben', () => {
    expect(sanitizeCourse('E25')).toBe('e25')
    expect(sanitizeCourse('  tinf22 ')).toBe('tinf22')
  })
  it('weist Unsinn ab', () => {
    expect(sanitizeCourse('a')).toBe('') // zu kurz
    expect(sanitizeCourse('mit leer')).toBe('') // Leerzeichen
    expect(sanitizeCourse('')).toBe('')
  })
})
