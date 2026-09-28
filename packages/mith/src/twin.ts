import { isFormSource, parseForm, TWIN_CONTEXT } from './form'
import { MithParseError, parseMith } from './parse'
import { DIAGRAM_FRAMES, DIAGRAM_LENSES, type MithDocument, type MithEntity, type MithWeights } from './types'

/**
 * Twin vocabulary for Mithril .mith: the `mithril/twin-document` profile (pinned context
 * https://mithril.fund/context/twin/v1, terms under https://mithril.fund/lib/twin/v1#). Mirrors
 * `mithril.twin` upstream: the same closed term list, the same refusals. The viewer reads:
 *   1. Mithril Form `(mithril/twin-document …)` — primary,
 *   2. the JSON-LD spelling with the pinned twin context,
 *   3. legacy twin v0 JSON (`"mith": "0.1"`) — deprecated, kept so older files still open.
 * All three become the same in-memory `MithDocument`.
 */

export const TWIN_BASE = 'https://mithril.fund/lib/twin/v1#'
export const TWIN_CLASSES = [
  'TwinDocument', 'Entity', 'Device', 'Software', 'DeviceLogs', 'LogEvent', 'DeviceUser', 'Boundary', 'Role',
  'Grant', 'Actor', 'Channel', 'Reach', 'Edge', 'Weights', 'Diagram', 'Plane', 'Placement', 'CrossLink',
  'Inference', 'Hypothesis', 'Citation', 'Attribute',
] as const
export const TWIN_TERMS = [
  'key', 'label', 'note', 'title', 'datasetKind', 'generatedAt', 'disclaimer', 'citations', 'source', 'entities',
  'edges', 'boundaries', 'roles', 'grants', 'actors', 'channels', 'reach', 'weights', 'diagram', 'inference',
  'entityType', 'layer', 'boundary', 'zone', 'sanctioned', 'criticality', 'attrs', 'value',
  'software', 'logs', 'users', 'name', 'version', 'vendor', 'eol', 'vulnerability', 'sources', 'forwardTo',
  'retentionDays', 'events', 'at', 'action', 'severity', 'user', 'person', 'relation',
  'kind', 'parent', 'holders', 'role', 'resource', 'level', 'from', 'to', 'verification', 'weight', 'jumpHost',
  'base', 'controls', 'none', 'callback', 'mfa', 'dualApproval', 'open', 'conditional', 'blocked', 'pivot', 'host',
  'blastRadius', 'networkValue', 'sync', 'heatSaturation', 'device', 'unsanctioned', 'maxEase', 'low', 'medium',
  'high', 'critical', 'minRetentionDays',
  'arrangement', 'camera', 'mode', 'tilt', 'yaw', 'zoom', 'focusPlane', 'selection', 'planes', 'transform', 'x', 'y',
  'z', 'placements', 'entity', 'tone', 'showLabel', 'crossLinks', 'lens', 'frame',
  'vizOnly', 'noRunners', 'hypotheses', 'summary', 'category', 'honesty', 'observationCount', 'relativeScore',
  'scoreNote', 'nodeIds', 'steps',
] as const
const TOP_LEVEL = new Set([
  '@context', '@id', '@type', 'title', 'datasetKind', 'generatedAt', 'disclaimer', 'citations', 'entities', 'edges',
  'boundaries', 'roles', 'grants', 'actors', 'channels', 'reach', 'weights', 'diagram', 'inference',
])
const TERM_SET = new Set<string>(TWIN_TERMS)
const CLASS_SET = new Set<string>(TWIN_CLASSES)
/** Multi-word twin terms and their Form keywords (upstream `key-names`). */
export const TWIN_KEYWORDS: Record<string, string> = {
  datasetKind: 'dataset-kind', generatedAt: 'generated-at', entityType: 'entity-type', forwardTo: 'forward-to',
  retentionDays: 'retention-days', jumpHost: 'jump-host', dualApproval: 'dual-approval', blastRadius: 'blast-radius',
  networkValue: 'network-value', heatSaturation: 'heat-saturation', maxEase: 'max-ease',
  minRetentionDays: 'min-retention-days', focusPlane: 'focus-plane', showLabel: 'show-label', crossLinks: 'cross-links',
  vizOnly: 'viz-only', noRunners: 'no-runners', observationCount: 'observation-count', relativeScore: 'relative-score',
  scoreNote: 'score-note', nodeIds: 'node-ids',
}

/**
 * Closed `datasetKind` labels upstream admits (`mithril.twin/dataset-kinds`). Both are non-live:
 * `synthetic-demo` is generated / fictional sample data; `workshop-export` is an illustrative diagram
 * hand-authored in a workshop and exported from the viewer, not collected from live systems.
 */
export const TWIN_DATASET_KINDS = ['synthetic-demo', 'workshop-export'] as const
export type TwinDatasetKind = (typeof TWIN_DATASET_KINDS)[number]
export const isTwinDatasetKind = (v: unknown): v is TwinDatasetKind => (TWIN_DATASET_KINDS as readonly unknown[]).includes(v)

export type MithFormat = 'form' | 'jsonld' | 'legacy-v0'
export type ReadMith = { doc: MithDocument; format: MithFormat; deprecated: boolean }

type J = unknown
const isObj = (v: J): v is Record<string, J> => !!v && typeof v === 'object' && !Array.isArray(v)
const refuse = (msg: string): never => {
  throw new MithParseError(msg)
}

// ---- Closed-vocabulary admission (mirrors mithril.twin/admit) --------------------------------
function checkNode(node: J, path: string) {
  if (Array.isArray(node)) return node.forEach((x, i) => checkNode(x, `${path}[${i}]`))
  if (!isObj(node)) return
  if ('@value' in node) {
    if (!Object.keys(node).every((k) => k === '@value' || k === '@type' || k === '@language')) refuse(`invalid literal at ${path}`)
    return
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === '@type') {
      for (const t of Array.isArray(v) ? v : [v]) if (!CLASS_SET.has(String(t))) refuse(`unknown twin class ${JSON.stringify(t)} at ${path}`)
    } else if (k === '@id') refuse(`twin nodes are referenced by :key, not :id, at ${path}`)
    else if (TERM_SET.has(k)) checkNode(v, `${path}.${k}`)
    else refuse(`unknown twin key "${k}" at ${path}`)
  }
}

/** Admit one lowered twin document (Form or JSON-LD spelling). */
export function admitTwin(doc: J): Record<string, J> {
  if (!isObj(doc)) return refuse('twin source must be one document')
  if (doc['@context'] !== TWIN_CONTEXT) refuse(`twin source must use the pinned twin context ${TWIN_CONTEXT}`)
  if (doc['@type'] !== 'TwinDocument') refuse(`@type must be TwinDocument (got ${JSON.stringify(doc['@type'])})`)
  for (const k of Object.keys(doc)) if (!TOP_LEVEL.has(k)) refuse(`unknown twin document key "${k}"`)
  const id = doc['@id']
  if (typeof id !== 'string' || !/^https:\/\/mithril\.fund\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/.test(id)) {
    refuse('twin document @id must be a mithril.fund HTTPS IRI')
  }
  if (!isTwinDatasetKind(doc.datasetKind)) refuse(`twin datasetKind must be one of ${TWIN_DATASET_KINDS.join(', ')}`)
  if (isObj(doc.diagram)) {
    for (const [term, allowed] of [['lens', DIAGRAM_LENSES], ['frame', DIAGRAM_FRAMES]] as const) {
      if (term in doc.diagram && !(allowed as readonly unknown[]).includes(doc.diagram[term])) {
        refuse(`twin diagram ${term} must be one of ${allowed.join(', ')}`)
      }
    }
  }
  const inf = doc.inference
  if (inf != null && !(isObj(inf) && inf.vizOnly === true && inf.noRunners === true)) refuse('twin inference must be vizOnly and noRunners')
  for (const [k, v] of Object.entries(doc)) if (!k.startsWith('@')) checkNode(v, k)
  return doc
}

// ---- Twin JSON-LD → in-memory document -------------------------------------------------------
const DECIMAL = new Set(['xsd:decimal', 'http://www.w3.org/2001/XMLSchema#decimal', 'xsd:double', 'http://www.w3.org/2001/XMLSchema#double'])
function n(v: J, path: string): number | undefined {
  if (v == null) return undefined
  if (typeof v === 'number') return v
  if (isObj(v) && typeof v['@value'] === 'string' && DECIMAL.has(String(v['@type']))) {
    const x = Number(v['@value'])
    if (Number.isFinite(x) && /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(v['@value'])) return x
  }
  return refuse(`${path} must be an integer or (rdf/literal "…" :datatype "xsd:decimal")`)
}
const many = (v: J): J[] => (v == null ? [] : Array.isArray(v) ? v : [v])
const one = (v: J, path: string): J => {
  if (Array.isArray(v)) return v.length === 1 ? v[0] : refuse(`${path} takes one value`)
  return v
}
const node = (v: J, path: string): Record<string, J> => {
  const x = one(v, path)
  return isObj(x) ? x : refuse(`${path} must be a node`)
}
/** Copy present keys (renamed), dropping undefined. */
function pick(src: Record<string, J>, map: Record<string, string>): Record<string, J> {
  const out: Record<string, J> = {}
  for (const [from, to] of Object.entries(map)) if (src[from] !== undefined && src[from] !== null) out[to] = src[from]
  return out
}
function numbers(src: Record<string, J>, keys: Record<string, string>, path: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [from, to] of Object.entries(keys)) {
    const x = n(src[from], `${path}.${from}`)
    if (x !== undefined) out[to] = x
  }
  return out
}

function entityRaw(e: Record<string, J>, i: number) {
  const at = `entities[${i}]`
  const attrs: Record<string, J> = {}
  for (const a of many(e.attrs)) {
    if (!isObj(a) || typeof a.key !== 'string') refuse(`${at}.attrs entries need :key and :value`)
    attrs[(a as Record<string, J>).key as string] = (a as Record<string, J>).value
  }
  return {
    ...pick(e, { key: 'id', label: 'label', entityType: 'type', layer: 'layer', boundary: 'boundary', zone: 'zone', sanctioned: 'sanctioned', source: 'source', criticality: 'criticality' }),
    citations: many(e.citations).map((c) => pick(node(c, `${at}.citations`), { source: 'source', note: 'note' })),
    attrs,
    ...(e.software != null ? { software: many(e.software).map((s) => pick(node(s, `${at}.software`), { name: 'name', version: 'version', vendor: 'vendor', sanctioned: 'sanctioned', eol: 'eol', vulnerability: 'vulnerability' })) } : {}),
    ...(e.logs != null
      ? (() => {
          const l = node(e.logs, `${at}.logs`)
          return {
            logs: {
              sources: many(l.sources),
              ...pick(l, { forwardTo: 'forwardTo' }),
              ...numbers(l, { retentionDays: 'retentionDays' }, `${at}.logs`),
              ...(l.events != null ? { events: many(l.events).map((ev) => pick(node(ev, `${at}.logs.events`), { at: 'at', source: 'source', action: 'action', severity: 'severity', user: 'user', note: 'note' })) } : {}),
            },
          }
        })()
      : {}),
    ...(e.users != null ? { users: many(e.users).map((u) => pick(node(u, `${at}.users`), { person: 'person', relation: 'relation' })) } : {}),
  }
}

function weightsRaw(w: Record<string, J>) {
  const sub = (k: string, keys: Record<string, string>) => (w[k] != null ? { [k]: numbers(node(w[k], `weights.${k}`), keys, `weights.${k}`) } : {})
  const dev = w.device != null ? node(w.device, 'weights.device') : null
  return {
    ...numbers(w, { base: 'base', pivot: 'pivot', host: 'host', blastRadius: 'blastRadius', networkValue: 'networkValue', jumpHost: 'jumpHost', heatSaturation: 'heatSaturation', minRetentionDays: 'minRetentionDays' }, 'weights'),
    ...sub('controls', { none: 'none', callback: 'callback', mfa: 'mfa', dualApproval: 'dual-approval' }),
    ...sub('reach', { open: 'open', conditional: 'conditional', blocked: 'blocked' }),
    ...sub('sync', { open: 'open', conditional: 'conditional' }),
    ...(dev
      ? {
          device: {
            ...numbers(dev, { eol: 'eol', unsanctioned: 'unsanctioned', maxEase: 'maxEase' }, 'weights.device'),
            ...(dev.vulnerability != null ? { vulnerability: numbers(node(dev.vulnerability, 'weights.device.vulnerability'), { low: 'low', medium: 'medium', high: 'high', critical: 'critical' }, 'weights.device.vulnerability') } : {}),
          },
        }
      : {}),
  }
}

const DEFAULT_DIAGRAM = {
  arrangement: 'coplanar',
  camera: { mode: 'iso', tilt: 54, yaw: -28, zoom: 1, focusPlane: 'org' },
  selection: null,
  planes: [{ id: 'org', layer: 'organization', label: 'Organization', transform: { x: 0, y: 0, z: 0, tilt: 0, yaw: 0 }, placements: [] }],
  crossLinks: [],
}

/** Lowered twin document → the legacy in-memory shape, validated by `parseMith`. */
export function twinToLegacy(doc: Record<string, J>): Record<string, J> {
  const list = (k: string, map: Record<string, string>, extra?: (x: Record<string, J>, i: number) => Record<string, J>) =>
    doc[k] == null ? undefined : many(doc[k]).map((x, i) => ({ ...pick(node(x, `${k}[${i}]`), map), ...(extra ? extra(node(x, `${k}[${i}]`), i) : {}) }))
  const model: Record<string, J> = {
    citations: many(doc.citations).map((c) => pick(node(c, 'citations'), { source: 'source', note: 'note' })),
    entities: many(doc.entities).map((e, i) => entityRaw(node(e, `entities[${i}]`), i)),
    edges: list('edges', { key: 'id', from: 'source', to: 'target', kind: 'kind' }) ?? [],
  }
  const sections: [string, Record<string, string>][] = [
    ['boundaries', { key: 'id', label: 'label', kind: 'kind', parent: 'parent' }],
    ['roles', { key: 'id', label: 'label', boundary: 'boundary', zone: 'zone' }],
    ['grants', { key: 'id', role: 'role', resource: 'resource', level: 'level' }],
    ['actors', { key: 'id', label: 'label', kind: 'kind' }],
    ['channels', { key: 'id', kind: 'kind', from: 'from', to: 'to' }],
    ['reach', { key: 'id', from: 'from', to: 'to', kind: 'kind', jumpHost: 'jumpHost' }],
  ]
  for (const [k, map] of sections) {
    const v = list(k, map, (x, i) =>
      k === 'roles' ? { holders: many(x.holders) } : k === 'channels' ? { verification: many(x.verification) } : k === 'reach' ? numbers(x, { weight: 'weight' }, `reach[${i}]`) : {},
    )
    if (v) model[k] = v
  }
  if (doc.weights != null) model.weights = weightsRaw(node(doc.weights, 'weights'))

  let diagram: Record<string, J> = DEFAULT_DIAGRAM
  if (doc.diagram != null) {
    const d = node(doc.diagram, 'diagram')
    const cam = d.camera != null ? node(d.camera, 'diagram.camera') : null
    diagram = {
      ...pick(d, { arrangement: 'arrangement' }),
      camera: cam ? { ...pick(cam, { mode: 'mode', focusPlane: 'focusPlane' }), ...numbers(cam, { tilt: 'tilt', yaw: 'yaw', zoom: 'zoom' }, 'diagram.camera') } : DEFAULT_DIAGRAM.camera,
      selection: d.selection ?? null,
      planes: many(d.planes).map((p, i) => {
        const pl = node(p, `diagram.planes[${i}]`)
        const t = pl.transform != null ? node(pl.transform, `diagram.planes[${i}].transform`) : {}
        return {
          ...pick(pl, { key: 'id', layer: 'layer', label: 'label' }),
          transform: numbers(t, { x: 'x', y: 'y', z: 'z', tilt: 'tilt', yaw: 'yaw' }, `diagram.planes[${i}].transform`),
          placements: many(pl.placements).map((q, j) => {
            const pq = node(q, `diagram.planes[${i}].placements[${j}]`)
            return { ...pick(pq, { entity: 'entity', tone: 'tone', showLabel: 'showLabel' }), ...numbers(pq, { x: 'x', y: 'y' }, `diagram.planes[${i}].placements[${j}]`) }
          }),
        }
      }),
      crossLinks: many(d.crossLinks).map((c, i) => pick(node(c, `diagram.crossLinks[${i}]`), { key: 'id', from: 'from', to: 'to', kind: 'kind' })),
      ...pick(d, { lens: 'lens', frame: 'frame' }),
    }
  }
  const inf = doc.inference != null ? node(doc.inference, 'inference') : { vizOnly: true, noRunners: true }
  const iri = doc['@id'] as string
  return {
    mith: '0.1',
    kind: 'document',
    id: iri.replace(/[/#]+$/, '').split(/[/#]/).pop(),
    title: doc.title,
    dataset_kind: doc.datasetKind,
    generated_at: doc.generatedAt ?? 'unspecified',
    disclaimer: doc.disclaimer ?? 'Synthetic demo data.',
    model,
    diagram,
    inference: {
      viz_only: inf.vizOnly === true,
      no_runners: inf.noRunners === true,
      hypotheses: many(inf.hypotheses).map((h, i) => {
        const x = node(h, `inference.hypotheses[${i}]`)
        return {
          ...pick(x, { key: 'id', label: 'label', summary: 'summary', category: 'category', honesty: 'honesty', scoreNote: 'score_note' }),
          ...numbers(x, { observationCount: 'observation_count', relativeScore: 'relative_score' }, `inference.hypotheses[${i}]`),
          node_ids: many(x.nodeIds),
          steps: many(x.steps).map((s, j) => pick(node(s, `inference.hypotheses[${i}].steps[${j}]`), { from: 'from', to: 'to', kind: 'kind' })),
        }
      }),
    },
  }
}

/** Parse any supported spelling. Form and twin JSON-LD are primary; v0 JSON is deprecated. */
export function readMith(text: string): ReadMith {
  if (isFormSource(text)) {
    const lowered = parseForm(text)
    if (lowered['@type'] !== 'TwinDocument') {
      refuse(`the viewer opens (mithril/twin-document …) forms; this form lowers to @type ${JSON.stringify(lowered['@type'])}`)
    }
    return { doc: parseMith(twinToLegacy(admitTwin(lowered))), format: 'form', deprecated: false }
  }
  let raw: J
  try {
    raw = JSON.parse(text)
  } catch {
    return refuse('source is neither a Mithril form nor JSON')
  }
  return readMithValue(raw)
}

/** Already-parsed JSON: twin JSON-LD or legacy v0. */
export function readMithValue(raw: J): ReadMith {
  if (isObj(raw) && '@context' in raw) return { doc: parseMith(twinToLegacy(admitTwin(raw))), format: 'jsonld', deprecated: false }
  if (isObj(raw) && raw.mith === '0.1') return { doc: parseMith(raw), format: 'legacy-v0', deprecated: true }
  return refuse('not a twin document: expected (mithril/twin-document …), twin JSON-LD, or legacy {"mith": "0.1"}')
}

/**
 * The pre-validation (v0-shaped) record for any supported spelling — handy for callers that
 * want to tweak a document before `parseMith` validates it (tests, the generator).
 */
export function readMithRaw(text: string): Record<string, unknown> {
  if (isFormSource(text)) return twinToLegacy(admitTwin(parseForm(text))) as Record<string, unknown>
  const raw = JSON.parse(text) as J
  if (isObj(raw) && '@context' in raw) return twinToLegacy(admitTwin(raw)) as Record<string, unknown>
  return raw as Record<string, unknown>
}

// ---- In-memory document → Mithril Form -------------------------------------------------------
const kw = (term: string) => `:${TWIN_KEYWORDS[term] ?? term}`
const q = (s: string) => JSON.stringify(s)
function val(v: unknown): string {
  if (typeof v === 'string') return q(v)
  if (typeof v === 'boolean') return String(v)
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new MithParseError('cannot write a non-finite number to Mithril Form')
    return Number.isInteger(v) ? String(v) : `(rdf/literal ${q(String(v))} :datatype "xsd:decimal")`
  }
  if (v == null) return 'nil'
  if (Array.isArray(v)) return `[${v.map(val).join(' ')}]`
  return rdfNode(v as Record<string, unknown>)
}
function rdfNode(o: Record<string, unknown>, type?: string): string {
  const parts: string[] = type ? [`:type ${q(type)}`] : []
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined) continue
    parts.push(`${kw(k)} ${val(v)}`)
  }
  return `(rdf/node ${parts.join(' ')})`
}
const ren = (o: object, map: Record<string, string>) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [map[k] ?? k, v]))

function entityForm(e: MithEntity): string {
  const { id, type, attrs, citations, ...rest } = e
  const o: Record<string, unknown> = { key: id, label: rest.label, entityType: type, layer: rest.layer }
  for (const k of ['boundary', 'zone', 'sanctioned', 'source', 'criticality'] as const) if (rest[k] !== undefined) o[k] = rest[k]
  if (citations.length) o.citations = citations
  const attrList = Object.entries(attrs).map(([key, value]) => ({ key, value }))
  if (attrList.length) o.attrs = attrList
  if (e.software) o.software = e.software
  if (e.logs) o.logs = e.logs
  if (e.users) o.users = e.users
  return rdfNode(o, e.software || e.logs || e.users ? 'Device' : undefined)
}

function weightsForm(w: MithWeights): Record<string, unknown> {
  const o: Record<string, unknown> = { ...w }
  if (w.controls) o.controls = ren(w.controls, { 'dual-approval': 'dualApproval' })
  return o
}

/**
 * Write a document as `(mithril/twin-document …)`. `iri` names the document; ids stay `:key`
 * literals. One top-level node per line so diffs stay readable.
 */
export function toTwinForm(doc: MithDocument, iri = `https://mithril.fund/lib/twin/${doc.id}`): string {
  if (!isTwinDatasetKind(doc.dataset_kind)) {
    refuse(`Mithril twin Form only admits dataset-kind ${TWIN_DATASET_KINDS.join(' / ')}; this document declares ${JSON.stringify(doc.dataset_kind)}`)
  }
  const m = doc.model
  const lines: string[] = [
    '(mithril/twin-document',
    `  ;; Twin vocabulary for Mithril .mith (twin-local terms: https://mithril.fund/lib/twin/v1#). ${doc.dataset_kind === 'synthetic-demo' ? 'Synthetic' : 'Illustrative workshop export'}, display-only.`,
    `  :id ${q(iri)}`,
    `  :title ${q(doc.title)}`,
    `  :dataset-kind ${q(doc.dataset_kind)}`,
    `  :generated-at ${q(doc.generated_at)}`,
    `  :disclaimer ${q(doc.disclaimer)}`,
  ]
  const block = (term: string, items: string[]) => {
    if (!items.length) return lines.push(`  ${kw(term)} []`)
    lines.push(`  ${kw(term)}`, `  [${items.join('\n   ')}]`)
  }
  if (m.citations.length) block('citations', m.citations.map((c) => rdfNode(c)))
  block('entities', m.entities.map(entityForm))
  block('edges', m.edges.map((e) => rdfNode({ key: e.id, from: e.source, to: e.target, kind: e.kind })))
  if (m.boundaries) block('boundaries', m.boundaries.map((b) => rdfNode(ren(b, { id: 'key' }))))
  if (m.roles) block('roles', m.roles.map((r) => rdfNode(ren(r, { id: 'key' }))))
  if (m.grants) block('grants', m.grants.map((g) => rdfNode(ren(g, { id: 'key' }))))
  if (m.actors) block('actors', m.actors.map((a) => rdfNode(ren(a, { id: 'key' }))))
  if (m.channels) block('channels', m.channels.map((c) => rdfNode(ren(c, { id: 'key' }))))
  if (m.reach) block('reach', m.reach.map((r) => rdfNode(ren(r, { id: 'key' }))))
  if (m.weights) lines.push(`  :weights ${rdfNode(weightsForm(m.weights))}`)
  const d = doc.diagram
  const diagram = {
    arrangement: d.arrangement,
    camera: d.camera,
    ...(d.selection ? { selection: d.selection } : {}),
    planes: d.planes.map((p) => ({ key: p.id, layer: p.layer, label: p.label, transform: p.transform, placements: p.placements })),
    crossLinks: d.crossLinks.map((c) => ren(c, { id: 'key' })),
    ...(d.lens ? { lens: d.lens } : {}),
    ...(d.frame ? { frame: d.frame } : {}),
  }
  lines.push(`  :diagram ${rdfNode(diagram)}`)
  const inf = {
    vizOnly: true,
    noRunners: true,
    hypotheses: doc.inference.hypotheses.map((h) => ({
      key: h.id, label: h.label, summary: h.summary, category: h.category, honesty: h.honesty,
      observationCount: h.observation_count, relativeScore: h.relative_score, scoreNote: h.score_note,
      nodeIds: h.node_ids, steps: h.steps,
    })),
  }
  lines.push(`  :inference ${rdfNode(inf)})`)
  return lines.join('\n') + '\n'
}
