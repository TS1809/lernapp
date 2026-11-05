import { db, uid, type Homework } from './db'
import { getConfig as getStundenplanConfig, RELAY_TOKEN, RELAY_URL } from './stundenplan'

/**
 * Zentrale Kurs-Hausaufgaben + Kursvergleich. Trägt jemand eine Hausaufgabe „für den
 * ganzen Kurs" ein, liegt sie im Relais (Cloudflare KV) und alle Kursmitglieder holen
 * sie in ihre Liste. Der Kurs wird aus dem DUALIS-Login abgeleitet (z. B. „e25019" →
 * „e25") oder manuell gewählt. Das erste Mitglied je Kurs wird Admin; bis zu 3 Admins.
 */

export interface CourseConfig {
  course: string
  memberId: string
}

export interface CourseMember {
  name?: string
  seen?: number
  renames?: number
  renameAllowed?: boolean
}

/** Anonymes Aggregat (Anzahl/Schnitt/Spannweite) – keine Einzelnoten. */
export interface GradeStat {
  count: number
  avg?: number
  min?: number
  max?: number
}

/** Kurs-Noten: gesamt, je Semester (Name) und je Klausur (Modul-Key). */
export interface CourseGradeStats {
  overall: GradeStat
  semesters: Record<string, GradeStat>
  modules: Record<string, GradeStat>
}

export interface CourseSyncResult {
  admin: boolean
  admins: string[]
  members: Record<string, CourseMember>
  gradeStats?: CourseGradeStats
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

/** Legt/aktualisiert die lokale Kopie einer Kurs-Hausaufgabe; eigener Erledigt-Stand bleibt. */
async function upsertLocalCourseHw(profileId: string, course: string, r: RemoteHw, examId: string): Promise<string> {
  const id = localId(course, r.id)
  const prev = await db.homework.get(id)
  const hw: Homework = {
    id,
    profileId,
    examId,
    title: r.title || 'Aufgabe',
    description: r.description || '',
    due: r.due || '',
    minutes: r.minutes || 30,
    image: r.image,
    createdAt: prev?.createdAt ?? Date.now(),
    doneAt: prev?.doneAt,
    keptAt: prev?.keptAt,
    solution: prev?.solution,
    solutionImage: prev?.solutionImage,
    fromCourse: course,
    courseHwId: r.id,
    courseAuthor: r.createdByName,
    courseOwner: r.createdBy,
    courseSolution: r.solution || undefined,
    courseSolutionImage: r.solutionImage || undefined,
  }
  await db.homework.put(hw)
  return id
}

/** Kurs-Hausaufgaben holen und in die lokale Liste einordnen (Fach per Namensabgleich). */
export async function syncCourse(profileId: string, semesterId: string, name: string): Promise<CourseSyncResult | undefined> {
  const cfg = await ensureCourseConfig(profileId)
  if (!cfg.course) return undefined
  const res = await post<{ admin: boolean; admins: string[]; members: Record<string, CourseMember>; homework: RemoteHw[]; gradeStats?: CourseGradeStats }>(
    '/course/sync',
    { course: cfg.course, memberId: cfg.memberId, name },
  )

  const exams = await db.exams.where('semesterId').equals(semesterId).toArray()
  const byName = new Map(exams.map((e) => [e.name.trim().toLowerCase(), e]))
  const remote = new Set<string>()
  for (const r of res.homework ?? []) {
    const exam = byName.get(String(r.subject ?? '').trim().toLowerCase())
    if (!exam || !r.due) continue
    remote.add(await upsertLocalCourseHw(profileId, cfg.course, r, exam.id))
  }
  const localCourse = (await db.homework.where('profileId').equals(profileId).toArray()).filter((h) => h.fromCourse === cfg.course)
  for (const h of localCourse) if (!remote.has(h.id)) await db.homework.delete(h.id)

  return { admin: res.admin, admins: res.admins ?? [], members: res.members ?? {}, gradeStats: res.gradeStats }
}

/** Teilt eine Hausaufgabe mit dem Kurs und legt sie sofort lokal als Kurs-Eintrag an. */
export async function shareHomework(
  profileId: string,
  hw: { subject: string; title: string; description?: string; due: string; minutes: number; image?: string; solution?: string; solutionImage?: string },
  examId: string,
): Promise<void> {
  const cfg = await ensureCourseConfig(profileId)
  if (!cfg.course) throw new Error('Kein Kurs eingestellt.')
  const name = (await db.profiles.get(profileId))?.name ?? ''
  const res = await post<{ id: string; homework: RemoteHw }>('/course/homework', { course: cfg.course, memberId: cfg.memberId, name, homework: hw })
  await upsertLocalCourseHw(profileId, cfg.course, res.homework, examId) // sofort sichtbar, kein Warten auf vollen Sync
}

export async function deleteCourseHomework(profileId: string, courseHwId: string): Promise<void> {
  const cfg = await ensureCourseConfig(profileId)
  if (!cfg.course) return
  await post('/course/homework/delete', { course: cfg.course, memberId: cfg.memberId, id: courseHwId })
}

/** Eigene Noten (gesamt + je Semester + je Klausur) melden, anonyme Kursstatistik zurück. */
export async function submitCourseGrade(
  profileId: string,
  grades: { avg: number | null; semesters?: Record<string, number>; modules?: Record<string, number> },
): Promise<CourseGradeStats | undefined> {
  const cfg = await ensureCourseConfig(profileId)
  if (!cfg.course) return undefined
  const name = (await db.profiles.get(profileId))?.name ?? ''
  const res = await post<{ gradeStats?: CourseGradeStats }>('/course/grade', {
    course: cfg.course,
    memberId: cfg.memberId,
    name,
    avg: grades.avg ?? null,
    semesters: grades.semesters ?? {},
    modules: grades.modules ?? {},
  })
  return res.gradeStats
}

/** Modul-Key für den anonymen Kursvergleich (muss App und Relais gleich bilden). */
export function moduleKey(m: { code?: string | null; name?: string | null }): string {
  return String(m.code || m.name || '').trim().toLowerCase()
}

/** Sich selbst umbenennen (einmal frei, danach nur mit Admin-Freigabe). */
export async function renameSelf(profileId: string, newName: string): Promise<void> {
  const cfg = await ensureCourseConfig(profileId)
  if (!cfg.course) throw new Error('Kein Kurs eingestellt.')
  const name = (await db.profiles.get(profileId))?.name ?? ''
  await post('/course/rename', { course: cfg.course, memberId: cfg.memberId, name, newName })
}

/** Admin: einem Mitglied eine weitere Umbenennung freigeben. */
export async function allowRename(profileId: string, target: string): Promise<void> {
  const cfg = await ensureCourseConfig(profileId)
  if (!cfg.course) return
  const name = (await db.profiles.get(profileId))?.name ?? ''
  await post('/course/rename/allow', { course: cfg.course, memberId: cfg.memberId, name, target })
}

export async function kickMember(profileId: string, target: string): Promise<void> {
  const cfg = await ensureCourseConfig(profileId)
  if (!cfg.course) return
  const name = (await db.profiles.get(profileId))?.name ?? ''
  await post('/course/member/remove', { course: cfg.course, memberId: cfg.memberId, name, target })
}

export async function promoteAdmin(profileId: string, target: string): Promise<void> {
  const cfg = await ensureCourseConfig(profileId)
  if (!cfg.course) return
  const name = (await db.profiles.get(profileId))?.name ?? ''
  await post('/course/admin', { course: cfg.course, memberId: cfg.memberId, name, target, action: 'promote' })
}

export async function demoteAdmin(profileId: string, target: string): Promise<void> {
  const cfg = await ensureCourseConfig(profileId)
  if (!cfg.course) return
  const name = (await db.profiles.get(profileId))?.name ?? ''
  await post('/course/admin', { course: cfg.course, memberId: cfg.memberId, name, target, action: 'demote' })
}

export function gradeRange(stats?: GradeStat): string {
  if (!stats || !stats.count || stats.min == null || stats.max == null) return '–'
  const fmt = (x: number) => x.toFixed(2).replace('.', ',')
  return stats.min === stats.max ? fmt(stats.min) : `${fmt(stats.min)}–${fmt(stats.max)}`
}
