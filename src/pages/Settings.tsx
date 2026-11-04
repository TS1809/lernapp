import { useEffect, useRef, useState } from 'react'
import { budgetInfo, BUDGET_MIN_DAYS, BUDGET_WINDOW_DAYS, type BudgetInfo } from '../lib/budget'
import { DAY } from '../lib/dates'
import { Link } from 'react-router-dom'
import { useAppState, useActive } from '../state'
import { db, deleteProfile, deleteSemester, uid, type Profile } from '../lib/db'
import { createBackup, parseBackup, restoreBackup, markBackup } from '../lib/backup'
import { createTemplate, templateSummary } from '../lib/template'
import { readJsonFile, safeFileName, saveFile } from '../lib/packages'
import { isoDate } from '../lib/dates'
import { PageHeader } from '../components/ui'
import { clearConfig, configReady, getConfig, setConfig, type StundenplanConfig } from '../lib/stundenplan'
import { useSync } from '../sync-state'
import { SEMESTER_KINDS } from '../lib/semesters'
import { useLiveQuery } from 'dexie-react-hooks'
import { listBackups, restoreBackup as restoreDropboxBackup, widgetKey, type BackupEntry } from '../lib/syncService'

export function Settings() {
  const { profile, semester, semesters } = useActive()
  const { profiles, selectProfile } = useAppState()
  const sync = useSync()
  const pdfs = useLiveQuery(() => db.pdfs.toCollection().primaryKeys(), [])
  const [backups, setBackups] = useState<BackupEntry[] | null>(null)

  async function showBackups() {
    try {
      setBackups(await listBackups(profile.id))
    } catch (e) {
      setMessage((e as Error).message)
    }
  }

  async function restoreWeek(b: BackupEntry) {
    if (!confirm(`Profil auf die Sicherung aus ${b.week.replace('-KW', ', KW ')} zurücksetzen? Was du seitdem auf diesem Gerät gelernt hast, geht verloren.`)) return
    try {
      await restoreDropboxBackup(profile.id, b)
      setMessage('Sicherung wiederhergestellt.')
      setBackups(null)
    } catch (e) {
      setMessage((e as Error).message)
    }
  }
  const [message, setMessage] = useState('')
  const [storage, setStorage] = useState<{ persisted?: boolean; usage?: number }>({})

  useEffect(() => {
    const s = navigator.storage
    Promise.all([s?.persisted?.(), s?.estimate?.()]).then(([persisted, est]) => setStorage({ persisted, usage: est?.usage })).catch(() => {})
  }, [])

  const update = (patch: Partial<Profile>) => db.profiles.update(profile.id, patch)

  async function removeSemester(id: string, name: string) {
    if (!confirm(`Semester „${name}“ mit allen Prüfungen, Karten und dem Lernfortschritt löschen?`)) return
    await deleteSemester(id)
    if (id === profile.activeSemesterId) {
      const rest = semesters.filter((s) => s.id !== id)
      await update({ activeSemesterId: rest[rest.length - 1]?.id })
    }
  }

  async function addProfile() {
    const name = prompt('Name des neuen Profils', '')
    if (!name?.trim()) return
    const id = uid()
    await db.profiles.add({ id, name: name.trim(), createdAt: Date.now(), minutesMobile: 20, minutesDesk: 30, retention: 0.9 })
    selectProfile(id)
  }

  async function removeProfile() {
    const typed = prompt(`Profil „${profile.name}“ mit allen Daten unwiderruflich löschen? Zum Bestätigen den Namen eingeben.`)
    if (typed !== profile.name) return
    await deleteProfile(profile.id)
    const next = profiles.find((p) => p.id !== profile.id)
    if (next) selectProfile(next.id)
  }

  async function exportBackup() {
    const b = await createBackup(profile.id)
    if (!(await saveFile(`lernapp-sicherung-${safeFileName(profile.name)}-${isoDate(Date.now())}.json`, JSON.stringify(b)))) return
    await markBackup(profile.id)
    setMessage('Sicherung erstellt.')
  }

  async function exportTemplate() {
    const t = await createTemplate(profile.id)
    if (!(await saveFile(`lernapp-vorlage-${safeFileName(profile.name)}-${isoDate(Date.now())}.json`, JSON.stringify(t)))) return
    const { exams, cards, reports } = templateSummary(t)
    setMessage(`Vorlage exportiert: ${exams} ${exams === 1 ? 'Prüfung' : 'Prüfungen'}, ${cards} Karten${reports ? `, ${reports} ${reports === 1 ? 'offene Meldung' : 'offene Meldungen'}` : ''}.`)
  }

  async function importBackup(file?: File) {
    if (!file) return
    try {
      const b = parseBackup(await readJsonFile(file))
      const exists = await db.profiles.get(b.profile.id)
      const q = exists
        ? `Profil „${b.profile.name}“ auf den Stand vom ${new Date(b.exportedAt).toLocaleString('de-DE')} zurücksetzen? Neuere Daten auf diesem Gerät gehen verloren.`
        : `Profil „${b.profile.name}“ aus der Sicherung wiederherstellen?`
      if (!confirm(q)) return
      await restoreBackup(b)
      selectProfile(b.profile.id)
      setMessage('Sicherung wiederhergestellt.')
    } catch (e) {
      setMessage((e as Error).message)
    }
  }

  const budgets = useLiveQuery(async () => {
    const now = Date.now()
    const logs = await db.reviews.where('reviewedAt').above(now - BUDGET_WINDOW_DAYS * DAY).filter((l) => l.profileId === profile.id).toArray()
    const auto = profile.budgetAuto !== false
    return { mobile: budgetInfo(profile.minutesMobile, logs, 'mobile', now, auto), desk: budgetInfo(profile.minutesDesk, logs, 'desk', now, auto) }
  }, [profile.id, profile.minutesMobile, profile.minutesDesk, profile.budgetAuto])

  return (
    <>
      <PageHeader back title="Einstellungen" />
      {message && <div className="notice">{message}</div>}

      <div className="section-title">Lernplan</div>
      <div className="card">
        <label className="field">
          <span>Unterwegs (Karten): {profile.minutesMobile} min pro Tag</span>
          <input type="range" min={5} max={120} step={5} value={profile.minutesMobile} onChange={(e) => update({ minutesMobile: Number(e.target.value) })} />
          <BudgetNote info={budgets?.mobile} />
        </label>
        <label className="field">
          <span>Am Schreibtisch (Rechenaufgaben): {profile.minutesDesk} min pro Tag</span>
          <input type="range" min={0} max={240} step={15} value={profile.minutesDesk} onChange={(e) => update({ minutesDesk: Number(e.target.value) })} />
          <BudgetNote info={budgets?.desk} desk />
        </label>
        <label className="row" style={{ gap: 10, marginBottom: 14 }}>
          <input type="checkbox" checked={profile.budgetAuto !== false} onChange={(e) => update({ budgetAuto: e.target.checked })} />
          <span style={{ fontSize: 15 }}>Budget an die gemessene Lernzeit anpassen</span>
        </label>
        <label className="row" style={{ gap: 10, marginBottom: 4, alignItems: 'flex-start' }}>
          <input type="checkbox" checked={!!profile.socratic} onChange={(e) => update({ socratic: e.target.checked })} style={{ marginTop: 3 }} />
          <span style={{ fontSize: 15 }}>Sokratisches Lernen (Test)</span>
        </label>
        <small style={{ display: 'block', marginBottom: 14 }}>
          Bei Karten mit Leitfragen gibt es vor dem Aufdecken „Tipp“-Fragen, danach Kernpunkte zum Abhaken und einen Bewertungsvorschlag. Ausgeschaltet läuft das Lernen wie bisher.
        </small>
        <label className="field" style={{ marginBottom: 0 }}>
          <span>Zielsicherheit: {Math.round(profile.retention * 100)} %</span>
          <input type="range" min={0.8} max={0.95} step={0.01} value={profile.retention} onChange={(e) => update({ retention: Number(e.target.value) })} />
          <small>Wie sicher du eine Karte bei der nächsten Wiederholung noch wissen sollst. Höher = mehr Wiederholungen. 90 % ist ein guter Standard.</small>
        </label>
        <Link to="/lernalgorithmus" className="row between" style={{ marginTop: 14 }}>
          <span>Lernalgorithmus (FSRS)</span>
          <small>{profile.fsrsWeights ? 'persönlich angepasst' : 'Standard'} ›</small>
        </Link>
      </div>

      <div className="section-title">Stundenplan & Noten (Test)</div>
      <StundenplanSection profile={profile} />

      <div className="section-title">Semester</div>
      <div className="list">
        {semesters.map((s) => (
          <div className="list-item" key={s.id}>
            <button
              className="grow truncate"
              style={{ border: 'none', background: 'none', font: 'inherit', color: 'inherit', textAlign: 'left', padding: 0, cursor: 'pointer' }}
              onClick={() => update({ activeSemesterId: s.id })}
              aria-pressed={s.id === semester.id}
            >
              <span style={{ display: 'inline-block', width: 22, color: 'var(--accent)', fontWeight: 600 }}>{s.id === semester.id ? '✓' : ''}</span>
              {s.name}
              <small style={{ display: 'block', marginLeft: 22, whiteSpace: 'normal' }}>{s.kind ? SEMESTER_KINDS[s.kind].label : 'Art der Prüfungsphase noch nicht festgelegt'}</small>
            </button>
            <Link className="btn small ghost" style={{ color: 'var(--accent)' }} to={`/semester/${s.id}`}>Ändern</Link>
            <button className="btn small ghost danger" onClick={() => removeSemester(s.id, s.name)} aria-label={`${s.name} löschen`}>Löschen</button>
          </div>
        ))}
        <div className="list-item">
          <Link className="btn small ghost" style={{ color: 'var(--accent)', marginLeft: -8 }} to="/semester/neu">Neues Semester hinzufügen</Link>
        </div>
      </div>

      <div className="section-title">Profil</div>
      <div className="card stack">
        <label className="field" style={{ marginBottom: 0 }}>
          <span>Name</span>
          <input type="text" defaultValue={profile.name} onBlur={(e) => e.target.value.trim() && update({ name: e.target.value.trim() })} />
        </label>
        {profiles.length > 1 && (
          <label className="field" style={{ marginBottom: 0 }}>
            <span>Profil wechseln</span>
            <select value={profile.id} onChange={(e) => selectProfile(e.target.value)}>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
        )}
        <div className="row">
          <button className="btn grow" onClick={addProfile}>Neues Profil</button>
          <button className="btn danger grow" onClick={removeProfile}>Profil löschen</button>
        </div>
      </div>

      <div className="section-title">Synchronisation</div>
      <div className="card stack">
        {!sync.available ? (
          <p className="muted" style={{ margin: 0 }}>Die Dropbox-Synchronisation ist für diese App noch nicht eingerichtet.</p>
        ) : sync.connected ? (
          <>
            <p style={{ margin: 0 }}>
              <b>Mit Dropbox verbunden.</b>{' '}
              <span className="muted">
                {sync.syncing
                  ? 'Synchronisiere …'
                  : sync.lastSync
                    ? `Zuletzt abgeglichen: ${new Date(sync.lastSync).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}`
                    : 'Noch nicht abgeglichen.'}
              </span>
            </p>
            {sync.error && <div className="notice warn" style={{ margin: 0 }}>{sync.error}</div>}
            <p className="muted" style={{ margin: 0, fontSize: 15 }}>
              Dein Profil wird automatisch abgeglichen – beim Öffnen, nach dem Lernen und alle paar Minuten. Auf einem weiteren Gerät beim ersten Start „Profil von einem anderen Gerät laden“ wählen.
            </p>
            <div className="row">
              <button className="btn grow" onClick={() => sync.syncNow()} disabled={sync.syncing}>Jetzt abgleichen</button>
              <button className="btn danger grow" onClick={() => confirm('Verbindung zu Dropbox trennen? Deine Daten bleiben auf diesem Gerät und in Dropbox erhalten.') && sync.disconnect()}>
                Trennen
              </button>
            </div>
            <WidgetKey profileId={profile.id} />
            {backups === null ? (
              <button className="btn small ghost" style={{ color: 'var(--accent)', alignSelf: 'flex-start', marginLeft: -8 }} onClick={showBackups}>
                Wochensicherungen anzeigen
              </button>
            ) : backups.length === 0 ? (
              <small>Noch keine Wochensicherung vorhanden – sie entsteht beim ersten Abgleich jeder Woche.</small>
            ) : (
              <div className="stack">
                <small>Einmal pro Woche legt die App eine Sicherung in deiner Dropbox ab (die letzten 8 bleiben erhalten).</small>
                {backups.map((b) => (
                  <div className="row between" key={b.path}>
                    <span>{b.week.replace('-KW', ' · KW ')}</span>
                    <button className="btn small" onClick={() => restoreWeek(b)}>Wiederherstellen</button>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <p className="muted" style={{ margin: 0 }}>
              Gleicht dein Profil automatisch zwischen deinen Geräten ab (z. B. iPhone und iPad). Die App sieht nur ihren eigenen Ordner in deiner Dropbox. Ein kostenloses Dropbox-Konto reicht.
            </p>
            <button className="btn primary block" onClick={sync.connect}>Mit Dropbox verbinden</button>
          </>
        )}
      </div>

      <div className="section-title">Daten & Sicherung</div>
      <div className="card stack">
        <p className="muted" style={{ margin: 0 }}>
          Deine Daten liegen auf diesem Gerät
          {storage.usage !== undefined && ` (${(storage.usage / 1024 / 1024).toFixed(1)} MB)`}
          {sync.connected ? ' und in deiner Dropbox. ' : '. '}
          {storage.persisted === true && 'Der Browser hält sie dauerhaft vor. '}
          {storage.persisted === false && !sync.connected && 'Der Browser darf sie bei Speichermangel löschen – installiere die App auf dem Homescreen und lege regelmäßig eine Sicherung an. '}
          Zusätzlich kannst du jederzeit eine Sicherungsdatei anlegen, z. B. in iCloud Drive.
        </p>
        <button className="btn block" onClick={exportBackup}>Sicherung exportieren</button>
        <label className="btn block">
          Sicherung wiederherstellen
          <input type="file" accept=".json,application/json" hidden onChange={(e) => importBackup(e.target.files?.[0])} />
        </label>
      </div>

      <div className="section-title">Vorlage ohne Lernfortschritt</div>
      <div className="card stack">
        <p className="muted" style={{ margin: 0 }}>
          Alle Semester, Prüfungen (mit Termin, Fachprofil und offenen Erinnerungen), Kartenpakete und offene Meldungen zu Karten in einer Datei – ohne Lernstand, Bewertungen, Hausaufgaben und persönliche Einstellungen. Zum Weitergeben an Kommilitonen oder für einen Neustart; importiert wird sie unter „Karten importieren“.
        </p>
        <button className="btn block" onClick={exportTemplate}>Vorlage exportieren</button>
      </div>

      <div className="section-title">Unterlagen</div>
      <div className="card">
        <Link to="/unterlagen" className="row between">
          <span>Skripte für „Folie ansehen“</span>
          <small>{pdfs?.length ?? 0} auf diesem Gerät ›</small>
        </Link>
      </div>

      <div className="section-title">Hilfe</div>
      <div className="card">
        <Link to="/hilfe">Installation, Erinnerungen & Lernmethode</Link>
      </div>
      <div className="card">
        <Link to="/ideen" className="row between">
          <span>Ideen für Version 2</span>
          <small>{profile.ideas?.length ? `${profile.ideas.length} eigene ›` : '›'}</small>
        </Link>
      </div>
      <p className="muted" style={{ textAlign: 'center', fontSize: 13 }}>
        Lernapp {__APP_VERSION__}
        <br />
        {__APP_BUILD__} · {new Date(__APP_BUILT_AT__).toLocaleDateString('de-DE')}
      </p>
    </>
  )
}

/** Gemessene Lernzeit zum eingestellten Budget und das Budget, mit dem tatsächlich geplant wird. */
function BudgetNote({ info, desk }: { info?: BudgetInfo; desk?: boolean }) {
  if (!info || info.setting === 0) return null
  const hw = desk ? ' Hausaufgaben bekommen immer ihre volle Zeit bis zur Abgabe; angepasst wird nur die Zeit für Aufgaben.' : ''
  if (info.measured === undefined)
    return <small>Noch zu wenig Daten: Ab {BUDGET_MIN_DAYS} Lerntagen wird deine tatsächliche Lernzeit gemessen.{hw}</small>
  return (
    <small>
      Gemessen{desk ? ' (Aufgaben)' : ''}: ⌀ {Math.round(info.measured)} min an {info.days} Lerntagen (letzte {BUDGET_WINDOW_DAYS} Tage)
      {!desk && info.effective !== info.setting ? ` · geplant wird mit ${info.effective} min` : ''}.{hw}
    </small>
  )
}

/** Schlüssel fürs Scriptable-Widget kopieren (siehe public/scriptable/lernapp-widget.js). */
function WidgetKey({ profileId }: { profileId: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'error'>('idle')
  async function copy() {
    try {
      const key = await widgetKey(profileId)
      if (!key) throw new Error()
      await navigator.clipboard.writeText(key)
      setState('ok')
    } catch {
      setState('error')
    }
  }
  return (
    <details className="explain">
      <summary>Widget-Schlüssel (Scriptable)</summary>
      <p className="muted" style={{ fontSize: 14 }}>
        Damit das Homescreen-Widget immer aktuell ist, lädt es den Fortschritt direkt aus deiner Dropbox. Schlüssel kopieren, dann in Scriptable das Skript „Lernapp“ starten und „Widget-Schlüssel einfügen“ wählen. Der Schlüssel erlaubt nur Zugriff auf den Ordner der Lernapp und wird mit „Trennen“ ungültig.
      </p>
      <button className="btn block" onClick={copy}>{state === 'ok' ? 'Widget-Schlüssel kopiert' : 'Widget-Schlüssel kopieren'}</button>
      {state === 'error' && <small className="badge-warn">Kopieren nicht möglich.</small>}
    </details>
  )
}

/** Schalter + Zugangsdaten für den Stundenplan/Noten-Bereich (gerätelokal in `meta`). */
function StundenplanSection({ profile }: { profile: Profile }) {
  const on = !!profile.stundenplan
  const cfg = useLiveQuery(() => getConfig(profile.id), [profile.id])
  const [form, setForm] = useState<StundenplanConfig>({ relayUrl: '', token: '', user: '', pass: '' })
  const [saved, setSaved] = useState(false)
  const loaded = useRef(false)

  useEffect(() => {
    if (cfg && !loaded.current) {
      setForm(cfg)
      loaded.current = true
    }
  }, [cfg])

  const set = (patch: Partial<StundenplanConfig>) => {
    setForm((f) => ({ ...f, ...patch }))
    setSaved(false)
  }

  async function save() {
    await setConfig(profile.id, { relayUrl: form.relayUrl.trim(), token: form.token.trim(), user: form.user.trim(), pass: form.pass })
    setSaved(true)
  }

  async function remove() {
    if (!confirm('Zugangsdaten für Stundenplan/Noten von diesem Gerät löschen?')) return
    await clearConfig(profile.id)
    setForm({ relayUrl: '', token: '', user: '', pass: '' })
    loaded.current = true
    setSaved(false)
  }

  return (
    <div className="card stack">
      <label className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <input type="checkbox" checked={on} onChange={(e) => db.profiles.update(profile.id, { stundenplan: e.target.checked })} style={{ marginTop: 3 }} />
        <span style={{ fontSize: 15 }}>Stundenplan & Noten aus DUALIS anzeigen</span>
      </label>
      <small className="muted" style={{ marginTop: -6 }}>
        Holt Stundenplan und Noten über dein eigenes Relais aus DUALIS. Die Zugangsdaten bleiben nur auf diesem Gerät (nicht in der Dropbox-Synchronisation).
      </small>
      {on && (
        <>
          <label className="field" style={{ marginBottom: 0 }}>
            <span>Relais-Adresse</span>
            <input type="url" inputMode="url" autoCapitalize="none" placeholder="https://…workers.dev" value={form.relayUrl} onChange={(e) => set({ relayUrl: e.target.value })} />
          </label>
          <label className="field" style={{ marginBottom: 0 }}>
            <span>Zugriffs-Token</span>
            <input type="text" autoCapitalize="none" autoComplete="off" value={form.token} onChange={(e) => set({ token: e.target.value })} />
          </label>
          <label className="field" style={{ marginBottom: 0 }}>
            <span>DUALIS-Benutzer</span>
            <input type="text" autoCapitalize="none" autoComplete="username" value={form.user} onChange={(e) => set({ user: e.target.value })} />
          </label>
          <label className="field" style={{ marginBottom: 0 }}>
            <span>DUALIS-Passwort</span>
            <input type="password" autoComplete="current-password" value={form.pass} onChange={(e) => set({ pass: e.target.value })} />
          </label>
          <small className="muted">Dein Passwort wird nur zum Abruf an dein Relais geschickt und dort nicht gespeichert.</small>
          <div className="row">
            <button className="btn primary grow" disabled={!form.relayUrl || !form.token || !form.user || !form.pass} onClick={save}>
              {saved ? 'Gespeichert ✓' : 'Speichern'}
            </button>
            {configReady(cfg) && (
              <button className="btn danger grow" onClick={remove}>
                Löschen
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
