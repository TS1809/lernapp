import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useActive } from '../state'
import { db, deleteExam, EXAM_COLORS, MAX_EXAMS_PER_SEMESTER, uid } from '../lib/db'
import { addDays, isoDate } from '../lib/dates'
import { PageHeader } from '../components/ui'

export function ExamForm() {
  const { id } = useParams()
  const { profile, semester } = useActive()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [date, setDate] = useState(isoDate(addDays(Date.now(), 60)))
  const [color, setColor] = useState(EXAM_COLORS[0])
  const [error, setError] = useState('')

  useEffect(() => {
    if (id) {
      db.exams.get(id).then((e) => {
        if (!e) return
        setName(e.name)
        setDate(e.date)
        setColor(e.color)
      })
    } else {
      db.exams.where('semesterId').equals(semester.id).toArray().then((list) => {
        const used = new Set(list.map((e) => e.color))
        setColor(EXAM_COLORS.find((c) => !used.has(c)) ?? EXAM_COLORS[list.length % EXAM_COLORS.length])
      })
    }
  }, [id, semester.id])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError('Bitte gib einen Namen ein.')
    if (!date) return setError('Bitte wähle einen Termin.')
    if (id) {
      await db.exams.update(id, { name: name.trim(), date, color })
      navigate(`/pruefung/${id}`, { replace: true })
    } else {
      const count = await db.exams.where('semesterId').equals(semester.id).count()
      if (count >= MAX_EXAMS_PER_SEMESTER) return setError(`Maximal ${MAX_EXAMS_PER_SEMESTER} Prüfungen pro Semester.`)
      const newId = uid()
      await db.exams.add({ id: newId, profileId: profile.id, semesterId: semester.id, name: name.trim(), date, weight: 2, color, createdAt: Date.now() })
      navigate(`/pruefung/${newId}`, { replace: true })
    }
  }

  async function remove() {
    if (!id || !confirm('Prüfung löschen?')) return
    await deleteExam(id)
    navigate('/pruefungen', { replace: true })
  }

  return (
    <form onSubmit={submit}>
      <PageHeader back title={id ? 'Prüfung bearbeiten' : 'Neue Prüfung'} />
      <div className="card">
        <label className="field">
          <span>Name</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Thermodynamik II" />
        </label>
        <label className="field">
          <span>Klausurtermin</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <div className="field">
          <span className="field-label">Farbe</span>
          <div className="row wrap">
            {EXAM_COLORS.map((c) => (
              <button
                type="button"
                key={c}
                onClick={() => setColor(c)}
                aria-label={`Farbe ${c}`}
                style={{ width: 32, height: 32, borderRadius: '50%', background: c, border: color === c ? '3px solid var(--text)' : '3px solid transparent', cursor: 'pointer' }}
              />
            ))}
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        <button className="btn primary block" type="submit">Speichern</button>
      </div>
      {id && (
        <button type="button" className="btn danger block" onClick={remove}>Prüfung löschen</button>
      )}
    </form>
  )
}
