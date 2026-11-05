import Dexie, { type EntityTable } from 'dexie'

export type Mode = 'mobile' | 'desk'
export type CardType = 'basic' | 'cloze' | 'mc' | 'match' | 'task'

/** Änderungszeitpunkt für die Synchronisation (neuerer Stand gewinnt). Wird per Hook gesetzt. */
interface Synced {
  updatedAt?: number
}

export interface Profile extends Synced {
  id: string
  name: string
  createdAt: number
  /** Tägliches Zeitbudget in Minuten für den Unterwegs-Modus (Karten). */
  minutesMobile: number
  /** Tägliches Zeitbudget in Minuten für den Schreibtisch-Modus (Rechenaufgaben). */
  minutesDesk: number
  /** Zielwahrscheinlichkeit, eine Karte bei der Wiederholung noch zu wissen (FSRS). */
  retention: number
  activeSemesterId?: string
  /** Persönliche FSRS-Parameter (aus scripts/optimize-fsrs.py); fehlen sie, gelten die Standardwerte. */
  fsrsWeights?: number[]
  /** Hinweis zur Personalisierung wurde ausgeblendet. */
  fsrsHintDismissed?: boolean
  /** false: immer mit dem eingestellten Budget planen statt es an die gemessene Lernzeit anzupassen (Standard: anpassen). */
  budgetAuto?: boolean
  /** Eigene Notizen zu Ideen für die nächste Hauptversion (Seite „Ideen für Version 2“). */
  ideas?: { id: string; text: string; createdAt: number }[]
  /** Sokratisches Lernen (Test): Leitfragen und Kernpunkte in der Lernsitzung zeigen. Standard: aus. */
  socratic?: boolean
  /** Stundenplan & Noten aus DUALIS über ein Relais (Test). Standard: aus. Die Zugangsdaten liegen gerätelokal in `meta`, nicht im synchronisierten Profil. */
  stundenplan?: boolean
  /** Bereits aus dem DUALIS-Stundenplan übernommene Prüfungen (dualisKey je Klausur), damit keine Dubletten entstehen und gelöschte nicht erneut angelegt werden. */
  dualisExamKeys?: string[]
}

export interface Semester extends Synced {
  id: string
  profileId: string
  name: string
  createdAt: number
  /** Art des Studiums bzw. der Prüfungsphase, bestimmt die Lernplanung (siehe semesters.ts). */
  kind?: 'dual' | 'regulaer'
}

export interface Exam extends Synced {
  id: string
  profileId: string
  semesterId: string
  name: string
  /** Klausurtermin als YYYY-MM-DD (lokale Zeit). */
  date: string
  /** Wichtigkeit 1–3, beeinflusst die Verteilung des Zeitbudgets. */
  weight: number
  color: string
  createdAt: number
  /** Vorlesung läuft noch, weitere Unterlagen folgen (siehe planner.ts, introWithin). */
  ongoing?: boolean
  /** Tage, innerhalb derer neuer Stoff einer laufenden Vorlesung begonnen wird (Standard 7). */
  ongoingDays?: number
  /** Fachprofil: Vorgaben für Claude bei der Erstellung von Kartenpaketen (siehe profile.ts). */
  profile?: ExamProfile
  /** Noch fehlende Unterlagen (z. B. Altklausuren), an die die App erinnert (siehe pending.ts). */
  pendingDocs?: PendingDoc[]
  /** Pausierte Kapitel (`${packageId}:${chapter}`): Ihre neuen Karten werden noch nicht eingeführt. */
  pausedChapters?: string[]
  /** Automatisch aus dem DUALIS-Stundenplan übernommen (`${date}:${Kürzel}`); kennzeichnet Klausuren, die nicht von Hand angelegt wurden. */
  dualisKey?: string
}

export interface PendingDoc {
  /** Stabil, damit ein Paket-Update eine erledigte Erinnerung nicht erneut anlegt. */
  id: string
  title: string
  note?: string
  /** Erst ab diesem Tag erinnern (YYYY-MM-DD). */
  from?: string
  /** Nach „Später“ erst ab diesem Tag wieder erinnern (YYYY-MM-DD). */
  snoozedUntil?: string
  /** Wiederkehrend (z. B. 7 = wöchentliche Übungsblätter): „Erledigt“ verschiebt die nächste Erinnerung um so viele Tage. */
  repeatDays?: number
  doneAt?: number
}

export type TaskShare = 'keine' | 'wenig' | 'mittel' | 'hoch'

export interface ExamProfile {
  /** Ordnername des Fachs im Inhalte-Archiv; bleibt beim Umbenennen der Prüfung gleich. */
  slug?: string
  /** Prüfungsform, z. B. „schriftlich“. */
  form?: string
  /** Prüfungsdauer in Minuten. */
  duration?: number
  /** Erlaubte Hilfsmittel. */
  aids?: string
  /** Gewünschter Anteil an Rechenaufgaben. */
  taskShare?: TaskShare
  /** Schwerpunkte und Hinweise des Dozenten. */
  focus?: string
  /** Was weggelassen oder nur als Zusatzstoff abgefragt werden soll. */
  omit?: string
  /** Notation, Formelzeichen, Einheiten. */
  notation?: string
  notes?: string
  /** Von Claude vorgeschlagene, noch nicht bestätigte Felder. */
  suggested?: ProfileField[]
}

export type ProfileField = Exclude<keyof ExamProfile, 'suggested'>

/** Inhalt einer Karte, wie er in einem Kartenpaket steht. */
export interface CardContent {
  uid: string
  type: CardType
  chapter?: string
  front: string
  back: string
  /** Multiple Choice: Antwortoptionen und Indizes der richtigen. */
  options?: string[]
  correct?: number[]
  /** Zuordnen: Paare [links, rechts]; die rechten Einträge werden gemischt angeboten. */
  pairs?: [string, string][]
  /** Rechenaufgabe: Lösungsschritte und Endergebnis. */
  steps?: string[]
  result?: string
  /** Rechenaufgabe: Zahlenergebnisse für die automatische Prüfung der Eingabe. */
  answers?: NumericAnswer[]
  /** slide = gedruckte Foliennummer, page = Seite im PDF (für „Folie ansehen“) */
  source?: { file?: string; slide?: number | string; page?: number }
  image?: string
  tags?: string[]
  /** Klausurrelevanz 1–3 (z. B. aus Altklausuren abgeleitet). */
  relevance?: number
  /** Themen-Schlagworte; verknüpfen Rechenaufgaben mit Karten desselben Themas (auch paketübergreifend). */
  topics?: string[]
  /** Aufgabe stammt aus einer Alt- oder Probeklausur – wird am Schreibtisch bevorzugt empfohlen. */
  pastExam?: boolean
  /** Überschreibt den Modus; Standard: Aufgaben am Schreibtisch, alles andere unterwegs. */
  mode?: Mode
  /** Sokratisches Lernen: Leitfragen, die vor dem Aufdecken einzeln als „Tipp“ erscheinen. */
  prompts?: string[]
  /** Sokratisches Lernen: Kernpunkte der Antwort zum Abhaken nach dem Aufdecken. */
  keyPoints?: string[]
}

export interface NumericAnswer {
  /** Bezeichnung bei mehreren gesuchten Größen, z. B. „σ“ */
  label?: string
  /** Zahlenwert – oder stattdessen `text` für Antworten, die keine Zahl sind */
  value?: number
  /** Akzeptierte Textantworten (z. B. „3E8“, „01101001“, „ELSIF“); Groß-/Kleinschreibung und Leerzeichen zählen nicht */
  text?: string[]
  unit?: string
  /** Erlaubte relative Abweichung (Standard 0,02 = 2 %) */
  tolerance?: number
}

/** FSRS-Zustand mit Zeitstempeln als Zahlen, damit Backups reines JSON bleiben. */
export interface MemoryState {
  due: number
  stability: number
  difficulty: number
  scheduled_days: number
  learning_steps: number
  reps: number
  lapses: number
  /** 0 = neu, 1 = lernen, 2 = wiederholen, 3 = neu lernen */
  state: number
  last_review?: number
}

export interface StudyCard extends CardContent, Synced {
  /** `${examId}:${packageId}:${uid}` */
  id: string
  profileId: string
  examId: string
  packageId: string
  chapterTitle?: string
  /** Position innerhalb des Pakets, bestimmt die Reihenfolge neuer Karten. */
  order: number
  archived: 0 | 1
  /** Vom Nutzer gelöscht: bleibt archiviert, auch wenn ein Paket-Update die Karte wieder enthält (siehe cards.ts). */
  deletedAt?: number
  addedAt: number
  s: MemoryState
}

/** Eine einzelne Bewertung. Unveränderlich; die ID ist geräteübergreifend eindeutig. */
export interface ReviewLog {
  id: string
  profileId: string
  examId: string
  cardId: string
  mode: Mode
  rating: number
  /** Zustand vor der Bewertung (0 = Karte war neu). */
  stateBefore: number
  reviewedAt: number
  durationMs: number
}

export interface PackageRecord extends Synced {
  /** `${examId}:${packageId}` */
  id: string
  profileId: string
  examId: string
  packageId: string
  title: string
  version: number
  importedAt: number
  /** Zeitpunkt des ersten Imports; bestimmt die Reihenfolge der Pakete, solange keine Position gesetzt ist. */
  firstImportedAt?: number
  /** Vom Nutzer festgelegte Lernreihenfolge der Pakete einer Prüfung (0, 1, …), siehe movePackage. */
  position?: number
  cardCount: number
  /** Vom Nutzer entfernt: Alle Karten des Pakets sind mit genau diesem Zeitpunkt gelöscht (siehe removePackage). */
  removedAt?: number
}

export interface Snapshot extends Synced {
  /** `${examId}:${YYYY-MM-DD}` */
  id: string
  profileId: string
  examId: string
  date: string
  total: number
  introduced: number
  secure: number
  /** Pflichtpensum des Lerntags (Karten unterwegs): erledigt und noch offen, Stand der letzten Speicherung. */
  done?: number
  left?: number
}

export type ReportCategory = 'fehler' | 'unklar' | 'aufteilen' | 'sonstiges'

/** Meldung zu einer fehlerhaften oder unklaren Karte – wird exportiert und bei der nächsten Paketerstellung bearbeitet. */
export interface CardReport extends Synced {
  id: string
  profileId: string
  examId: string
  cardId: string
  packageId: string
  uid: string
  category: ReportCategory
  note: string
  createdAt: number
  /** Gesetzt, sobald ein Paket-Update die Karte geändert hat oder der Nutzer die Meldung abhakt. */
  resolvedAt?: number
}

/** Hausaufgabe: einmalige Schreibtischaufgabe mit Abgabetermin (keine Wiederholung wie bei Karten). */
export interface Homework {
  id: string
  profileId: string
  examId: string
  title: string
  description: string
  /** Abgabetermin (ISO-Datum) */
  due: string
  /** Geschätzte Bearbeitungszeit in Minuten */
  minutes: number
  /** Foto des Aufgabenblatts als Daten-URL (verkleinert) */
  image?: string
  createdAt: number
  doneAt?: number
  /** Eigene Lösung (Notiz und Foto), beim Abhaken optional erfasst */
  solution?: string
  solutionImage?: string
  /** Als Übungsaufgabe in die Wiederholung übernommen */
  keptAt?: number
  updatedAt?: number
  /* --- Kurs-Hausaufgaben (zentral geteilt über das Relais) --- */
  /** Kurs-Kürzel, aus dem diese Hausaufgabe stammt (gesetzt = vom Kurs geteilt, nicht selbst angelegt). */
  fromCourse?: string
  /** ID des Eintrags im Kurs-Speicher (zum Abgleich/Löschen). */
  courseHwId?: string
  /** Anzeigename, wer die Aufgabe im Kurs eingestellt hat. */
  courseAuthor?: string
  /** memberId des Erstellers (für „darf löschen/ändern"). */
  courseOwner?: string
  /** Vom Kurs geteilte Musterlösung (getrennt von der eigenen `solution`). */
  courseSolution?: string
  courseSolutionImage?: string
}

/** Freie Erinnerung („an etwas denken“) – optional mit einer Prüfung oder Hausaufgabe verknüpft. */
export interface Reminder {
  id: string
  profileId: string
  title: string
  note?: string
  /** Fällig ab diesem Tag (ISO-Datum) */
  date: string
  examId?: string
  /** Verknüpfte Hausaufgabe, z. B. um sie vor der Abgabe zu bearbeiten – ist sie erledigt, gilt die Erinnerung als erledigt. */
  homeworkId?: string
  createdAt: number
  doneAt?: number
  updatedAt?: number
}

/** Merkt sich Löschungen, damit sie bei der Synchronisation nicht wieder auftauchen. */
export interface Tombstone {
  /** `${table}:${key}` */
  id: string
  profileId: string
  table: 'profiles' | 'semesters' | 'exams' | 'reviews' | 'reports' | 'homework' | 'reminders'
  key: string
  deletedAt: number
}

/** Zwischengespeicherte Vorlesungsunterlage für „Folie ansehen“ (nur auf diesem Gerät). */
export interface StoredPdf {
  /** Dateiname wie in source.file der Karten */
  name: string
  blob: Blob
  size: number
  addedAt: number
}

/** Geräteeinstellungen, die nicht synchronisiert werden (z. B. Dropbox-Zugang). */
export interface Meta {
  key: string
  value: unknown
}

export const db = new Dexie('lernapp') as Dexie & {
  profiles: EntityTable<Profile, 'id'>
  semesters: EntityTable<Semester, 'id'>
  exams: EntityTable<Exam, 'id'>
  cards: EntityTable<StudyCard, 'id'>
  reviews: EntityTable<ReviewLog, 'id'>
  packages: EntityTable<PackageRecord, 'id'>
  snapshots: EntityTable<Snapshot, 'id'>
  tombstones: EntityTable<Tombstone, 'id'>
  meta: EntityTable<Meta, 'key'>
  reports: EntityTable<CardReport, 'id'>
  pdfs: EntityTable<StoredPdf, 'name'>
  homework: EntityTable<Homework, 'id'>
  reminders: EntityTable<Reminder, 'id'>
}

export const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)

db.version(1).stores({
  profiles: 'id',
  semesters: 'id, profileId',
  exams: 'id, profileId, semesterId',
  cards: 'id, profileId, examId, [examId+archived], packageId',
  logs: '++id, profileId, examId, cardId, reviewedAt',
  packages: 'id, profileId, examId',
  snapshots: 'id, profileId, examId',
})

// Version 2: Bewertungen mit geräteübergreifend eindeutiger ID (statt fortlaufender Nummer),
// dazu Löschmarken und Geräteeinstellungen für die Synchronisation.
db.version(2)
  .stores({
    reviews: 'id, profileId, examId, cardId, reviewedAt',
    tombstones: 'id, profileId',
    meta: 'key',
  })
  .upgrade(async (tx) => {
    const old = await tx.table('logs').toArray()
    await tx.table('reviews').bulkAdd(old.map(({ id: _id, ...l }) => ({ ...l, id: uid() })))
  })

db.version(3).stores({ logs: null })

db.version(4).stores({ reports: 'id, profileId, examId, cardId' })

db.version(5).stores({ pdfs: 'name' })

db.version(6).stores({ homework: 'id, profileId, examId' })

db.version(7).stores({ reminders: 'id, profileId' })

/** Solange aktiv, übernehmen Schreibzugriffe den mitgelieferten Änderungszeitpunkt (Sync). */
let keepTimestamps = false

export async function withSyncedTimestamps<T>(fn: () => Promise<T>): Promise<T> {
  keepTimestamps = true
  try {
    return await fn()
  } finally {
    keepTimestamps = false
  }
}

for (const table of [db.profiles, db.semesters, db.exams, db.cards, db.packages, db.snapshots, db.reports, db.homework, db.reminders] as Dexie.Table<Synced>[]) {
  table.hook('creating', (_key, obj) => {
    if (!keepTimestamps || !obj.updatedAt) obj.updatedAt = Date.now()
  })
  table.hook('updating', () => (keepTimestamps ? undefined : { updatedAt: Date.now() }))
}

export const tombstone = (table: Tombstone['table'], key: string, profileId: string, deletedAt = Date.now()): Tombstone => ({
  id: `${table}:${key}`,
  profileId,
  table,
  key,
  deletedAt,
})

export const cardMode = (c: Pick<CardContent, 'type' | 'mode'>): Mode =>
  c.mode ?? (c.type === 'task' ? 'desk' : 'mobile')

export const MAX_EXAMS_PER_SEMESTER = 10

export const EXAM_COLORS = ['#0071e3', '#ff9500', '#34c759', '#af52de', '#ff2d55', '#5ac8fa', '#ffcc00', '#5856d6', '#a2845e', '#8e8e93']

const PROFILE_TABLES = () => [db.semesters, db.exams, db.cards, db.reviews, db.packages, db.snapshots, db.reports, db.homework, db.reminders, db.tombstones] as Dexie.Table[]

/** Löscht ein Profil mit allen zugehörigen Daten auf diesem Gerät. */
export async function deleteProfile(profileId: string) {
  await db.transaction('rw', [db.profiles, db.meta, ...PROFILE_TABLES()], async () => {
    for (const t of PROFILE_TABLES()) await t.where('profileId').equals(profileId).delete()
    await db.profiles.delete(profileId)
    await db.meta.delete(`dropbox:${profileId}`)
  })
}

/** Löscht eine Prüfung mit Karten, Verlauf und Paketen. */
export async function deleteExam(examId: string) {
  await db.transaction('rw', [db.exams, db.cards, db.reviews, db.packages, db.snapshots, db.reports, db.homework, db.tombstones], async () => {
    const exam = await db.exams.get(examId)
    for (const t of [db.cards, db.reviews, db.packages, db.snapshots, db.reports, db.homework] as Dexie.Table[]) {
      await t.where('examId').equals(examId).delete()
    }
    await db.exams.delete(examId)
    // Karten, Verlauf usw. gelten bei der Synchronisation als verwaist und werden mit entfernt.
    if (exam) await db.tombstones.put(tombstone('exams', examId, exam.profileId))
  })
}

export async function deleteSemester(semesterId: string) {
  const semester = await db.semesters.get(semesterId)
  const exams = await db.exams.where('semesterId').equals(semesterId).toArray()
  for (const e of exams) await deleteExam(e.id)
  await db.semesters.delete(semesterId)
  if (semester) await db.tombstones.put(tombstone('semesters', semesterId, semester.profileId))
}

/**
 * Bittet den Browser, die Lerndaten nicht bei Speichermangel zu löschen. Erst nach dem
 * Anlegen eines Profils, damit Browser mit Rückfrage (Firefox) nicht beim ersten Öffnen fragen.
 */
export async function requestPersistentStorage() {
  try {
    if ((await db.profiles.count()) && !(await navigator.storage?.persisted?.())) await navigator.storage?.persist?.()
  } catch {
    // nicht unterstützt
  }
}
