import { Component, type ErrorInfo, type ReactNode } from 'react'
import { applyUpdate, isBusyRoute, useUpdateAvailable } from '../lib/appUpdate'
import { createBackup, markBackup } from '../lib/backup'
import { db } from '../lib/db'
import { safeFileName, saveFile } from '../lib/files'
import { isoDate } from '../lib/dates'
import { readStored } from '../state'

/** Hinweis auf eine neue Version. */
export function UpdateBanner() {
  const available = useUpdateAvailable()
  if (!available || isBusyRoute()) return null
  return (
    <div className="notice row between" role="status">
      <span>Neue Version verfügbar.</span>
      <button className="btn small primary" onClick={applyUpdate}>Neu laden</button>
    </div>
  )
}

/** Fängt Anzeigefehler ab, damit statt einer weißen Seite ein Ausweg angeboten wird. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error?: Error; saved?: boolean }> {
  state: { error?: Error; saved?: boolean } = {}

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  private backup = async () => {
    const profiles = await db.profiles.toArray()
    const profile = profiles.find((p) => p.id === readStored()) ?? profiles[0]
    if (!profile) return
    if (!(await saveFile(`lernapp-sicherung-${safeFileName(profile.name)}-${isoDate(Date.now())}.json`, JSON.stringify(await createBackup(profile.id))))) return
    await markBackup(profile.id)
    this.setState({ saved: true })
  }

  render() {
    const { error, saved } = this.state
    if (!error) return this.props.children
    return (
      <main className="main">
        <div className="card stack" role="alert">
          <h2 style={{ margin: 0 }}>Hier ist etwas schiefgelaufen</h2>
          <p className="muted" style={{ margin: 0 }}>
            Deine Lerndaten sind nicht betroffen. Meist hilft Neuladen. Tritt der Fehler immer wieder auf, sichere deine Daten und melde den Fehler mit dem Text unten.
          </p>
          <button className="btn primary block" onClick={() => location.reload()}>Neu laden</button>
          <button
            className="btn block"
            onClick={() => {
              location.hash = '#/'
              this.setState({ error: undefined })
            }}
          >
            Zur Übersicht
          </button>
          <button className="btn block" onClick={this.backup}>{saved ? 'Sicherung erstellt ✓' : 'Sicherung exportieren'}</button>
          <small className="muted" style={{ wordBreak: 'break-word' }}>{error.message}</small>
        </div>
      </main>
    )
  }
}
