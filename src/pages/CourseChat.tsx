import { useEffect, useRef, useState } from 'react'
import { useActive } from '../state'
import { PageHeader, Widget } from '../components/ui'
import { chatUnreadCount, deleteChat, keepChat, listChat, markChatRead, reactChat, sendChat, type ChatMessage, type ChatState } from '../lib/chat'

const EMOJIS = ['👍', '🔥', '😂', '❤️', '✅', '❓']

/** Dashboard-Kachel mit Ungelesen-Zähler (ohne den Chat öffnen zu müssen). */
export function KurschatKachel({ profileId }: { profileId: string }) {
  const [unread, setUnread] = useState(0)
  useEffect(() => {
    let cancelled = false
    const tick = () =>
      chatUnreadCount(profileId)
        .then((n) => { if (!cancelled) setUnread(n) })
        .catch(() => {})
    tick()
    const t = setInterval(tick, 20000)
    const onVis = () => { if (document.visibilityState === 'visible') tick() }
    document.addEventListener('visibilitychange', onVis)
    return () => { cancelled = true; clearInterval(t); document.removeEventListener('visibilitychange', onVis) }
  }, [profileId])
  const badge = unread > 0 ? <span className="w-badge">{unread > 99 ? '99+' : unread}</span> : undefined
  return (
    <Widget size="small" to="/kurschat" title="Kurschat" icon="chat" badge={badge}>
      <div className="w-headline">Kurschat</div>
      <div className="w-foot">{unread > 0 ? `${unread} neue Nachricht${unread === 1 ? '' : 'en'}` : 'Nachrichten im Kurs'}</div>
    </Widget>
  )
}

function when(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const t = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  return sameDay ? t : `${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} ${t}`
}

export function CourseChat() {
  const { profile } = useActive()
  const [state, setState] = useState<ChatState | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const busy = useRef(false)
  const endRef = useRef<HTMLDivElement>(null)
  // Lokal gesendete Nachrichten sichtbar halten, bis der Server sie listet (KV ist eventual consistent).
  const pendingRef = useRef<ChatMessage[]>([])

  async function load() {
    if (busy.current) return
    busy.current = true
    try {
      const s = await listChat(profile.id)
      if (s) {
        const ids = new Set(s.messages.map((m) => m.id))
        // vom Server bestätigte entfernen; alte Reste (>2 min) als Sicherheitsnetz verwerfen
        pendingRef.current = pendingRef.current.filter((m) => !ids.has(m.id) && Date.now() - m.at < 120000)
        setState({ ...s, messages: [...s.messages, ...pendingRef.current] })
        markChatRead(s.course) // sichtbar = gelesen
      } else {
        setState(null)
      }
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
    const t = setInterval(load, 7000) // einfaches Nachladen für neue Nachrichten
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [state?.messages.length])

  async function act(fn: () => Promise<void>) {
    try {
      await fn()
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function send() {
    const t = text.trim()
    if (!t || !state) return
    setText('')
    // Eigene Nachricht sofort anzeigen (optimistisch); bei anderen erscheint sie beim nächsten Nachladen.
    const tmpId = 'tmp-' + Date.now()
    const temp: ChatMessage = { id: tmpId, memberId: state.memberId, name: profile.name, text: t, at: Date.now(), reactions: {} }
    pendingRef.current = [...pendingRef.current, temp]
    setState((s) => (s ? { ...s, messages: [...s.messages.filter((m) => m.id !== tmpId), temp] } : s))
    try {
      const real = await sendChat(profile.id, t)
      // Temp durch die echte Nachricht ersetzen; bleibt „pending", bis ein Server-Listing sie enthält.
      pendingRef.current = pendingRef.current.map((m) => (m.id === tmpId ? real : m))
      setState((s) => (s ? { ...s, messages: [...s.messages.filter((m) => m.id !== tmpId && m.id !== real.id), real] } : s))
    } catch (e) {
      pendingRef.current = pendingRef.current.filter((m) => m.id !== tmpId)
      setState((s) => (s ? { ...s, messages: s.messages.filter((m) => m.id !== tmpId) } : s))
      setError((e as Error).message)
      setText(t) // Text zurückgeben, damit man es erneut versuchen kann
    }
  }

  if (ready && !state) {
    return (
      <>
        <PageHeader back title="Kurschat" />
        <div className="card stack">
          <p className="muted" style={{ margin: 0 }}>Für den Kurschat musst du zuerst einem Kurs beitreten.</p>
          <a className="btn primary block" href="#/einstellungen">Zu den Einstellungen</a>
        </div>
      </>
    )
  }

  const me = state?.memberId
  const isAdmin = !!me && !!state?.admins.includes(me)
  const messages = state?.messages ?? []

  return (
    <>
      <PageHeader back title="Kurschat" />
      <p className="muted" style={{ fontSize: 13, margin: '-4px 0 10px' }}>
        Nachrichten verschwinden nach 7 Tagen von selbst – außer du markierst sie mit 📌 „behalten".
      </p>

      <div className="chat-list">
        {messages.length === 0 && ready && <p className="muted" style={{ textAlign: 'center', padding: '20px 0' }}>Noch keine Nachrichten. Schreib die erste!</p>}
        {messages.map((m) => {
          const mine = m.memberId === me
          const canUnkeep = m.keptBy === me || isAdmin
          const canDelete = mine || isAdmin
          return (
            <div key={m.id} className={`chat-msg${mine ? ' mine' : ''}`}>
              <div className="chat-head">
                <b>{m.name || 'Mitglied'}</b>
                <span className="muted">{when(m.at)}</span>
                {m.keep && <span className="chip" title="behalten">📌</span>}
              </div>
              <div className="chat-text">{m.text}</div>
              <div className="chat-actions">
                {EMOJIS.map((e) => {
                  const who = m.reactions?.[e] ?? []
                  const on = !!me && who.includes(me)
                  return (
                    <button key={e} className={`chat-react${on ? ' on' : ''}`} onClick={() => act(() => reactChat(profile.id, m.id, e, !on))}>
                      {e}
                      {who.length > 0 && <span>{who.length}</span>}
                    </button>
                  )
                })}
                {!m.keep ? (
                  <button className="chat-tool" onClick={() => act(() => keepChat(profile.id, m.id, true))}>📌 behalten</button>
                ) : canUnkeep ? (
                  <button className="chat-tool" onClick={() => act(() => keepChat(profile.id, m.id, false))}>📌 freigeben</button>
                ) : null}
                {canDelete && (
                  <button className="chat-tool danger" onClick={() => { if (confirm('Nachricht löschen?')) act(() => deleteChat(profile.id, m.id)) }}>Löschen</button>
                )}
              </div>
              {Object.entries(m.reactions ?? {}).some(([, who]) => who.length > 0) && (
                <div className="chat-reactors">
                  {Object.entries(m.reactions ?? {})
                    .filter(([, who]) => who.length > 0)
                    .map(([e, who]) => (
                      <span key={e} className="chat-reactor">
                        <span className="chat-reactor-e">{e}</span>
                        {who.map((id) => (id === me ? 'Du' : state?.members[id] || 'Mitglied')).join(', ')}
                      </span>
                    ))}
                </div>
              )}
            </div>
          )
        })}
        <div ref={endRef} />
      </div>

      {error && <p className="badge-warn" style={{ marginTop: 10 }}>{error}</p>}

      <div className="chat-compose">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder="Nachricht an den Kurs … (Enter sendet)"
          rows={2}
        />
        <button className="btn primary" disabled={!text.trim()} onClick={send}>Senden</button>
      </div>
    </>
  )
}
