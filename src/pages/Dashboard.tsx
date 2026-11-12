import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useActive } from '../state'
import { daysUntil, formatCountdown, formatDate, studyDate } from '../lib/dates'
import { Icon, PageHeader, Widget } from '../components/ui'
import { Link } from 'react-router-dom'
import { shortDue } from './Homework'
import { sortOpen } from '../lib/homework'
import { ReminderRow, usePurgeDoneReminders, useReminders } from './Reminders'
import { isDueReminder, isOpenReminder } from '../lib/reminders'
import { useSync } from '../sync-state'
import { BACKUP_REMINDER_DAYS, lastBackup } from '../lib/backup'
import { db } from '../lib/db'
import { DashboardStundenplan, NotenKachel } from './Stundenplan'
import { KurschatKachel } from './CourseChat'
import { TermineKachel } from './CourseEvents'
import { SpeiseplanKachel } from './Mensa'
import { syncCourse } from '../lib/course'

/** So viele Klausuren passen in die „Nächste Klausuren“-Kachel. */
const MAX_EXAM_ROWS = 5

/** Startseite im Stil des iPadOS-Homescreens: Widgets führen zu den einzelnen Bereichen. */
export function Dashboard() {
  const { profile, semester } = useActive()
  const sync = useSync()
  const exams = useLiveQuery(
    () => (profile.activeSemesterId ? db.exams.where('semesterId').equals(profile.activeSemesterId).toArray() : []),
    [profile.activeSemesterId],
  )
  const homeworkAll = useLiveQuery(() => db.homework.where('profileId').equals(profile.id).toArray(), [profile.id])
  const backupAt = useLiveQuery(async () => (await lastBackup(profile.id)) ?? 0, [profile.id])
  const rem = useReminders()
  usePurgeDoneReminders()

  // Kurs automatisch beitreten (aus dem DUALIS-Login erkannt) und Kurs-Hausaufgaben holen.
  useEffect(() => {
    syncCourse(profile.id, semester.id, profile.name).catch(() => {})
  }, [profile.id, semester.id])

  if (!exams || !homeworkAll) return null
  const now = Date.now()
  const homework = sortOpen(homeworkAll)
  // Ohne Dropbox: Erinnerung an eine Sicherungsdatei, sobald seit der letzten (bzw. dem Start) eine Woche vergangen ist.
  const since = backupAt || profile.createdAt
  const hasData = exams.length > 0 || homeworkAll.length > 0
  const backupDue =
    !sync.connected && backupAt !== undefined && hasData && now - since >= BACKUP_REMINDER_DAYS * 864e5
      ? backupAt
        ? Math.floor((now - backupAt) / 864e5)
        : 0
      : null
  const openReminders = rem ? rem.reminders.filter((r) => isOpenReminder(r, rem.homework)) : []
  const dueReminders = rem ? openReminders.filter((r) => isDueReminder(r, rem.homework, now)) : []
  // Heute abgehakte bleiben bis zum Abend ausgegraut im Widget – zum Rückgängigmachen.
  const doneToday = rem ? rem.reminders.filter((r) => r.doneAt && studyDate(r.doneAt) === studyDate(now)) : []
  const reminderRows = [...dueReminders, ...doneToday]

  // Nächste Klausuren: nur die aktuelle Prüfungsphase. Beim Import aus dem
  // Stundenplan landen alle Klausuren im aktiven Semester; ein späteres Semester
  // liegt zeitlich weit entfernt (große Lücke) und bleibt hier außen vor.
  const nextExams = (() => {
    const future = exams.filter((e) => e.date && daysUntil(e.date, now) >= 0).sort((a, b) => a.date.localeCompare(b.date))
    const phase: typeof future = []
    for (const e of future) {
      const prev = phase[phase.length - 1]
      if (prev && daysUntil(e.date, now) - daysUntil(prev.date, now) > 90) break
      phase.push(e)
    }
    return phase
  })()

  return (
    <>
      <PageHeader
        action={
          <span className="header-icons">
            <Link to="/hilfe" className="icon-btn" aria-label="Hilfe" title="Hilfe"><Icon name="help" size={22} /></Link>
            <Link to="/einstellungen" className="icon-btn" aria-label="Einstellungen" title="Einstellungen"><Icon name="settings" size={22} /></Link>
          </span>
        }
        eyebrow={new Date(now).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}
        title={`Hallo ${profile.name}.`}
        subtitle={
          <>
            {semester.name}
            {semester.kind && ` · ${semester.kind === 'dual' ? 'dual' : 'regulär'}`}
            {sync.connected && <span className={sync.error ? 'badge-warn' : ''}>{sync.error ? ' · Abgleich fehlgeschlagen' : sync.syncing ? ' · gleicht ab …' : ' · synchronisiert'}</span>}
          </>
        }
      />

      <div className="widgets-wrap">
      <div className="widgets">
        {backupDue !== null && (
          <Widget size="medium" to="/einstellungen" title="Sicherung" icon="download" tint="var(--warn)">
            <div className="w-headline">{backupDue ? `Letzte Sicherung vor ${backupDue} Tagen` : 'Noch keine Sicherung'}</div>
            <p className="w-caption">Ohne Dropbox liegen deine Daten nur auf diesem Gerät. Tippen und unter „Daten & Sicherung“ eine Sicherungsdatei anlegen, z. B. in iCloud Drive.</p>
          </Widget>
        )}

        {!semester.kind && (
          <Widget size="medium" to={`/semester/${semester.id}`} title="Semester einrichten" icon="settings" tint="var(--warn)">
            <div className="w-headline">Wie sieht deine Prüfungsphase aus?</div>
            <p className="w-caption">Dual mit allen Klausuren in einer Woche oder regulär über mehrere Wochen.</p>
          </Widget>
        )}

        {exams.length === 0 && (
          <Widget size="medium" to="/pruefung/neu" title="Loslegen" icon="plus">
            <div className="w-headline">Erste Prüfung anlegen</div>
            <p className="w-caption">Mit Termin und Fach – sie taucht dann in „Nächste Klausuren“ und im Stundenplan auf.</p>
          </Widget>
        )}

        {rem && reminderRows.length > 0 && (
          <Widget size="medium" title="Erinnerungen" icon="bell" tint="var(--accent)" label={`Erinnerungen: ${dueReminders.length} fällig`}>
            <div className="w-reminders">
              {reminderRows.slice(0, 3).map((r) => (
                <ReminderRow key={r.id} r={r} exam={r.examId ? rem.exams.get(r.examId) : undefined} hw={r.homeworkId ? rem.homework.get(r.homeworkId) : undefined} compact />
              ))}
            </div>
            <Link className="w-caption" to="/erinnerungen" style={{ marginTop: 'auto' }}>
              {reminderRows.length > 3 ? `+ ${reminderRows.length - 3} weitere – alle Erinnerungen` : 'Alle Erinnerungen'}
            </Link>
          </Widget>
        )}

        {exams.length > 0 && (
          <Widget size="small" title="Hausaufgaben" icon="pencil" tint="var(--hard)">
            <Link to="/hausaufgaben" className="w-link" aria-label={`Hausaufgaben: ${homework.length} offen`}>
              {homework.length > 0 ? (
                <>
                  <div className="w-number">{homework.length}</div>
                  <div className="w-caption truncate">offen · {shortDue(homework[0], now)}</div>
                </>
              ) : (
                <div className="w-headline">Nichts offen</div>
              )}
            </Link>
            <Link className="w-pill w-add" to="/hausaufgabe/neu" aria-label="Hausaufgabe eintragen">
              <Icon name="plus" size={16} /> Eintragen
            </Link>
          </Widget>
        )}

        {rem && reminderRows.length === 0 && (
          <Widget size="small" title="Erinnerungen" icon="bell">
            <Link to="/erinnerungen" className="w-link" aria-label={`Erinnerungen: ${openReminders.length} offen`}>
              {openReminders.length > 0 ? (
                <>
                  <div className="w-number">{openReminders.length}</div>
                  <div className="w-caption truncate">offen · nächste {new Date(`${openReminders[0].date}T12:00:00`).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</div>
                </>
              ) : (
                <div className="w-headline">Keine offen</div>
              )}
            </Link>
            <Link className="w-pill w-add" to="/erinnerung/neu" aria-label="Erinnerung eintragen">
              <Icon name="plus" size={16} /> Eintragen
            </Link>
          </Widget>
        )}

        {nextExams.length > 0 && (
          <Widget size={nextExams.length > 1 ? 'large' : 'medium'} to="/pruefungen" title="Nächste Klausuren" icon="clock" label="Nächste Klausuren">
            <div className="w-list">
              {nextExams.slice(0, MAX_EXAM_ROWS).map((e) => {
                const d = daysUntil(e.date, now)
                return (
                  <div key={e.id} className="w-list-item" aria-label={`${e.name}: ${formatCountdown(d)}`}>
                    <div className="row between">
                      <span className="row grow" style={{ gap: 8, minWidth: 0 }}>
                        <span className="dot" style={{ background: e.color }} />
                        <span className="truncate">{e.name}</span>
                      </span>
                      <small className={d <= 7 ? 'badge-warn' : ''}>{formatCountdown(d)}</small>
                    </div>
                    <small className="muted">{formatDate(e.date)}{e.ongoing ? ' · läuft noch' : ''}</small>
                  </div>
                )
              })}
              {nextExams.length > MAX_EXAM_ROWS && <small>+ {nextExams.length - MAX_EXAM_ROWS} weitere</small>}
            </div>
          </Widget>
        )}

        {profile.stundenplan && <NotenKachel profileId={profile.id} />}

        {profile.stundenplan && <KurschatKachel profileId={profile.id} />}

        {profile.stundenplan && <TermineKachel profileId={profile.id} />}

        {profile.stundenplan && <SpeiseplanKachel profileId={profile.id} />}
      </div>
      </div>

      {profile.stundenplan && <DashboardStundenplan profileId={profile.id} semesterId={semester.id} />}
    </>
  )
}
