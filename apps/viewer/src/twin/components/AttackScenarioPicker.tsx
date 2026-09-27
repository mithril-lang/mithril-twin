import type { AttackScenario } from '../data/types'

type Props = {
  scenarios: AttackScenario[]
  activeId: string | null
  onChange: (id: string | null) => void
  disabled?: boolean
}

export default function AttackScenarioPicker({ scenarios, activeId, onChange, disabled }: Props) {
  return (
    <div className="attack-scenario-picker" role="group" aria-label="Attack path scenario">
      <span className="chrome-label">Fraud scenario</span>
      <button
        type="button"
        className={`chrome-btn ${activeId === null ? 'active' : ''}`}
        disabled={disabled}
        onClick={() => onChange(null)}
        title="Clear path highlight"
      >
        None
      </button>
      {scenarios.map((s) => (
        <button
          key={s.id}
          type="button"
          className={`chrome-btn attack-scenario-btn ${activeId === s.id ? 'active' : ''}`}
          disabled={disabled}
          onClick={() => onChange(s.id)}
          title={`${s.summary} (hypothesis · observation_count=${s.observation_count} · viz only)`}
        >
          {s.label}
        </button>
      ))}
      <span className="attack-scenario-note">
        viz overlay only · no runners · synthetic-demo
      </span>
    </div>
  )
}
