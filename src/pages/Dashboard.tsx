import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useActive } from '../state'
import { loadStudyData, updateSnapshots } from '../lib/study'
import { addDays, formatCountdown, isoDate, studyDate, studyDayStart } from '../lib/dates'
import { cardMode, type Mode } from '../lib/db'
import { examStats, materialByExam, streak } from '../lib/stats'
import { DayBars, Icon, PageHeader, Progress, Widget } from '../components/ui'
import { Link } from 'react-router-dom'
import { subjectsToday } from '../lib/planner'
import { homeworkDueByExam, isDueSoon } from '../lib/homework'
import { duePending } from '../lib/pending'
import { shortDue } from './Homework'
import { ReminderRow, usePurgeDoneReminders, useReminders } from './Reminders'
import { isDueReminder, isOpenReminder } from '../lib/reminders'
import { useSync } from '../sync-state'
import { BACKUP_REMINDER_DAYS, lastBackup } from '../lib/backup'
import { db } from '../lib/db'
import { FSRS_HINT_REVIEWS } from './FsrsSettings'
import { dayShare, dayWork, weekShares } from '../lib/dayProgress'
import { DashboardStundenplan, NotenKachel } from './Stundenplan'
import { KurschatKachel } from './CourseChat'
import { TermineKachel } from './CourseEvents'
import { SpeiseplanKachel } from './Mensa'
import { syncCourse } from '../lib/course'

export const MODE_INFO: Record<Mode, { title: string; unit: string; one: string; extra: number }> = {
  mobile: { title: 'Unterwegs', unit: 'Karten', one: 'Karte', extra: 10 },
  desk: { title: 'Schreibtisch', unit: 'Aufgaben', one: 'Aufgabe', extra: 1 },
}

/** So viele Prüfungen passen in das Fortschritts-Widget. */
const MAX_PROGRESS_ROWS = 5
const pctOf = (a: number, b: number) => `${b ? Math.round((a / b) * 100) : 0} %`

/** Startseite im Stil des iPadOS-Homescreens: Widgets führen zu den einzelnen Bereichen. */
export function Dashboard() {
  const { profile, semester } = useActive()
  const sync = useSync()
  const data = useLiveQuery(() => loadStudyData(profile), [profile])
  const reviewCount = useLiveQuery(() => db.reviews.where('profileId').equals(profile.id).count(), [profile.id])
  // Gespeichertes Tagespensum der letzten Woche für die Lernserie
  const weekStart = isoDate(addDays(studyDayStart(Date.now()), -6))
  const snapshots = useLiveQuery(() => db.snapshots.where('profileId').equals(profile.id).filter((s) => s.date >= weekStart).toArray(), [profile.id, weekStart])
  const backupAt = useLiveQuery(async () => (await lastBackup(profile.id)) ?? 0, [profile.id])
  const rem = useReminders()
  usePurgeDoneReminders()

  useEffect(() => {
    // Ein Wert pro Tag; nach dem Lernen aktualisiert, damit das Pensum des Tages für die Lernserie stimmt.
    if (data) updateSnapshots(profile, data.exams, data.cards, Date.now(), data.plan).catch(() => {})
  }, [data])

  // Kurs automatisch beitreten (aus dem DUALIS-Login erkannt) und Kurs-Hausaufgaben holen.
  useEffect(() => {
    syncCourse(profile.id, semester.id, profile.name).catch(() => {})
  }, [profile.id, semester.id])

  if (!data) return null
  const { exams, cards, plan, logs, homework } = data
  const now = Date.now()
  const upcoming = exams.filter((e) => plan.exams.some((p) => p.examId === e.id))
  const next = upcoming[0]
  const nextPlan = next && plan.exams.find((p) => p.examId === next.id)
  const days = streak(logs, now)
  // Ohne Dropbox: Erinnerung an eine Sicherungsdatei, sobald seit der letzten (bzw. dem ersten Lernen) eine Woche vergangen ist.
  const since = backupAt || Math.min(...logs.map((l) => l.reviewedAt))
  const backupDue =
    !sync.connected && backupAt !== undefined && logs.length && now - since >= BACKUP_REMINDER_DAYS * 864e5
      ? backupAt
        ? Math.floor((now - backupAt) / 864e5)
        : 0
      : null
  const modes = (['mobile', 'desk'] as Mode[]).filter((m) => cards.some((c) => cardMode(c) === m) || (m === 'desk' && data.homework.length > 0))
  // Nach Fach getrennt lernen: Bei mehreren Fächern führt das Widget zur Auswahl, empfohlen ist das mit dem größten Rückstand
  const hwDue = homework.filter((h) => isDueSoon(h, now))
  const subjects = subjectsToday(plan, homeworkDueByExam(homework, now))
  const examById = new Map(exams.map((e) => [e.id, e]))
  const missingDocs = upcoming.flatMap((e) => duePending(e, now).map((doc) => ({ exam: e, doc })))
  const openReminders = rem ? rem.reminders.filter((r) => isOpenReminder(r, rem.homework)) : []
  const dueReminders = rem ? openReminders.filter((r) => isDueReminder(r, rem.homework, now)) : []
  // Heute abgehakte bleiben bis zum Abend ausgegraut im Widget – zum Rückgängigmachen.
  const doneToday = rem ? rem.reminders.filter((r) => r.doneAt && studyDate(r.doneAt) === studyDate(now)) : []
  const reminderRows = [...dueReminders, ...doneToday]

  // Gesamtfortschritt über alle anstehenden Prüfungen
  let total = 0
  let introduced = 0
  let forecast = 0
  const perExam = new Map(
    upcoming.map((e) => {
      const st = examStats(e, cards.filter((c) => c.examId === e.id), now, profile.retention)
      total += st.total
      introduced += st.introduced
      // Prognose: erwartet abrufbarer Anteil am Klausurtag, wenn dem Plan gefolgt wird
      forecast += (plan.exams.find((p) => p.examId === e.id)?.forecastShare ?? 0) * profile.retention * st.total
      return [e.id, st]
    }),
  )

  // Gelernte Karten der letzten 7 Tage
  const today = studyDayStart(now)
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6))
  const counts = week.map((d) => logs.filter((l) => studyDate(l.reviewedAt) === isoDate(d)).length)
  // Balken: geschaffter Anteil des Tagespensums (voll = alle Karten unterwegs erledigt)
  const work = [...dayWork(plan).values()]
  const todayShare = dayShare(
    work.reduce((s, w) => s + w.done, 0),
    work.reduce((s, w) => s + w.left, 0),
    counts[6],
  )
  const shares = weekShares(week.map((d) => isoDate(d)), snapshots ?? [], counts, { date: isoDate(today), share: todayShare })
  const dayLabels = week.map((d) => new Date(d).toLocaleDateString('de-DE', { weekday: 'narrow' }))

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
        {(reviewCount ?? 0) >= FSRS_HINT_REVIEWS && !profile.fsrsWeights && !profile.fsrsHintDismissed && (
          <Widget size="medium" to="/lernalgorithmus" title="Lernalgorithmus anpassen" icon="chart" tint="var(--ok)">
            <div className="w-headline">{reviewCount?.toLocaleString('de-DE')} Bewertungen geschafft</div>
            <p className="w-caption">Jetzt lässt sich der Wiederholungsplan an dein Gedächtnis anpassen – dauert 2 Minuten. Tippen für die Anleitung.</p>
          </Widget>
        )}

        {backupDue !== null && (
          <Widget size="medium" to="/einstellungen" title="Sicherung" icon="download" tint="var(--warn)">
            <div className="w-headline">{backupDue ? `Letzte Sicherung vor ${backupDue} Tagen` : 'Noch keine Sicherung'}</div>
            <p className="w-caption">Ohne Dropbox liegen deine Lerndaten nur auf diesem Gerät. Tippen und unter „Daten & Sicherung“ eine Sicherungsdatei anlegen, z. B. in iCloud Drive.</p>
          </Widget>
        )}

        {!semester.kind && (
          <Widget size="medium" to={`/semester/${semester.id}`} title="Semester einrichten" icon="settings" tint="var(--warn)">
            <div className="w-headline">Wie sieht deine Prüfungsphase aus?</div>
            <p className="w-caption">Dual mit allen Klausuren in einer Woche oder regulär über mehrere Wochen – danach richtet sich dein Lernplan.</p>
          </Widget>
        )}
        {exams.length === 0 ? (
          <Widget size="medium" to="/pruefung/neu" title="Loslegen" icon="plus">
            <div className="w-headline">Erste Prüfung anlegen</div>
            <p className="w-caption">Mit Termin und Wichtigkeit – danach Karten importieren und die App plant dein Lernen.</p>
          </Widget>
        ) : profile.tileImport && cards.length === 0 && homework.length === 0 ? (
          <Widget size="medium" to="/import" title="Loslegen" icon="download">
            <div className="w-headline">Karten importieren</div>
            <p className="w-caption">Lade ein Kartenpaket für eine deiner Prüfungen – oder probiere das Beispielpaket aus.</p>
          </Widget>
        ) : (
          <>
          {modes.filter((m) => (m === 'mobile' ? profile.tileMobile : profile.tileDesk)).map((m) => {
            const t = plan.modes[m]
            const hwCount = m === 'desk' ? hwDue.length : 0
            const left = t.reviewsLeft + t.newLeft + hwCount
            const info = MODE_INFO[m]
            const budget = data.budgets[m].effective
            const forMode = subjects.filter((s) => s.left[m] > 0)
            // Auswahl, sobald mehrere Fächer Stoff für diesen Modus haben – auch wenn heute nur eines eingeplant ist.
            const choose = new Set([...materialByExam(data.cards, m).keys(), ...forMode.map((s) => s.examId)]).size > 1
            return (
              <Widget
                key={m}
                size="medium"
                to={choose ? `/lernen/${m}/auswahl` : left > 0 ? `/lernen/${m}` : `/lernen/${m}?extra=${info.extra}`}
                title={info.title}
                icon={m === 'mobile' ? 'cards' : 'pencil'}
                label={`${info.title} lernen`}
              >
                <div className="w-split">
                  <div>
                    {left > 0 ? (
                      <>
                        <div className="w-number">{left}</div>
                        <div className="w-caption">{forMode.length > 1 ? `${info.unit} in ${forMode.length} Fächern` : `${info.unit} heute`}</div>
                      </>
                    ) : (
                      <>
                        <div className="w-number done">✓</div>
                        <div className="w-caption">Für heute erledigt</div>
                      </>
                    )}
                  </div>
                  <div className="w-side">
                    {left > 0 ? (
                      <>
                        {hwCount > 0 && <span>{hwCount} {hwCount === 1 ? 'Hausaufgabe' : 'Hausaufgaben'}</span>}
                        <span>{t.reviewsLeft} Wdh. · {t.newLeft} {m === 'desk' ? 'empfohlen' : 'neu'}</span>
                        {choose && forMode.length > 0 && <span className="truncate">Empfohlen: {examById.get(forMode[0].examId)?.name}</span>}
                        <span className="w-pill">ca. {t.minutesLeft} min · {choose ? 'Fach wählen' : 'Start'}</span>
                      </>
                    ) : (
                      <span className="w-pill">{m === 'mobile' ? '10 extra' : '1 extra'}</span>
                    )}
                    {(t.minutesNeeded > budget || (m === 'desk' && data.homeworkMinutes > profile.minutesDesk)) && <span className="w-warn">Budget zu knapp</span>}
                  </div>
                </div>
              </Widget>
            )
          })}
          </>
        )}

        {missingDocs.length > 0 && (
          <Widget size="medium" to={`/pruefung/${missingDocs[0].exam.id}`} title="Unterlagen fehlen" icon="download" tint="var(--warn)" label="Fehlende Unterlagen">
            <div className="w-list" style={{ gap: 6 }}>
              {missingDocs.slice(0, 3).map(({ exam: e, doc }) => (
                <div key={`${e.id}:${doc.id}`} className="row" style={{ gap: 8, minWidth: 0 }}>
                  <span className="dot" style={{ background: e.color }} />
                  <span className="truncate"><b>{e.name}:</b> {doc.title}</span>
                </div>
              ))}
              {missingDocs.length > 3 && <small>+ {missingDocs.length - 3} weitere</small>}
            </div>
            <p className="w-caption" style={{ marginTop: 'auto' }}>Tippen zum Abhaken oder Zurückstellen.</p>
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

        {profile.tileNextExam && next && nextPlan && (
          <Widget size="small" to={`/pruefung/${next.id}`} title="Nächste Klausur" icon="clock" tint={next.color}>
            <div className="w-number">{nextPlan.daysLeft}</div>
            <div className="w-caption">{nextPlan.daysLeft === 1 ? 'Tag' : 'Tage'}</div>
            <div className="w-foot truncate">{next.name}</div>
          </Widget>
        )}

        {next && nextPlan && nextPlan.daysLeft <= 21 && cards.some((c) => c.examId === next.id) && (
          <Widget size="small" to={`/probeklausur/${next.id}`} title="Probeklausur" icon="pencil" tint={next.color}>
            <div className="w-headline">Unter Zeitdruck üben</div>
            <div className="w-foot truncate">{next.name}</div>
          </Widget>
        )}

        {upcoming.length > 0 && (
          <Widget size={upcoming.length > 1 ? 'large' : 'medium'} to="/pruefungen" title="Fortschritt" icon="chart" label="Fortschritt der Prüfungen">
            <div className="w-progress-legend">
              <span><i style={{ background: 'var(--text)' }} />begonnen</span>
              <span><i style={{ background: 'var(--ok)' }} />Prognose am Klausurtag{upcoming.some((e) => e.ongoing) && ' (vorläufig)'}</span>
              {total > 0 && <b>Gesamt {pctOf(introduced, total)} · {pctOf(forecast, total)}</b>}
            </div>
            <div className="w-list">
              {upcoming.slice(0, MAX_PROGRESS_ROWS).map((e) => {
                const st = perExam.get(e.id)!
                const p = plan.exams.find((x) => x.examId === e.id)!
                const started = st.total ? st.introduced / st.total : 0
                const expected = p.forecastShare * profile.retention
                return (
                  <div key={e.id} className="w-list-item" aria-label={`${e.name}: ${pctOf(started, 1)} begonnen, Prognose ${pctOf(expected, 1)}`}>
                    <div className="row between">
                      <span className="row grow" style={{ gap: 8, minWidth: 0 }}>
                        <span className="dot" style={{ background: e.color }} />
                        <span className="truncate">{e.name}</span>
                      </span>
                      <small className={p.behind && st.total ? 'badge-warn' : ''}>{p.behind && st.total ? 'Rückstand · ' : ''}{formatCountdown(p.daysLeft)}</small>
                    </div>
                    {st.total ? (
                      <div className="w-exam-bar">
                        <div className="w-exam-track">
                          <Progress value={started} color={e.color} />
                          <span className="w-forecast" style={{ left: `${Math.min(100, expected * 100)}%` }} />
                        </div>
                        <small className="w-exam-nums">{pctOf(started, 1)} · <span className="ok">{pctOf(expected, 1)}</span></small>
                      </div>
                    ) : null}
                    {st.total > 0 && upcoming.length <= 3 && (
                      <small className="muted">{st.introduced} von {st.total} Karten begonnen · {st.secure} sicher bis zur Klausur{st.tasks.total > 0 && ` · ${st.tasks.practiced}/${st.tasks.total} Aufgaben`}</small>
                    )}
                    {!st.total && (
                      <small className="muted">Noch keine Karten</small>
                    )}
                  </div>
                )
              })}
              {upcoming.length > MAX_PROGRESS_ROWS && <small>+ {upcoming.length - MAX_PROGRESS_ROWS} weitere</small>}
            </div>
          </Widget>
        )}

        {profile.tileStreak && (
          <Widget size="small" to="/pruefungen" title="Lernserie" icon="flame" tint="var(--hard)">
            <div className="w-number">{days}</div>
            <div className="w-caption">{days === 1 ? 'Tag' : 'Tage'} in Folge</div>
            <DayBars values={shares} labels={dayLabels} max={1} />
          </Widget>
        )}

        {profile.stundenplan && <NotenKachel profileId={profile.id} />}

        {profile.stundenplan && <KurschatKachel profileId={profile.id} />}

        {profile.stundenplan && <TermineKachel profileId={profile.id} />}

        {profile.stundenplan && <SpeiseplanKachel profileId={profile.id} />}

        {profile.tileImport && (
          <Widget size="small" to="/import" title="Importieren" icon="download">
            <div className="w-headline">Karten&shy;paket hinzufügen</div>
            <div className="w-foot">Neu oder Update</div>
          </Widget>
        )}


      </div>
      </div>

      {profile.stundenplan && <DashboardStundenplan profileId={profile.id} semesterId={semester.id} />}
    </>
  )
}
