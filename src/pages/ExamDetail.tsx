import { Link, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { daysUntil, formatCountdown, formatDate } from '../lib/dates'
import { PageHeader } from '../components/ui'
import { sortOpen } from '../lib/homework'
import { dueLabel } from './Homework'

export function ExamDetail() {
  const { id = '' } = useParams()
  const data = useLiveQuery(async () => {
    const exam = await db.exams.get(id)
    if (!exam) return { exam: undefined }
    const homework = await db.homework.where('examId').equals(id).toArray()
    return { exam, homework: sortOpen(homework) }
  }, [id])

  if (!data) return null
  const { exam } = data
  if (!exam) {
    return (
      <div className="card empty">
        <p>Prüfung nicht gefunden.</p>
        <Link to="/pruefungen">Zur Übersicht</Link>
      </div>
    )
  }
  const { homework } = data
  const days = daysUntil(exam.date)

  return (
    <>
      <PageHeader
        back
        action={<Link className="btn small" to={`/pruefung/${exam.id}/bearbeiten`}>Bearbeiten</Link>}
        eyebrow={
          <span className="row" style={{ gap: 6 }}>
            <span className="dot" style={{ background: exam.color, width: 8, height: 8 }} />
            Klausur {formatCountdown(days)}
          </span>
        }
        title={exam.name}
        subtitle={formatDate(exam.date)}
      />

      <div className="section-title">Hausaufgaben</div>
      <div className="list">
        {homework.length === 0 && <p className="muted" style={{ padding: '4px 0' }}>Keine offenen Hausaufgaben für dieses Fach.</p>}
        {homework.slice(0, 5).map((h) => (
          <Link key={h.id} className="list-item" to={`/hausaufgabe/${h.id}`}>
            <span className="grow">
              <span className="truncate" style={{ display: 'block', fontWeight: 500 }}>{h.title}</span>
              <small className="muted">{dueLabel(h)} · ca. {h.minutes} min</small>
            </span>
          </Link>
        ))}
        {homework.length > 5 && (
          <Link className="list-item" to={`/hausaufgaben?exam=${exam.id}`}>
            <span className="grow">Alle {homework.length} offenen Hausaufgaben</span>
          </Link>
        )}
        <Link className="list-item" to={`/hausaufgabe/neu?exam=${exam.id}`}>
          <span className="grow" style={{ color: 'var(--accent)' }}>Hausaufgabe hinzufügen</span>
        </Link>
      </div>
    </>
  )
}
