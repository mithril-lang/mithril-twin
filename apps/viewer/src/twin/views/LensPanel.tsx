import { useMemo, type ReactNode } from 'react'
import type { FrameDim, Lens } from '../mith/lensLayout'
import {
  allBlastRadii,
  blastRadius,
  boundaryPath,
  impersonationPaths,
  orgModel,
  shadowSystems,
} from '../mith/org'
import { analyzeExposure, type ExposureReport } from '../mith/exposure'
import { buildGraph, dijkstra, NODE, reconstruct, resolveWeights } from '../mith/graph'
import type { MithDocument, MithEntity } from '../mith/types'
import { DeviceDetail, PersonDevices } from './DeviceDetail'

type Props = {
  doc: MithDocument
  lens: Lens
  dim: FrameDim
  selectedId: string | null
  onSelect: (id: string | null) => void
}

const LENS_BLURB: Record<Lens, string> = {
  org: 'Org boundaries frame the grid: company › department › team. Network zones are a separate dimension.',
  network: 'Network zones frame the grid. The same people and systems keep their org boundary.',
  access: 'Grants from roles to systems. Select a role to see its blast radius if that role were impersonated.',
  impersonation: 'Request channels from outside actors into roles. Red hops carry no verification control.',
  shadow: 'Unsanctioned systems sit outside the org boundary in dashed frames, linked to who uses them.',
  layers: 'Layer boards from the diagram section.',
}

function Row({ children, onClick, active }: { children: ReactNode; onClick?: () => void; active?: boolean }) {
  return (
    <button type="button" className={`lens-row ${active ? 'active' : ''}`} onClick={onClick}>
      {children}
    </button>
  )
}

/** Right-rail analysis for the active lens. Every number is computed from the synthetic document. */
export default function LensPanel({ doc, lens, dim, selectedId, onSelect }: Props) {
  const org = useMemo(() => orgModel(doc), [doc])
  const labelOf = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of doc.model.entities) m.set(e.id, e.label)
    for (const b of org.boundaries) m.set(b.id, b.label)
    for (const r of org.roles) m.set(r.id, r.label)
    for (const a of org.actors) m.set(a.id, a.label)
    return (id: string) => m.get(id) ?? id
  }, [doc, org])
  const radii = useMemo(() => allBlastRadii(doc), [doc])
  const report = useMemo(() => analyzeExposure(doc.model), [doc])
  const paths = useMemo(() => impersonationPaths(doc), [doc])
  const shadow = useMemo(() => shadowSystems(doc), [doc])

  const entity = selectedId ? doc.model.entities.find((e) => e.id === selectedId) : undefined
  const role = selectedId ? org.roles.find((r) => r.id === selectedId) : undefined
  const actor = selectedId ? org.actors.find((a) => a.id === selectedId) : undefined
  const boundary = selectedId ? org.boundaries.find((b) => b.id === selectedId) : undefined
  const unverifiedTotal = paths.filter((p) => p.unverified).length
  const weights = useMemo(() => resolveWeights(doc.model.weights), [doc])
  // person → devices (owner or any linked user)
  const personDevices = useMemo(() => {
    const m = new Map<string, { device: MithEntity; relation: string }[]>()
    for (const d of doc.model.entities) {
      if (d.layer !== 'node') continue
      const links = d.users?.length ? d.users : d.attrs.owner ? [{ person: d.attrs.owner, relation: 'primary' as const }] : []
      for (const u of links) m.set(u.person, [...(m.get(u.person) ?? []), { device: d, relation: u.relation }])
    }
    return m
  }, [doc])
  const graph = useMemo(() => buildGraph(doc.model), [doc])
  const isDevice = !!entity && entity.layer === 'node' && !!(entity.software || entity.logs || entity.users)

  return (
    <div className="lens-panel" data-lens-panel={lens}>
      <div className="lens-panel-head">
        <strong>{lens === 'shadow' ? 'Shadow IT' : lens.charAt(0).toUpperCase() + lens.slice(1)} lens</strong>
        <span className="lens-badge">display-only · synthetic</span>
      </div>
      <p className="lens-blurb">{LENS_BLURB[lens]}</p>

      {(lens === 'org' || lens === 'network') && (
        <dl className="lens-stats">
          <div><dt>Frames by</dt><dd>{dim === 'org' ? 'Org boundary' : 'Network zone'}</dd></div>
          <div><dt>Boundaries</dt><dd>{org.boundaries.length}</dd></div>
          <div><dt>Roles</dt><dd>{org.roles.length}</dd></div>
          <div><dt>Unsanctioned</dt><dd>{shadow.length}</dd></div>
        </dl>
      )}

      {lens === 'access' && (
        <>
          <RankedResources report={report} labelOf={labelOf} selectedId={selectedId} onSelect={onSelect} />
          <h3 className="lens-h3">Blast radius per role (direct + unverified lateral)</h3>
          <div className="lens-table" role="table" aria-label="Blast radius per role">
            <div className="lens-th" role="row"><span>Role</span><span>reach</span><span>admin</span><span>approve</span></div>
            {radii.map((r) => (
              <Row key={r.role} active={r.role === selectedId} onClick={() => onSelect(r.role)}>
                <span>{labelOf(r.role)}</span>
                <span>{r.resources.length}</span>
                <span className={r.counts.admin ? 'lens-num-hot' : ''}>{r.counts.admin}</span>
                <span>{r.counts.approve}</span>
              </Row>
            ))}
          </div>
        </>
      )}

      {lens === 'impersonation' && (
        <>
          <p className="lens-metric">
            <b className="lens-num-hot">{unverifiedTotal}</b> unverified of {paths.length} paths from outside actors (≤4 hops)
          </p>
          <RankedRoles report={report} labelOf={labelOf} selectedId={selectedId} onSelect={onSelect} />
        </>
      )}

      {lens === 'shadow' && (
        <div className="lens-list">
          {shadow.map((s) => (
            <Row key={s.entity.id} active={s.entity.id === selectedId} onClick={() => onSelect(s.entity.id)}>
              <span>
                <strong>{s.entity.label}</strong>
                <small>source: {s.source} · used by {s.usedBy.map(labelOf).join(', ') || 'nobody linked'}</small>
              </span>
            </Row>
          ))}
          {shadow.length === 0 && <p className="lens-blurb">No unsanctioned systems in this document.</p>}
        </div>
      )}

      {(entity || role || actor || boundary) && (
        <div className="lens-detail" aria-label="Selection">
          <div className="lens-detail-head">
            <h2>{labelOf(selectedId!)}</h2>
            <button type="button" className="make-icon-btn" aria-label="Clear selection" onClick={() => onSelect(null)}>×</button>
          </div>
          {entity && isDevice && <DeviceDetail device={entity} weights={weights} labelOf={labelOf} onPick={(id) => onSelect(id)} />}
          {entity && !isDevice && personDevices.has(entity.id) && (
            <PersonDevices person={entity} devices={personDevices.get(entity.id)!} weights={weights} onPick={(id) => onSelect(id)} />
          )}
          {entity && (
            <dl className="lens-kv">
              <div><dt>type</dt><dd>{entity.type}</dd></div>
              <div><dt>org boundary</dt><dd>{boundaryPath(org.boundaries, entity.boundary).map((b) => b.label).join(' › ') || '—'}</dd></div>
              <div><dt>network zone</dt><dd>{entity.zone ? labelOf(entity.zone) : '—'}</dd></div>
              {entity.sanctioned === false && <div><dt>shadow IT</dt><dd>unsanctioned · {entity.source ?? 'unknown'}</dd></div>}
              {org.roles.some((r) => r.holders.includes(entity.id)) && (
                <div><dt>roles</dt><dd>{org.roles.filter((r) => r.holders.includes(entity.id)).map((r) => r.label).join(', ')}</dd></div>
              )}
              {org.grants.some((g) => g.resource === entity.id) && (
                <div><dt>granted to</dt><dd>{org.grants.filter((g) => g.resource === entity.id).map((g) => `${labelOf(g.role)} (${g.level})`).join(', ')}</dd></div>
              )}
            </dl>
          )}
          {boundary && (
            <dl className="lens-kv">
              <div><dt>kind</dt><dd>{boundary.kind}</dd></div>
              <div><dt>path</dt><dd>{boundaryPath(org.boundaries, boundary.id).map((b) => b.label).join(' › ')}</dd></div>
            </dl>
          )}
          {actor && <p className="lens-blurb">Synthetic outside party. Paths below are exposure measurements, not actions.</p>}
          {role && (
            <>
              <dl className="lens-kv">
                <div><dt>boundary</dt><dd>{boundaryPath(org.boundaries, role.boundary).map((b) => b.label).join(' › ')}</dd></div>
                <div><dt>holders</dt><dd>{role.holders.map(labelOf).join(', ') || '—'}</dd></div>
              </dl>
              <h3 className="lens-h3">Blast radius if impersonated</h3>
              <ul className="lens-reach">
                {blastRadius(doc, role.id).resources.map((r) => (
                  <li key={r.resource} className={`level-${r.level}`}>
                    <span>{labelOf(r.resource)}</span>
                    <em>{r.level}</em>
                    {r.via.length > 1 && <small>via {r.via.slice(1).map(labelOf).join(' → ')} (unverified)</small>}
                  </li>
                ))}
              </ul>
            </>
          )}
          {role && (lens === 'impersonation' || lens === 'access') && (
            <EasiestPath report={report} roleId={role.id} labelOf={labelOf} />
          )}
          {role && (lens === 'impersonation' || lens === 'access') && (() => {
            // After seizing the role: where the impersonator lands (role → holder / user device),
            // and the path to its top resource when that walks through a device. Device ease and
            // detection blind spots are explanation only; they never change reachability.
            const x = report.roles.find((r) => r.role === role.id)
            const ri = graph.index.get(role.id)
            if (ri == null) return null
            const dj = dijkstra(graph, [ri])
            const ti = x?.topResource ? graph.index.get(x.topResource) : undefined
            const top = ti == null ? [] : reconstruct(graph, dj, ti)
            const viaDevice = top.some((h) => graph.nodeType[graph.index.get(h.to)!] === NODE.device)
            const pivots = (graph.roleZones.get(ri) ?? [])
              .filter((z) => z.device >= 0)
              .map((z) => reconstruct(graph, dj, z.device).find((h) => h.to === graph.ids[z.device]))
              .filter((h): h is NonNullable<typeof h> => !!h)
            const hops = viaDevice ? top : pivots
            if (!hops.length) return null
            return (
              <>
                <h3 className="lens-h3">{viaDevice ? 'From the role to its top resource' : 'Devices an impersonator of this role lands on'}</h3>
                <ol className="device-hops" data-role-device-path={role.id}>
                  {hops.map((h, i) => (
                    <li key={`${h.ref}:${h.to}:${i}`}>
                      <span>{labelOf(h.from)} → {labelOf(h.to)}</span>
                      <small>{h.kind} · cost {Number.isInteger(h.cost) ? h.cost : h.cost.toFixed(2)}</small>
                      {h.blind && <em className={`scale-hop-blind blind-${h.blind}`} data-hop-blind={h.blind}>{h.blind === 'blind' ? 'detection blind spot' : 'short log retention'}</em>}
                      {h.notes?.map((n) => <small key={n} className="scale-hop-note">{n}</small>)}
                    </li>
                  ))}
                </ol>
              </>
            )
          })()}
          {(role || actor) && lens === 'impersonation' && (
            <>
              <h3 className="lens-h3">Paths through this {role ? 'role' : 'actor'}</h3>
              <ul className="lens-paths">
                {paths
                  .filter((p) => p.nodes.includes(selectedId!))
                  .slice(0, 8)
                  .map((p) => (
                    <li key={p.channels.join('|')} className={p.unverified ? 'is-unverified' : ''}>
                      {p.nodes.map(labelOf).join(' → ')}
                      <small>{p.hops} hop{p.hops === 1 ? '' : 's'} · {p.unverified ? 'no verification' : 'has a control'}</small>
                    </li>
                  ))}
              </ul>
            </>
          )}
        </div>
      )}
      <p className="lens-foot">Measures exposure in the synthetic model only. No runners, no scanning, no credential collection.</p>
    </div>
  )
}

type RankProps = {
  report: ExposureReport
  labelOf: (id: string) => string
  selectedId: string | null
  onSelect: (id: string | null) => void
  limit?: number
  /** Optional second line under a role / resource label (e.g. department · company at scale). */
  subOf?: (id: string) => string
}

const fmtScore = (n: number) => (n >= 10 ? n.toFixed(0) : n.toFixed(1))
const heatClass = (score: number) => (score >= 50 ? 'heat-4' : score >= 25 ? 'heat-3' : score >= 10 ? 'heat-2' : score > 0 ? 'heat-1' : 'heat-0')

/** Roles ranked by exposure score = easiest-path ease × criticality of what the role can reach. */
export function RankedRoles({ report, labelOf, selectedId, onSelect, limit = 50, subOf }: RankProps) {
  return (
    <div className="lens-table lens-rank" role="table" aria-label="Roles ranked by exposure">
      <div className="lens-th" role="row"><span>Role (ranked)</span><span>score</span><span>cost</span><span title="unverified paths">unv.</span><span title="min hops">hops</span></div>
      {report.roles.slice(0, limit).map((x, i) => (
        <Row key={x.role} active={x.role === selectedId} onClick={() => onSelect(x.role)}>
          <span>
            <i className="lens-rank-n">{i + 1}</i>
            {labelOf(x.role)}
            {x.highValue && <em className="lens-hv">high-value</em>}
            {subOf && <small>{subOf(x.role)}</small>}
          </span>
          <span className={`lens-score ${heatClass(x.score)}`}>{fmtScore(x.score)}</span>
          <span>{x.minCost ?? '—'}</span>
          <span className={x.unverifiedPaths ? 'lens-num-hot' : ''}>{x.unverifiedPaths}{report.totals.capped ? '+' : ''}</span>
          <span>{x.minHops ?? '—'}</span>
        </Row>
      ))}
      {report.roles.length > limit && <p className="lens-blurb">Top {limit} of {report.roles.length} roles.</p>}
    </div>
  )
}

/** Resources ranked by the best exposure of any role granted on them. */
export function RankedResources({ report, labelOf, selectedId, onSelect, limit = 50, subOf }: RankProps) {
  return (
    <div className="lens-table lens-rank" role="table" aria-label="Resources ranked by exposure">
      <div className="lens-th" role="row"><span>Resource (ranked)</span><span>score</span><span>criticality</span><span>via role</span></div>
      {report.resources.slice(0, limit).map((x, i) => (
        <Row key={x.resource} active={x.resource === selectedId} onClick={() => onSelect(x.resource)}>
          <span><i className="lens-rank-n">{i + 1}</i>{labelOf(x.resource)}</span>
          <span className={`lens-score ${heatClass(x.score)}`}>{fmtScore(x.score)}</span>
          <span className={`crit crit-${x.criticality}`}>{x.criticality}{x.declared ? '' : '*'}</span>
          <span>{x.viaRole ? labelOf(x.viaRole) : '—'}{x.viaRole && subOf && <small>{subOf(x.viaRole)}</small>}</span>
        </Row>
      ))}
      {report.resources.some((r) => !r.declared) && <p className="lens-blurb">* no criticality declared; inferred from grant level.</p>}
    </div>
  )
}

export function EasiestPath({ report, roleId, labelOf }: { report: ExposureReport; roleId: string; labelOf: (id: string) => string }) {
  const x = report.roles.find((r) => r.role === roleId)
  if (!x) return null
  return (
    <>
      <h3 className="lens-h3">Easiest path from outside</h3>
      {x.easiest ? (
        <p className="lens-easiest" data-easiest-path>
          {x.easiest.nodes.map(labelOf).join(' → ')}
          <small>
            cost {x.easiest.cost} · ease {x.ease.toFixed(2)} · score {fmtScore(x.score)} · target {x.topResource ? labelOf(x.topResource) : '—'}
          </small>
        </p>
      ) : (
        <p className="lens-blurb">No channel path from an external actor.</p>
      )}
    </>
  )
}
