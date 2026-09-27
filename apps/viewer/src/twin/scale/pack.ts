import type { MithBoundary, MithDeviceLogs, MithDeviceUser, MithEntity, MithLogEvent, MithSoftware } from '../mith/types'

/**
 * Chunked `.mith` pack for enterprise-scale synthetic data.
 *
 *   manifest.json            counts, per-company / per-department aggregates, chunk list
 *   index.mith               a twin document in Mithril Form, `(mithril/twin-document …)`:
 *                            boundaries down to department, zones, systems (with criticality),
 *                            roles, grants, actors, channels, shadow-IT `uses` edges. Read by
 *                            `readMith` (twin reader → `parseMith`).
 *   companies/<id>.json      one chunk per subsidiary: teams, people, devices, role holders,
 *                            stored column-wise (integer arrays) because they are 90% of rows.
 *                            Device software / log coverage are indices into small per-chunk
 *                            catalogs (`software`, `stacks`, `logProfiles`); sample log events
 *                            are derived deterministically on expansion.
 *
 * The analysis (roles, grants, channels) only needs the index. People and devices load per
 * company on drill-down, so the UI never holds or renders all of them at once.
 */

export const PACK_VERSION = '0.1' as const

export type PackCompany = {
  id: string
  label: string
  sector: string
  chunk: string
  people: number
  devices: number
  departments: number
  teams: number
  systems: number
  /** Device count per zone id. */
  zones: Record<string, number>
}

export type PackManifest = {
  mith_pack: typeof PACK_VERSION
  kind: 'chunked-document'
  id: string
  title: string
  dataset_kind: 'synthetic-demo'
  disclaimer: string
  generated_at: string
  generator: { name: string; version: number; seed: number }
  index: string
  counts: {
    subsidiaries: number
    departments: number
    teams: number
    employees: number
    devices: number
    systems: number
    unsanctioned: number
    zones: number
    roles: number
    grants: number
    channels: number
    actors: number
    /** Zone→zone reach edges; `openReach` of them open; `misconfigured` seeded open-by-mistake. */
    reach: number
    openReach: number
    misconfigured: number
  }
  companies: PackCompany[]
  /** department id → [people, devices, teams] */
  departments: Record<string, [number, number, number]>
}

export type PackChunk = {
  mith_chunk: typeof PACK_VERSION
  dataset_kind: 'synthetic-demo'
  company: string
  teams: { id: string; label: string; parent: string }[]
  zones: string[]
  titles: string[]
  deviceKinds: string[]
  /** Column-wise: index i is person i. `team` / `zone` / `title` index the arrays above. */
  people: { team: number[]; zone: number[]; title: number[] }
  /** Column-wise: `owner` is a person index or -1 (shared / server, then `team` says where). */
  devices: {
    owner: number[]
    team: number[]
    kind: number[]
    zone: number[]
    /** Index into `stacks` (installed software), -1 when not modeled. */
    stack?: number[]
    /** Index into `logProfiles`, -1 when unknown (no logs block). */
    logs?: number[]
    /** Person index of an extra admin on the device, or -1. */
    admin?: number[]
  }
  /** Software catalog; `stacks[i]` lists catalog indices. */
  software?: MithSoftware[]
  stacks?: number[][]
  logProfiles?: Omit<MithDeviceLogs, 'events'>[]
  /** role id → person indices. */
  holders: Record<string, number[]>
}

export const personId = (company: string, i: number) => `${company.replace('b:', '')}.p${i}`
export const deviceId = (company: string, i: number) => `${company.replace('b:', '')}.v${i}`
const short = (company: string) => company.replace('b:', '').toUpperCase()
export const personLabel = (company: string, i: number) => `Employee ${short(company)}-${String(i).padStart(4, '0')}`

export type ExpandedChunk = {
  teams: MithBoundary[]
  people: MithEntity[]
  devices: MithEntity[]
  holders: Map<string, string[]>
  /** team id → person indices / device indices */
  teamPeople: Map<string, number[]>
  teamDevices: Map<string, number[]>
}

/** Validate a chunk lightly and expand it into ordinary .mith entities / boundaries. */
export function expandChunk(chunk: PackChunk): ExpandedChunk {
  if (chunk.mith_chunk !== PACK_VERSION) throw new Error(`unsupported chunk version ${String(chunk.mith_chunk)}`)
  if (chunk.dataset_kind !== 'synthetic-demo') throw new Error('chunk dataset_kind must be synthetic-demo')
  const n = chunk.people.team.length
  if (chunk.people.zone.length !== n || chunk.people.title.length !== n) throw new Error('chunk people columns differ in length')
  const m = chunk.devices.owner.length
  if (chunk.devices.team.length !== m || chunk.devices.kind.length !== m || chunk.devices.zone.length !== m) {
    throw new Error('chunk device columns differ in length')
  }
  const teams: MithBoundary[] = chunk.teams.map((t) => ({ id: t.id, label: t.label, kind: 'team', parent: t.parent }))
  const teamPeople = new Map<string, number[]>()
  const teamDevices = new Map<string, number[]>()
  const people: MithEntity[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const team = chunk.teams[chunk.people.team[i]!]!
    people[i] = {
      id: personId(chunk.company, i),
      label: personLabel(chunk.company, i),
      type: 'Person',
      layer: 'organization',
      citations: [],
      attrs: { title: chunk.titles[chunk.people.title[i]!] ?? '' },
      boundary: team.id,
      zone: chunk.zones[chunk.people.zone[i]!],
    }
    const list = teamPeople.get(team.id) ?? []
    list.push(i)
    teamPeople.set(team.id, list)
  }
  const devices: MithEntity[] = new Array(m)
  const stackCol = chunk.devices.stack
  const logCol = chunk.devices.logs
  const adminCol = chunk.devices.admin
  for (const col of [stackCol, logCol, adminCol]) if (col && col.length !== m) throw new Error('chunk device columns differ in length')
  for (let i = 0; i < m; i++) {
    const team = chunk.teams[chunk.devices.team[i]!]!
    const kind = chunk.deviceKinds[chunk.devices.kind[i]!] ?? 'Device'
    const owner = chunk.devices.owner[i]!
    devices[i] = {
      id: deviceId(chunk.company, i),
      label: owner >= 0 ? `${kind} · ${personLabel(chunk.company, owner)}` : `${kind} ${short(chunk.company)}-${i}`,
      type: kind,
      layer: 'node',
      citations: [],
      attrs: owner >= 0 ? { owner: personId(chunk.company, owner) } : {},
      boundary: team.id,
      zone: chunk.zones[chunk.devices.zone[i]!],
    }
    const dev = devices[i]!
    const st = stackCol?.[i] ?? -1
    if (st >= 0 && chunk.stacks?.[st] && chunk.software) dev.software = chunk.stacks[st]!.map((k) => chunk.software![k]!)
    const users: MithDeviceUser[] = []
    if (owner >= 0) users.push({ person: personId(chunk.company, owner), relation: 'primary' })
    const admin = adminCol?.[i] ?? -1
    if (admin >= 0 && admin !== owner) users.push({ person: personId(chunk.company, admin), relation: 'admin' })
    if (users.length) dev.users = users
    const lp = logCol?.[i] ?? -1
    const profile = lp >= 0 ? chunk.logProfiles?.[lp] : undefined
    if (profile) dev.logs = { ...profile, events: sampleEvents(chunk.company, i, profile, users[0]?.person, dev.software) }
    const list = teamDevices.get(team.id) ?? []
    list.push(i)
    teamDevices.set(team.id, list)
  }
  const holders = new Map<string, string[]>()
  for (const [role, idx] of Object.entries(chunk.holders)) holders.set(role, idx.map((i) => personId(chunk.company, i)))
  return { teams, people, devices, holders, teamPeople, teamDevices }
}

const ACTIONS: Record<string, string[]> = {
  edr: ['agent heartbeat', 'signature update', 'quarantine check'],
  'os-auth': ['interactive logon', 'screen unlock', 'logoff'],
  process: ['process started', 'scheduled task ran', 'installer executed'],
  network: ['outbound connection summary', 'dns query summary'],
  'saas-audit': ['saas sign-in', 'file shared (synthetic)'],
}

/**
 * Deterministic synthetic sample events (3 per device) for the detail panel's timeline.
 * Derived from ids only; no clock, no randomness, no real telemetry.
 */
export function sampleEvents(
  company: string,
  i: number,
  logs: Omit<MithDeviceLogs, 'events'>,
  user: string | undefined,
  software: MithSoftware[] | undefined,
): MithLogEvent[] {
  if (!logs.sources.length) return []
  let h = 2166136261
  for (const ch of `${company}:${i}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
  const risky = software?.find((s) => s.eol || s.sanctioned === false)
  const out: MithLogEvent[] = []
  for (let k = 0; k < 3; k++) {
    const source = logs.sources[(h + k) % logs.sources.length]!
    const acts = ACTIONS[source] ?? ['event']
    const minute = (h >>> (k * 3)) % 50
    const at = `2026-09-27T${String(8 + k).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+09:00`
    const flagged = k === 2 && risky
    out.push({
      at,
      source,
      action: flagged ? `${risky.eol ? 'EOL' : 'unsanctioned'} software launched: ${risky.name}` : acts[(h >>> k) % acts.length]!,
      severity: flagged ? 'medium' : 'info',
      ...(user ? { user } : {}),
    })
  }
  return out
}
