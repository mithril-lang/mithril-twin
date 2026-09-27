import type { ViewMode } from '../data/types'

const VIEWS: { id: ViewMode; label: string }[] = [
  { id: 'make', label: 'Grid' },
  { id: 'board', label: 'Board' },
]

type Props = { view: ViewMode; onChange: (v: ViewMode) => void }

export default function ViewToggle({ view, onChange }: Props) {
  return (
    <div className="view-toggle" role="group" aria-label="View">
      <span className="chrome-label">View</span>
      {VIEWS.map((v) => (
        <button
          key={v.id}
          type="button"
          className={`chrome-btn ${view === v.id ? 'active' : ''}`}
          onClick={() => onChange(v.id)}
        >
          {v.label}
        </button>
      ))}
    </div>
  )
}
