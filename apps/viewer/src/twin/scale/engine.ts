import { blastRadius } from '../mith/org'
import { dijkstra, reconstruct, type Dijkstra, type Graph, type MixedHop } from '../mith/graph'
import { parseMith } from '../mith/parse'
import type { MithDocument } from '../mith/types'
import { ENTERPRISE_SEED, generateEnterprise, type GeneratedPack } from './generate'
import { analyzeScaleGraph, type ScaleAnalysis } from './model'
import type { PackChunk, PackManifest } from './pack'

/**
 * The enterprise pack engine: generates the synthetic 北極星 dataset in the browser (seeded,
 * deterministic), parses its index, runs the exposure analysis, and answers chunk / path requests.
 * Runs inside a Web Worker (`engine.worker.ts`); the same class runs inline where Workers are
 * unavailable (tests). Display-only arithmetic. No network, no scanning.
 */

export type PathRequest = { role?: string; resource?: string }

export type BlastSummary = {
  maxCost: number
  count: number
  crownJewels: number
  network: number
  top: { resource: string; level: string; cost: number }[]
}

export type PathResult = {
  /** Where the path ends (a system), or the role itself when it reaches nothing. */
  target: string | null
  role: string | null
  /** Mixed org + network hops from an external actor (or the internet) to `target`. */
  hops: MixedHop[]
  cost: number | null
  blast: BlastSummary | null
}

export type PackLoad = {
  manifest: PackManifest
  doc: MithDocument
  timings: { generateMs: number; parseMs: number }
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

export class ScaleEngine {
  private pack: GeneratedPack | null = null
  private doc: MithDocument | null = null
  private graph: Graph | null = null
  private dj: Dijkstra | null = null
  private analysis: ScaleAnalysis | null = null

  load(seed = ENTERPRISE_SEED): PackLoad {
    const t0 = now()
    this.pack = generateEnterprise(seed)
    const t1 = now()
    this.doc = parseMith(this.pack.index)
    const t2 = now()
    return { manifest: this.pack.manifest, doc: this.doc, timings: { generateMs: t1 - t0, parseMs: t2 - t1 } }
  }

  analyze(): ScaleAnalysis {
    if (!this.doc) throw new Error('engine not loaded')
    const res = analyzeScaleGraph(this.doc)
    this.graph = res.graph
    this.dj = res.dj
    this.analysis = res.analysis
    return res.analysis
  }

  chunk(company: string): PackChunk {
    const meta = this.pack?.manifest.companies.find((c) => c.id === company)
    const chunk = meta ? this.pack!.chunks.get(meta.chunk) : undefined
    if (!chunk) throw new Error(`unknown company ${company}`)
    return chunk
  }

  /**
   * Mixed path for a role (actor → … → role, then role → device → zone → … → its top resource)
   * with its weighted blast radius, or the cheapest actor path to a resource.
   */
  path(req: PathRequest): PathResult {
    const g = this.graph
    const dj = this.dj
    const doc = this.doc
    if (!g || !dj || !doc || !this.analysis) throw new Error('analysis not ready')
    if (req.resource) {
      const i = g.index.get(req.resource)
      if (i == null) return { target: req.resource, role: null, hops: [], cost: null, blast: null }
      const hops = reconstruct(g, dj, i)
      return { target: req.resource, role: null, hops, cost: Number.isFinite(dj.dist[i]!) ? dj.dist[i]! : null, blast: null }
    }
    const roleId = req.role!
    const ri = g.index.get(roleId)
    const score = this.analysis.report.roles.find((r) => r.role === roleId)
    if (ri == null || !score) return { target: null, role: roleId, hops: [], cost: null, blast: null }
    const inbound = reconstruct(g, dj, ri)
    let outbound: MixedHop[] = []
    let target: string | null = null
    if (score.topResource) {
      const t = g.index.get(score.topResource)
      if (t != null) {
        const fromRole = dijkstra(g, [ri])
        outbound = reconstruct(g, fromRole, t)
        target = score.topResource
      }
    }
    const br = blastRadius(doc, roleId, { graph: g })
    const crit = new Map(doc.model.entities.map((e) => [e.id, e.criticality]))
    const blast: BlastSummary = {
      maxCost: g.weights.blastRadius,
      count: br.resources.length,
      crownJewels: br.resources.filter((r) => crit.get(r.resource) === 'crown-jewel').length,
      network: br.resources.filter((r) => r.level === 'network').length,
      top: br.resources.slice(0, 8).map((r) => ({ resource: r.resource, level: r.level, cost: r.cost })),
    }
    const inCost = Number.isFinite(dj.dist[ri]!) ? dj.dist[ri]! : null
    const outCost = outbound.reduce((a, h) => a + h.cost, 0)
    return { target, role: roleId, hops: [...inbound, ...outbound], cost: inCost == null ? null : inCost + outCost, blast }
  }
}

// ---- Worker protocol ----------------------------------------------------------------------
export type EngineRequest =
  | { type: 'load'; seed: number }
  | { type: 'chunk'; id: number; company: string }
  | { type: 'path'; id: number; req: PathRequest }

export type EngineReply =
  | { type: 'pack'; load: PackLoad; ms: number }
  | { type: 'analysis'; analysis: ScaleAnalysis; ms: number }
  | { type: 'chunk'; id: number; chunk: PackChunk; ms: number }
  | { type: 'path'; id: number; result: PathResult; ms: number }
  | { type: 'error'; id?: number; error: string }

/** Handle one request against an engine, emitting replies (shared by worker and inline client). */
export function handle(engine: ScaleEngine, msg: EngineRequest, post: (r: EngineReply) => void) {
  try {
    if (msg.type === 'load') {
      const t0 = now()
      const load = engine.load(msg.seed)
      post({ type: 'pack', load, ms: now() - t0 })
      const t1 = now()
      const analysis = engine.analyze()
      post({ type: 'analysis', analysis, ms: now() - t1 })
    } else if (msg.type === 'chunk') {
      const t = now()
      post({ type: 'chunk', id: msg.id, chunk: engine.chunk(msg.company), ms: now() - t })
    } else {
      const t = now()
      post({ type: 'path', id: msg.id, result: engine.path(msg.req), ms: now() - t })
    }
  } catch (err) {
    post({ type: 'error', id: 'id' in msg ? msg.id : undefined, error: err instanceof Error ? err.message : 'engine failed' })
  }
}
