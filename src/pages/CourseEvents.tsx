import { useEffect, useRef, useState } from 'react'
import { useActive } from '../state'
import { PageHeader, Widget } from '../components/ui'
import { createEvent, deleteEvent, eventsPendingCount, listEvents, voteEvent, type CourseEvent, type EventState } from '../lib/events'

function whenLabel(ts: number): string {
  const d = new Date(ts)
  return (
    d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }) +
    ' · ' +
    d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  )
}

/** Dashboard-Kachel: Termine mit Zahl der noch offenen Zu-/Absagen. */
export function TermineKachel({ profileId }: { profileId: string }) {
  const [pending, setPending] = useState(0)
  useEffect(() => {
    let cancelled = false
    const tick = () =>
      eventsPendingCount(profileId)
        .then((n) => { if (!cancelled) setPending(n) })
        .catch(() => {})
    tick()
    const t = setInterval(tick, 30000)
    const onVis = () => { if (document.visibilityState === 'visible') tick() }
    document.addEventListener('visibilitychange', onVis)
    return () => { cancelled = true; clearInterval(t); document.removeEventListener('visibilitychange', onVis) }
  }, [profileId])
  const badge = pending > 0 ? <span className="w-badge">{pending > 99 ? '99+' : pending}</span> : undefined
  return (
    <Widget size="small" to="/termine" title="Termine" icon="today" badge={badge}>
      <div className="w-headline">Termine</div>
      <div className="w-foot">{pending > 0 ? `${pending} offene Abstimmung${pending === 1 ? '' : 'en'}` : 'Kurs-Termine'}</div>
    </Widget>
  )
}

export function CourseEvents() {
  const { profile } = useActive()
  const [state, setState] = useState<EventState | null>(null)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const busy = useRef(false)
  // Gegen KV-Verzögerung: optimistische Zustände halten, bis der Server sie widerspiegelt.
  const createdRef = useRef<CourseEvent[]>([])
  const voteRef = useRef<Record<string, 'yes' | 'no' | null>>({})
  const deletedRef = useRef<Set<string>>(new Set())

  // Formular
  const [title, setTitle] = useState('')
  const [at, setAt] = useState('')
  const [location, setLocation] = useState('')
  const [desc, setDesc] = useState('')

  function merge(serverEvents: CourseEvent[], me: string): CourseEvent[] {
    const ids = new Set(serverEvents.map((e) => e.id))
    createdRef.current = createdRef.current.filter((e) => !ids.has(e.id)) // vom Server bestätigte entfernen
    for (const id of [...deletedRef.current]) if (!ids.has(id)) deletedRef.current.delete(id)
    let list = [...serverEvents, ...createdRef.current].filter((e) => !deletedRef.current.has(e.id))
    list = list.map((e) => {
      const ov = voteRef.current[e.id]
      if (ov === undefined) return e
      const serverVote = e.votes?.[me]
      if ((ov === null && !serverVote) || serverVote === ov) {
        delete voteRef.current[e.id]
        return e
      }
      const votes = { ...(e.votes || {}) }
      if (ov === null) delete votes[me]
      else votes[me] = ov
      return { ...e, votes }
    })
    list.sort((a, z) => (a.at || 0) - (z.at || 0))
    return list
  }

  async function load() {
    if (busy.current) return
    busy.current = true
    try {
      const s = await listEvents(profile.id)
      if (s) setState({ ...s, events: merge(s.events, s.memberId) })
      else setState(null)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      busy.current = false
      setReady(true)
    }
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id])

  async function add() {
    const t = title.trim()
    const ts = at ? new Date(at).getTime() : NaN
    if (!t) return
    if (!Number.isFinite(ts)) {
      setError('Bitte Datum und Uhrzeit angeben.')
      return
    }
    setTitle('')
    setAt('')
    setLocation('')
    setDesc('')
    try {
      const real = await createEvent(profile.id, { title: t, at: ts, location: location.trim(), description: desc.trim() })
      createdRef.current = [...createdRef.current.filter((e) => e.id !== real.id), real]
      setState((s) => (s ? { ...s, events: merge([...s.events.filter((e) => e.id !== real.id), real], s.memberId) } : s))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function vote(id: string, next: 'yes' | 'no' | null) {
    if (!state) return
    const me = state.memberId
    voteRef.current[id] = next
    setState((s) => {
      if (!s) return s
      const events = s.events.map((e) => {
        if (e.id !== id) return e
        const votes = { ...(e.votes || {}) }
        if (next === null) delete votes[me]
        else votes[me] = next
        return { ...e, votes }
      })
      return { ...s, events }
    })
    try {
      await voteEvent(profile.id, id, next)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function remove(id: string) {
    if (!confirm('Termin löschen?')) return
    deletedRef.current.add(id)
    setState((s) => (s ? { ...s, events: s.events.filter((e) => e.id !== id) } : s))
    try {
      await deleteEvent(profile.id, id)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (ready && !state) {
    return (
      <>
        <PageHeader back title="Termine" />
        <div className="card stack">
          <p className="muted" style={{ margin: 0 }}>Für Kurs-Termine musst du zuerst einem Kurs beitreten.</p>
          <a className="btn primary block" href="#/einstellungen">Zu den Einstellungen</a>
        </div>
      </>
    )
  }

  const me = state?.memberId
  const isAdmin = !!me && !!state?.admins.includes(me)
  const members = state?.members ?? {}
  const events = state?.events ?? []
  const now = Date.now()
  const nameOf = (id: string) => (id === me ? 'Du' : members[id] || 'Mitglied')

  return (
    <>
      <PageHeader back title="Termine" />

      <div className="card stack">
        <label className="field" style={{ marginBottom: 0 }}>
          <span>Titel</span>
          <input type="text" placeholder="z. B. Lerngruppe Konstruktionslehre" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field" style={{ marginBottom: 0 }}>
          <span>Wann</span>
          <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
        </label>
        <label className="field" style={{ marginBottom: 0 }}>
          <span>Ort (optional)</span>
          <input type="text" placeholder="z. B. Bibliothek / Online" value={location} onChange={(e) => setLocation(e.target.value)} />
        </label>
        <label className="field" style={{ marginBottom: 0 }}>
          <span>Notiz (optional)</span>
          <textarea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} />
        </label>
        <div className="row">
          <button className="btn primary grow" disabled={!title.trim() || !at} onClick={add}>Termin anlegen</button>
        </div>
      </div>

      {error && <p className="badge-warn" style={{ marginTop: 10 }}>{error}</p>}

      <div className="list" style={{ marginTop: 12, gap: 10 }}>
        {events.length === 0 && ready && <p className="muted" style={{ textAlign: 'center', padding: '16px 0' }}>Noch keine Termine. Leg den ersten an!</p>}
        {events.map((e) => {
          const yes = Object.entries(e.votes || {}).filter(([, v]) => v === 'yes').map(([id]) => id)
          const no = Object.entries(e.votes || {}).filter(([, v]) => v === 'no').map(([id]) => id)
          const mine = me ? e.votes?.[me] : undefined
          const past = (e.at || 0) < now
          const canDelete = e.createdBy === me || isAdmin
          return (
            <div key={e.id} className={`card stack${past ? ' event-past' : ''}`} style={{ gap: 6 }}>
              <div className="row between" style={{ gap: 8 }}>
                <b style={{ fontSize: 16 }}>{e.title}</b>
                {canDelete && <button className="chat-tool danger" onClick={() => remove(e.id)}>Löschen</button>}
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                {whenLabel(e.at)}{past ? ' · vorbei' : ''}{e.location ? ` · ${e.location}` : ''}
              </div>
              {e.description && <div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{e.description}</div>}
              <div className="row" style={{ gap: 8, marginTop: 2 }}>
                <button className={`btn small${mine === 'yes' ? ' primary' : ''}`} onClick={() => vote(e.id, mine === 'yes' ? null : 'yes')}>✓ Zusagen{yes.length ? ` (${yes.length})` : ''}</button>
                <button className={`btn small${mine === 'no' ? ' danger' : ''}`} onClick={() => vote(e.id, mine === 'no' ? null : 'no')}>✗ Absagen{no.length ? ` (${no.length})` : ''}</button>
              </div>
              {(yes.length > 0 || no.length > 0) && (
                <div className="event-voters">
                  {yes.length > 0 && <span><span style={{ color: 'var(--good)' }}>✓</span> {yes.map(nameOf).join(', ')}</span>}
                  {no.length > 0 && <span><span style={{ color: 'var(--bad)' }}>✗</span> {no.map(nameOf).join(', ')}</span>}
                </div>
              )}
              <small className="muted">von {e.createdByName || 'Mitglied'}</small>
            </div>
          )
        })}
      </div>
    </>
  )
}
