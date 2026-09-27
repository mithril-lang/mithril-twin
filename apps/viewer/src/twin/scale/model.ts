import { analyzeExposure, type ExposureReport, type RoleScore } from '../mith/exposure'
import { parseMith } from '../mith/parse'
import type { MithDocument } from '../mith/types'
import type { PackManifest } from './pack'

export type Heat = { max: number; hot: number; top: string | null }

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
  /** Role exposure heat per subsidiary / department (max score, count ≥ 50, top role). */
  companyHeat: Record<string, Heat>
  deptHeat: Record<string, Heat>
  /** Resource exposure heat per subsidiary (company-local systems only). */
  companyAccessHeat: Record<string, Heat>
  shadowApps: ShadowApp[]
  /** subsidiary → number of distinct unsanctioned apps used by its departments */
  companyShadow: Record<string, number>
  deptShadow: Record<string, string[]>
  timings: { parseMs: number; analysisMs: number; aggregateMs: number }
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
  const h = (map[key] ??= { max: 0, hot: 0, top: null })
  if (score > h.max) {
    h.max = score
    h.top = id
  }
  if (score >= HOT) h.hot += 1
}

export function analyzeScale(doc: MithDocument, parseMs = 0): ScaleAnalysis {
  const t0 = now()
  const report = analyzeExposure(doc.model)
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
  return {
    report,
    companyHeat,
    deptHeat,
    companyAccessHeat,
    shadowApps,
    companyShadow,
    deptShadow,
    timings: { parseMs, analysisMs: t1 - t0, aggregateMs: now() - t1 },
  }
}

export type WorkerResult =
  | { ok: true; analysis: ScaleAnalysis; workerMs: number; fetchMs: number }
  | { ok: false; error: string }

/** Parse the index + run the exposure analysis off the main thread when a Worker is available. */
export function runScaleAnalysis(indexUrl: string, fallbackDoc: () => MithDocument | null): Promise<WorkerResult & { via: 'worker' | 'inline' }> {
  if (typeof Worker === 'undefined') {
    const doc = fallbackDoc()
    if (!doc) return Promise.resolve({ ok: false, error: 'index not loaded', via: 'inline' })
    const t = now()
    const analysis = analyzeScale(doc)
    return Promise.resolve({ ok: true, analysis, workerMs: now() - t, fetchMs: 0, via: 'inline' })
  }
  return new Promise((resolve) => {
    const worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<WorkerResult>) => {
      resolve({ ...e.data, via: 'worker' })
      worker.terminate()
    }
    worker.onerror = (e) => {
      resolve({ ok: false, error: e.message || 'worker failed', via: 'worker' })
      worker.terminate()
    }
    worker.postMessage({ indexUrl: new URL(indexUrl, globalThis.location?.href ?? 'http://localhost/').href })
  })
}

export function parseIndex(raw: unknown): MithDocument {
  return parseMith(raw)
}

export type { RoleScore }
