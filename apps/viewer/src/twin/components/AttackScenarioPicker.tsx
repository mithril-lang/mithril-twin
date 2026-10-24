import type { AttackScenario } from '../data/types'
import { useViewerLocale } from '../../locale'
import { twinCopy } from '../twin-copy'

type Props = {
  scenarios: AttackScenario[]
  activeId: string | null
  onChange: (id: string | null) => void
  disabled?: boolean
}

export default function AttackScenarioPicker({ scenarios, activeId, onChange, disabled }: Props) {
  const locale = useViewerLocale()
  return (
    <div className="attack-scenario-picker" role="group" aria-label={twinCopy(locale, 'Attack path scenario')}>
      <span className="chrome-label">{twinCopy(locale, 'Fraud scenario')}</span>
      <button
        type="button"
        className={`chrome-btn ${activeId === null ? 'active' : ''}`}
        disabled={disabled}
        onClick={() => onChange(null)}
        title={twinCopy(locale, 'Clear path highlight')}
      >
        {twinCopy(locale, 'None')}
      </button>
      {scenarios.map((s) => (
        <button
          key={s.id}
          type="button"
          className={`chrome-btn attack-scenario-btn ${activeId === s.id ? 'active' : ''}`}
          disabled={disabled}
          onClick={() => onChange(s.id)}
          title={twinCopy(locale, '{summary} (hypothesis · observation_count={count} · viz only)', { summary: s.summary, count: s.observation_count })}
        >
          {s.label}
        </button>
      ))}
      <span className="attack-scenario-note">
        {twinCopy(locale, 'viz overlay only · no runners · synthetic-demo')}
      </span>
    </div>
  )
}
