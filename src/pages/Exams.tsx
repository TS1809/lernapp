import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useActive } from '../state'
import { db, MAX_EXAMS_PER_SEMESTER } from '../lib/db'
import { daysUntil, formatCountdown, formatDate } from '../lib/dates'
import { PageHeader } from '../components/ui'

export function Exams() {
  const { semester } = useActive()
  const rows = useLiveQuery(
    async () => (await db.exams.where('semesterId').equals(semester.id).toArray()).sort((a, b) => a.date.localeCompare(b.date)),
    [semester.id],
  )
  if (!rows) return null
  const full = rows.length >= MAX_EXAMS_PER_SEMESTER

  return (
    <>
      <PageHeader
        back
        title="Prüfungen"
        subtitle={semester.name}
        action={
          <Link className="btn small primary" to="/pruefung/neu" aria-disabled={full} onClick={(e) => full && e.preventDefault()}>
            Neue Prüfung
          </Link>
        }
      />
      {full && <div className="notice">Maximal {MAX_EXAMS_PER_SEMESTER} Prüfungen pro Semester.</div>}
      {rows.length === 0 && (
        <div className="card empty">
          <p className="muted">Noch keine Prüfungen in diesem Semester.</p>
        </div>
      )}
      {rows.map((e) => {
        const d = daysUntil(e.date)
        return (
          <Link key={e.id} to={`/pruefung/${e.id}`} className="card link" style={d < 0 ? { opacity: 0.6 } : undefined}>
            <div className="row between">
              <span className="row grow">
                <span className="dot" style={{ background: e.color }} />
                <b>{e.name}</b>
              </span>
              <span className="chip">{formatCountdown(d)}</span>
            </div>
            <small>{formatDate(e.date)}{e.ongoing ? ' · läuft noch' : ''}</small>
          </Link>
        )
      })}
    </>
  )
}
