import { useEffect, useState } from 'react'
import { useActive } from '../state'
import { PageHeader, Widget } from '../components/ui'
import { addDays, cachedTimetable, isoOf, mondayOf, type TimetableEvent } from '../lib/stundenplan'
import { DIET_LABEL, getMensa, onCampus, type MensaItem } from '../lib/mensa'

const DAYSFULL = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag']
const pad = (n: number) => String(n).padStart(2, '0')
const isoLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const todayIso = () => isoLocal(new Date())

function DietChip({ code }: { code: string }) {
  const label = DIET_LABEL[code] || code
  const green = code === 'VG' || code === 'V' || code === 'VR'
  return <span className="mensa-diet" style={green ? { color: 'var(--good)', borderColor: 'var(--good)' } : undefined}>{label}</span>
}

/** Speiseplan eines Tages (Kategorien + Gerichte, nur der erste – studentische – Preis). */
function DayMenu({ items }: { items: MensaItem[] }) {
  if (items.length === 0) return <p className="muted" style={{ margin: 0, fontSize: 13 }}>Kein Speiseplan.</p>
  const cats: string[] = []
  for (const it of items) if (!cats.includes(it.category)) cats.push(it.category)
  return (
    <>
      {cats.map((cat) => (
        <div key={cat} className="mensa-catblock">
          <div className="mensa-cat">{cat}</div>
          {items
            .filter((it) => it.category === cat)
            .map((it, i) => (
              <div key={i} className="mensa-item">
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="mensa-name">{it.name}</div>
                  {it.icons.length > 0 && <div className="mensa-diets">{it.icons.map((c) => <DietChip key={c} code={c} />)}</div>}
                </div>
                {it.prices[0] && <div className="mensa-price">€ {it.prices[0]}</div>}
              </div>
            ))}
        </div>
      ))}
    </>
  )
}

/** Dashboard-Kachel „Speiseplan": Übersicht des heutigen Tages (nur erster Preis). */
export function SpeiseplanKachel({ profileId }: { profileId: string }) {
  const [items, setItems] = useState<MensaItem[] | null>(null)
  useEffect(() => {
    let cancelled = false
    getMensa(todayIso())
      .then((it) => { if (!cancelled) setItems(it) })
      .catch(() => { if (!cancelled) setItems([]) })
    return () => { cancelled = true }
  }, [profileId])
  return (
    <Widget size="medium" to="/mensa" title="Speiseplan" icon="today">
      <div className="w-headline">Mensa Horb – heute</div>
      {items === null ? (
        <div className="w-foot">Lädt …</div>
      ) : items.length === 0 ? (
        <div className="w-foot">Heute kein Speiseplan</div>
      ) : (
        <div className="mensa-widget">
          {items.slice(0, 4).map((it, i) => (
            <div key={i} className="mensa-widget-row">
              <span className="truncate">{it.name}</span>
              {it.prices[0] && <span className="mensa-widget-price">€ {it.prices[0]}</span>}
            </div>
          ))}
          {items.length > 4 && <div className="w-foot" style={{ marginTop: 2 }}>+ {items.length - 4} weitere</div>}
        </div>
      )}
    </Widget>
  )
}

export function Mensa() {
  const { profile } = useActive()
  const [monday, setMonday] = useState(() => mondayOf(new Date()))
  const [byDay, setByDay] = useState<Record<string, MensaItem[]>>({})
  const [status, setStatus] = useState('Lädt …')
  const [events, setEvents] = useState<TimetableEvent[] | null>(null)

  // Stundenplan der Woche (Zwischenspeicher) für die Campus-Erkennung.
  useEffect(() => {
    let cancelled = false
    cachedTimetable(profile.id, isoOf(monday))
      .then((tt) => { if (!cancelled) setEvents(tt ? tt.events : null) })
      .catch(() => { if (!cancelled) setEvents(null) })
    return () => { cancelled = true }
  }, [profile.id, monday])

  // Speiseplan aller Wochentage (Mo–Fr) laden.
  useEffect(() => {
    let cancelled = false
    setStatus('Lädt …')
    setByDay({})
    const isos = [0, 1, 2, 3, 4].map((i) => isoLocal(addDays(monday, i)))
    Promise.all(isos.map((iso) => getMensa(iso).then((items) => [iso, items] as const).catch(() => [iso, [] as MensaItem[]] as const)))
      .then((pairs) => {
        if (cancelled) return
        const m: Record<string, MensaItem[]> = {}
        for (const [iso, items] of pairs) m[iso] = items
        setByDay(m)
        setStatus('')
      })
    return () => { cancelled = true }
  }, [profile.id, monday])

  const dayIsos = [0, 1, 2, 3, 4].map((i) => isoLocal(addDays(monday, i)))
  const campusKnown = events !== null
  const today = todayIso()
  const fr = addDays(monday, 4)
  const weekLabel = `${pad(monday.getDate())}.${pad(monday.getMonth() + 1)}. – ${pad(fr.getDate())}.${pad(fr.getMonth() + 1)}.`

  return (
    <>
      <PageHeader back title="Speiseplan Horb" />

      <div className="sp-weeknav">
        <button onClick={() => setMonday(addDays(monday, -7))} aria-label="vorige Woche">‹</button>
        <button onClick={() => setMonday(mondayOf(new Date()))}>Heute</button>
        <button onClick={() => setMonday(addDays(monday, 7))} aria-label="nächste Woche">›</button>
        <span className="sp-weeklabel">{weekLabel}</span>
      </div>

      {status ? (
        <div className="sp-status">{status}</div>
      ) : (
        dayIsos.map((iso, i) => {
          const d = addDays(monday, i)
          const off = campusKnown && !onCampus((events ?? []).filter((e) => e.start.slice(0, 10) === iso))
          return (
            <div key={iso} className={`card stack mensa-daycard${off ? ' mensa-off' : ''}`} style={{ gap: 8 }}>
              <div className="mensa-dayhead">
                <b>{DAYSFULL[i]} {pad(d.getDate())}.{pad(d.getMonth() + 1)}.</b>
                {iso === today && <span className="chip accent">heute</span>}
                {off && <span className="chip">nicht am Campus</span>}
              </div>
              <DayMenu items={byDay[iso] ?? []} />
            </div>
          )
        })
      )}

      <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>Preis für Studierende. Quelle: Studierendenwerk Stuttgart.</p>
    </>
  )
}
