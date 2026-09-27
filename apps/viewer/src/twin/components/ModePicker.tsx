import type { SelectMode } from '../data/types'
import { SELECT_MODES } from '../data/halo'

type Props = { mode: SelectMode; onChange: (m: SelectMode) => void }

export default function ModePicker({ mode, onChange }: Props) {
  return (
    <div className="mode-picker" role="group" aria-label="Select layer mode">
      <span className="chrome-label">Select Layer</span>
      {SELECT_MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          className={`chrome-btn mode-${m.id} ${mode === m.id ? 'active' : ''}`}
          onClick={() => onChange(m.id)}
          title={m.hint}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}
