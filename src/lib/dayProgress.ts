import { REQUIRED_MODE, type DayPlan } from './planner'
import type { Snapshot } from './db'

/** Heutiges Pflichtpensum (Karten unterwegs) je Prüfung: erledigt und noch offen. */
export function dayWork(plan: DayPlan): Map<string, { done: number; left: number }> {
  return new Map(
    plan.exams.map((p) => {
      const m = p.modes[REQUIRED_MODE]
      return [p.examId, { done: m.newDoneToday + m.reviewsDoneToday, left: m.newLeft + m.reviewsDue }]
    }),
  )
}

/** Geschaffter Anteil des Pensums; ohne Pensum zählt ein Tag, an dem gelernt wurde, als voll. */
export function dayShare(done: number, left: number, learned: number): number {
  return done + left > 0 ? done / (done + left) : learned > 0 ? 1 : 0
}

/**
 * Anteil des geschafften Pensums je Tag für die Lernserie. Heute aus dem aktuellen Plan, frühere Tage aus den
 * gespeicherten Tageswerten. Tage ohne gespeichertes Pensum (vor Version 1.27.0) zeigen wie bisher die Zahl der
 * Bewertungen im Verhältnis zum stärksten Tag.
 */
export function weekShares(dates: string[], snapshots: Snapshot[], counts: number[], today: { date: string; share: number }): number[] {
  const max = Math.max(1, ...counts)
  return dates.map((date, i) => {
    if (date === today.date) return today.share
    const rows = snapshots.filter((s) => s.date === date && s.left !== undefined)
    if (!rows.length) return counts[i] / max
    const done = rows.reduce((s, r) => s + (r.done ?? 0), 0)
    const left = rows.reduce((s, r) => s + (r.left ?? 0), 0)
    return dayShare(done, left, counts[i])
  })
}
