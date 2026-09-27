import { analyzeExposureGraph, type ExposureReport, type RoleScore } from '../mith/exposure'
import type { Dijkstra, Graph } from '../mith/graph'
import { readMith, readMithValue } from '../mith/twin'
import type { MithDocument } from '../mith/types'
import type { PackManifest } from './pack'

/**
 * Tile heat. `share` (hot / roles) drives the fill: the share of roles in the tile whose exposure
 * score is ≥ HOT. `max` / `top` stay for the ranked lists.
 */
export type Heat = { max: number; hot: number; roles: number; share: number; top: string | null }

/** Default share of hot roles at which a tile is fully red; per document: `weights.heatSaturation`. */
export const SHARE_SATURATION = 0.25

export type ShadowApp = {
  id: string
  label: string
  source: string
  criticality: string
  departments: string[]
  companies: string[]
}

/** Everything the scale view needs from the analysis, keyed for aggregation. Structured-clone safe. */
export type ScaleAnalysis = {
  report: ExposureReport
  /** Role exposure heat per subsidiary / department (share of roles ≥ 50, max score, top role). */
  companyHeat: Record<string, Heat>
  deptHeat: Record<string, Heat>
  /** Resource exposure heat per subsidiary (company-local systems only). */
  companyAccessHeat: Record<string, Heat>
  shadowApps: ShadowApp[]
  /** subsidiary → number of distinct unsanctioned apps used by its departments */
  companyShadow: Record<string, number>
  deptShadow: Record<string, string[]>
  /** subsidiary → zones with an open-only path into a crown-jewel zone, and zone count. */
  companyNet: Record<string, { zones: number; openToCrownJewel: number }>
  timings: { parseMs: number; analysisMs: number; aggregateMs: number }
  /** Device software risk / log-coverage aggregates from the chunks (enterprise engine only). */
  devices?: DeviceAggregates
}

/** [devices, high-ease devices, log gaps (blind + short), logs unknown] */
export type DeviceCounts = [number, number, number, number]
export type DeviceAggregates = {
  /** A device counts as software-risky at or above this ease. */
  easeThreshold: number
  company: Record<string, DeviceCounts>
  dept: Record<string, DeviceCounts>
}

export const HOT = 50

export async function fetchJson(url: string, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const res = await fetchImpl(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.json()
}

export function parseManifest(raw: unknown): PackManifest {
  const m = raw as PackManifest
  if (!m || m.mith_pack !== '0.1' || m.kind !== 'chunked-document') throw new Error('not a .mith pack manifest')
  if (m.dataset_kind !== 'synthetic-demo') throw new Error('pack dataset_kind must be synthetic-demo')
  if (!Array.isArray(m.companies) || typeof m.index !== 'string') throw new Error('pack manifest needs companies and index')
  return m
}

export const packUrl = (manifestUrl: string, file: string) => manifestUrl.replace(/[^/]*$/, '') + file

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

function bump(map: Record<string, Heat>, key: string | undefined, score: number, id: string) {
  if (!key) return
  const h = (map[key] ??= { max: 0, hot: 0, roles: 0, share: 0, top: null })
  h.roles += 1
  if (score > h.max) {
    h.max = score
    h.top = id
  }
  if (score >= HOT) h.hot += 1
  h.share = h.hot / h.roles
}

export function analyzeScale(doc: MithDocument, parseMs = 0): ScaleAnalysis {
  return analyzeScaleGraph(doc, parseMs).analysis
}

/** `analyzeScale` plus the graph and actor Dijkstra, kept by the engine for on-demand paths. */
export function analyzeScaleGraph(doc: MithDocument, parseMs = 0): { analysis: ScaleAnalysis; graph: Graph; dj: Dijkstra } {
  const t0 = now()
  const { report, graph, dj } = analyzeExposureGraph(doc.model)
  const t1 = now()
  const parent = new Map((doc.model.boundaries ?? []).map((b) => [b.id, b.parent]))
  const roleBoundary = new Map((doc.model.roles ?? []).map((r) => [r.id, r.boundary]))
  const companyOf = (boundary: string | undefined) => {
    let cur = boundary
    let guard = 0
    while (cur && guard++ < 8) {
      const p = parent.get(cur)
      if (p === 'b:polaris' || !p) return cur
      cur = p
    }
    return cur
  }
  const companyHeat: Record<string, Heat> = {}
  const deptHeat: Record<string, Heat> = {}
  for (const x of report.roles) {
    const dept = roleBoundary.get(x.role)
    bump(deptHeat, dept, x.score, x.role)
    bump(companyHeat, companyOf(dept), x.score, x.role)
  }
  const entityBoundary = new Map(doc.model.entities.map((e) => [e.id, e.boundary]))
  const companyAccessHeat: Record<string, Heat> = {}
  for (const x of report.resources) bump(companyAccessHeat, companyOf(entityBoundary.get(x.resource)), x.score, x.resource)
  const companyNet: Record<string, { zones: number; openToCrownJewel: number }> = {}
  for (const z of report.zones) {
    const m = /^net:(s\d+)\./.exec(z.zone)
    if (!m) continue
    const c = (companyNet[`b:${m[1]}`] ??= { zones: 0, openToCrownJewel: 0 })
    c.zones += 1
    if (z.openToCrownJewel) c.openToCrownJewel += 1
  }

  const deptShadow: Record<string, string[]> = {}
  const shadowApps: ShadowApp[] = doc.model.entities
    .filter((e) => e.sanctioned === false)
    .map((e) => ({ id: e.id, label: e.label, source: e.source ?? 'unknown', criticality: e.criticality ?? 'unknown', departments: [] as string[], companies: [] as string[] }))
  const appById = new Map(shadowApps.map((a) => [a.id, a]))
  for (const edge of doc.model.edges) {
    if (edge.kind !== 'uses') continue
    const app = appById.get(edge.target)
    if (!app) continue
    app.departments.push(edge.source)
    ;(deptShadow[edge.source] ??= []).push(app.id)
  }
  const companyShadowSets: Record<string, Set<string>> = {}
  for (const app of shadowApps) {
    const cos = new Set(app.departments.map((d) => companyOf(d)).filter((c): c is string => !!c))
    app.companies = [...cos]
    for (const c of cos) (companyShadowSets[c] ??= new Set()).add(app.id)
  }
  shadowApps.sort((a, b) => b.departments.length - a.departments.length || a.label.localeCompare(b.label))
  const companyShadow = Object.fromEntries(Object.entries(companyShadowSets).map(([k, v]) => [k, v.size]))
  const analysis: ScaleAnalysis = {
    report,
    companyHeat,
    deptHeat,
    companyAccessHeat,
    shadowApps,
    companyShadow,
    deptShadow,
    companyNet,
    timings: { parseMs, analysisMs: t1 - t0, aggregateMs: now() - t1 },
  }
  return { analysis, graph, dj }
}

/** Index document: Mithril Form text (primary), twin JSON-LD, or legacy v0 JSON (deprecated). */
export function parseIndex(raw: unknown): MithDocument {
  return typeof raw === 'string' ? readMith(raw).doc : readMithValue(raw).doc
}

export type { RoleScore }
