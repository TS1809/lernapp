import { studyDayStart } from './dates'

const KEY = 'lernapp-uebersprungen'

/**
 * In der Lernsitzung übersprungene Karten ruhen bis zum nächsten Lerntag. Nur auf diesem Gerät gespeichert –
 * ohne Speicher (privates Fenster) gilt das Überspringen nur für die laufende Sitzung.
 */
export function skippedToday(now = Date.now()): Set<string> {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { day: number; ids: string[] } | null
    return new Set(stored?.day === studyDayStart(now) ? stored.ids : [])
  } catch {
    return new Set()
  }
}

export function skipToday(cardId: string, now = Date.now()) {
  try {
    const ids = [...skippedToday(now), cardId]
    localStorage.setItem(KEY, JSON.stringify({ day: studyDayStart(now), ids }))
  } catch {
    // Ohne Speicher wird die Karte nur aus der laufenden Sitzung genommen.
  }
}
