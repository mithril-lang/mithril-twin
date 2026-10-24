import type { AttackScenario, GraphItem } from '../data/types'
import { useTheme } from '../themes/ThemeContext'
import { useViewerLocale } from '../../locale'
import { twinCopy } from '../twin-copy'

type Props = {
  selected: GraphItem | null
  attackScenario?: AttackScenario | null
  personLabel?: (id: string) => string
}

export default function Inspector({ selected, attackScenario = null, personLabel }: Props) {
  const { theme } = useTheme()
  const locale = useViewerLocale()
  const t = (english: string) => twinCopy(locale, english)
  const nodeEntries = Object.entries(theme.nodes).slice(0, 24)
  const edgeEntries = Object.entries(theme.edges)

  return (
    <aside className="card panel">
      <h2>{t('Selection inspector')}</h2>
      <p className="panel-hint">{t('Select a node or edge to inspect its JSON payload.')}</p>
      {selected ? (
        <pre className="json">{JSON.stringify(selected.data, null, 2)}</pre>
      ) : (
        <div className="empty">
          {t('Nothing selected.')}
          <br />
          {t('The graph is synthetic and safe for local exploration.')}
        </div>
      )}

      {attackScenario && (
        <>
          <h2 className="legend-title">{t('AttackPath')} · {attackScenario.label}</h2>
          <p className="panel-hint">
            {attackScenario.summary}
            <br />
            <strong>{t('honesty')}:</strong> {attackScenario.honesty} · observation_count=
            {attackScenario.observation_count} · <strong>viz only / no runners</strong>
          </p>
          <h2 className="legend-title">{t('RACI owners who should catch it')}</h2>
          <ul className="legend raci-catch-list">
            {attackScenario.raci_catch.map((r) => (
              <li key={`${r.person_id}-${r.process}`}>
                <span className="swatch" style={{ background: theme.halos.attackPath }} />
                <span>
                  <strong>{personLabel?.(r.person_id) ?? r.person_id}</strong>
                  {' · '}
                  {r.raci}
                  {' · '}
                  <code>{r.process}</code>
                </span>
              </li>
            ))}
          </ul>
          <h2 className="legend-title">{t('Path steps')}</h2>
          <ol className="attack-step-list">
            {attackScenario.steps.map((s, i) => (
              <li key={i}>
                <code>{s.from}</code> —{s.kind}→ <code>{s.to}</code>
              </li>
            ))}
          </ol>
        </>
      )}

      <h2 className="legend-title">{t('Node legend')} · {theme.label}</h2>
      <ul className="legend">
        {nodeEntries.map(([type, st]) => (
          <li key={type}>
            <span
              className="swatch"
              style={{ background: st.color, borderColor: st.border }}
              data-shape={st.shape}
            />
            {type}
          </li>
        ))}
      </ul>

      <h2 className="legend-title">{t('Edge legend')}</h2>
      <ul className="legend">
        {edgeEntries.map(([kind, color]) => (
          <li key={kind}>
            <span className="swatch line" style={{ background: color }} />
            {kind}
          </li>
        ))}
      </ul>

      <h2 className="legend-title">{t('Mode halos')}</h2>
      <ul className="legend">
        {Object.entries(theme.halos).map(([mode, color]) => (
          <li key={mode}>
            <span className="swatch" style={{ background: color, borderColor: color }} />
            {mode}
          </li>
        ))}
      </ul>
    </aside>
  )
}
