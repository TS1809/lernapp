import { db } from './db'
import { ensureCourseConfig } from './course'
import { RELAY_TOKEN, RELAY_URL } from './stundenplan'

/**
 * Kurs-Termine mit Abstimmung (Zu-/Absage), gemeinsam im Kurs über das Relais (KV `PUSH`).
 * Jedes Mitglied kann Termine anlegen; löschen darf Ersteller oder Admin. Abstimmen (ja/nein)
 * darf jedes Mitglied, die eigene Stimme ist jederzeit änderbar. Vergangene Termine räumt das
 * Relais 14 Tage nach dem Termin selbst auf.
 */
export interface CourseEvent {
  id: string
  title: string
  at: number
  location?: string
  description?: string
  createdBy: string
  createdByName: string
  createdAt: number
  votes?: Record<string, 'yes' | 'no'>
}

export interface EventState {
  events: CourseEvent[]
  admins: string[]
  memberId: string
  course: string
  members: Record<string, string> // memberId -> Anzeigename (für „wer hat zu-/abgesagt")
}

function endpoint(path: string): string {
  return RELAY_URL.replace(/\/+$/, '') + path + '?token=' + encodeURIComponent(RELAY_TOKEN)
}

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(endpoint(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok || (data && typeof data === 'object' && 'error' in data && data.error)) {
    throw new Error((data && data.error) || `Fehler ${res.status}`)
  }
  return data
}

async function base(profileId: string): Promise<{ course: string; memberId: string; name: string } | undefined> {
  const cfg = await ensureCourseConfig(profileId)
  if (!cfg.course) return undefined
  const name = (await db.profiles.get(profileId))?.name ?? ''
  return { course: cfg.course, memberId: cfg.memberId, name }
}

export async function listEvents(profileId: string): Promise<EventState | undefined> {
  const b = await base(profileId)
  if (!b) return undefined
  const res = await post<{ events: CourseEvent[]; admins: string[]; members?: Record<string, string> }>('/course/event/list', b)
  return { events: res.events ?? [], admins: res.admins ?? [], memberId: b.memberId, course: b.course, members: res.members ?? {} }
}

export async function createEvent(
  profileId: string,
  event: { title: string; at: number; location?: string; description?: string },
): Promise<CourseEvent> {
  const b = await base(profileId)
  if (!b) throw new Error('Kein Kurs eingestellt.')
  const res = await post<{ event: CourseEvent }>('/course/event/create', { ...b, event })
  return res.event
}

export async function deleteEvent(profileId: string, id: string): Promise<void> {
  const b = await base(profileId)
  if (!b) return
  await post('/course/event/delete', { ...b, id })
}

export async function voteEvent(profileId: string, id: string, vote: 'yes' | 'no' | null): Promise<void> {
  const b = await base(profileId)
  if (!b) return
  await post('/course/event/vote', { ...b, id, vote })
}

/** Anzahl kommender Termine, bei denen die eigene Stimme noch fehlt (für die Dashboard-Kachel). */
export async function eventsPendingCount(profileId: string): Promise<number> {
  const b = await base(profileId)
  if (!b) return 0
  const res = await post<{ events: CourseEvent[] }>('/course/event/list', b)
  const now = Date.now()
  return (res.events ?? []).filter((e) => (e.at || 0) >= now && !(e.votes && e.votes[b.memberId])).length
}
