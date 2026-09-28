import { deviceRisk, logCoverage, type LogCoverage, type ResolvedWeights } from '../mith/graph'
import type { MithEntity } from '../mith/types'
import type { ExpandedChunk } from '../scale/pack'
import { useViewerLocale } from '../../locale'
import { twinCopy } from '../twin-copy'
import './device.css'

/**
 * Device detail (software, logs, people) and person → device links for the enterprise view.
 * Display-only: every device, package, log event, and person is synthetic.
 */

export const COVERAGE_LABEL: Record<LogCoverage, string> = {
  forwarded: 'forwarded',
  short: 'short retention',
  blind: 'not forwarded (blind spot)',
  unknown: 'not modeled',
}

export function easeColor(ease: number): string {
  return ease >= 0.5 ? '#d6283f' : ease >= 0.25 ? '#f08c2e' : ease > 0.05 ? '#e7b416' : '#3aa37a'
}

export function coverageColor(c: LogCoverage): string {
  return c === 'blind' ? '#d6283f' : c === 'short' ? '#f08c2e' : c === 'forwarded' ? '#3aa37a' : '#c3c8d4'
}

/** `<company>.v<i>` → the expanded chunk device, if it belongs to this chunk. */
export function chunkDevice(chunk: ExpandedChunk | null, id: string): MithEntity | undefined {
  if (!chunk) return undefined
  const dot = id.lastIndexOf('.v')
  const i = Number(id.slice(dot + 2))
  const d = dot > 0 && Number.isInteger(i) ? chunk.devices[i] : undefined
  return d?.id === id ? d : undefined
}

export function chunkPerson(chunk: ExpandedChunk | null, id: string): MithEntity | undefined {
  if (!chunk) return undefined
  const dot = id.lastIndexOf('.p')
  const i = Number(id.slice(dot + 2))
  const p = dot > 0 && Number.isInteger(i) ? chunk.people[i] : undefined
  return p?.id === id ? p : undefined
}

/** person id → devices they use (primary, shared user, or admin), from device `users`. */
export function devicesByPerson(chunk: ExpandedChunk): Map<string, { device: MithEntity; relation: string }[]> {
  const out = new Map<string, { device: MithEntity; relation: string }[]>()
  for (const d of chunk.devices) {
    for (const u of d.users ?? []) {
      const list = out.get(u.person) ?? []
      list.push({ device: d, relation: u.relation })
      out.set(u.person, list)
    }
  }
  return out
}

export function DeviceDetail({
  device,
  weights,
  labelOf,
  onPick,
}: {
  device: MithEntity
  weights: ResolvedWeights
  labelOf: (id: string) => string
  onPick: (id: string) => void
}) {
  const locale = useViewerLocale()
  const t = (english: string, values?: Record<string, string | number>) => twinCopy(locale, english, values)
  const risk = deviceRisk(device.software, weights.device)
  const cov = logCoverage(device.logs, weights.minRetentionDays)
  const logs = device.logs
  return (
    <div className="device-detail" data-device-detail={device.id}>
      <dl className="lens-kv">
        <div><dt>{t('type')}</dt><dd>{device.type}</dd></div>
        <div><dt>{t('zone')}</dt><dd>{device.zone ? labelOf(device.zone) : '—'}</dd></div>
        <div>
          <dt>{t('compromise ease')}</dt>
          <dd>
            <b style={{ color: easeColor(risk.ease) }}>{risk.ease.toFixed(2)}</b> {t('of max {maximum} · role → device pivot costs {cost} (pivot {pivot} × (1 − ease))', { maximum: weights.device.maxEase, cost: (weights.pivot * (1 - risk.ease)).toFixed(2), pivot: weights.pivot })}
          </dd>
        </div>
        <div>
          <dt>{t('log coverage')}</dt>
          <dd data-log-coverage={cov}>
            <b style={{ color: coverageColor(cov) }}>{t(COVERAGE_LABEL[cov])}</b>
            {cov === 'blind' || cov === 'short' ? t(' · shown as a detection blind spot on paths through this device (reachability unchanged)') : ''}
          </dd>
        </div>
      </dl>

      <h3 className="lens-h3">{t('Software ({count})', { count: device.software?.length ?? 0 })}</h3>
      {device.software?.length ? (
        <table className="device-table" data-device-software>
          <thead><tr><th>{t('name')}</th><th>{t('version')}</th><th>{t('vendor')}</th><th>{t('flags')}</th></tr></thead>
          <tbody>
            {device.software.map((s, i) => (
              <tr key={`${s.name}:${i}`} className={s.eol || s.sanctioned === false || (s.vulnerability && s.vulnerability !== 'none' && s.vulnerability !== 'low') ? 'is-risky' : ''}>
                <td>{s.name}</td>
                <td>{s.version}</td>
                <td>{s.vendor ?? '—'}</td>
                <td>
                  {s.eol && <span className="device-flag flag-eol">EOL</span>}
                  {s.sanctioned === false && <span className="device-flag flag-unsanctioned">{t('unsanctioned')}</span>}
                  {s.vulnerability && s.vulnerability !== 'none' && <span className={`device-flag flag-vuln-${s.vulnerability}`}>{t(s.vulnerability)}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="lens-blurb">{t('No software modeled.')}</p>
      )}
      {risk.reasons.length > 0 && <p className="lens-blurb">{t('Ease = min({maximum}, EOL {eol} + unsanctioned {unsanctioned} + worst vuln): {reasons}', { maximum: weights.device.maxEase, eol: weights.device.eol, unsanctioned: weights.device.unsanctioned, reasons: risk.reasons.map((reason) => {
        if (reason.startsWith('EOL: ')) return t('EOL: {software}', { software: reason.slice(5) })
        if (reason.startsWith('unsanctioned: ')) return t('unsanctioned: {software}', { software: reason.slice(14) })
        const match = /^(\w+) vuln: (.+)$/.exec(reason)
        return match ? t('{severity} vulnerability: {software}', { severity: t(match[1]!), software: match[2]! }) : reason
      }).join('; ') })}</p>}

      <h3 className="lens-h3">{t('Logs')}</h3>
      {logs ? (
        <>
          <dl className="lens-kv" data-device-logs>
            <div><dt>{t('sources')}</dt><dd>{logs.sources.length ? logs.sources.join(', ') : t('none')}</dd></div>
            <div><dt>{t('forwarded to')}</dt><dd>{logs.forwardTo === 'none' ? t('not forwarded (kept on device)') : logs.forwardTo}</dd></div>
            <div><dt>{t('retention')}</dt><dd>{t('{days} days{minimum}', { days: logs.retentionDays, minimum: logs.retentionDays < weights.minRetentionDays ? t(' (< {days} minimum)', { days: weights.minRetentionDays }) : '' })}</dd></div>
          </dl>
          {logs.events?.length ? (
            <ol className="device-timeline" aria-label={t('Sample log events (synthetic)')} data-device-events={logs.events.length}>
              {logs.events.map((e, i) => (
                <li key={`${e.at}:${i}`} className={`sev-${e.severity ?? 'info'}`}>
                  <time dateTime={e.at}>{e.at.slice(11, 16)}</time>
                  <span><b>{e.source}</b> · {e.action}{e.user ? ` · ${labelOf(e.user)}` : ''}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="lens-blurb">{t('No sample events.')}</p>
          )}
        </>
      ) : (
        <p className="lens-blurb">{t('No logs block modeled (coverage unknown, not flagged).')}</p>
      )}

      <h3 className="lens-h3">{t('People ({count})', { count: device.users?.length ?? 0 })}</h3>
      {device.users?.length ? (
        <div className="lens-list" data-device-people>
          {device.users.map((u) => (
            <button key={u.person} type="button" className="lens-row" onClick={() => onPick(u.person)}>
              <span><strong>{labelOf(u.person)}</strong><small>{t(u.relation)}</small></span>
            </button>
          ))}
        </div>
      ) : (
        <p className="lens-blurb">{t('No people linked.')}</p>
      )}
    </div>
  )
}

export function PersonDevices({
  person,
  devices,
  weights,
  onPick,
}: {
  person: MithEntity
  devices: { device: MithEntity; relation: string }[]
  weights: ResolvedWeights
  onPick: (id: string) => void
}) {
  const locale = useViewerLocale()
  const t = (english: string, values?: Record<string, string | number>) => twinCopy(locale, english, values)
  return (
    <div data-person-devices={person.id}>
      <dl className="lens-kv">
        <div><dt>{t('title')}</dt><dd>{person.attrs.title || '—'}</dd></div>
        <div><dt>{t('zone')}</dt><dd>{person.zone ?? '—'}</dd></div>
      </dl>
      <h3 className="lens-h3">{t('Devices ({count})', { count: devices.length })}</h3>
      <div className="lens-list">
        {devices.map(({ device, relation }) => {
          const risk = deviceRisk(device.software, weights.device)
          const cov = logCoverage(device.logs, weights.minRetentionDays)
          return (
            <button key={device.id} type="button" className="lens-row" onClick={() => onPick(device.id)} data-person-device={device.id}>
              <span>
                <strong>{device.label}</strong>
                <small>
                  {t(relation)} · {t('ease')} <b style={{ color: easeColor(risk.ease) }}>{risk.ease.toFixed(2)}</b> · {t('logs')}{' '}
                  <b style={{ color: coverageColor(cov) }}>{t(COVERAGE_LABEL[cov])}</b>
                </small>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
