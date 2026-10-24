import type { ViewMode } from '../data/types'
import { useViewerLocale } from '../../locale'
import { twinCopy } from '../twin-copy'

const VIEWS: { id: ViewMode; label: string }[] = [
  { id: 'make', label: 'Grid' },
  { id: 'board', label: 'Board' },
]

type Props = { view: ViewMode; onChange: (v: ViewMode) => void }

export default function ViewToggle({ view, onChange }: Props) {
  const locale = useViewerLocale()
  return (
    <div className="view-toggle" role="group" aria-label={twinCopy(locale, 'View')}>
      <span className="chrome-label">{twinCopy(locale, 'View')}</span>
      {VIEWS.map((v) => (
        <button
          key={v.id}
          type="button"
          className={`chrome-btn ${view === v.id ? 'active' : ''}`}
          onClick={() => onChange(v.id)}
        >
          {twinCopy(locale, v.label)}
        </button>
      ))}
    </div>
  )
}
