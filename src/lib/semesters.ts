import type { Semester } from './db'

export type SemesterKind = 'dual' | 'regulaer'

export interface SemesterKindInfo {
  label: string
  description: string
}

export const SEMESTER_KINDS: Record<SemesterKind, SemesterKindInfo> = {
  dual: {
    label: 'Dual – kompakte Prüfungsphase',
    description: 'Alle Klausuren liegen innerhalb weniger Tage.',
  },
  regulaer: {
    label: 'Regulär – entzerrte Prüfungsphase',
    description: 'Klausuren über mehrere Wochen verteilt.',
  },
}

/** Semester ohne festgelegte Art verhalten sich wie „regulär“. */
export const semesterKind = (s?: Pick<Semester, 'kind'>): SemesterKind => s?.kind ?? 'regulaer'
