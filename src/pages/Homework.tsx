import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useActive } from '../state'
import { db, type Exam, type Homework } from '../lib/db'
import { addDays, daysUntil, formatDate, isoDate } from '../lib/dates'
import { completeHomework, deleteHomework, imageToDataUrl, isDueSoon, keepAsTask, reopenHomework, saveHomework, sortOpen } from '../lib/homework'
import { deleteCourseHomework, getCourseConfig, shareHomework, syncCourse } from '../lib/course'
import { Rich } from '../components/Rich'
import { PageHeader } from '../components/ui'

/** „heute fällig“, „in 3 Tagen“, „2 Tage überfällig“ */
export function dueLabel(h: Homework, now = Date.now()) {
  const d = daysUntil(h.due, now)
  if (d < 0) return `${-d} ${d === -1 ? 'Tag' : 'Tage'} überfällig`
  if (d === 0) return 'heute fällig'
  if (d === 1) return 'morgen fällig'
  return `fällig in ${d} Tagen (${formatDate(h.due)})`
}

/** Kurzform fürs Widget: „heute“, „morgen“, „bis Mi.“, „bis 04.11.“, „2 Tage überfällig“ */
export function shortDue(h: Homework, now = Date.now()) {
  const d = daysUntil(h.due, now)
  if (d < 0) return `${-d} ${d === -1 ? 'Tag' : 'Tage'} überfällig`
  if (d === 0) return 'heute fällig'
  if (d === 1) return 'morgen fällig'
  const date = new Date(`${h.due}T12:00:00`)
  return `bis ${d < 7 ? date.toLocaleDateString('de-DE', { weekday: 'short' }) : date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}`
}

function useSemesterExams() {
  const { semester } = useActive()
  return useLiveQuery(() => db.exams.where('semesterId').equals(semester.id).sortBy('date'), [semester.id])
}

/** Übersicht aller Hausaufgaben: fällige, spätere (zum Vorziehen) und erledigte. */
export function HomeworkList() {
  const { profile, semester } = useActive()
  const [search] = useSearchParams()
  const examFilter = search.get('exam') ?? undefined
  const exams = useSemesterExams()
  // Kurs-Hausaufgaben beim Öffnen holen (erscheinen dann in der Liste).
  useEffect(() => {
    syncCourse(profile.id, semester.id, profile.name).catch(() => {})
  }, [profile.id, semester.id])
  const list = useLiveQuery(async () => {
    if (!exams) return undefined
    const all = (await Promise.all(exams.map((e) => db.homework.where('examId').equals(e.id).toArray()))).flat()
    return all.filter((h) => !examFilter || h.examId === examFilter)
  }, [exams, examFilter])
  if (!exams || !list) return null
  const examById = new Map(exams.map((e) => [e.id, e]))
  const open = sortOpen(list)
  const due = open.filter((h) => isDueSoon(h))
  const later = open.filter((h) => !isDueSoon(h))
  const done = list.filter((h) => h.doneAt).sort((a, b) => b.doneAt! - a.doneAt!).slice(0, 20)

  const section = (title: string, items: Homework[], hint?: string) =>
    items.length > 0 && (
      <>
        <div className="section-title">{title}</div>
        {hint && <p className="muted" style={{ fontSize: 14, margin: '-4px 0 8px' }}>{hint}</p>}
        <div className="list">
          {items.map((h) => (
            <Link key={h.id} className="list-item" to={`/hausaufgabe/${h.id}`}>
              <span className="dot" style={{ background: examById.get(h.examId)?.color }} />
              <span className="grow">
                <span className="truncate" style={{ display: 'block', fontWeight: 500 }}>
                  {h.title}
                  {h.fromCourse && <span className="chip accent" style={{ marginLeft: 6, fontSize: 11, padding: '1px 7px' }}>Kurs</span>}
                </span>
                <small className={!h.doneAt && daysUntil(h.due) < 0 ? 'badge-warn' : 'muted'}>
                  {examById.get(h.examId)?.name} · {h.doneAt ? `erledigt am ${new Date(h.doneAt).toLocaleDateString('de-DE')}` : `${dueLabel(h)} · ca. ${h.minutes} min`}
                </small>
              </span>
            </Link>
          ))}
        </div>
      </>
    )

  return (
    <>
      <PageHeader
        back
        title="Hausaufgaben"
        subtitle={examFilter ? examById.get(examFilter)?.name : undefined}
        action={<Link className="btn small" to={`/hausaufgabe/neu${examFilter ? `?exam=${examFilter}` : ''}`}>Neu</Link>}
      />
      <Link className="list-item card" to="/erinnerungen" style={{ marginBottom: 12 }}>
        <span className="grow">
          <span style={{ display: 'block', fontWeight: 500 }}>Erinnerungen</span>
          <small className="muted">Für alles ohne Abgabe – oder um eine Hausaufgabe früher anzugehen</small>
        </span>
        <span aria-hidden>›</span>
      </Link>
      {open.length === 0 && done.length === 0 && (
        <div className="card empty stack">
          <p className="muted">Noch keine Hausaufgaben. Hausaufgaben erscheinen kurz vor der Abgabe in der Schreibtisch-Sitzung und werden in dein Zeitbudget eingeplant.</p>
          <Link className="btn primary" to={`/hausaufgabe/neu${examFilter ? `?exam=${examFilter}` : ''}`}>Hausaufgabe hinzufügen</Link>
        </div>
      )}
      {section('Fällig', due, 'Kommen in der Schreibtisch-Sitzung von selbst vor den Karten dran.')}
      {section('Später', later, 'Noch nicht fällig – du kannst sie jederzeit vorziehen.')}
      {section('Erledigt', done)}
    </>
  )
}

/** Neue Hausaufgabe anlegen oder bearbeiten. */
export function HomeworkForm() {
  const { id } = useParams()
  const [search] = useSearchParams()
  const { profile, semester } = useActive()
  const navigate = useNavigate()
  const exams = useSemesterExams()
  const [existing, setExisting] = useState<Homework>()
  const [examId, setExamId] = useState(search.get('exam') ?? '')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [due, setDue] = useState(isoDate(addDays(Date.now(), 7)))
  const [minutes, setMinutes] = useState('30')
  const [image, setImage] = useState<string>()
  const [course, setCourse] = useState('')
  const [shareToCourse, setShareToCourse] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getCourseConfig(profile.id).then((c) => setCourse(c?.course ?? ''))
  }, [profile.id])

  useEffect(() => {
    if (!id) return
    db.homework.get(id).then((h) => {
      if (!h) return
      setExisting(h)
      setExamId(h.examId)
      setTitle(h.title)
      setDescription(h.description)
      setDue(h.due)
      setMinutes(String(h.minutes))
      setImage(h.image)
    })
  }, [id])
  useEffect(() => {
    if (!examId && exams?.length) setExamId(exams[0].id)
  }, [exams])

  async function submit(e: FormEvent) {
    e.preventDefault()
    const m = Number(minutes)
    if (!examId) return setError('Bitte wähle eine Prüfung.')
    if (!title.trim()) return setError('Bitte gib einen Titel ein.')
    if (!due) return setError('Bitte gib einen Abgabetermin ein.')
    if (!(m > 0 && m <= 600)) return setError('Die Dauer muss zwischen 1 und 600 Minuten liegen.')
    const saved = await saveHomework({ ...existing, profileId: profile.id, examId, title: title.trim(), description, due, minutes: Math.round(m), image })
    if (!id && shareToCourse && course) {
      const examName = exams?.find((x) => x.id === examId)?.name ?? ''
      try {
        await shareHomework(profile.id, { subject: examName, title: title.trim(), description, due, minutes: Math.round(m), image })
        await deleteHomework(saved) // wird als Kurs-Eintrag neu geholt
        await syncCourse(profile.id, semester.id, profile.name)
        return navigate('/hausaufgaben', { replace: true })
      } catch (err) {
        return setError('Mit dem Kurs teilen fehlgeschlagen: ' + (err as Error).message)
      }
    }
    navigate(`/hausaufgabe/${saved.id}`, { replace: true })
  }

  async function onImage(file?: File) {
    if (!file) return
    try {
      setImage(await imageToDataUrl(file))
    } catch {
      setError('Das Bild konnte nicht gelesen werden.')
    }
  }

  if (!exams) return null
  return (
    <form onSubmit={submit}>
      <PageHeader back title={id ? 'Hausaufgabe bearbeiten' : 'Neue Hausaufgabe'} />
      <div className="card">
        <label className="field">
          <span>Prüfung</span>
          <select value={examId} onChange={(e) => setExamId(e.target.value)}>
            {exams.map((x) => (
              <option key={x.id} value={x.id}>{x.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Titel</span>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z. B. Übungsblatt 3, Aufgabe 2" />
        </label>
        <label className="field">
          <span>Aufgabe</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Aufgabenstellung oder Hinweise (optional, Formeln mit $…$)" />
        </label>
        <label className="field">
          <span>Abgabe</span>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <label className="field">
          <span>Geschätzte Dauer (Minuten)</span>
          <input type="number" inputMode="numeric" min={1} max={600} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </label>
        <div className="field">
          <span className="field-label">Foto des Aufgabenblatts (optional)</span>
          {image && <img className="card-image" src={image} alt="Aufgabenblatt" style={{ marginBottom: 8 }} />}
          <div className="row">
            <label className="btn small grow">
              {image ? 'Anderes Foto' : 'Foto wählen'}
              <input type="file" accept="image/*" hidden onChange={(e) => onImage(e.target.files?.[0])} />
            </label>
            {image && <button type="button" className="btn small ghost danger" onClick={() => setImage(undefined)}>Entfernen</button>}
          </div>
        </div>
        {!id && course && (
          <label className="row" style={{ gap: 10, alignItems: 'flex-start', marginTop: 4 }}>
            <input type="checkbox" checked={shareToCourse} onChange={(e) => setShareToCourse(e.target.checked)} style={{ marginTop: 3 }} />
            <span style={{ fontSize: 15 }}>Für den ganzen Kurs <b>{course.toUpperCase()}</b> teilen (alle bekommen sie eingetragen)</span>
          </label>
        )}
        {error && <p className="badge-warn">{error}</p>}
        <button className="btn primary block" type="submit">Speichern</button>
      </div>
    </form>
  )
}

/**
 * Bearbeiten und Abhaken einer Hausaufgabe – auf der eigenen Seite und in der Schreibtisch-Sitzung.
 * Nach dem Abhaken wird gefragt, ob sie als Übungsaufgabe in die Wiederholung soll.
 */
export function HomeworkWork({ h, exam, onFinished, onSkip }: { h: Homework; exam?: Exam; onFinished?: () => void; onSkip?: () => void }) {
  const [step, setStep] = useState<'work' | 'solution' | 'keep'>(h.doneAt && !h.keptAt ? 'keep' : 'work')
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<string>()
  const [busy, setBusy] = useState(false)

  async function finish() {
    setBusy(true)
    try {
      await completeHomework(h, { text: note.trim(), image: photo })
      setStep('keep')
    } finally {
      setBusy(false)
    }
  }
  async function keep(yes: boolean) {
    setBusy(true)
    try {
      if (yes && exam) await keepAsTask({ ...h, solution: note.trim() || h.solution, solutionImage: photo ?? h.solutionImage }, exam)
      onFinished?.()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <article className="card flashcard">
        <div className="meta">
          {exam && <span className="chip"><span className="dot" style={{ background: exam.color }} />{exam.name}</span>}
          <span className="chip accent">Hausaufgabe</span>
          {h.fromCourse && <span className="chip accent">Kurs{h.courseAuthor ? ` · ${h.courseAuthor}` : ''}</span>}
          <span className={`chip${daysUntil(h.due) < 0 && !h.doneAt ? ' warn' : ''}`}>{h.doneAt ? 'erledigt' : dueLabel(h)}</span>
          <span className="chip">ca. {h.minutes} min</span>
        </div>
        <div className="content">
          <h2 style={{ margin: '0 0 8px' }}>{h.title}</h2>
          {h.description.trim() && <Rich text={h.description} />}
          {h.image && <img className="card-image" src={h.image} alt="Aufgabenblatt" />}
          {(h.courseSolution || h.courseSolutionImage) && (
            <>
              <hr />
              <b>Musterlösung{h.courseAuthor ? ` · ${h.courseAuthor}` : ''}</b>
              {h.courseSolution && <Rich text={h.courseSolution} />}
              {h.courseSolutionImage && <img className="card-image" src={h.courseSolutionImage} alt="Musterlösung" />}
            </>
          )}
          {(h.solution || h.solutionImage) && step !== 'solution' && (
            <>
              <hr />
              <b>Deine Lösung</b>
              {h.solution && <Rich text={h.solution} />}
              {h.solutionImage && <img className="card-image" src={h.solutionImage} alt="Deine Lösung" />}
            </>
          )}
        </div>
      </article>

      {step === 'solution' && (
        <div className="card stack">
          <b>Abhaken</b>
          <p className="muted" style={{ margin: 0, fontSize: 15 }}>Optional: Lösung notieren oder fotografieren – praktisch, wenn du die Aufgabe später als Übung wiederholst.</p>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ergebnis oder Notizen (optional)" style={{ minHeight: 90 }} />
          {photo && <img className="card-image" src={photo} alt="Deine Lösung" />}
          <label className="btn small">
            {photo ? 'Anderes Foto' : 'Foto der Lösung'}
            <input type="file" accept="image/*" hidden onChange={async (e) => e.target.files?.[0] && setPhoto(await imageToDataUrl(e.target.files[0]))} />
          </label>
          <div className="row">
            <button className="btn grow" onClick={() => setStep('work')}>Zurück</button>
            <button className="btn primary grow" onClick={finish} disabled={busy}>Erledigt</button>
          </div>
        </div>
      )}

      {step === 'keep' && (
        <div className="card stack">
          <b>Als Übungsaufgabe behalten?</b>
          <p className="muted" style={{ margin: 0, fontSize: 15 }}>Dann kommt sie zur Klausurvorbereitung wie eine Schreibtischaufgabe wieder dran – mit deiner Lösung zum Vergleich.</p>
          <div className="row">
            <button className="btn grow" onClick={() => keep(false)} disabled={busy}>Nein</button>
            <button className="btn primary grow" onClick={() => keep(true)} disabled={busy || !exam}>Ja, behalten</button>
          </div>
        </div>
      )}

      {step === 'work' && !h.doneAt && (
        <div className="actions">
          <div className="row">
            {onSkip && <button className="btn grow" onClick={onSkip}>Später</button>}
            <button className="btn primary grow" onClick={() => setStep('solution')}>Abhaken</button>
          </div>
        </div>
      )}
    </>
  )
}

/** Einzelne Hausaufgabe: bearbeiten, abhaken, wieder öffnen, löschen. */
export function HomeworkPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { profile, semester } = useActive()
  const [course, setCourse] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => {
    getCourseConfig(profile.id).then((c) => setCourse(c?.course ?? ''))
  }, [profile.id])
  const data = useLiveQuery(async () => {
    const h = await db.homework.get(id)
    return { h, exam: h ? await db.exams.get(h.examId) : undefined }
  }, [id])
  if (!data) return null
  const { h, exam } = data
  if (!h) {
    return (
      <div className="card empty">
        <p>Hausaufgabe nicht gefunden.</p>
        <Link to="/hausaufgaben">Zur Übersicht</Link>
      </div>
    )
  }

  async function shareToCourse() {
    if (!h || !exam) return
    setBusy(true)
    setMsg('')
    try {
      await shareHomework(profile.id, {
        subject: exam.name,
        title: h.title,
        description: h.description,
        due: h.due,
        minutes: h.minutes,
        image: h.image,
        solution: h.solution,
        solutionImage: h.solutionImage,
      })
      await deleteHomework(h) // wird als Kurs-Eintrag neu geholt
      await syncCourse(profile.id, semester.id, profile.name)
      navigate('/hausaufgaben', { replace: true })
    } catch (e) {
      setMsg('Teilen fehlgeschlagen: ' + (e as Error).message)
      setBusy(false)
    }
  }

  async function removeFromCourse() {
    if (!h?.courseHwId) return
    if (!confirm('Diese Hausaufgabe für den ganzen Kurs entfernen?')) return
    setBusy(true)
    setMsg('')
    try {
      await deleteCourseHomework(profile.id, h.courseHwId)
      await syncCourse(profile.id, semester.id, profile.name)
      navigate('/hausaufgaben', { replace: true })
    } catch (e) {
      setMsg((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader back title="Hausaufgabe" action={!h.fromCourse ? <Link className="btn small" to={`/hausaufgabe/${h.id}/bearbeiten`}>Bearbeiten</Link> : undefined} />
      <HomeworkWork key={`${h.id}:${h.doneAt ?? 0}`} h={h} exam={exam} onFinished={() => navigate('/hausaufgaben')} />
      {!h.doneAt && (
        <Link className="btn block" style={{ marginTop: 12 }} to={`/erinnerung/neu?hausaufgabe=${h.id}`}>
          Erinnerung zum Bearbeiten setzen
        </Link>
      )}
      {h.doneAt && (
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn grow" onClick={() => reopenHomework(h)}>Wieder öffnen</button>
          {h.keptAt && <span className="muted grow" style={{ alignSelf: 'center', fontSize: 14 }}>Als Übungsaufgabe übernommen</span>}
        </div>
      )}
      {msg && <p className="badge-warn" style={{ marginTop: 12 }}>{msg}</p>}
      {!h.fromCourse && course && (
        <button className="btn block" style={{ marginTop: 12 }} disabled={busy} onClick={shareToCourse}>
          Für den Kurs {course.toUpperCase()} teilen
        </button>
      )}
      {h.fromCourse ? (
        <button className="btn block ghost danger" style={{ marginTop: 12 }} disabled={busy} onClick={removeFromCourse}>
          Aus dem Kurs entfernen
        </button>
      ) : (
        <button
          className="btn block ghost danger"
          style={{ marginTop: 12 }}
          onClick={async () => {
            if (!confirm('Hausaufgabe löschen? Eine bereits übernommene Übungsaufgabe bleibt erhalten.')) return
            await deleteHomework(h)
            navigate('/hausaufgaben', { replace: true })
          }}
        >
          Löschen
        </button>
      )}
    </>
  )
}
