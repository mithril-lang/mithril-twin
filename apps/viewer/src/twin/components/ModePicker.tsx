import type { SelectMode } from '../data/types'
import { SELECT_MODES } from '../data/halo'
import { useViewerLocale } from '../../locale'
import { twinCopy } from '../twin-copy'

type Props = { mode: SelectMode; onChange: (m: SelectMode) => void }

export default function ModePicker({ mode, onChange }: Props) {
  const locale = useViewerLocale()
  return (
    <div className="mode-picker" role="group" aria-label={twinCopy(locale, 'Select layer mode')}>
      <span className="chrome-label">{twinCopy(locale, 'Select Layer')}</span>
      {SELECT_MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          className={`chrome-btn mode-${m.id} ${mode === m.id ? 'active' : ''}`}
          onClick={() => onChange(m.id)}
          title={twinCopy(locale, m.hint)}
        >
          {twinCopy(locale, m.label)}
        </button>
      ))}
    </div>
  )
}
