import type { MithBoundary, MithEntity } from '../mith/types'

/**
 * Chunked `.mith` pack for enterprise-scale synthetic data.
 *
 *   manifest.json            counts, per-company / per-department aggregates, chunk list
 *   index.mith               a normal .mith 0.1 document: boundaries down to department,
 *                            zones, systems (with criticality), roles, grants, actors,
 *                            channels, shadow-IT `uses` edges. Parsed by `parseMith`.
 *   companies/<id>.json      one chunk per subsidiary: teams, people, devices, role holders,
 *                            stored column-wise (integer arrays) because they are 90% of rows.
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
  devices: { owner: number[]; team: number[]; kind: number[]; zone: number[] }
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
    const list = teamDevices.get(team.id) ?? []
    list.push(i)
    teamDevices.set(team.id, list)
  }
  const holders = new Map<string, string[]>()
  for (const [role, idx] of Object.entries(chunk.holders)) holders.set(role, idx.map((i) => personId(chunk.company, i)))
  return { teams, people, devices, holders, teamPeople, teamDevices }
}
