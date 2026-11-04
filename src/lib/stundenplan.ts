import { db } from './db'

/**
 * Stundenplan & Noten aus DUALIS – über ein vom Nutzer betriebenes Relais (Cloudflare
 * Worker), weil der Browser DUALIS wegen CORS/Login nicht direkt abfragen kann.
 * Zugangsdaten liegen gerätelokal in der `meta`-Tabelle (nicht synchronisiert).
 */

export interface StundenplanConfig {
  /** Basis-Adresse des Relais, z. B. https://dualis-relais.name.workers.dev */
  relayUrl: string
  /** Gemeinsames Zugriffs-Token des Relais (RELAY_TOKEN). */
  token: string
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
  return !!cfg && !!cfg.relayUrl && !!cfg.token && !!cfg.user && !!cfg.pass
}

async function relayFetch<T>(cfg: StundenplanConfig, path: string): Promise<T> {
  const sep = path.includes('?') ? '&' : '?'
  const url = cfg.relayUrl.replace(/\/+$/, '') + path + sep + 'token=' + encodeURIComponent(cfg.token)
  const res = await fetch(url, { headers: { 'X-DUALIS-USER': cfg.user, 'X-DUALIS-PASS': cfg.pass } })
  const data = (await res.json()) as T & { error?: string }
  if (data && typeof data === 'object' && 'error' in data && data.error) throw new Error(String(data.error))
  return data
}

export async function cachedTimetable(profileId: string, iso: string): Promise<CachedTimetable | undefined> {
  return (await db.meta.get(ttKey(profileId, iso)))?.value as CachedTimetable | undefined
}

export async function refreshTimetable(profileId: string, cfg: StundenplanConfig, iso: string): Promise<CachedTimetable> {
  const data = await relayFetch<{ week?: string; events?: TimetableEvent[] }>(cfg, `/timetable?from=${iso}`)
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
