import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'

export function Progress({ value, color = 'var(--accent)' }: { value: number; color?: string }) {
  const pct = Math.max(0, Math.min(100, value * 100))
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

export function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="stat">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  )
}

export const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : '–')

const paths = {
  today: 'M8 2v3M16 2v3M3.5 9h17M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 19 20.5H5A1.5 1.5 0 0 1 3.5 19V6A1.5 1.5 0 0 1 5 4.5ZM8 14l2.5 2.5L16 11',
  exams: 'M4 19.5V5a1.5 1.5 0 0 1 1.5-1.5H19a1 1 0 0 1 1 1V17H6a2 2 0 0 0-2 2.5Zm0 0A2 2 0 0 0 6 21h14M8 8h8M8 11.5h5',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4.9a7.4 7.4 0 0 0-2-1.2L14.5 3h-5l-.4 2.5a7.4 7.4 0 0 0-2 1.2l-2.4-.9-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-.9a7.4 7.4 0 0 0 2 1.2l.4 2.5h5l.4-2.5a7.4 7.4 0 0 0 2-1.2l2.4.9 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
  close: 'M6 6l12 12M18 6 6 18',
  back: 'M15 5l-7 7 7 7',
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  cards: 'M7 7V5.5A1.5 1.5 0 0 1 8.5 4h10A1.5 1.5 0 0 1 20 5.5v8a1.5 1.5 0 0 1-1.5 1.5H17M5.5 9h10A1.5 1.5 0 0 1 17 10.5v8a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 4 18.5v-8A1.5 1.5 0 0 1 5.5 9Z',
  pencil: 'M14.5 5.5l4 4M4 20l1-4.5L15.8 4.7a1.4 1.4 0 0 1 2 0l1.5 1.5a1.4 1.4 0 0 1 0 2L8.5 19 4 20Z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13.5V12l3 2',
  chart: 'M4 20h16M7 16v-4M12 16V8M17 16v-6',
  flame: 'M12 21c3.9 0 6.5-2.6 6.5-6.2 0-3.3-2.3-5.6-4-7.8-.4 1.9-1.4 3-2.6 3.5.3-2.7-.8-5.6-3.4-7.5.2 3.2-1.4 5.1-2.8 6.9C4.6 11.2 5.5 13 5.5 14.8 5.5 18.4 8.1 21 12 21Z',
  download: 'M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5M5 19.5h14',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-2.4-11.6a2.5 2.5 0 1 1 3.6 2.3c-.7.3-1.2 1-1.2 1.8v.5M12 17h.01',
  plus: 'M12 5v14M5 12h14',
  pause: 'M9 6v12M15 6v12',
  play: 'M8.5 6.2v11.6a.6.6 0 0 0 .9.5l9-5.8a.6.6 0 0 0 0-1l-9-5.8a.6.6 0 0 0-.9.5Z',
  chevron: 'M9 5l7 7-7 7',
  skip: 'M5.5 6.2v11.6a.6.6 0 0 0 .9.5l8.6-5.8a.6.6 0 0 0 0-1L6.4 5.7a.6.6 0 0 0-.9.5ZM18.5 5.5v13',
  flag: 'M5 21V4.5m0 0h11.5l-2 4 2 4H5',
  bell: 'M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15l1.5-2ZM10 20.5a2 2 0 0 0 4 0',
  trash: 'M4 6.5h16M9.5 6.5V4.5h5v2M6 6.5l1 13a1.5 1.5 0 0 0 1.5 1.4h7a1.5 1.5 0 0 0 1.5-1.4l1-13M10 10.5v6M14 10.5v6',
}

export type IconName = keyof typeof paths

export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  )
}

/** Seitenkopf mit großem Titel; optional Zurück-Link und Aktion in einer Leiste darüber. */
export function PageHeader({ title, eyebrow, subtitle, back, action }: { title: ReactNode; eyebrow?: ReactNode; subtitle?: ReactNode; back?: boolean; action?: ReactNode }) {
  const navigate = useNavigate()
  // Ohne Verlauf (z. B. direkt geöffneter Link) führt „Zurück“ zur Übersicht.
  const goBack = () => ((window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate('/'))
  return (
    <header className="page-header">
      {(back || action) && (
        <div className="page-bar">
          {back ? (
            <button className="back-link" onClick={goBack}>
              <Icon name="back" size={20} />
              Zurück
            </button>
          ) : (
            <span />
          )}
          {action}
        </div>
      )}
      {eyebrow && <span className="eyebrow">{eyebrow}</span>}
      <h1>{title}</h1>
      {subtitle && <p className="subtitle">{subtitle}</p>}
    </header>
  )
}

export type WidgetSize = 'small' | 'medium' | 'large'

/** Kachel im Stil der iPadOS-Widgets; mit `to` führt die ganze Fläche zur verlinkten Seite, ohne `to` enthält sie eigene Links. */
export function Widget({ size, to, title, icon, tint = 'var(--accent)', children, label, badge }: { size: WidgetSize; to?: string; title: string; icon: IconName; tint?: string; children: ReactNode; label?: string; badge?: ReactNode }) {
  const inner = (
    <>
      <div className="widget-title" style={{ color: tint }}>
        <Icon name={icon} size={18} />
        <span className="truncate">{title}</span>
        {badge}
      </div>
      <div className="widget-body">{children}</div>
    </>
  )
  return to ? (
    <Link to={to} className={`widget widget-${size}`} aria-label={label ?? title}>
      {inner}
    </Link>
  ) : (
    <section className={`widget widget-${size}`} aria-label={label ?? title}>
      {inner}
    </section>
  )
}

/** Ringdiagramm wie in den Aktivitäts-Widgets: äußerer Ring = begonnen, innerer = sicher. */
export function Rings({ outer, inner, size = 96 }: { outer: number; inner: number; size?: number }) {
  const ring = (r: number, value: number, color: string, width: number) => {
    const c = 2 * Math.PI * r
    return (
      <>
        <circle cx={50} cy={50} r={r} fill="none" stroke={color} strokeOpacity={0.18} strokeWidth={width} />
        <circle
          cx={50}
          cy={50}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={width}
          strokeLinecap="round"
          strokeDasharray={`${Math.max(0.001, Math.min(1, value)) * c} ${c}`}
          transform="rotate(-90 50 50)"
        />
      </>
    )
  }
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      {ring(42, outer, 'var(--accent)', 11)}
      {ring(27, inner, 'var(--ok)', 11)}
    </svg>
  )
}

/** Mini-Balkendiagramm der letzten Tage. */
/** Tagesbalken; ohne `max` relativ zum größten Wert. */
export function DayBars({ values, labels, max: fixedMax }: { values: number[]; labels: string[]; max?: number }) {
  const max = fixedMax ?? Math.max(1, ...values)
  return (
    <div className="daybars" aria-hidden="true">
      {values.map((v, i) => (
        <div key={i} className="daybar">
          <div className="daybar-track">
            <div className="daybar-fill" style={{ height: `${Math.max(v ? 8 : 0, (v / max) * 100)}%` }} />
          </div>
          <span>{labels[i]}</span>
        </div>
      ))}
    </div>
  )
}
