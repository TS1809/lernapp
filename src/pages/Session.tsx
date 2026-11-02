import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useActive } from '../state'
import { db, type Exam, type Homework, type Mode, type ReportCategory, type StudyCard } from '../lib/db'
import { isDueSoon } from '../lib/homework'
import { HomeworkWork } from './Homework'
import { buildQueue, subjectsToday } from '../lib/planner'
import { loadStudyData, planCards, recordReview, undoReview, type Undo } from '../lib/study'
import type { TaskRecommendation } from '../lib/tasks'
import { previewIntervals, Rating, type Grade } from '../lib/scheduler'
import { formatInterval } from '../lib/dates'
import { reportCard } from '../lib/reports'
import { ReportForm } from '../components/ReportForm'
import { deleteCard } from '../lib/cards'
import { skipToday } from '../lib/skip'
import { checkAnswer, formatAnswer } from '../lib/answers'
import { SlideViewer } from '../components/SlideViewer'
import { MatchQuestion, matchScore } from '../components/MatchQuestion'
import { Rich } from '../components/Rich'
import { Icon, Progress } from '../components/ui'
import { Hints, KeyPoints } from '../components/Socratic'
import { suggestRating } from '../lib/socratic'

/** Karten, die innerhalb dieser Zeit wieder fällig sind, kommen noch in derselben Sitzung dran. */
const REQUEUE_WITHIN = 30 * 60_000

const RATINGS: { r: Grade; label: string; key: string }[] = [
  { r: Rating.Again, label: 'Nochmal', key: '1' },
  { r: Rating.Hard, label: 'Schwer', key: '2' },
  { r: Rating.Good, label: 'Gut', key: '3' },
  { r: Rating.Easy, label: 'Einfach', key: '4' },
]

export function Session() {
  const { profile } = useActive()
  const params = useParams()
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const mode: Mode = params.mode === 'desk' ? 'desk' : 'mobile'
  const examFilter = search.get('exam') ?? undefined
  const extra = Number(search.get('extra') ?? 0) || 0

  const [queue, setQueue] = useState<StudyCard[] | null>(null)
  /** Am Schreibtisch: fällige Hausaufgaben vor den Karten; `later` = offene, noch nicht fällige zum Vorziehen */
  const [homework, setHomework] = useState<Homework[]>([])
  const [laterHomework, setLaterHomework] = useState(0)
  const [exams, setExams] = useState<Map<string, Exam>>(new Map())
  const [reviewed, setReviewed] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [selected, setSelected] = useState<number[]>([])
  const [matchSel, setMatchSel] = useState<number[]>([])
  const [stepsShown, setStepsShown] = useState(0)
  /** Sokratisches Lernen: aufgedeckte Leitfragen und abgehakte Kernpunkte der aktuellen Karte. */
  const [hintsShown, setHintsShown] = useState(0)
  const [pointsChecked, setPointsChecked] = useState<number[] | null>(null)
  const [undo, setUndo] = useState<Undo | null>(null)
  const [busy, setBusy] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [reported, setReported] = useState<Set<string>>(new Set())
  const [answerInputs, setAnswerInputs] = useState<string[]>([])
  const [showSlide, setShowSlide] = useState(false)
  const [recommendations, setRecommendations] = useState<Map<string, TaskRecommendation>>(new Map())
  const started = useRef(Date.now())
  const sessionStart = useRef(Date.now())

  useEffect(() => {
    let cancelled = false
    loadStudyData(profile).then((d) => {
      if (cancelled) return
      const byId = new Map(d.cards.map((c) => [c.id, c]))
      const order = buildQueue(d.plan, planCards(d), { mode, now: Date.now(), examId: examFilter, extraNew: extra })
      setRecommendations(d.recommendations)
      setExams(new Map(d.exams.map((e) => [e.id, e])))
      setQueue(order.map((p) => byId.get(p.id)!))
      if (mode === 'desk') {
        const own = d.homework.filter((h) => !examFilter || h.examId === examFilter)
        setHomework(own.filter((h) => isDueSoon(h)))
        setLaterHomework(own.filter((h) => !isDueSoon(h)).length)
      }
      started.current = Date.now()
    })
    return () => {
      cancelled = true
    }
    // Die Sitzung wird einmal beim Öffnen zusammengestellt und danach nicht neu geladen.
  }, [])

  const card = queue?.[0]
  const exam = card ? exams.get(card.examId) : undefined

  const resetCardUi = () => {
    setReporting(false)
    setAnswerInputs([])
    setRevealed(false)
    setSelected([])
    setMatchSel([])
    setStepsShown(0)
    setHintsShown(0)
    setPointsChecked(null)
    started.current = Date.now()
  }

  const intervals = useMemo(
    () => (card && revealed ? previewIntervals(card.s, Date.now(), profile.retention, exam?.date, card.id) : null),
    [card, revealed, profile.retention, exam?.date],
  )

  const mcCorrect = card?.type === 'mc' && revealed ? sameSet(selected, card.correct ?? []) : null
  const matchCount = card?.type === 'match' ? card.pairs?.length ?? 0 : 0
  const matchRight = matchCount ? matchScore(matchSel, matchCount) : 0
  const matchComplete = matchCount > 0 && Array.from({ length: matchCount }, (_, i) => (matchSel[i] ?? -1) >= 0).every(Boolean)
  const answers = card?.answers ?? []
  const answerResults = answers.map((a, i) => checkAnswer(answerInputs[i] ?? '', a))
  const answersTried = answerInputs.some((x) => x?.trim())

  const rate = useCallback(
    async (r: Grade) => {
      if (!card || !queue || busy) return
      setBusy(true)
      try {
        const now = Date.now()
        const { updated, undo: u } = await recordReview(profile, exam, card, r, mode, now - started.current, now)
        const rest = queue.slice(1)
        if (updated.s.due - now < REQUEUE_WITHIN) rest.splice(Math.min(rest.length, 4), 0, updated)
        setQueue(rest)
        setUndo(u)
        setReviewed((n) => n + 1)
        resetCardUi()
      } finally {
        setBusy(false)
      }
    },
    [card, queue, busy, profile, exam, mode],
  )

  async function undoLast() {
    if (!undo || !queue || busy) return
    setBusy(true)
    try {
      await undoReview(undo)
      const restored = (await db.cards.get(undo.card.id)) ?? undo.card
      setQueue([restored, ...queue.filter((c) => c.id !== restored.id)])
      setReviewed((n) => Math.max(0, n - 1))
      setUndo(null)
      resetCardUi()
    } finally {
      setBusy(false)
    }
  }

  async function submitReport(category: ReportCategory, note: string) {
    if (!card) return
    await reportCard(card, category, note)
    setReported((s) => new Set(s).add(card.id))
    setReporting(false)
  }

  /**
   * Karte ohne Bewertung aus der Sitzung nehmen. Gemeldete Karten sind ohnehin bis zur Korrektur pausiert,
   * andere ruhen bis zum nächsten Lerntag; ihr Lernstand bleibt unverändert.
   */
  function skipCard() {
    if (!card || !queue || busy) return
    if (!reported.has(card.id)) skipToday(card.id)
    setQueue(queue.filter((c) => c.id !== card.id))
    resetCardUi()
  }

  async function removeCard() {
    if (!card || !queue || busy) return
    if (!confirm('Karte löschen? Sie wird nicht mehr abgefragt – auch nicht nach einem Paket-Update. Wiederherstellen kannst du sie auf der Seite der Prüfung.')) return
    setBusy(true)
    try {
      await deleteCard(card)
      setQueue(queue.filter((c) => c.id !== card.id))
      // Eine rückgängig gemachte Bewertung würde die gelöschte Karte wieder in die Sitzung holen.
      if (undo?.card.id === card.id) setUndo(null)
      resetCardUi()
    } finally {
      setBusy(false)
    }
  }

  const reveal = () => {
    if (!card || (card.type === 'match' && !matchComplete)) return
    if (card.type === 'task') setStepsShown(card.steps?.length ?? 0)
    setRevealed(true)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (!card || reporting || showSlide || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault()
        reveal()
      } else if (revealed) {
        const hit = RATINGS.find((x) => x.key === e.key)
        if (hit) rate(hit.r)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!queue) return null

  const total = reviewed + queue.length
  const top = (
    <div className="session-top">
      <button className="btn ghost small" onClick={() => navigate('/')} aria-label="Sitzung beenden">
        <Icon name="close" />
      </button>
      <Progress value={total ? reviewed / total : 1} />
      <small className="session-count" aria-label={`${reviewed} von ${total} erledigt`}>{reviewed}/{total}</small>
      {card && (
        <button className="btn ghost small" onClick={() => setReporting((r) => !r)} aria-label="Karte melden" aria-pressed={reporting}>
          <Icon name="flag" />
        </button>
      )}
      {card && (
        <button className="btn ghost small" onClick={skipCard} disabled={busy} aria-label="Karte für heute auslassen" title="Überspringen – die Karte kommt erst morgen wieder">
          <Icon name="skip" />
        </button>
      )}
      {card && (
        <button className="btn ghost small" onClick={removeCard} disabled={busy} aria-label="Karte löschen">
          <Icon name="trash" />
        </button>
      )}
      <button className="btn ghost small" onClick={undoLast} disabled={!undo || busy} aria-label="Letzte Bewertung rückgängig">
        <Icon name="undo" />
      </button>
    </div>
  )

  const hw = homework[0]
  if (hw) {
    const next = () => setHomework((list) => list.slice(1))
    return (
      <>
        {top}
        <HomeworkWork key={hw.id} h={hw} exam={exams.get(hw.examId)} onFinished={next} onSkip={next} />
      </>
    )
  }

  const moreHomework = laterHomework > 0 && (
    <Link className="btn block" to={`/hausaufgaben${examFilter ? `?exam=${examFilter}` : ''}`}>
      Hausaufgabe vorziehen ({laterHomework})
    </Link>
  )

  if (!card) {
    const minutes = Math.max(1, Math.round((Date.now() - sessionStart.current) / 60000))
    return (
      <>
        {top}
        <div className="card empty stack">
          <h2>{reviewed ? 'Geschafft!' : 'Nichts fällig'}</h2>
          <p className="muted">
            {reviewed
              ? `${reviewed} ${reviewed === 1 ? 'Karte' : 'Karten'} in ca. ${minutes} min gelernt.`
              : 'Für diesen Modus ist gerade nichts geplant.'}
          </p>
          {examFilter && <NextSubject current={examFilter} mode={mode} />}
          {moreHomework}
          <Link className={`btn block${examFilter ? '' : ' primary'}`} to="/">Zur Übersicht</Link>
        </div>
      </>
    )
  }

  const isNew = card.s.state === 0
  const steps = card.steps ?? []
  // Sokratisches Lernen nur mit eingeschaltetem Test-Schalter – sonst läuft die Sitzung wie bisher.
  const prompts = profile.socratic ? card.prompts ?? [] : []
  const keyPoints = profile.socratic ? card.keyPoints ?? [] : []
  const suggestion =
    revealed && (pointsChecked !== null || (keyPoints.length === 0 && hintsShown > 0))
      ? suggestRating({ checked: pointsChecked?.length ?? 0, total: keyPoints.length, hints: hintsShown })
      : undefined

  return (
    <>
      {top}
      <article className="card flashcard">
        <div className="meta">
          {exam && (
            <span className="chip">
              <span className="dot" style={{ background: exam.color }} />
              {exam.name}
            </span>
          )}
          {card.chapterTitle && <span className="chip wrap">{card.chapterTitle}</span>}
          {isNew && <span className="chip accent">neu</span>}
          {reported.has(card.id) && <span className="chip" style={{ color: 'var(--warn)' }}>gemeldet</span>}
        </div>
        {isNew && mode === 'desk' && !!recommendations.get(card.id)?.reasons.length && (
          <p className="recommend-reason">Empfohlen: {recommendations.get(card.id)!.reasons.join(' · ')}</p>
        )}

        <Rich text={card.front} cloze={card.type === 'cloze' ? (revealed ? 'back' : 'front') : 'none'} />
        {card.image && <img className="card-image" src={card.image} alt="" style={{ marginTop: 12 }} />}
        {prompts.length > 0 && <Hints prompts={prompts} shown={hintsShown} />}

        {card.type === 'mc' && card.options && (
          <div className="options">
            {(card.correct?.length ?? 0) > 1 && !revealed && <small>Mehrere Antworten möglich</small>}
            {card.options.map((o, i) => {
              const isSel = selected.includes(i)
              const isRight = card.correct?.includes(i)
              const cls = revealed ? (isRight ? 'correct' : isSel ? 'wrong' : '') : isSel ? 'selected' : ''
              return (
                <button
                  key={i}
                  className={`option ${cls}`}
                  disabled={revealed}
                  onClick={() =>
                    setSelected((s) =>
                      (card.correct?.length ?? 0) > 1 ? (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]) : [i],
                    )
                  }
                >
                  <Rich text={o} />
                </button>
              )
            })}
          </div>
        )}

        {card.type === 'match' && card.pairs && (
          <MatchQuestion pairs={card.pairs} value={matchSel} onChange={setMatchSel} revealed={revealed} seed={card.id} />
        )}

        {card.type === 'task' && stepsShown > 0 && (
          <div className="steps">
            {steps.slice(0, stepsShown).map((s, i) => (
              <div className="step" key={i}>
                <b>Schritt {i + 1}</b>
                <Rich text={s} />
              </div>
            ))}
          </div>
        )}

        {answers.length > 0 && (
          <div className="steps">
            <div className="step">
              <b>{revealed ? 'Dein Ergebnis' : 'Dein Ergebnis (optional)'}</b>
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
                      value={answerInputs[i] ?? ''}
                      disabled={revealed}
                      placeholder={a.text ? 'Antwort' : 'Zahl'}
                      onChange={(e) => setAnswerInputs((xs) => Object.assign([...xs], { [i]: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && reveal()}
                      style={{ minHeight: 40, padding: '6px 10px' }}
                    />
                    {a.unit && <span className="muted">{a.unit}</span>}
                    {revealed && (
                      <span className={answerResults[i] ? 'badge-good' : 'badge-warn'} style={{ whiteSpace: 'nowrap' }}>
                        {answerResults[i] ? '✓' : `✗ ${formatAnswer(a)}`}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {revealed && (
          <>
            {answers.length > 0 && answersTried && (
              <p className={answerResults.every(Boolean) ? 'badge-good' : 'badge-warn'} style={{ marginTop: 12 }}>
                {answerResults.every(Boolean) ? 'Ergebnis richtig!' : 'Ergebnis weicht ab – „Nochmal“ oder „Schwer“ empfohlen.'}
              </p>
            )}
            {card.type === 'mc' && (
              <p className={mcCorrect ? 'badge-good' : 'badge-warn'} style={{ marginTop: 12 }}>
                {mcCorrect ? 'Richtig!' : 'Leider nicht ganz – „Nochmal“ empfohlen.'}
              </p>
            )}
            {card.type === 'match' && (
              <p className={matchRight === matchCount ? 'badge-good' : 'badge-warn'} style={{ marginTop: 12 }}>
                {matchRight === matchCount ? 'Alles richtig zugeordnet!' : `${matchRight} von ${matchCount} richtig – „Nochmal“ oder „Schwer“ empfohlen.`}
              </p>
            )}
            {card.type === 'task' && card.result && (
              <div className="step result" style={{ marginTop: 12 }}>
                <b>Ergebnis</b>
                <Rich text={card.result} />
              </div>
            )}
            {card.back.trim() && (
              <>
                <hr />
                <Rich text={card.back} />
              </>
            )}
            {keyPoints.length > 0 && (
              <KeyPoints
                points={keyPoints}
                checked={pointsChecked ?? []}
                onToggle={(i) => setPointsChecked((xs) => ((xs ?? []).includes(i) ? (xs ?? []).filter((x) => x !== i) : [...(xs ?? []), i]))}
              />
            )}
            {suggestion && (
              <p className="suggestion">
                Vorschlag: <b>{RATINGS.find((x) => x.r === suggestion)?.label}</b>
                {keyPoints.length > 0 && ` – ${pointsChecked?.length ?? 0} von ${keyPoints.length} Kernpunkten`}
                {hintsShown > 0 && `, ${hintsShown} ${hintsShown === 1 ? 'Tipp' : 'Tipps'}`}
              </p>
            )}
          </>
        )}

        {revealed && card.source && (card.source.file || card.source.slide !== undefined) && (
          <div className="source row between">
            <span>
              Quelle: {card.source.file ?? 'Skript'}
              {card.source.slide !== undefined && `, Folie ${card.source.slide}`}
            </span>
            {card.source.file && (card.source.page || Number(card.source.slide) > 0) && (
              <button className="btn small ghost" style={{ color: 'var(--accent)' }} onClick={() => setShowSlide(true)}>
                Folie ansehen
              </button>
            )}
          </div>
        )}
      </article>

      {showSlide && card.source?.file && (
        <SlideViewer
          file={card.source.file}
          page={card.source.page ?? Number(card.source.slide)}
          profileId={profile.id}
          onClose={() => setShowSlide(false)}
        />
      )}

      {reporting && <ReportForm onSubmit={submitReport} onCancel={() => setReporting(false)} />}

      {reported.has(card.id) && !reporting && (
        <div className="notice row between" style={{ alignItems: 'center' }}>
          <span>Gemeldet – die Karte ist pausiert, bis sie korrigiert oder die Meldung erledigt ist.</span>
          <button className="btn small" onClick={skipCard} disabled={busy}>Überspringen</button>
        </div>
      )}

      <div className="actions">
        {!revealed && hintsShown < prompts.length && (
          <button className="btn block" style={{ marginBottom: 8 }} onClick={() => setHintsShown((n) => n + 1)}>
            Tipp ({hintsShown + 1}/{prompts.length})
          </button>
        )}
        {!revealed ? (
          card.type === 'task' && stepsShown < steps.length ? (
            <div className="row">
              <button className="btn grow" onClick={() => setStepsShown((n) => n + 1)}>
                {stepsShown === 0 ? 'Ersten Schritt zeigen' : 'Nächster Schritt'}
              </button>
              <button className="btn primary grow" onClick={reveal}>Lösung</button>
            </div>
          ) : (
            <button className="btn primary block" onClick={reveal} disabled={(card.type === 'mc' && selected.length === 0) || (card.type === 'match' && !matchComplete)}>
              {card.type === 'mc' || card.type === 'match' ? 'Prüfen' : card.type === 'task' ? 'Lösung' : 'Antwort zeigen'}
            </button>
          )
        ) : (
          <div className="ratings">
            {RATINGS.map(({ r, label }) => (
              <button key={r} className={`r${r}${suggestion === r ? ' suggested' : ''}`} onClick={() => rate(r)} disabled={busy}>
                {label}
                <small>{intervals ? formatInterval(intervals[r]) : ''}</small>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

function sameSet(a: number[], b: number[]) {
  return a.length === b.length && a.every((x) => b.includes(x))
}

/** Nach einer Fach-Sitzung: das als Nächstes empfohlene Fach anbieten. */
function NextSubject({ current, mode }: { current: string; mode: Mode }) {
  const { profile } = useActive()
  const next = useLiveQuery(async () => {
    const d = await loadStudyData(profile)
    const s = subjectsToday(d.plan).find((x) => x.examId !== current && x.left[mode] > 0)
    const exam = s && d.exams.find((e) => e.id === s.examId)
    return exam ? { exam, left: s!.left[mode] } : null
  }, [profile, current, mode])
  if (!next) return null
  return (
    <Link className="btn primary block" to={`/lernen/${mode}?exam=${next.exam.id}`}>
      Weiter mit {next.exam.name} ({next.left})
    </Link>
  )
}
