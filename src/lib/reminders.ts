// Freie Erinnerungen („an etwas denken“), z. B. eine Hausaufgabe früher bearbeiten oder Feedback geben.
// Unabhängig vom Lernplan: Sie erscheinen ab ihrem Tag auf der Startseite und in der Kurzbefehle-Erinnerung.
import { db, tombstone, uid, type Homework, type Reminder } from './db'
import { addDays, daysUntil, isoDate } from './dates'

/** So lange bleiben erledigte Erinnerungen (ausgegraut, mit „Rückgängig“) sichtbar, danach werden sie gelöscht. */
export const KEEP_DONE_DAYS = 7

/** Offen = nicht abgehakt und die verknüpfte Hausaufgabe (falls vorhanden) nicht erledigt. */
export function isOpenReminder(r: Reminder, homework: Map<string, Homework>) {
  if (r.doneAt) return false
  const h = r.homeworkId ? homework.get(r.homeworkId) : undefined
  return !h?.doneAt
}

/** Zeitpunkt, zu dem die Erinnerung erledigt wurde – abgehakt oder über die verknüpfte Hausaufgabe. */
export function doneTime(r: Reminder, homework: Map<string, Homework>): number | undefined {
  return r.doneAt ?? (r.homeworkId ? homework.get(r.homeworkId)?.doneAt : undefined)
}

/** Erledigt, aber noch keine KEEP_DONE_DAYS her – wird ausgegraut angezeigt. */
export function isRecentlyDone(r: Reminder, homework: Map<string, Homework>, now = Date.now()) {
  const t = doneTime(r, homework)
  return t !== undefined && now - t < KEEP_DONE_DAYS * 864e5
}

/** Löscht Erinnerungen, die seit mehr als KEEP_DONE_DAYS erledigt sind (mit Löschmarke für den Abgleich). */
export async function purgeDoneReminders(profileId: string, now = Date.now()) {
  const [list, hw] = await Promise.all([
    db.reminders.where('profileId').equals(profileId).toArray(),
    db.homework.where('profileId').equals(profileId).toArray(),
  ])
  const homework = new Map(hw.map((h) => [h.id, h]))
  const old = list.filter((r) => {
    const t = doneTime(r, homework)
    return t !== undefined && now - t >= KEEP_DONE_DAYS * 864e5
  })
  for (const r of old) await deleteReminder(r)
  return old.length
}

/** Fällig = offen und der Tag ist erreicht. */
export const isDueReminder = (r: Reminder, homework: Map<string, Homework>, now = Date.now()) => isOpenReminder(r, homework) && daysUntil(r.date, now) <= 0

/** Offene Erinnerungen, die nächste zuerst. */
export const sortReminders = (list: Reminder[]) => [...list].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)

export async function saveReminder(r: Omit<Reminder, 'id' | 'createdAt'> & { id?: string; createdAt?: number }) {
  const record: Reminder = { ...r, id: r.id ?? uid(), createdAt: r.createdAt ?? Date.now() }
  await db.reminders.put(record)
  return record
}

export const completeReminder = (r: Reminder, now = Date.now()) => db.reminders.update(r.id, { doneAt: now })
export const reopenReminder = (r: Reminder) => db.reminders.update(r.id, { doneAt: undefined })

/** Auf einen späteren Tag verschieben (Standard: morgen). */
export const postponeReminder = (r: Reminder, days = 1, now = Date.now()) => db.reminders.update(r.id, { date: isoDate(addDays(now, days)), doneAt: undefined })

export async function deleteReminder(r: Reminder) {
  await db.transaction('rw', db.reminders, db.tombstones, async () => {
    await db.reminders.delete(r.id)
    await db.tombstones.put(tombstone('reminders', r.id, r.profileId))
  })
}

/** Vorschlag für eine Erinnerung zu einer Hausaufgabe: zwei Tage vor der Abgabe, frühestens heute. */
export function homeworkReminderDate(h: Homework, now = Date.now()) {
  const d = daysUntil(h.due, now)
  return isoDate(addDays(now, Math.max(0, d - 2)))
}
