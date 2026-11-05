import { db } from './db'
import { ensureCourseConfig } from './course'
import { RELAY_TOKEN, RELAY_URL } from './stundenplan'

/**
 * Kurschat: nur Textnachrichten, gemeinsam im Kurs (über das Relais, KV `PUSH`).
 * Nachrichten löschen sich nach 7 Tagen selbst – außer sie sind als „behalten" markiert.
 * Löschen: Sender oder Admin. „Behalten" setzen: jeder; entfernen: Admin oder wer es setzte.
 * Reaktionen: mehrere pro Person möglich (je Emoji eine Liste von Mitgliedern).
 */
export interface ChatMessage {
  id: string
  memberId: string
  name: string
  text: string
  at: number
  keep?: boolean
  keptBy?: string
  reactions?: Record<string, string[]>
}

export interface ChatState {
  messages: ChatMessage[]
  admins: string[]
  memberId: string
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

export async function listChat(profileId: string): Promise<ChatState | undefined> {
  const b = await base(profileId)
  if (!b) return undefined
  const res = await post<{ messages: ChatMessage[]; admins: string[] }>('/course/chat/list', b)
  return { messages: res.messages ?? [], admins: res.admins ?? [], memberId: b.memberId }
}

export async function sendChat(profileId: string, text: string): Promise<void> {
  const b = await base(profileId)
  if (!b) throw new Error('Kein Kurs eingestellt.')
  await post('/course/chat/send', { ...b, text })
}

export async function deleteChat(profileId: string, id: string): Promise<void> {
  const b = await base(profileId)
  if (!b) return
  await post('/course/chat/delete', { ...b, id })
}

export async function keepChat(profileId: string, id: string, keep: boolean): Promise<void> {
  const b = await base(profileId)
  if (!b) return
  await post('/course/chat/keep', { ...b, id, keep })
}

export async function reactChat(profileId: string, id: string, emoji: string, on: boolean): Promise<void> {
  const b = await base(profileId)
  if (!b) return
  await post('/course/chat/react', { ...b, id, emoji, on })
}
