import {
  BOUNDARY_KINDS,
  CRITICALITIES,
  type MithCriticality,
  GRANT_LEVELS,
  DIAGRAM_FRAMES,
  DIAGRAM_LENSES,
  MITH_VERSION,
  VERIFICATION_CONTROLS,
  type MithActor,
  type MithBoundary,
  type MithBoundaryKind,
  type MithChannel,
  type MithGrant,
  type MithGrantLevel,
  type MithRole,
  type MithVerification,
  REACH_KINDS,
  type MithReach,
  type MithReachKind,
  type MithWeights,
  type DiagramFrame,
  type DiagramLens,
  type MithArrangement,
  type MithCamera,
  type MithCrossLink,
  type MithDocument,
  type MithEdge,
  type MithEntity,
  type MithHypothesis,
  type MithPlane,
  type MithPlacement,
  type MithrilPackage,
  type MithCitation,
  DEVICE_USER_RELATIONS,
  LOG_SEVERITIES,
  LOG_SOURCES,
  VULN_SEVERITIES,
  type MithDeviceLogs,
  type MithDeviceRelation,
  type MithLogSeverity,
  type MithLogSource,
  type MithSoftware,
  type MithVulnSeverity,
} from './types'
import { COPLANAR_BOARD_H, COPLANAR_BOARD_W } from './geometry'

export class MithParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MithParseError'
  }
}

const FORBIDDEN = ['runner', 'execute', 'executor', 'payload', 'secret', 'secrets', 'weaponize']

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function str(v: unknown, path: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new MithParseError(`${path} must be a non-empty string`)
  return v
}

/**
 * The file's own label. Samples use `synthetic-demo`; any other declared label is kept.
 * Empty, huge, or control-character values are rejected so the chip stays a label.
 */
function datasetKind(v: unknown, path: string): string {
  if (typeof v !== 'string') throw new MithParseError(`${path} must be a string`)
  if (!v.trim() || v !== v.trim()) {
    throw new MithParseError(`${path} must be a non-empty label without surrounding space`)
  }
  if (v.length > 64) throw new MithParseError(`${path} must be at most 64 characters`)
  for (let i = 0; i < v.length; i++) {
    if (v.charCodeAt(i) < 32) throw new MithParseError(`${path} must not contain control characters`)
  }
  return v
}

function num(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new MithParseError(`${path} must be a finite number`)
  return v
}

const FORBIDDEN_SET = new Set(FORBIDDEN)
/** Fast pre-check (no path strings); the path-building walk runs only to name the offender. */
function hasForbidden(value: unknown): boolean {
  if (Array.isArray(value)) {
    for (const item of value) if (hasForbidden(item)) return true
    return false
  }
  if (!isObj(value)) return false
  for (const key in value) {
    if (FORBIDDEN_SET.has(key.toLowerCase()) || hasForbidden(value[key])) return true
  }
  return false
}

function rejectForbidden(value: unknown, path: string) {
  if (!hasForbidden(value)) return
  rejectForbiddenAt(value, path)
}

function rejectForbiddenAt(value: unknown, path: string) {
  if (Array.isArray(value)) {
    value.forEach((item, i) => rejectForbiddenAt(item, `${path}[${i}]`))
    return
  }
  if (!isObj(value)) return
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN.includes(key.toLowerCase())) {
      throw new MithParseError(`${path}.${key} is not allowed in a .mith document`)
    }
    rejectForbiddenAt(child, `${path}.${key}`)
  }
}

function citations(v: unknown, path: string): MithCitation[] {
  if (v == null) return []
  if (!Array.isArray(v)) throw new MithParseError(`${path} must be an array`)
  return v.map((item, i) => {
    if (!isObj(item)) throw new MithParseError(`${path}[${i}] must be an object`)
    return {
      source: str(item.source, `${path}[${i}].source`),
      ...(typeof item.note === 'string' ? { note: item.note } : {}),
    }
  })
}

function attrs(v: unknown, path: string): Record<string, string> {
  if (v == null) return {}
  if (!isObj(v)) throw new MithParseError(`${path} must be an object`)
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(v)) {
    if (typeof value !== 'string') throw new MithParseError(`${path}.${key} must be a string`)
    out[key] = value
  }
  return out
}

function entity(v: unknown, i: number): MithEntity {
  if (!isObj(v)) throw new MithParseError(`model.entities[${i}] must be an object`)
  const path = `model.entities[${i}]`
  if (v.sanctioned != null && typeof v.sanctioned !== 'boolean') {
    throw new MithParseError(`${path}.sanctioned must be true or false`)
  }
  // Optional org / network / shadow-IT fields are only copied when present,
  // so a document from before these fields parses to the same shape.
  return {
    id: str(v.id, `${path}.id`),
    label: str(v.label, `${path}.label`),
    type: str(v.type, `${path}.type`),
    layer: str(v.layer, `${path}.layer`),
    citations: citations(v.citations, `${path}.citations`),
    attrs: attrs(v.attrs, `${path}.attrs`),
    ...(v.boundary != null ? { boundary: str(v.boundary, `${path}.boundary`) } : {}),
    ...(v.zone != null ? { zone: str(v.zone, `${path}.zone`) } : {}),
    ...(typeof v.sanctioned === 'boolean' ? { sanctioned: v.sanctioned } : {}),
    ...(v.source != null ? { source: str(v.source, `${path}.source`) } : {}),
    ...(v.criticality != null
      ? { criticality: oneOf<MithCriticality>(v.criticality, CRITICALITIES, `${path}.criticality`) }
      : {}),
    ...deviceFields(v, path),
  }
}

export const MAX_SAMPLE_EVENTS = 50

/** Device-only sections: software inventory, logging, and the people who use the device. */
function deviceFields(v: Record<string, unknown>, path: string): Pick<MithEntity, 'software' | 'logs' | 'users'> {
  const out: Pick<MithEntity, 'software' | 'logs' | 'users'> = {}
  if (v.software == null && v.logs == null && v.users == null) return out
  if (v.layer !== 'node') {
    throw new MithParseError(`${path} has software / logs / users, which are only allowed on node-layer devices`)
  }
  if (v.software != null) out.software = section(v.software, `${path}.software`, softwareItem)
  if (v.logs != null) out.logs = deviceLogs(v.logs, `${path}.logs`)
  if (v.users != null) {
    out.users = section(v.users, `${path}.users`, (u, at) => ({
      person: str(u.person, `${at}.person`),
      relation: oneOf<MithDeviceRelation>(u.relation, DEVICE_USER_RELATIONS, `${at}.relation`),
    }))
    const primaries = out.users.filter((u) => u.relation === 'primary')
    if (primaries.length > 1) throw new MithParseError(`${path}.users has ${primaries.length} primary users (at most one)`)
    const seen = new Set<string>()
    for (const u of out.users) {
      if (seen.has(u.person)) throw new MithParseError(`${path}.users lists ${u.person} twice`)
      seen.add(u.person)
    }
    const owner = isObj(v.attrs) && typeof v.attrs.owner === 'string' ? v.attrs.owner : null
    if (owner && primaries[0] && primaries[0].person !== owner) {
      throw new MithParseError(`${path}.users primary ${primaries[0].person} differs from attrs.owner ${owner}`)
    }
  }
  return out
}

function softwareItem(sw: Record<string, unknown>, at: string): MithSoftware {
  return {
    name: str(sw.name, `${at}.name`),
    version: str(sw.version, `${at}.version`),
    ...(sw.vendor != null ? { vendor: str(sw.vendor, `${at}.vendor`) } : {}),
    ...(sw.sanctioned != null ? { sanctioned: bool(sw.sanctioned, `${at}.sanctioned`) } : {}),
    ...(sw.eol != null ? { eol: bool(sw.eol, `${at}.eol`) } : {}),
    ...(sw.vulnerability != null ? { vulnerability: oneOf<MithVulnSeverity>(sw.vulnerability, VULN_SEVERITIES, `${at}.vulnerability`) } : {}),
  }
}

function deviceLogs(v: unknown, path: string): MithDeviceLogs {
  if (!isObj(v)) throw new MithParseError(`${path} must be an object`)
  if (!Array.isArray(v.sources)) throw new MithParseError(`${path}.sources must be an array (may be empty)`)
  const sources = v.sources.map((x, j) => oneOf<MithLogSource>(x, LOG_SOURCES, `${path}.sources[${j}]`))
  if (new Set(sources).size !== sources.length) throw new MithParseError(`${path}.sources lists a source twice`)
  const forwardTo = str(v.forwardTo, `${path}.forwardTo`)
  if (!/^[a-z0-9][a-z0-9:._-]*$/.test(forwardTo)) {
    throw new MithParseError(`${path}.forwardTo must be a destination id such as "siem" or "none"`)
  }
  const retentionDays = num(v.retentionDays, `${path}.retentionDays`)
  if (!Number.isInteger(retentionDays) || retentionDays < 0 || retentionDays > 3650) {
    throw new MithParseError(`${path}.retentionDays must be a whole number of days from 0 to 3650`)
  }
  const out: MithDeviceLogs = { sources, forwardTo, retentionDays }
  if (v.events != null) {
    if (!Array.isArray(v.events)) throw new MithParseError(`${path}.events must be an array`)
    if (v.events.length > MAX_SAMPLE_EVENTS) throw new MithParseError(`${path}.events keeps at most ${MAX_SAMPLE_EVENTS} synthetic samples`)
    out.events = section(v.events, `${path}.events`, (e, at) => {
      const when = str(e.at, `${at}.at`)
      if (Number.isNaN(Date.parse(when))) throw new MithParseError(`${at}.at must be an ISO 8601 timestamp`)
      return {
        at: when,
        source: oneOf<MithLogSource>(e.source, LOG_SOURCES, `${at}.source`),
        action: str(e.action, `${at}.action`),
        ...(e.severity != null ? { severity: oneOf<MithLogSeverity>(e.severity, LOG_SEVERITIES, `${at}.severity`) } : {}),
        ...(e.user != null ? { user: str(e.user, `${at}.user`) } : {}),
        ...(e.note != null ? { note: str(e.note, `${at}.note`) } : {}),
      }
    })
  }
  return out
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], path: string): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw new MithParseError(`${path} must be one of ${allowed.join(', ')}`)
  }
  return v as T
}

function optionalOne<T extends string>(v: unknown, allowed: readonly T[], path: string): T | undefined {
  if (v == null) return undefined
  return oneOf(v, allowed, path)
}

function section<T>(v: unknown, path: string, each: (item: Record<string, unknown>, at: string) => T): T[] {
  if (!Array.isArray(v)) throw new MithParseError(`${path} must be an array`)
  return v.map((item, i) => {
    const at = `${path}[${i}]`
    if (!isObj(item)) throw new MithParseError(`${at} must be an object`)
    return each(item, at)
  })
}

function uniqueIds(items: { id: string }[], path: string, taken: Set<string>) {
  for (const item of items) {
    if (taken.has(item.id)) throw new MithParseError(`${path} id ${item.id} is already used`)
    taken.add(item.id)
  }
}

type OrgSections = {
  boundaries?: MithBoundary[]
  roles?: MithRole[]
  grants?: MithGrant[]
  actors?: MithActor[]
  channels?: MithChannel[]
  reach?: MithReach[]
  weights?: MithWeights
}

function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') throw new MithParseError(`${path} must be true or false`)
  return v
}

function nonNeg(v: unknown, path: string): number {
  const n = num(v, path)
  if (n < 0) throw new MithParseError(`${path} must be 0 or more`)
  return n
}

function weightMap<K extends string>(v: unknown, allowed: readonly K[], path: string): Partial<Record<K, number>> {
  if (!isObj(v)) throw new MithParseError(`${path} must be an object`)
  const out: Partial<Record<K, number>> = {}
  for (const [key, value] of Object.entries(v)) {
    const k = oneOf<K>(key, allowed, `${path} key`)
    out[k] = nonNeg(value, `${path}.${key}`)
  }
  return out
}

/** Optional per-document weight overrides. Unknown keys are rejected so typos surface. */
function weights(v: unknown): MithWeights {
  if (!isObj(v)) throw new MithParseError('model.weights must be an object')
  const known = ['base', 'controls', 'reach', 'pivot', 'host', 'blastRadius', 'networkValue', 'jumpHost', 'sync', 'heatSaturation', 'device', 'minRetentionDays']
  for (const key of Object.keys(v)) {
    if (!known.includes(key)) throw new MithParseError(`model.weights.${key} is not a known weight (${known.join(', ')})`)
  }
  return {
    ...(v.base != null ? { base: nonNeg(v.base, 'model.weights.base') } : {}),
    ...(v.controls != null ? { controls: weightMap<MithVerification>(v.controls, VERIFICATION_CONTROLS, 'model.weights.controls') } : {}),
    ...(v.reach != null ? { reach: weightMap<MithReachKind>(v.reach, REACH_KINDS, 'model.weights.reach') } : {}),
    ...(v.pivot != null ? { pivot: nonNeg(v.pivot, 'model.weights.pivot') } : {}),
    ...(v.host != null ? { host: nonNeg(v.host, 'model.weights.host') } : {}),
    ...(v.blastRadius != null ? { blastRadius: nonNeg(v.blastRadius, 'model.weights.blastRadius') } : {}),
    ...(v.networkValue != null ? { networkValue: inRange(v.networkValue, 'model.weights.networkValue', 0, 1, true) } : {}),
    ...(v.jumpHost != null ? { jumpHost: nonNeg(v.jumpHost, 'model.weights.jumpHost') } : {}),
    ...(v.sync != null ? { sync: weightMap<'open' | 'conditional'>(v.sync, ['open', 'conditional'] as const, 'model.weights.sync') } : {}),
    ...(v.heatSaturation != null ? { heatSaturation: inRange(v.heatSaturation, 'model.weights.heatSaturation', 0, 1, false) } : {}),
    ...(v.device != null ? { device: deviceWeights(v.device) } : {}),
    ...(v.minRetentionDays != null ? { minRetentionDays: wholeDays(v.minRetentionDays, 'model.weights.minRetentionDays') } : {}),
  }
}

function wholeDays(v: unknown, path: string): number {
  const n = num(v, path)
  if (!Number.isInteger(n) || n < 1 || n > 3650) throw new MithParseError(`${path} must be a whole number of days from 1 to 3650`)
  return n
}

/** Device compromise-ease weights: every value in [0, 1]; unknown keys rejected. */
function deviceWeights(v: unknown): NonNullable<MithWeights['device']> {
  const path = 'model.weights.device'
  if (!isObj(v)) throw new MithParseError(`${path} must be an object`)
  const known = ['eol', 'unsanctioned', 'vulnerability', 'maxEase']
  for (const key of Object.keys(v)) {
    if (!known.includes(key)) throw new MithParseError(`${path}.${key} is not a known weight (${known.join(', ')})`)
  }
  const unit = (x: unknown, at: string) => inRange(x, at, 0, 1, true)
  const out: NonNullable<MithWeights['device']> = {}
  if (v.eol != null) out.eol = unit(v.eol, `${path}.eol`)
  if (v.unsanctioned != null) out.unsanctioned = unit(v.unsanctioned, `${path}.unsanctioned`)
  if (v.maxEase != null) out.maxEase = unit(v.maxEase, `${path}.maxEase`)
  if (v.vulnerability != null) {
    const vv = v.vulnerability
    if (!isObj(vv)) throw new MithParseError(`${path}.vulnerability must be an object`)
    const sev = ['low', 'medium', 'high', 'critical'] as const
    const m: Partial<Record<(typeof sev)[number], number>> = {}
    for (const [key, value] of Object.entries(vv)) {
      const k = oneOf(key, sev, `${path}.vulnerability key`)
      m[k] = unit(value, `${path}.vulnerability.${key}`)
    }
    out.vulnerability = m
  }
  return out
}

/** Number in [lo, hi] (or (lo, hi] when `loInclusive` is false). */
function inRange(v: unknown, path: string, lo: number, hi: number, loInclusive: boolean): number {
  const n = num(v, path)
  if ((loInclusive ? n < lo : n <= lo) || n > hi) {
    throw new MithParseError(`${path} must be ${loInclusive ? 'between' : 'above'} ${lo} ${loInclusive ? 'and' : 'and at most'} ${hi}`)
  }
  return n
}

/**
 * Org boundaries, roles, grants, external actors, and channels.
 * Every section is optional. Absent sections stay absent on the result.
 */
function orgSections(model: Record<string, unknown>, entities: MithEntity[]): OrgSections {
  const out: OrgSections = {}
  const entityById = new Map(entities.map((e) => [e.id, e]))
  const taken = new Set(entities.map((e) => e.id))

  if (model.boundaries != null) {
    out.boundaries = section(model.boundaries, 'model.boundaries', (b, at) => ({
      id: str(b.id, `${at}.id`),
      label: str(b.label, `${at}.label`),
      kind: oneOf<MithBoundaryKind>(b.kind, BOUNDARY_KINDS, `${at}.kind`),
      ...(b.parent != null ? { parent: str(b.parent, `${at}.parent`) } : {}),
    }))
    uniqueIds(out.boundaries, 'model.boundaries', taken)
  }
  const boundaryIds = new Set((out.boundaries ?? []).map((b) => b.id))
  const parentOf = new Map((out.boundaries ?? []).map((b) => [b.id, b.parent]))
  for (const b of out.boundaries ?? []) {
    if (b.parent != null && !boundaryIds.has(b.parent)) {
      throw new MithParseError(`boundary ${b.id} names parent ${b.parent}, which is not in model.boundaries`)
    }
    const seen = new Set<string>([b.id])
    let cur = b.parent
    while (cur != null) {
      if (seen.has(cur)) throw new MithParseError(`boundary ${b.id} is inside itself (parent cycle through ${cur})`)
      seen.add(cur)
      cur = parentOf.get(cur)
    }
  }

  for (const e of entities) {
    if (e.boundary != null && !boundaryIds.has(e.boundary)) {
      throw new MithParseError(`entity ${e.id} names boundary ${e.boundary}, which is not in model.boundaries`)
    }
    if (e.zone != null) {
      const zone = entityById.get(e.zone)
      if (!zone || zone.layer !== 'network') {
        throw new MithParseError(`entity ${e.id} names zone ${e.zone}, which is not a network-layer entity`)
      }
      if (e.zone === e.id) throw new MithParseError(`entity ${e.id} cannot be its own zone`)
    }
  }

  for (const e of entities) {
    for (const u of e.users ?? []) {
      if (!entityById.has(u.person)) throw new MithParseError(`device ${e.id} user ${u.person} is not in model.entities`)
    }
    for (const ev of e.logs?.events ?? []) {
      if (ev.user != null && !entityById.has(ev.user)) throw new MithParseError(`device ${e.id} log event user ${ev.user} is not in model.entities`)
    }
  }

  if (model.roles != null) {
    out.roles = section(model.roles, 'model.roles', (r, at) => {
      if (!Array.isArray(r.holders)) throw new MithParseError(`${at}.holders must be an array`)
      return {
        id: str(r.id, `${at}.id`),
        label: str(r.label, `${at}.label`),
        boundary: str(r.boundary, `${at}.boundary`),
        holders: r.holders.map((h, j) => str(h, `${at}.holders[${j}]`)),
        ...(r.zone != null ? { zone: str(r.zone, `${at}.zone`) } : {}),
      }
    })
    uniqueIds(out.roles, 'model.roles', taken)
    for (const r of out.roles) {
      if (!boundaryIds.has(r.boundary)) {
        throw new MithParseError(`role ${r.id} names boundary ${r.boundary}, which is not in model.boundaries`)
      }
      for (const h of r.holders) {
        if (!entityById.has(h)) throw new MithParseError(`role ${r.id} holder ${h} is not in model.entities`)
      }
      if (r.zone != null && entityById.get(r.zone)?.layer !== 'network') {
        throw new MithParseError(`role ${r.id} names zone ${r.zone}, which is not a network-layer entity`)
      }
    }
  }
  const roleIds = new Set((out.roles ?? []).map((r) => r.id))

  if (model.grants != null) {
    out.grants = section(model.grants, 'model.grants', (g, at) => ({
      id: str(g.id, `${at}.id`),
      role: str(g.role, `${at}.role`),
      resource: str(g.resource, `${at}.resource`),
      level: oneOf<MithGrantLevel>(g.level, GRANT_LEVELS, `${at}.level`),
    }))
    uniqueIds(out.grants, 'model.grants', taken)
    for (const g of out.grants) {
      if (!roleIds.has(g.role)) throw new MithParseError(`grant ${g.id} names role ${g.role}, which is not in model.roles`)
      if (!entityById.has(g.resource)) {
        throw new MithParseError(`grant ${g.id} names resource ${g.resource}, which is not in model.entities`)
      }
    }
  }

  if (model.actors != null) {
    out.actors = section(model.actors, 'model.actors', (a, at) => {
      if (a.kind !== 'external') throw new MithParseError(`${at}.kind must be external`)
      return { id: str(a.id, `${at}.id`), label: str(a.label, `${at}.label`), kind: 'external' as const }
    })
    uniqueIds(out.actors, 'model.actors', taken)
  }
  const actorIds = new Set((out.actors ?? []).map((a) => a.id))

  if (model.channels != null) {
    out.channels = section(model.channels, 'model.channels', (c, at) => {
      if (!Array.isArray(c.verification)) throw new MithParseError(`${at}.verification must be an array`)
      return {
        id: str(c.id, `${at}.id`),
        kind: str(c.kind, `${at}.kind`),
        from: str(c.from, `${at}.from`),
        to: str(c.to, `${at}.to`),
        verification: c.verification.map((v, j) =>
          oneOf<MithVerification>(v, VERIFICATION_CONTROLS, `${at}.verification[${j}]`),
        ),
      }
    })
    uniqueIds(out.channels, 'model.channels', taken)
    for (const c of out.channels) {
      if (!actorIds.has(c.from) && !roleIds.has(c.from)) {
        throw new MithParseError(`channel ${c.id} starts at ${c.from}, which is not an actor or role`)
      }
      if (!roleIds.has(c.to)) throw new MithParseError(`channel ${c.id} ends at ${c.to}, which is not a role`)
    }
  }

  if (model.reach != null) {
    out.reach = section(model.reach, 'model.reach', (r, at) => ({
      id: str(r.id, `${at}.id`),
      from: str(r.from, `${at}.from`),
      to: str(r.to, `${at}.to`),
      kind: oneOf<MithReachKind>(r.kind, REACH_KINDS, `${at}.kind`),
      ...(r.weight != null ? { weight: nonNeg(r.weight, `${at}.weight`) } : {}),
      ...(r.jumpHost != null ? { jumpHost: bool(r.jumpHost, `${at}.jumpHost`) } : {}),
    }))
    uniqueIds(out.reach, 'model.reach', taken)
    for (const r of out.reach) {
      for (const [end, id] of [['from', r.from], ['to', r.to]] as const) {
        if (entityById.get(id)?.layer !== 'network') {
          throw new MithParseError(`reach ${r.id} ${end} ${id} is not a network-layer entity (zone)`)
        }
      }
      if (r.from === r.to) throw new MithParseError(`reach ${r.id} cannot go from a zone to itself`)
    }
  }
  if (model.weights != null) out.weights = weights(model.weights)
  return out
}

function edge(v: unknown, i: number): MithEdge {
  if (!isObj(v)) throw new MithParseError(`model.edges[${i}] must be an object`)
  return {
    id: str(v.id, `model.edges[${i}].id`),
    source: str(v.source, `model.edges[${i}].source`),
    target: str(v.target, `model.edges[${i}].target`),
    kind: str(v.kind, `model.edges[${i}].kind`),
  }
}

function placement(v: unknown, path: string): MithPlacement {
  if (!isObj(v)) throw new MithParseError(`${path} must be an object`)
  const tone = v.tone
  if (tone != null && tone !== 'quiet' && tone !== 'accent' && tone !== 'info') {
    throw new MithParseError(`${path}.tone must be quiet, accent, or info`)
  }
  const x = num(v.x, `${path}.x`)
  const y = num(v.y, `${path}.y`)
  if (x < 0 || x > 1 || y < 0 || y > 1) throw new MithParseError(`${path} x/y must be within 0..1`)
  return {
    entity: str(v.entity, `${path}.entity`),
    x,
    y,
    ...(tone ? { tone } : {}),
    ...(v.showLabel === true ? { showLabel: true } : {}),
  }
}

function plane(v: unknown, i: number): MithPlane {
  if (!isObj(v)) throw new MithParseError(`diagram.planes[${i}] must be an object`)
  const t = v.transform
  if (!isObj(t)) throw new MithParseError(`diagram.planes[${i}].transform must be an object`)
  if (!Array.isArray(v.placements)) throw new MithParseError(`diagram.planes[${i}].placements must be an array`)
  return {
    id: str(v.id, `diagram.planes[${i}].id`),
    layer: str(v.layer, `diagram.planes[${i}].layer`),
    label: str(v.label, `diagram.planes[${i}].label`),
    transform: {
      x: num(t.x, `diagram.planes[${i}].transform.x`),
      y: num(t.y, `diagram.planes[${i}].transform.y`),
      z: num(t.z, `diagram.planes[${i}].transform.z`),
      tilt: num(t.tilt, `diagram.planes[${i}].transform.tilt`),
      yaw: num(t.yaw, `diagram.planes[${i}].transform.yaw`),
    },
    placements: v.placements.map((p, j) => placement(p, `diagram.planes[${i}].placements[${j}]`)),
  }
}

function crossLink(v: unknown, i: number): MithCrossLink {
  if (!isObj(v)) throw new MithParseError(`diagram.crossLinks[${i}] must be an object`)
  return {
    id: str(v.id, `diagram.crossLinks[${i}].id`),
    from: str(v.from, `diagram.crossLinks[${i}].from`),
    to: str(v.to, `diagram.crossLinks[${i}].to`),
    kind: str(v.kind, `diagram.crossLinks[${i}].kind`),
  }
}

function sameNumber(a: number, b: number) {
  return Math.abs(a - b) < 0.001
}

function zValuesDiffer(planes: MithPlane[]) {
  const origin = planes[0]?.transform.z ?? 0
  return planes.some((p) => !sameNumber(p.transform.z, origin))
}

/**
 * Missing `arrangement` keeps 0.1 files from before the field.
 * Distinct z (the original stacked v0 sample) is stacked. A shared z is coplanar.
 */
function resolveArrangement(raw: unknown, planes: MithPlane[]): MithArrangement {
  if (raw == null) return zValuesDiffer(planes) ? 'stacked' : 'coplanar'
  if (raw !== 'coplanar' && raw !== 'stacked') {
    throw new MithParseError(
      'diagram.arrangement must be "coplanar" (one floor, shared z, different x/y) or "stacked"',
    )
  }
  return raw
}

function boardRectsOverlap(a: MithPlane, b: MithPlane) {
  const w = COPLANAR_BOARD_W
  const h = COPLANAR_BOARD_H
  return (
    a.transform.x < b.transform.x + w &&
    b.transform.x < a.transform.x + w &&
    a.transform.y < b.transform.y + h &&
    b.transform.y < a.transform.y + h
  )
}

/** Coplanar boards share a floor. Stacked layers stair-step on z. */
function assertArrangement(arrangement: MithArrangement, planes: MithPlane[], explicit: boolean) {
  if (planes.length <= 1) return
  const origin = planes[0]!
  const sameZ = !zValuesDiffer(planes)
  if (arrangement === 'coplanar' && !sameZ) {
    const detail = planes.map((p) => `${p.id} z=${p.transform.z}`).join(', ')
    throw new MithParseError(
      `coplanar arrangement keeps every board on one floor (shared transform.z, different x/y). These planes use different z: ${detail}. Set diagram.arrangement to "stacked" only for a vertical stair.`,
    )
  }
  if (arrangement === 'coplanar') {
    for (let i = 0; i < planes.length; i++) {
      for (let j = i + 1; j < planes.length; j++) {
        const a = planes[i]!
        const b = planes[j]!
        if (!boardRectsOverlap(a, b)) continue
        throw new MithParseError(
          `coplanar boards overlap on the floor (each board is ${COPLANAR_BOARD_W}×${COPLANAR_BOARD_H}). ${a.id} at (${a.transform.x}, ${a.transform.y}) overlaps ${b.id} at (${b.transform.x}, ${b.transform.y}). Spread transform.x / transform.y so the rectangles do not intersect.`,
        )
      }
    }
  }
  if (explicit && arrangement === 'stacked' && sameZ) {
    throw new MithParseError(
      `stacked arrangement expects distinct transform.z so layers stair-step. Every plane shares z=${origin.transform.z}. Use diagram.arrangement "coplanar" for a same-layer grid.`,
    )
  }
}

function camera(v: unknown): MithCamera {
  if (!isObj(v)) throw new MithParseError('diagram.camera must be an object')
  const mode = v.mode
  if (mode !== 'iso' && mode !== 'ortho') throw new MithParseError('diagram.camera.mode must be iso or ortho')
  return {
    mode,
    tilt: num(v.tilt, 'diagram.camera.tilt'),
    yaw: num(v.yaw, 'diagram.camera.yaw'),
    zoom: num(v.zoom, 'diagram.camera.zoom'),
    focusPlane: str(v.focusPlane, 'diagram.camera.focusPlane'),
  }
}

function hypothesis(v: unknown, i: number): MithHypothesis {
  if (!isObj(v)) throw new MithParseError(`inference.hypotheses[${i}] must be an object`)
  if (v.honesty !== 'hypothesis') {
    throw new MithParseError(`inference.hypotheses[${i}].honesty must be "hypothesis"`)
  }
  const observation = num(v.observation_count, `inference.hypotheses[${i}].observation_count`)
  if (observation !== 0) {
    throw new MithParseError(`inference.hypotheses[${i}] must stay observation_count=0 in v0`)
  }
  const score = num(v.relative_score, `inference.hypotheses[${i}].relative_score`)
  if (score < 0 || score > 1) throw new MithParseError(`inference.hypotheses[${i}].relative_score must be 0..1`)
  if (!Array.isArray(v.node_ids) || !Array.isArray(v.steps)) {
    throw new MithParseError(`inference.hypotheses[${i}] needs node_ids and steps arrays`)
  }
  return {
    id: str(v.id, `inference.hypotheses[${i}].id`),
    label: str(v.label, `inference.hypotheses[${i}].label`),
    summary: str(v.summary, `inference.hypotheses[${i}].summary`),
    category: str(v.category, `inference.hypotheses[${i}].category`),
    honesty: 'hypothesis',
    observation_count: 0,
    relative_score: score,
    score_note: str(v.score_note, `inference.hypotheses[${i}].score_note`),
    node_ids: v.node_ids.map((id, j) => str(id, `inference.hypotheses[${i}].node_ids[${j}]`)),
    steps: v.steps.map((step, j) => {
      if (!isObj(step)) throw new MithParseError(`inference.hypotheses[${i}].steps[${j}] must be an object`)
      return {
        from: str(step.from, `inference.hypotheses[${i}].steps[${j}].from`),
        to: str(step.to, `inference.hypotheses[${i}].steps[${j}].to`),
        kind: str(step.kind, `inference.hypotheses[${i}].steps[${j}].kind`),
      }
    }),
  }
}

/** Parse and lightly validate a .mith v0 document. */
export function parseMith(input: unknown): MithDocument {
  rejectForbidden(input, 'mith')
  if (!isObj(input)) throw new MithParseError('document must be an object')
  if (input.mith !== MITH_VERSION) throw new MithParseError(`unsupported mith version: ${String(input.mith)}`)
  if (input.kind !== 'document') throw new MithParseError('kind must be document')
  const declaredKind = datasetKind(input.dataset_kind, 'dataset_kind')
  if (!isObj(input.model)) throw new MithParseError('model must be an object')
  if (!Array.isArray(input.model.entities)) throw new MithParseError('model.entities must be an array')
  if (!Array.isArray(input.model.edges)) throw new MithParseError('model.edges must be an array')
  if (!isObj(input.diagram)) throw new MithParseError('diagram must be an object')
  if (!Array.isArray(input.diagram.planes) || input.diagram.planes.length === 0) {
    throw new MithParseError('diagram.planes must be a non-empty array')
  }
  if (!Array.isArray(input.diagram.crossLinks)) throw new MithParseError('diagram.crossLinks must be an array')

  const inferenceRaw = input.inference
  if (!isObj(inferenceRaw)) throw new MithParseError('inference must be an object')
  if (inferenceRaw.viz_only !== true || inferenceRaw.no_runners !== true) {
    throw new MithParseError('inference must set viz_only and no_runners')
  }
  if (!Array.isArray(inferenceRaw.hypotheses)) throw new MithParseError('inference.hypotheses must be an array')

  const entities = input.model.entities.map(entity)
  const ids = new Set(entities.map((e) => e.id))
  if (ids.size !== entities.length) throw new MithParseError('model.entities ids must be unique')

  const org = orgSections(input.model, entities)

  const planes = input.diagram.planes.map(plane)
  const arrangement = resolveArrangement(input.diagram.arrangement, planes)
  assertArrangement(arrangement, planes, input.diagram.arrangement != null)
  for (const p of planes) {
    for (const placement of p.placements) {
      if (!ids.has(placement.entity)) {
        throw new MithParseError(`placement ${placement.entity} on ${p.id} is not in the model`)
      }
    }
  }
  const selection = input.diagram.selection
  if (selection != null && typeof selection !== 'string') {
    throw new MithParseError('diagram.selection must be a string or null')
  }
  const known = new Set(ids)
  for (const list of [org.boundaries, org.roles, org.grants, org.actors, org.channels, org.reach]) {
    for (const item of list ?? []) known.add(item.id)
  }
  if (typeof selection === 'string' && selection && !known.has(selection)) {
    throw new MithParseError('diagram.selection is not in the model')
  }
  const lens = optionalOne<DiagramLens>(input.diagram.lens, DIAGRAM_LENSES, 'diagram.lens')
  const frame = optionalOne<DiagramFrame>(input.diagram.frame, DIAGRAM_FRAMES, 'diagram.frame')

  return {
    mith: MITH_VERSION,
    kind: 'document',
    id: str(input.id, 'id'),
    title: str(input.title, 'title'),
    dataset_kind: declaredKind,
    generated_at: str(input.generated_at, 'generated_at'),
    disclaimer: str(input.disclaimer, 'disclaimer'),
    model: {
      citations: citations(input.model.citations, 'model.citations'),
      entities,
      edges: input.model.edges.map(edge),
      ...org,
    },
    diagram: {
      arrangement,
      camera: camera(input.diagram.camera),
      selection: selection ? selection : null,
      planes,
      crossLinks: input.diagram.crossLinks.map(crossLink),
      ...(lens ? { lens } : {}),
      ...(frame ? { frame } : {}),
    },
    inference: {
      viz_only: true,
      no_runners: true,
      hypotheses: inferenceRaw.hypotheses.map(hypothesis),
    },
  }
}

/** Parse a .mithril v0 package manifest (stub; not a zip). */
export function parseMithrilPackage(input: unknown): MithrilPackage {
  rejectForbidden(input, 'mithril')
  if (!isObj(input)) throw new MithParseError('package must be an object')
  if (input.mithril !== MITH_VERSION) throw new MithParseError(`unsupported mithril version: ${String(input.mithril)}`)
  if (input.kind !== 'package') throw new MithParseError('kind must be package')
  const declaredKind = datasetKind(input.dataset_kind, 'dataset_kind')
  if (!Array.isArray(input.documents) || input.documents.length === 0) {
    throw new MithParseError('documents must be a non-empty array')
  }
  return {
    mithril: MITH_VERSION,
    kind: 'package',
    id: str(input.id, 'id'),
    dataset_kind: declaredKind,
    documents: input.documents.map((d, i) => str(d, `documents[${i}]`)),
    attachments: Array.isArray(input.attachments)
      ? input.attachments.map((d, i) => str(d, `attachments[${i}]`))
      : [],
    ...(typeof input.note === 'string' ? { note: input.note } : {}),
  }
}
