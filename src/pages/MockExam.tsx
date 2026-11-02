import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useActive } from '../state'
import { cardMode, db, type StudyCard } from '../lib/db'
import { composeMockExam, itemMinutes, scoreMockExam, type Grade } from '../lib/mockExam'
import { checkAnswer, formatAnswer } from '../lib/answers'
import { recordReview } from '../lib/study'
import { Rating } from '../lib/scheduler'
import { MatchQuestion, matchScore } from '../components/MatchQuestion'
import { Rich } from '../components/Rich'
import { Icon, PageHeader, Progress } from '../components/ui'

const DURATIONS = [30, 60, 90, 120]
const GRADE_RATING = { richtig: Rating.Good, teilweise: Rating.Hard, falsch: Rating.Again } as const

type Phase = 'setup' | 'running' | 'review' | 'done'

/** Laufende Probeklausur – wird gespeichert, damit sie einen App-Wechsel oder Neustart übersteht. */
interface SavedMockExam {
  phase: 'running' | 'review'
  minutes: number
  itemIds: string[]
  index: number
  selected: Record<string, number[]>
  inputs: Record<string, string[]>
  grades: Record<string, Grade | undefined>
  adopt: boolean
  endsAt: number
  startedAt: number
}

const savedKey = (examId: string) => `mockexam:${examId}`

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function MockExam() {
  const { id = '' } = useParams()
  const { profile } = useActive()
  const navigate = useNavigate()
  const data = useLiveQuery(async () => ({
    exam: await db.exams.get(id),
    cards: await db.cards.where('[examId+archived]').equals([id, 0]).toArray(),
  }), [id])

  const [phase, setPhase] = useState<Phase>('setup')
  const [minutes, setMinutes] = useState(60)
  const [items, setItems] = useState<StudyCard[]>([])
  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState<Record<string, number[]>>({})
  const [inputs, setInputs] = useState<Record<string, string[]>>({})
  const [grades, setGrades] = useState<Record<string, Grade | undefined>>({})
  const [adopt, setAdopt] = useState(true)
  const [endsAt, setEndsAt] = useState(0)
  const [now, setNow] = useState(Date.now())
  const startedAt = useRef(0)
  const [resumed, setResumed] = useState(false)
  const restored = useRef(false)

  // Gespeicherte Probeklausur fortsetzen (z. B. nachdem iOS die App im Hintergrund beendet hat).
  useEffect(() => {
    if (!data || restored.current) return
    restored.current = true
    db.meta.get(savedKey(id)).then((m) => {
      const saved = m?.value as SavedMockExam | undefined
      if (!saved) return
      const byId = new Map(data.cards.map((c) => [c.id, c]))
      const list = saved.itemIds.map((cid) => byId.get(cid)).filter((c): c is StudyCard => !!c)
      if (!list.length) return
      setItems(list)
      setMinutes(saved.minutes)
      setIndex(Math.min(saved.index, list.length))
      setSelected(saved.selected)
      setInputs(saved.inputs)
      setGrades(saved.grades)
      setAdopt(saved.adopt)
      setEndsAt(saved.endsAt)
      startedAt.current = saved.startedAt
      setNow(Date.now())
      setPhase(saved.phase)
      setResumed(true)
    })
  }, [data, id])

  useEffect(() => {
    if (phase === 'running' || phase === 'review') {
      const value: SavedMockExam = { phase, minutes, itemIds: items.map((c) => c.id), index, selected, inputs, grades, adopt, endsAt, startedAt: startedAt.current }
      db.meta.put({ key: savedKey(id), value })
    } else if (phase === 'done') db.meta.delete(savedKey(id))
  }, [id, phase, minutes, items, index, selected, inputs, grades, adopt, endsAt])

  const preview = useMemo(() => (data ? composeMockExam(data.cards, minutes) : []), [data, minutes])

  // Uhr; bei Ablauf automatisch abgeben
  useEffect(() => {
    if (phase !== 'running') return
    const t = setInterval(() => {
      setNow(Date.now())
      if (Date.now() >= endsAt) submit()
    }, 1000)
    return () => clearInterval(t)
  })

  if (!data) return null
  const { exam } = data
  if (!exam) return <Link to="/pruefungen">Prüfung nicht gefunden</Link>

  function start() {
    setItems(preview)
    setIndex(0)
    startedAt.current = Date.now()
    setEndsAt(Date.now() + minutes * 60_000)
    setNow(Date.now())
    setPhase('running')
  }

  /** Abgabe: Multiple Choice und Zahlenergebnisse werden automatisch bewertet. */
  function submit() {
    const auto: Record<string, Grade | undefined> = {}
    for (const c of items) {
      if (c.type === 'match' && c.pairs) {
        const right = matchScore(selected[c.id] ?? [], c.pairs.length)
        auto[c.id] = right === c.pairs.length ? 'richtig' : right > 0 ? 'teilweise' : 'falsch'
      } else if (c.type === 'mc') {
        const sel = selected[c.id] ?? []
        const right = c.correct ?? []
        auto[c.id] = sel.length === right.length && sel.every((x) => right.includes(x)) ? 'richtig' : 'falsch'
      } else if (c.answers?.length && (inputs[c.id] ?? []).some((x) => x?.trim())) {
        const ok = c.answers.map((a, i) => checkAnswer(inputs[c.id]?.[i] ?? '', a))
        auto[c.id] = ok.every(Boolean) ? 'richtig' : ok.some(Boolean) ? 'teilweise' : 'falsch'
      }
    }
    setGrades(auto)
    setIndex(0)
    setPhase('review')
  }

  async function discard() {
    if (!confirm('Probeklausur verwerfen? Deine Eingaben gehen verloren.')) return
    await db.meta.delete(savedKey(id))
    setResumed(false)
    setPhase('setup')
  }

  async function finish() {
    if (adopt) {
      const t = Date.now()
      const per = Math.round((t - startedAt.current) / Math.max(1, items.length))
      for (const c of items) {
        const fresh = (await db.cards.get(c.id)) ?? c
        await recordReview(profile, exam, fresh, GRADE_RATING[grades[c.id] ?? 'falsch'], cardMode(c), per, t)
      }
    }
    setPhase('done')
  }

  if (phase === 'setup') {
    const tasks = preview.filter((c) => cardMode(c) === 'desk').length
    return (
      <>
        <PageHeader back eyebrow={exam.name} title="Probeklausur" subtitle="Unter Zeitdruck über alle Kapitel – wie in der echten Klausur." />
        <div className="card stack">
          <span className="field-label">Dauer</span>
          <div className="segmented" role="radiogroup" aria-label="Dauer">
            {DURATIONS.map((d) => (
              <button key={d} type="button" role="radio" aria-checked={minutes === d} className={minutes === d ? 'on' : ''} onClick={() => setMinutes(d)}>
                {d} min
              </button>
            ))}
          </div>
          <p className="muted" style={{ margin: 0 }}>
            {preview.length
              ? `${tasks ? `${tasks} Rechenaufgaben und ` : ''}${preview.length - tasks} Fragen aus ${new Set(preview.map((c) => c.chapter)).size} Kapiteln, klausurrelevante Themen bevorzugt.`
              : 'Für diese Prüfung gibt es noch keine Karten.'}
          </p>
          <ul className="help muted" style={{ margin: 0, fontSize: 15 }}>
            <li>Rechenaufgaben auf Papier lösen und das Ergebnis eintragen.</li>
            <li>Bei Verständnisfragen die Antwort auf Papier oder im Kopf formulieren.</li>
            <li>Nach der Abgabe vergleichst du mit den Lösungen und bewertest dich.</li>
          </ul>
          <button className="btn primary block" disabled={!preview.length} onClick={start}>Probeklausur starten</button>
        </div>
      </>
    )
  }

  const c = items[index]
  const left = endsAt - now

  const nav = (
    <div className="row" style={{ marginTop: 14 }}>
      <button className="btn grow" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>Zurück</button>
      {index < items.length - 1 ? (
        <button className="btn primary grow" onClick={() => setIndex((i) => i + 1)}>Weiter</button>
      ) : (
        <button className="btn primary grow" onClick={() => confirm('Probeklausur abgeben?') && submit()}>Abgeben</button>
      )}
    </div>
  )

  if (phase === 'done' || (phase === 'review' && index >= items.length)) {
    const r = scoreMockExam(items, grades)
    return (
      <>
        <PageHeader eyebrow={exam.name} title="Auswertung" subtitle={`${Math.round(r.share * 100)} % der Punkte`} />
        <div className="card stack">
          <Progress value={r.share} color={exam.color} />
          {r.chapters.map((ch) => (
            <div className="chapter-row" key={ch.title}>
              <span>{ch.title}</span>
              <small className={ch.points / ch.max < 0.5 ? 'badge-warn' : ''}>{Math.round((ch.points / ch.max) * 100)} %</small>
              <Progress value={ch.points / ch.max} color={ch.points / ch.max < 0.5 ? 'var(--warn)' : exam.color} />
            </div>
          ))}
          <small>Punkte gewichtet nach Bearbeitungszeit. Kapitel unter 50 % sind orange markiert – dort lohnt sich gezieltes Üben.</small>
        </div>
        {phase === 'review' ? (
          <div className="card stack">
            <label className="row" style={{ gap: 10 }}>
              <input type="checkbox" checked={adopt} onChange={(e) => setAdopt(e.target.checked)} style={{ width: 20, height: 20 }} />
              <span>Ergebnisse in den Lernplan übernehmen (falsche Aufgaben kommen bald wieder dran)</span>
            </label>
            <button className="btn primary block" onClick={finish}>Abschließen</button>
          </div>
        ) : (
          <button className="btn primary block" onClick={() => navigate(`/pruefung/${exam.id}`)}>Zur Prüfung</button>
        )}
      </>
    )
  }

  const answers = c.answers ?? []
  const sel = selected[c.id] ?? []
  const multi = (c.correct?.length ?? 0) > 1
  const reviewing = phase === 'review'
  const grade = grades[c.id]

  return (
    <>
      <div className="session-top">
        {phase === 'running' ? (
          <span className={`chip${left < 5 * 60_000 ? '' : ' accent'}`} style={left < 5 * 60_000 ? { color: 'var(--warn)' } : undefined}>
            <Icon name="clock" size={16} /> {clock(left)}
          </span>
        ) : (
          <span className="chip accent">Auswertung</span>
        )}
        <Progress value={(index + 1) / items.length} />
        <small style={{ whiteSpace: 'nowrap' }}>
          {index + 1}/{items.length}
        </small>
      </div>

      {resumed && (
        <div className="notice">
          Probeklausur fortgesetzt{phase === 'running' ? ' – die Zeit ist weitergelaufen' : ''}.{' '}
          <button className="btn small ghost" style={{ color: 'var(--accent)', padding: 0, minHeight: 0 }} onClick={discard}>Verwerfen</button>
        </div>
      )}

      <article className="card flashcard">
        <div className="meta">
          {c.chapterTitle && <span className="chip wrap">{c.chapterTitle}</span>}
          <span className="chip">{itemMinutes(c)} min</span>
        </div>
        <Rich text={c.front} cloze={c.type === 'cloze' ? (reviewing ? 'back' : 'front') : 'none'} />
        {c.image && <img className="card-image" src={c.image} alt="" style={{ marginTop: 12 }} />}

        {c.type === 'mc' && c.options && (
          <div className="options">
            {multi && !reviewing && <small>Mehrere Antworten möglich</small>}
            {c.options.map((o, i) => {
              const isSel = sel.includes(i)
              const cls = reviewing ? (c.correct?.includes(i) ? 'correct' : isSel ? 'wrong' : '') : isSel ? 'selected' : ''
              return (
                <button
                  key={i}
                  className={`option ${cls}`}
                  disabled={reviewing}
                  onClick={() => setSelected((s) => ({ ...s, [c.id]: multi ? (isSel ? sel.filter((x) => x !== i) : [...sel, i]) : [i] }))}
                >
                  <Rich text={o} />
                </button>
              )
            })}
          </div>
        )}

        {c.type === 'match' && c.pairs && (
          <MatchQuestion pairs={c.pairs} value={sel} onChange={(v) => setSelected((s) => ({ ...s, [c.id]: v }))} revealed={reviewing} seed={c.id} />
        )}

        {answers.length > 0 && (
          <div className="steps">
            <div className="step">
              <b>Dein Ergebnis</b>
              <div className="stack" style={{ marginTop: 6 }}>
                {answers.map((a, i) => (
                  <div className="row" key={i}>
                    {a.label && <span style={{ minWidth: 28 }}><Rich text={a.label.includes('$') ? a.label : `$${a.label}$`} /></span>}
                    <input
                      type="text"
                      inputMode={a.text ? 'text' : 'decimal'}
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      className="grow"
                      value={inputs[c.id]?.[i] ?? ''}
                      disabled={reviewing}
                      placeholder={a.text ? 'Antwort' : 'Zahl'}
                      onChange={(e) => setInputs((x) => ({ ...x, [c.id]: Object.assign([...(x[c.id] ?? [])], { [i]: e.target.value }) }))}
                      style={{ minHeight: 40, padding: '6px 10px' }}
                    />
                    {a.unit && <span className="muted">{a.unit}</span>}
                    {reviewing && (
                      <span className={checkAnswer(inputs[c.id]?.[i] ?? '', a) ? 'badge-good' : 'badge-warn'} style={{ whiteSpace: 'nowrap' }}>
                        {checkAnswer(inputs[c.id]?.[i] ?? '', a) ? '✓' : `✗ ${formatAnswer(a)}`}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {reviewing && (
          <>
            {c.type === 'task' && (
              <div className="steps">
                {(c.steps ?? []).map((s, i) => (
                  <div className="step" key={i}>
                    <b>Schritt {i + 1}</b>
                    <Rich text={s} />
                  </div>
                ))}
                {c.result && (
                  <div className="step result">
                    <b>Ergebnis</b>
                    <Rich text={c.result} />
                  </div>
                )}
              </div>
            )}
            {c.back.trim() && (
              <>
                <hr />
                <Rich text={c.back} />
              </>
            )}
            <div className="segmented" role="radiogroup" aria-label="Selbstbewertung" style={{ marginTop: 16 }}>
              {(['richtig', 'teilweise', 'falsch'] as Grade[]).map((g) => (
                <button key={g} type="button" role="radio" aria-checked={grade === g} className={grade === g ? 'on' : ''} onClick={() => setGrades((x) => ({ ...x, [c.id]: g }))}>
                  {g === 'richtig' ? 'Richtig' : g === 'teilweise' ? 'Teilweise' : 'Falsch'}
                </button>
              ))}
            </div>
          </>
        )}
      </article>

      {phase === 'running' ? (
        nav
      ) : (
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn grow" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>Zurück</button>
          <button className="btn primary grow" disabled={!grade} onClick={() => setIndex((i) => i + 1)}>
            {index < items.length - 1 ? 'Weiter' : 'Zur Auswertung'}
          </button>
        </div>
      )}
      {phase === 'running' && (
        <button className="btn ghost block" style={{ marginTop: 8 }} onClick={() => confirm('Probeklausur jetzt abgeben?') && submit()}>
          Vorzeitig abgeben
        </button>
      )}
    </>
  )
}
