import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { useActive } from '../state'
import { PageHeader } from '../components/ui'
import {
  addDays,
  average,
  cachedGrades,
  cachedTimetable,
  configReady,
  fmtGrade,
  getConfig,
  gradeNum,
  hhmm,
  isoOf,
  minutesOf,
  mondayOf,
  refreshGrades,
  refreshTimetable,
  type CachedGrades,
  type CachedTimetable,
  type StundenplanConfig,
  type TimetableEvent,
} from '../lib/stundenplan'

const SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr']
const DAYSFULL = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']
const DS = 8 * 60 // 08:00
const DE = 20 * 60 // 20:00
const PPM = 0.72 // Pixel pro Minute (feste Zeitachse 8–20 Uhr)
const PAD = 12 // Rand oben/unten, damit 8/20 Uhr sichtbar bleiben

const two = (n: number) => String(n).padStart(2, '0')
const weekdayIndex = (start: string) => (new Date(`${start.slice(0, 10)}T00:00`).getDay() + 6) % 7
const clock = (t: number) => {
  const d = new Date(t)
  return `${two(d.getHours())}:${two(d.getMinutes())}`
}

export function Stundenplan() {
  const { profile } = useActive()
  const cfg = useLiveQuery(() => getConfig(profile.id), [profile.id])

  if (!configReady(cfg)) {
    return (
      <>
        <PageHeader back title="Stundenplan & Noten" />
        <div className="card stack">
          <p className="muted" style={{ margin: 0 }}>
            Hier erscheinen deine Noten und dein Stundenplan aus DUALIS. Dafür musst du einmal dein DUALIS-Login hinterlegen.
          </p>
          <Link className="btn primary block" to="/einstellungen">In den Einstellungen einrichten</Link>
        </div>
      </>
    )
  }

  // Noten oben, Stundenplan immer offen ganz unten.
  return (
    <>
      <PageHeader back title="Stundenplan & Noten" />
      <div className="sp-app">
        <NotenView profileId={profile.id} cfg={cfg} />
        <div className="sp-sectitle">Stundenplan</div>
        <PlanView profileId={profile.id} cfg={cfg} />
      </div>
    </>
  )
}

function PlanView({ profileId, cfg }: { profileId: string; cfg: StundenplanConfig }) {
  const [monday, setMonday] = useState(() => mondayOf(new Date()))
  const [tt, setTt] = useState<CachedTimetable | null>(null)
  const [status, setStatus] = useState('')
  const [detail, setDetail] = useState<TimetableEvent | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  // Angezeigte Woche laden: erst Zwischenspeicher, dann frisch aus DUALIS.
  useEffect(() => {
    let cancelled = false
    const iso = isoOf(monday)
    ;(async () => {
      const c = await cachedTimetable(profileId, iso)
      if (cancelled) return
      if (c) {
        setTt(c)
        setStatus('Aktualisiere …')
      } else {
        setTt(null)
        setStatus('Lädt …')
      }
      try {
        const fresh = await refreshTimetable(profileId, cfg, iso)
        if (cancelled) return
        setTt(fresh)
        setStatus(`Aktualisiert ${clock(fresh.fetchedAt)}`)
      } catch (e) {
        if (cancelled) return
        if (c) setStatus(`Gespeicherter Stand von ${clock(c.fetchedAt)} · DUALIS gerade nicht erreichbar`)
        else {
          setTt({ fetchedAt: Date.now(), week: iso, events: [] })
          setStatus((e as Error).message || 'DUALIS gerade nicht erreichbar')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [profileId, monday, cfg.user, cfg.pass])

  // Alle Semesterwochen einmalig im Hintergrund vorladen, damit das Wischen flüssig ist.
  useEffect(() => {
    let cancelled = false
    const base = mondayOf(new Date())
    const weeks: string[] = []
    for (let i = -2; i <= 9; i++) weeks.push(isoOf(addDays(base, i * 7)))
    ;(async () => {
      await new Promise((r) => setTimeout(r, 2500))
      for (const iso of weeks) {
        if (cancelled) return
        if (await cachedTimetable(profileId, iso)) continue
        try {
          await refreshTimetable(profileId, cfg, iso, true)
        } catch {
          // Hintergrund – Fehler ignorieren
        }
        await new Promise((r) => setTimeout(r, 1300))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [profileId, cfg.user, cfg.pass])

  function open(e: TimetableEvent) {
    setDetail(e)
    setSheetOpen(true)
  }

  // Wischen: links = nächste Woche, rechts = vorige Woche.
  const touch = useRef({ x: 0, y: 0, t: 0 })
  function onTouchStart(e: React.TouchEvent) {
    const t = e.changedTouches[0]
    touch.current = { x: t.clientX, y: t.clientY, t: Date.now() }
  }
  function onTouchEnd(e: React.TouchEvent) {
    const t = e.changedTouches[0]
    const dx = t.clientX - touch.current.x
    const dy = t.clientY - touch.current.y
    if (Date.now() - touch.current.t < 600 && Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.6) {
      setMonday(addDays(monday, dx < 0 ? 7 : -7))
    }
  }

  const fr = addDays(monday, 4)
  const label = `${two(monday.getDate())}.${two(monday.getMonth() + 1)}. – ${two(fr.getDate())}.${two(fr.getMonth() + 1)}.${fr.getFullYear()}`
  const events = (tt?.events ?? []).filter((e) => weekdayIndex(e.start) < 5)
  const todayIso = isoOf(new Date())
  const H = (DE - DS) * PPM
  const hours: number[] = []
  for (let m = DS; m <= DE; m += 60) hours.push(m)

  return (
    <section className="sp-viewplan" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="sp-weeknav">
        <button onClick={() => setMonday(addDays(monday, -7))} aria-label="vorige Woche">‹</button>
        <button onClick={() => setMonday(mondayOf(new Date()))}>Heute</button>
        <button onClick={() => setMonday(addDays(monday, 7))} aria-label="nächste Woche">›</button>
        <span className="sp-weeklabel">{label}</span>
      </div>

      <div className="sp-calhead">
        <div className="sp-sp" />
        {SHORT.map((sh, i) => {
          const d = addDays(monday, i)
          return (
            <div key={i} className={`sp-ghead${isoOf(d) === todayIso ? ' today' : ''}`}>
              {sh}
              <span>
                {two(d.getDate())}.{two(d.getMonth() + 1)}.
              </span>
            </div>
          )
        })}
      </div>

      <div className="sp-calbody" style={{ height: H + 2 * PAD }}>
        <div className="sp-gutter">
          {hours.map((m) => (
            <div key={m} className="sp-hr" style={{ top: PAD + (m - DS) * PPM }}>
              {m / 60}:00
            </div>
          ))}
        </div>
        {[0, 1, 2, 3, 4].map((i) => {
          const d = addDays(monday, i)
          const col = events.filter((e) => weekdayIndex(e.start) === i)
          return (
            <div key={i} className={`sp-daycol${isoOf(d) === todayIso ? ' todaycol' : ''}`}>
              {hours.slice(1, -1).map((m) => (
                <div key={m} className="sp-hline" style={{ top: PAD + (m - DS) * PPM }} />
              ))}
              {col.map((e, j) => {
                const s = Math.max(DS, minutesOf(e.start))
                const en = Math.min(DE, minutesOf(e.end))
                return (
                  <button
                    key={j}
                    className={`sp-block${e.isTest ? ' exam' : ''}`}
                    style={{ top: PAD + (s - DS) * PPM, height: Math.max(22, (en - s) * PPM - 2) }}
                    onClick={() => open(e)}
                  >
                    <div className="sp-bt">
                      {hhmm(e.start)}
                      {e.isTest ? ' • Prüfung' : ''}
                    </div>
                    <div className="sp-bn">{e.shortName}</div>
                    {(en - s) * PPM > 44 && e.room ? <div className="sp-br">{e.room}</div> : null}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
      {tt && events.length === 0 && <div className="sp-empty">Keine Vorlesungen in dieser Woche.</div>}
      {status && <div className="sp-status">{status}</div>}

      <div className={`sp-backdrop${sheetOpen ? ' open' : ''}`} onClick={() => setSheetOpen(false)} />
      <div className={`sp-sheet${sheetOpen ? ' open' : ''}`}>
        <div className="sp-grip" />
        {detail && <DetailBody ev={detail} />}
        <button className="sp-sheetclose" onClick={() => setSheetOpen(false)}>Schließen</button>
      </div>
    </section>
  )
}

function DetailBody({ ev }: { ev: TimetableEvent }) {
  const d = new Date(`${ev.start.slice(0, 10)}T00:00`)
  const zeit = `${DAYSFULL[(d.getDay() + 6) % 7]}, ${two(d.getDate())}.${two(d.getMonth() + 1)}.  ·  ${hhmm(ev.start)}–${hhmm(ev.end)}`
  return (
    <>
      <h3>{ev.fullName || ev.shortName}</h3>
      {ev.isTest && <span className="sp-exbadge">Prüfung</span>}
      <div className="sp-drow"><span className="k">Zeit</span><span className="v">{zeit}</span></div>
      {ev.room && <div className="sp-drow"><span className="k">Raum</span><span className="v">{ev.room}</span></div>}
      {ev.lecturer && <div className="sp-drow"><span className="k">Dozent</span><span className="v">{ev.lecturer}</span></div>}
      {ev.shortName && ev.shortName !== (ev.fullName ?? '') && (
        <div className="sp-drow"><span className="k">Kürzel</span><span className="v">{ev.shortName}</span></div>
      )}
    </>
  )
}

function NotenView({ profileId, cfg }: { profileId: string; cfg: StundenplanConfig }) {
  const [data, setData] = useState<CachedGrades | null>(null)
  const [status, setStatus] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const c = await cachedGrades(profileId)
      if (cancelled) return
      if (c) setData(c)
      else setStatus('Lädt …')
      try {
        const fresh = await refreshGrades(profileId, cfg)
        if (cancelled) return
        setData(fresh)
        setStatus(`Aktualisiert ${clock(fresh.fetchedAt)}`)
      } catch (e) {
        if (cancelled) return
        setStatus(c ? `Gespeicherter Stand von ${clock(c.fetchedAt)} · DUALIS gerade nicht erreichbar` : (e as Error).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [profileId, cfg.user, cfg.pass])

  if (!data) {
    return <div className="sp-empty">{status || 'Lädt …'}</div>
  }

  const sems = data.semesters
  const all = sems.flatMap((s) => s.modules)
  const ov = average(all)

  return (
    <>
      <div className="sp-overall">
        <div className="sp-big">{fmtGrade(ov)}</div>
        <div className="sp-lbl">Gesamtschnitt (gewichtet nach Credits)</div>
      </div>
      {sems
        .filter((s) => s.modules.length > 0)
        .map((s) => {
          const a = average(s.modules)
          return (
            <div key={s.semester} className="sp-sem">
              <div className="sp-semhead">
                <h3>{s.semester}</h3>
                {a != null && <span className="sp-avg">Ø {fmtGrade(a)}</span>}
              </div>
              {s.modules.map((m, i) => {
                const gn = gradeNum(m.grade)
                return (
                  <div key={i} className="sp-mod">
                    <div className="sp-info">
                      <div className="sp-nm">{m.name || m.code}</div>
                      <div className="sp-sub">{[m.code, m.credits ? `${m.credits} CP` : '', m.status].filter(Boolean).join(' · ')}</div>
                    </div>
                    <span className={gn != null ? 'sp-grade' : 'sp-grade open'}>
                      {gn != null ? (m.grade ?? '').replace('.', ',') : m.grade || 'offen'}
                    </span>
                  </div>
                )
              })}
            </div>
          )
        })}
      {all.length === 0 && <div className="sp-empty">Keine Noten gefunden.</div>}
      {status && <div className="sp-status">{status}</div>}
    </>
  )
}
