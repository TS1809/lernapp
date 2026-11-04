import { db, EXAM_COLORS, MAX_EXAMS_PER_SEMESTER, uid } from './db'

/**
 * Stundenplan & Noten aus DUALIS – über ein vom Nutzer betriebenes Relais (Cloudflare
 * Worker), weil der Browser DUALIS wegen CORS/Login nicht direkt abfragen kann.
 * Zugangsdaten liegen gerätelokal in der `meta`-Tabelle (nicht synchronisiert).
 */

/**
 * Relais (Cloudflare Worker) und Zugriffs-Token sind fest im Code hinterlegt – die
 * Nutzer dieses Forks sind vertrauenswürdig und müssen nur noch ihr eigenes
 * DUALIS-Login eintragen. Das Relais speichert keine Zugangsdaten.
 */
export const RELAY_URL = 'https://dualis-relais.e25019.workers.dev'
export const RELAY_TOKEN = 'bLpTqFeVx8KuD4yWgmn9NvBAY0h3wJ'

export interface StundenplanConfig {
  /** DUALIS-Benutzername (wie beim Login). */
  user: string
  /** DUALIS-Passwort. */
  pass: string
}

export interface TimetableEvent {
  /** Lokale Wandzeit „YYYY-MM-DDTHH:MM“. */
  start: string
  end: string
  weekday: string
  shortName: string
  fullName?: string | null
  room: string
  isTest: boolean
  lecturer?: string
  detailUrl?: string | null
}

export interface GradeModule {
  code?: string | null
  name?: string | null
  grade?: string | null
  credits?: string | null
  status?: string | null
}

export interface GradeSemester {
  semester: string
  modules: GradeModule[]
}

export interface CachedTimetable {
  fetchedAt: number
  week: string
  events: TimetableEvent[]
}

export interface CachedGrades {
  fetchedAt: number
  semesters: GradeSemester[]
}

const cfgKey = (profileId: string) => `stundenplan:cfg:${profileId}`
const ttKey = (profileId: string, iso: string) => `stundenplan:tt:${profileId}:${iso}`
const grKey = (profileId: string) => `stundenplan:grades:${profileId}`

export async function getConfig(profileId: string): Promise<StundenplanConfig | undefined> {
  return (await db.meta.get(cfgKey(profileId)))?.value as StundenplanConfig | undefined
}

export async function setConfig(profileId: string, cfg: StundenplanConfig): Promise<void> {
  await db.meta.put({ key: cfgKey(profileId), value: cfg })
}

export async function clearConfig(profileId: string): Promise<void> {
  await db.meta.delete(cfgKey(profileId))
}

export function configReady(cfg?: StundenplanConfig): cfg is StundenplanConfig {
  return !!cfg && !!cfg.user && !!cfg.pass
}

async function relayFetch<T>(cfg: StundenplanConfig, path: string): Promise<T> {
  const sep = path.includes('?') ? '&' : '?'
  const url = RELAY_URL.replace(/\/+$/, '') + path + sep + 'token=' + encodeURIComponent(RELAY_TOKEN)
  const res = await fetch(url, { headers: { 'X-DUALIS-USER': cfg.user, 'X-DUALIS-PASS': cfg.pass } })
  const data = (await res.json()) as T & { error?: string }
  if (data && typeof data === 'object' && 'error' in data && data.error) throw new Error(String(data.error))
  return data
}

export async function cachedTimetable(profileId: string, iso: string): Promise<CachedTimetable | undefined> {
  return (await db.meta.get(ttKey(profileId, iso)))?.value as CachedTimetable | undefined
}

export async function refreshTimetable(profileId: string, cfg: StundenplanConfig, iso: string, noDozent = false): Promise<CachedTimetable> {
  const data = await relayFetch<{ week?: string; events?: TimetableEvent[] }>(cfg, `/timetable?from=${iso}${noDozent ? '&dozent=0' : ''}`)
  const out: CachedTimetable = { fetchedAt: Date.now(), week: data.week ?? iso, events: data.events ?? [] }
  await db.meta.put({ key: ttKey(profileId, iso), value: out })
  return out
}

export async function cachedGrades(profileId: string): Promise<CachedGrades | undefined> {
  return (await db.meta.get(grKey(profileId)))?.value as CachedGrades | undefined
}

export async function refreshGrades(profileId: string, cfg: StundenplanConfig): Promise<CachedGrades> {
  const data = await relayFetch<{ semesters?: GradeSemester[] }>(cfg, `/grades`)
  const out: CachedGrades = { fetchedAt: Date.now(), semesters: data.semesters ?? [] }
  await db.meta.put({ key: grKey(profileId), value: out })
  return out
}

/* ------------------------------------------------------------------ Datum ---- */

const pad = (n: number) => String(n).padStart(2, '0')

export function isoOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const wd = (x.getDay() + 6) % 7 // Montag = 0
  x.setDate(x.getDate() - wd)
  return x
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

/** Minuten seit Mitternacht aus „…THH:MM“. */
export function minutesOf(start: string): number {
  return parseInt(start.slice(11, 13), 10) * 60 + parseInt(start.slice(14, 16), 10)
}

export function hhmm(s: string): string {
  return s.slice(11, 16)
}

/* ------------------------------------------------------------- Noten-Schnitt ---- */

/** „1,6“/„1.6“ → 1.6; alles andere (z. B. „bestanden“) → null. */
export function gradeNum(g?: string | null): number | null {
  const m = /^([0-9])[.,]([0-9])$/.exec((g ?? '').trim())
  return m ? parseFloat(`${m[1]}.${m[2]}`) : null
}

export function creditNum(c?: string | null): number {
  const v = parseFloat(String(c ?? '').replace(',', '.'))
  return Number.isFinite(v) ? v : 0
}

/** Nach Credits gewichteter Notenschnitt; null, wenn keine benotete Leistung dabei ist. */
export function average(modules: GradeModule[]): number | null {
  let sum = 0
  let weight = 0
  for (const m of modules) {
    const g = gradeNum(m.grade)
    const c = creditNum(m.credits)
    if (g != null && c > 0) {
      sum += g * c
      weight += c
    }
  }
  return weight > 0 ? sum / weight : null
}

export function fmtGrade(x: number | null): string {
  return x == null ? '–' : x.toFixed(2).replace('.', ',')
}

/* ----------------------------------------------- Prüfungen übernehmen ---- */

/**
 * Legt Klausuren aus dem Stundenplan (als Prüfung markierte Termine) automatisch in
 * der Prüfungsübersicht an. `profile.dualisExamKeys` merkt sich bereits übernommene
 * Klausuren (`${Datum}:${Kürzel}`), damit nichts doppelt angelegt und eine vom Nutzer
 * gelöschte Klausur nicht wieder erzeugt wird. Gibt die Zahl neu angelegter Prüfungen zurück.
 */
export async function importExamsFromTimetable(profileId: string, semesterId: string, events: TimetableEvent[]): Promise<number> {
  const exams = events.filter((e) => e.isTest && e.shortName)
  if (!exams.length) return 0
  const profile = await db.profiles.get(profileId)
  if (!profile) return 0

  const known = new Set(profile.dualisExamKeys ?? [])
  const added: string[] = []

  for (const e of exams) {
    const date = e.start.slice(0, 10)
    const key = `${date}:${e.shortName}`
    if (known.has(key)) continue
    // Sicherheits-Abgleich über die (synchronisierte) Prüfungstabelle – verhindert Dubletten über Geräte hinweg.
    const dup = await db.exams.where('profileId').equals(profileId).filter((x) => x.dualisKey === key).first()
    if (!dup) {
      const count = await db.exams.where('semesterId').equals(semesterId).count()
      if (count >= MAX_EXAMS_PER_SEMESTER) continue // Semester voll – nicht merken, später erneut versuchen
      await db.exams.add({
        id: uid(),
        profileId,
        semesterId,
        name: e.fullName || e.shortName,
        date,
        weight: 2,
        color: EXAM_COLORS[count % EXAM_COLORS.length],
        createdAt: Date.now(),
        dualisKey: key,
      })
    }
    known.add(key)
    added.push(key)
  }

  if (added.length) await db.profiles.update(profileId, { dualisExamKeys: [...known] })
  return added.length
}

/**
 * Übernimmt Klausuren aus allen bereits gespeicherten Stundenplan-Wochen. Läuft auch
 * ohne frischen Abruf – nützlich, wenn das Relais gerade nicht erreichbar ist, die Wochen
 * aber früher schon einmal geladen (und zwischengespeichert) wurden.
 */
export async function importExamsFromCache(profileId: string, semesterId: string): Promise<number> {
  const prefix = `stundenplan:tt:${profileId}:`
  const rows = await db.meta.where('key').startsWith(prefix).toArray()
  const events = rows.flatMap((r) => (r.value as CachedTimetable | undefined)?.events ?? [])
  return importExamsFromTimetable(profileId, semesterId, events)
}
