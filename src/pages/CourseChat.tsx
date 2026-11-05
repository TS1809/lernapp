import { useEffect, useRef, useState } from 'react'
import { useActive } from '../state'
import { PageHeader } from '../components/ui'
import { deleteChat, keepChat, listChat, reactChat, sendChat, type ChatState } from '../lib/chat'

const EMOJIS = ['👍', '🔥', '😂', '❤️', '✅', '❓']

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

  async function load() {
    if (busy.current) return
    busy.current = true
    try {
      const s = await listChat(profile.id)
      setState(s ?? null)
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
    if (!t) return
    setText('')
    await act(() => sendChat(profile.id, t))
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
