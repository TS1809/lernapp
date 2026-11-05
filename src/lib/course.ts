import { db, uid, type Homework } from './db'
import { getConfig as getStundenplanConfig, RELAY_TOKEN, RELAY_URL } from './stundenplan'

/**
 * Zentrale Kurs-Hausaufgaben: Trägt jemand eine Hausaufgabe „für den ganzen Kurs" ein,
 * liegt sie im Relais (Cloudflare KV) und alle Kursmitglieder holen sie beim Öffnen in
 * ihre Hausaufgabenliste. Der Kurs wird aus dem DUALIS-Login abgeleitet (z. B. „e25019"
 * → „e25" für ET2025) oder manuell gewählt. Das erste Mitglied je Kurs wird Admin.
 */

export interface CourseConfig {
  /** Kurs-Kürzel, z. B. „e25". Leer = (noch) kein Kurs gewählt. */
  course: string
  /** Stabile Mitglieds-ID (bei DUALIS an den Login gebunden, sonst gerätelokal). */
  memberId: string
}

export interface CourseMember {
  name?: string
  seen?: number
}

export interface CourseSyncResult {
  admin: boolean
  adminId?: string
  members: Record<string, CourseMember>
}

/** Leitet das Kurs-Kürzel aus dem DUALIS-Benutzernamen ab: Buchstaben + 2 Jahresziffern. */
export function courseFromUser(user?: string | null): string {
  const m = /^([a-zA-Z]+\d{2})/.exec(String(user ?? '').trim())
  return m ? m[1].toLowerCase() : ''
}

export function sanitizeCourse(c?: string | null): string {
  const s = String(c ?? '').trim().toLowerCase()
  return /^[a-z0-9]{2,20}$/.test(s) ? s : ''
}

const cfgKey = (profileId: string) => `course:cfg:${profileId}`

export async function getCourseConfig(profileId: string): Promise<CourseConfig | undefined> {
  return (await db.meta.get(cfgKey(profileId)))?.value as CourseConfig | undefined
}

async function saveCourseConfig(profileId: string, cfg: CourseConfig): Promise<void> {
  await db.meta.put({ key: cfgKey(profileId), value: cfg })
}

/** Liefert (und erzeugt bei Bedarf) die Kurs-Konfiguration inkl. stabiler memberId. */
export async function ensureCourseConfig(profileId: string): Promise<CourseConfig> {
  const existing = await getCourseConfig(profileId)
  if (existing?.memberId) {
    // Kurs ggf. aus dem Stundenplan-Login nachziehen, wenn noch keiner gewählt ist.
    if (!existing.course) {
      const sp = await getStundenplanConfig(profileId)
      const derived = courseFromUser(sp?.user)
      if (derived) {
        const updated = { ...existing, course: derived }
        await saveCourseConfig(profileId, updated)
        return updated
      }
    }
    return existing
  }
  const sp = await getStundenplanConfig(profileId)
  const memberId = sp?.user ? 'd:' + sp.user.trim().toLowerCase() : 'm:' + uid()
  const cfg: CourseConfig = { course: courseFromUser(sp?.user), memberId }
  await saveCourseConfig(profileId, cfg)
  return cfg
}

/** Kurs manuell setzen oder ändern (ohne die memberId zu verlieren). */
export async function setCourse(profileId: string, course: string): Promise<CourseConfig> {
  const cfg = await ensureCourseConfig(profileId)
  const updated = { ...cfg, course: sanitizeCourse(course) }
  await saveCourseConfig(profileId, updated)
  return updated
}

function endpoint(path: string): string {
  return RELAY_URL.replace(/\/+$/, '') + path + '?token=' + encodeURIComponent(RELAY_TOKEN)
}

async function post<T>(path: string, body: unknown): Promise<T> {
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

interface RemoteHw {
  id: string
  subject?: string
  title?: string
  description?: string
  due?: string
  minutes?: number
  image?: string
  solution?: string
  solutionImage?: string
  createdBy?: string
  createdByName?: string
}

const localId = (course: string, hwId: string) => `c:${course}:${hwId}`

/**
 * Holt die Kurs-Hausaufgaben und führt sie in die lokale Liste ein: ein Eintrag wird dem
 * eigenen Fach gleichen Namens zugeordnet (Fächer werden ja aus demselben Stundenplan
 * übernommen). Der eigene Erledigt-Status bleibt erhalten; im Kurs gelöschte verschwinden.
 */
export async function syncCourse(profileId: string, semesterId: string, name: string): Promise<CourseSyncResult | undefined> {
  const cfg = await ensureCourseConfig(profileId)
  if (!cfg.course) return undefined
  const res = await post<{ admin: boolean; adminId?: string; members: Record<string, CourseMember>; homework: RemoteHw[] }>('/course/sync', {
    course: cfg.course,
    memberId: cfg.memberId,
    name,
  })

  const exams = await db.exams.where('semesterId').equals(semesterId).toArray()
  const byName = new Map(exams.map((e) => [e.name.trim().toLowerCase(), e]))
  const remote = new Set<string>()

  for (const r of res.homework ?? []) {
    const exam = byName.get(String(r.subject ?? '').trim().toLowerCase())
    if (!exam || !r.due) continue // kein passendes Fach / kein Termin → überspringen
    const id = localId(cfg.course, r.id)
    remote.add(id)
    const prev = await db.homework.get(id)
    const hw: Homework = {
      id,
      profileId,
      examId: exam.id,
      title: r.title || 'Aufgabe',
      description: r.description || '',
      due: r.due,
      minutes: r.minutes || 30,
      image: r.image,
      createdAt: prev?.createdAt ?? Date.now(),
      // Eigener Stand bleibt erhalten:
      doneAt: prev?.doneAt,
      keptAt: prev?.keptAt,
      solution: prev?.solution,
      solutionImage: prev?.solutionImage,
      // Kurs-Infos:
      fromCourse: cfg.course,
      courseHwId: r.id,
      courseAuthor: r.createdByName,
      courseOwner: r.createdBy,
      courseSolution: r.solution || undefined,
      courseSolutionImage: r.solutionImage || undefined,
    }
    await db.homework.put(hw)
  }

  // Lokale Kurs-Hausaufgaben entfernen, die es im Kurs nicht mehr gibt.
  const localCourse = (await db.homework.where('profileId').equals(profileId).toArray()).filter((h) => h.fromCourse === cfg.course)
  for (const h of localCourse) if (!remote.has(h.id)) await db.homework.delete(h.id)

  return { admin: res.admin, adminId: res.adminId, members: res.members ?? {} }
}

/** Teilt eine Hausaufgabe mit dem ganzen Kurs (Fach = Prüfungsname). */
export async function shareHomework(
  profileId: string,
  hw: { subject: string; title: string; description?: string; due: string; minutes: number; image?: string; solution?: string; solutionImage?: string },
): Promise<string> {
  const cfg = await ensureCourseConfig(profileId)
  if (!cfg.course) throw new Error('Kein Kurs eingestellt.')
  const name = (await db.profiles.get(profileId))?.name ?? ''
  const res = await post<{ id: string }>('/course/homework', { course: cfg.course, memberId: cfg.memberId, name, homework: hw })
  return res.id
}

/** Entfernt eine Kurs-Hausaufgabe im Kurs (nur Ersteller oder Admin). */
export async function deleteCourseHomework(profileId: string, courseHwId: string): Promise<void> {
  const cfg = await ensureCourseConfig(profileId)
  if (!cfg.course) return
  await post('/course/homework/delete', { course: cfg.course, memberId: cfg.memberId, id: courseHwId })
}

/** Admin-Recht an ein anderes Mitglied übertragen (nur aktueller Admin). */
export async function transferAdmin(profileId: string, toMemberId: string): Promise<void> {
  const cfg = await ensureCourseConfig(profileId)
  if (!cfg.course) return
  const name = (await db.profiles.get(profileId))?.name ?? ''
  await post('/course/admin', { course: cfg.course, memberId: cfg.memberId, name, toMemberId })
}
