import { useEffect, useState } from 'react'
import { useActive } from '../state'
import { PageHeader, Widget } from '../components/ui'
import { addDays, cachedTimetable, isoOf, mondayOf, type TimetableEvent } from '../lib/stundenplan'
import { DIET_LABEL, getMensa, onCampus, type MensaItem } from '../lib/mensa'

const SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr']
const pad = (n: number) => String(n).padStart(2, '0')
const isoLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
function todayIso(): string {
  return isoLocal(new Date())
}
/** Heute, aber am Wochenende auf Montag (Mensa Mo–Fr). */
function defaultDay(): string {
  const d = new Date()
  const wd = (d.getDay() + 6) % 7
  if (wd > 4) d.setDate(d.getDate() + (7 - wd))
  return isoLocal(d)
}

function DietChip({ code }: { code: string }) {
  const label = DIET_LABEL[code] || code
  const green = code === 'VG' || code === 'V' || code === 'VR'
  return <span className="mensa-diet" style={green ? { color: 'var(--good)', borderColor: 'var(--good)' } : undefined}>{label}</span>
}

function MensaList({ items }: { items: MensaItem[] }) {
  if (items.length === 0) return <p className="muted" style={{ textAlign: 'center', padding: '16px 0' }}>Für diesen Tag ist kein Speiseplan hinterlegt.</p>
  const cats: string[] = []
  for (const it of items) if (!cats.includes(it.category)) cats.push(it.category)
  return (
    <>
      {cats.map((cat) => (
        <div key={cat} className="card stack" style={{ gap: 8 }}>
          <div className="mensa-cat">{cat}</div>
          {items
            .filter((it) => it.category === cat)
            .map((it, i) => (
              <div key={i} className="mensa-item">
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="mensa-name">{it.name}</div>
                  {it.icons.length > 0 && <div className="mensa-diets">{it.icons.map((c) => <DietChip key={c} code={c} />)}</div>}
                </div>
                {it.prices.length === 3 && <div className="mensa-price">€ {it.prices.join(' / ')}</div>}
              </div>
            ))}
        </div>
      ))}
    </>
  )
}

/** Dashboard-Kachel: Mensa Horb mit dem heutigen Hauptgericht als Teaser. */
export function MensaKachel({ profileId }: { profileId: string }) {
  const [teaser, setTeaser] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    getMensa(todayIso())
      .then((items) => {
        if (cancelled) return
        const main = items.find((i) => /HAUPT/i.test(i.category)) || items[0]
        setTeaser(main ? main.name : 'Heute kein Speiseplan')
      })
      .catch(() => { if (!cancelled) setTeaser(null) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId])
  return (
    <Widget size="small" to="/mensa" title="Mensa" icon="today">
      <div className="w-headline">Mensa Horb</div>
      <div className="w-foot truncate">{teaser ?? 'Speiseplan'}</div>
    </Widget>
  )
}

export function Mensa() {
  const { profile } = useActive()
  const [monday, setMonday] = useState(() => mondayOf(new Date()))
  const [date, setDate] = useState(() => defaultDay())
  const [items, setItems] = useState<MensaItem[]>([])
  const [status, setStatus] = useState('Lädt …')
  const [events, setEvents] = useState<TimetableEvent[] | null>(null)

  // Stundenplan der Woche (aus dem Zwischenspeicher) für die Campus-Erkennung.
  useEffect(() => {
    let cancelled = false
    cachedTimetable(profile.id, isoOf(monday))
      .then((tt) => { if (!cancelled) setEvents(tt ? tt.events : null) })
      .catch(() => { if (!cancelled) setEvents(null) })
    return () => { cancelled = true }
  }, [profile.id, monday])

  // Speiseplan des gewählten Tages laden.
  useEffect(() => {
    let cancelled = false
    setStatus('Lädt …')
    getMensa(date)
      .then((it) => { if (!cancelled) { setItems(it); setStatus('') } })
      .catch((e) => { if (!cancelled) { setItems([]); setStatus((e as Error).message || 'Speiseplan gerade nicht erreichbar') } })
    return () => { cancelled = true }
  }, [date])

  const dayIsos = [0, 1, 2, 3, 4].map((i) => isoLocal(addDays(monday, i)))
  const campusKnown = events !== null
  const campusByDay = dayIsos.map((iso) => onCampus((events ?? []).filter((e) => e.start.slice(0, 10) === iso)))
  const fr = addDays(monday, 4)
  const weekLabel = `${pad(monday.getDate())}.${pad(monday.getMonth() + 1)}. – ${pad(fr.getDate())}.${pad(fr.getMonth() + 1)}.`

  return (
    <>
      <PageHeader back title="Mensa Horb" />

      <div className="sp-weeknav">
        <button onClick={() => setMonday(addDays(monday, -7))} aria-label="vorige Woche">‹</button>
        <button onClick={() => { const m = mondayOf(new Date()); setMonday(m); setDate(defaultDay()) }}>Heute</button>
        <button onClick={() => setMonday(addDays(monday, 7))} aria-label="nächste Woche">›</button>
        <span className="sp-weeklabel">{weekLabel}</span>
      </div>

      <div className="mensa-days">
        {SHORT.map((sh, i) => {
          const iso = dayIsos[i]
          const d = addDays(monday, i)
          const off = campusKnown && !campusByDay[i]
          return (
            <button
              key={iso}
              className={`mensa-day${iso === date ? ' active' : ''}${off ? ' off' : ''}`}
              onClick={() => setDate(iso)}
              title={off ? 'Laut Stundenplan nicht am Campus' : undefined}
            >
              {sh}
              <span>{pad(d.getDate())}.{pad(d.getMonth() + 1)}.</span>
            </button>
          )
        })}
      </div>

      {campusKnown && !campusByDay[dayIsos.indexOf(date)] && (
        <p className="muted" style={{ fontSize: 13, margin: '0 0 10px' }}>An diesem Tag bist du laut Stundenplan nicht am Campus.</p>
      )}

      {status ? <div className="sp-status">{status}</div> : <MensaList items={items} />}

      <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>Preise: Studierende / Bedienstete / Gäste. Quelle: Studierendenwerk Stuttgart.</p>
    </>
  )
}
