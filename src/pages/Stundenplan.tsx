import { useEffect, useState } from 'react'
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
const DS = 8 * 60 // 08:00
const DE = 20 * 60 // 20:00
const PPM = 0.72 // Pixel pro Minute
const PAD = 12 // Rand oben/unten, damit 8/20 Uhr sichtbar bleiben

const two = (n: number) => String(n).padStart(2, '0')
const weekdayIndex = (start: string) => (new Date(`${start.slice(0, 10)}T00:00`).getDay() + 6) % 7
const timeStr = (t: number) => new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })

export function Stundenplan() {
  const { profile } = useActive()
  const cfg = useLiveQuery(() => getConfig(profile.id), [profile.id])
  const [tab, setTab] = useState<'plan' | 'noten'>('plan')

  if (!configReady(cfg)) {
    return (
      <>
        <PageHeader back title="Stundenplan & Noten" />
        <div className="card stack">
          <p className="muted" style={{ margin: 0 }}>
            Hier erscheinen dein Stundenplan und deine Noten aus DUALIS. Dafür musst du einmal die Adresse deines Relais und dein DUALIS-Login hinterlegen.
          </p>
          <Link className="btn primary block" to="/einstellungen">In den Einstellungen einrichten</Link>
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader back title="Stundenplan & Noten" />
      <div className="sp-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'plan'} className={tab === 'plan' ? 'active' : ''} onClick={() => setTab('plan')}>
          Stundenplan
        </button>
        <button role="tab" aria-selected={tab === 'noten'} className={tab === 'noten' ? 'active' : ''} onClick={() => setTab('noten')}>
          Noten
        </button>
      </div>
      {tab === 'plan' ? <PlanView profileId={profile.id} cfg={cfg} /> : <NotenView profileId={profile.id} cfg={cfg} />}
    </>
  )
}

function StatusLine({ text }: { text: string }) {
  if (!text) return null
  return <p className="muted" style={{ textAlign: 'center', fontSize: 13, marginTop: 14 }}>{text}</p>
}

function PlanView({ profileId, cfg }: { profileId: string; cfg: StundenplanConfig }) {
  const [monday, setMonday] = useState(() => mondayOf(new Date()))
  const [tt, setTt] = useState<CachedTimetable | null>(null)
  const [status, setStatus] = useState('')
  const [detail, setDetail] = useState<TimetableEvent | null>(null)

  useEffect(() => {
    let cancelled = false
    const iso = isoOf(monday)
    setDetail(null)
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
        setStatus(`Aktualisiert ${timeStr(fresh.fetchedAt)}`)
      } catch (e) {
        if (cancelled) return
        setStatus(c ? `Gespeicherter Stand von ${timeStr(c.fetchedAt)} · DUALIS gerade nicht erreichbar` : (e as Error).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [profileId, monday, cfg.relayUrl, cfg.token, cfg.user, cfg.pass])

  const fr = addDays(monday, 4)
  const label = `${two(monday.getDate())}.${two(monday.getMonth() + 1)}. – ${two(fr.getDate())}.${two(fr.getMonth() + 1)}.${fr.getFullYear()}`
  const events = (tt?.events ?? []).filter((e) => weekdayIndex(e.start) < 5)
  const todayIso = isoOf(new Date())
  const H = (DE - DS) * PPM
  const hours: number[] = []
  for (let m = DS; m <= DE; m += 60) hours.push(m)

  return (
    <>
      <div className="sp-weeknav">
        <button className="btn small" onClick={() => setMonday(addDays(monday, -7))} aria-label="vorige Woche">‹</button>
        <button className="btn small" onClick={() => setMonday(mondayOf(new Date()))}>Heute</button>
        <button className="btn small" onClick={() => setMonday(addDays(monday, 7))} aria-label="nächste Woche">›</button>
        <span className="sp-weeklabel">{label}</span>
      </div>

      <div className="sp-cal">
        <div className="sp-head">
          <div className="sp-sp" />
          {SHORT.map((sh, i) => {
            const d = addDays(monday, i)
            return (
              <div key={i} className={`sp-gh${isoOf(d) === todayIso ? ' today' : ''}`}>
                {sh}
                <span>
                  {two(d.getDate())}.{two(d.getMonth() + 1)}.
                </span>
              </div>
            )
          })}
        </div>
        <div className="sp-body" style={{ height: H + 2 * PAD }}>
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
              <div key={i} className={`sp-col${isoOf(d) === todayIso ? ' today' : ''}`}>
                {hours.slice(1, -1).map((m) => (
                  <div key={m} className="sp-line" style={{ top: PAD + (m - DS) * PPM }} />
                ))}
                {col.map((e, j) => {
                  const s = Math.max(DS, minutesOf(e.start))
                  const en = Math.min(DE, minutesOf(e.end))
                  return (
                    <button
                      key={j}
                      className={`sp-block${e.isTest ? ' exam' : ''}`}
                      style={{ top: PAD + (s - DS) * PPM, height: Math.max(20, (en - s) * PPM - 2) }}
                      onClick={() => setDetail(e)}
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
      </div>
      {tt && events.length === 0 && <p className="muted" style={{ textAlign: 'center', marginTop: 14 }}>Keine Vorlesungen in dieser Woche.</p>}

      <StatusLine text={status} />

      {detail && <DetailSheet ev={detail} onClose={() => setDetail(null)} />}
    </>
  )
}

function DetailSheet({ ev, onClose }: { ev: TimetableEvent; onClose: () => void }) {
  const d = new Date(`${ev.start.slice(0, 10)}T00:00`)
  const days = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']
  const zeit = `${days[(d.getDay() + 6) % 7]}, ${two(d.getDate())}.${two(d.getMonth() + 1)}. · ${hhmm(ev.start)}–${hhmm(ev.end)}`
  return (
    <div className="sp-backdrop" onClick={onClose}>
      <div className="sp-sheet card" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 6px' }}>{ev.fullName || ev.shortName}</h3>
        {ev.isTest && <span className="badge-warn" style={{ marginBottom: 8, display: 'inline-block' }}>Prüfung</span>}
        <div className="sp-drow"><span>Zeit</span><b>{zeit}</b></div>
        {ev.room && <div className="sp-drow"><span>Raum</span><b>{ev.room}</b></div>}
        {ev.lecturer && <div className="sp-drow"><span>Dozent</span><b>{ev.lecturer}</b></div>}
        {ev.shortName && ev.shortName !== (ev.fullName ?? '') && <div className="sp-drow"><span>Kürzel</span><b>{ev.shortName}</b></div>}
        <button className="btn primary block" style={{ marginTop: 14 }} onClick={onClose}>Schließen</button>
      </div>
    </div>
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
        setStatus(`Aktualisiert ${timeStr(fresh.fetchedAt)}`)
      } catch (e) {
        if (cancelled) return
        setStatus(c ? `Gespeicherter Stand von ${timeStr(c.fetchedAt)} · DUALIS gerade nicht erreichbar` : (e as Error).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [profileId, cfg.relayUrl, cfg.token, cfg.user, cfg.pass])

  if (!data) {
    return (
      <>
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>{status || 'Lädt …'}</p>
        </div>
        <StatusLine text="" />
      </>
    )
  }

  const sems = data.semesters
  const all = sems.flatMap((s) => s.modules)
  const ov = average(all)

  return (
    <>
      <div className="sp-overall card">
        <div className="sp-big">{fmtGrade(ov)}</div>
        <div className="muted" style={{ fontSize: 13 }}>Gesamtschnitt (gewichtet nach Credits)</div>
      </div>
      {sems
        .filter((s) => s.modules.length > 0)
        .map((s) => {
          const a = average(s.modules)
          return (
            <div key={s.semester} className="card" style={{ marginBottom: 14 }}>
              <div className="row between" style={{ marginBottom: 8 }}>
                <b style={{ fontSize: 17 }}>{s.semester}</b>
                {a != null && <span className="sp-avg">Ø {fmtGrade(a)}</span>}
              </div>
              {s.modules.map((m, i) => {
                const gn = gradeNum(m.grade)
                return (
                  <div key={i} className="sp-mod">
                    <div style={{ minWidth: 0 }}>
                      <div className="truncate" style={{ fontWeight: 600 }}>{m.name || m.code}</div>
                      <small className="muted">{[m.code, m.credits ? `${m.credits} CP` : '', m.status].filter(Boolean).join(' · ')}</small>
                    </div>
                    <span className={gn != null ? 'sp-grade' : 'sp-grade open'}>{gn != null ? (m.grade ?? '').replace('.', ',') : m.grade || 'offen'}</span>
                  </div>
                )
              })}
            </div>
          )
        })}
      {all.length === 0 && <p className="muted" style={{ textAlign: 'center' }}>Keine Noten gefunden.</p>}
      <StatusLine text={status} />
    </>
  )
}
