import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as REPointerEvent,
  type ReactNode,
  type WheelEvent as REWheelEvent,
} from 'react'
import GitHubLink from '../components/GitHubLink'
import ThemeSwitcher from '../components/ThemeSwitcher'
import { useViewerLocale } from '../../locale'
import { twinCopy } from '../twin-copy'
import { CONTROL_WEIGHTS, type MixedHop, type RoleScore, type ZoneScore } from '../mith/exposure'
import {
  DEFAULT_DEVICE_WEIGHTS,
  DEFAULT_JUMP_HOST_COST,
  DEFAULT_MIN_RETENTION_DAYS,
  DEFAULT_REACH_WEIGHTS,
  deviceRisk,
  EDGE,
  logCoverage,
  resolveWeights,
  type ResolvedWeights,
} from '../mith/graph'
import { fitBoardsInSafeArea } from '../mith/geometry'
import { MithFileActions, useMithFileDrop } from '../components/MithFileActions'
import { buildMithDownload, formatBytes, saveMithFile } from '../mith/io'
import { SAMPLE_DOCS } from '../mith/load'
import { DIAGRAM_LENSES } from '@mithril-twin/mith'
import type { DiagramLens, MithBoundary, MithChannel, MithDocument, MithEntity, MithReach, MithRole } from '../mith/types'
import { sharedEngine } from '../scale/client'
import type { PathResult } from '../scale/engine'
import { HOT, type Heat, type ScaleAnalysis } from '../scale/model'
import { expandChunk, type ExpandedChunk, type PackCompany, type PackManifest } from '../scale/pack'
import { inset, treemap, type Rect } from '../scale/treemap'
import { useBoardAnchors } from './node3d'
import { chunkDevice, chunkPerson, coverageColor, DeviceDetail, devicesByPerson, easeColor, PersonDevices } from './DeviceDetail'
import { RankedResources, RankedRoles } from './LensPanel'
import './make-grid.css'
import './lens.css'
import './scale.css'

type ScaleLens = 'org' | 'network' | 'access' | 'impersonation' | 'shadow' | 'software' | 'logs'
const SCALE_LENSES: { id: ScaleLens; label: string }[] = [
  { id: 'org', label: 'Org' },
  { id: 'network', label: 'Network' },
  { id: 'access', label: 'Access' },
  { id: 'impersonation', label: 'Impersonation' },
  { id: 'shadow', label: 'Shadow IT' },
  { id: 'software', label: 'Software risk' },
  { id: 'logs', label: 'Log gaps' },
]
function useScaleCopy() {
  const locale = useViewerLocale()
  return useCallback((english: string, values?: Record<string, string | number>) => twinCopy(locale, english, values), [locale])
}
const DEVICE_LENS = (l: ScaleLens) => l === 'software' || l === 'logs'
/** Device-share heat saturates here (device shares run higher than hot-role shares). */
const DEVICE_HEAT_SATURATION = 0.5
type Level = { company: string | null; dept: string | null; team: string | null }
type PerfRow = { name: string; ms: number; note?: string }

type Props = {
  /** Generator seed: the pack is generated in the browser (Web Worker), not fetched. */
  seed: number
  sampleId: string
  onPickSample: (id: string) => void
  onImportFiles: (files: File[]) => void
}

const WORLD_W = 1500
const WORLD_H = 940
const SHADOW_W = 420
const TAG_CAP = 16

const now = () => performance.now()

declare global {
  interface Window {
    __twinScalePerf?: PerfRow[]
  }
}

/** Share of hot roles (score ≥ HOT) → floor tint; saturates at `sat` (weights.heatSaturation). */
function shareColor(share: number, sat: number): string {
  return heatColor(Math.min(100, (share / sat) * 100))
}

/** 0–100 exposure → floor tint. Neutral lavender → amber → red. */
function heatColor(score: number): string {
  if (score <= 0) return 'rgba(236, 233, 247, 0.95)'
  const t = Math.min(1, score / 100)
  const stops: [number, [number, number, number]][] = [
    [0, [243, 238, 252]],
    [0.25, [253, 230, 160]],
    [0.5, [251, 160, 90]],
    [0.8, [232, 72, 72]],
    [1, [190, 24, 48]],
  ]
  for (let i = 1; i < stops.length; i++) {
    const [p1, c1] = stops[i]!
    const [p0, c0] = stops[i - 1]!
    if (t <= p1) {
      const k = (t - p0) / (p1 - p0)
      const c = c0.map((v, j) => Math.round(v + (c1[j]! - v) * k))
      return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
    }
  }
  return 'rgb(190, 24, 48)'
}

function shadowColor(count: number, max: number): string {
  if (!count) return 'rgba(236, 233, 247, 0.95)'
  const t = Math.min(1, count / Math.max(1, max))
  return `rgba(217, 138, 26, ${(0.18 + 0.72 * t).toFixed(2)})`
}

const zoneKind = (id: string) =>
  id === 'net:mobile'
    ? 'Managed mobile'
    : id.endsWith('.pay')
      ? 'Payments core'
      : id.endsWith('.prod')
        ? 'Prod servers'
        : id.endsWith('.ot')
          ? 'OT / branch'
          : id.endsWith('.dmz')
            ? 'DMZ'
            : id.endsWith('.mgmt')
              ? 'Mgmt VLAN'
              : id.endsWith('.corp')
                ? 'Corp VLAN'
                : 'Group'
const GROUP_ZONES = ['net:inet', 'net:mobile', 'net:transit', 'net:gdc', 'net:gid', 'net:gcore']

/** Zone fill for the Network lens: red = open path into a crown-jewel zone, amber = hosts one. */
function zoneFill(z: ZoneScore | undefined): string {
  if (z?.openToCrownJewel) return 'rgba(232, 72, 72, 0.9)'
  if (z?.hostsCrownJewel) return 'rgba(253, 214, 140, 0.95)'
  return 'rgba(214, 243, 228, 0.95)'
}

const fmt = (n: number) => n.toLocaleString('en-US')

type TileSpec = {
  id: string
  label: string
  rect: Rect
  fill: string
  meta?: string
  kind: 'company' | 'department' | 'team' | 'zone' | 'shadow' | 'role' | 'more'
  hot?: boolean
  onClick?: () => void
  tag?: boolean
  canvas?: { team: string }
}
type LinkSpec = { id: string; from: Rect; to: Rect; kind: MithReach['kind']; red: boolean; weight: number }
type FrameSpec = { id: string; label: string; rect: Rect; kind: string; dashed?: boolean; tag?: boolean; root?: boolean }

/**
 * Enterprise-scale grid. Level of detail:
 *   group → sector clusters of subsidiary tiles (counts + exposure heat)
 *   subsidiary → department tiles
 *   department → team tiles with people / devices drawn on canvas, roles as tiles
 *   team → virtualized people / device list in the right rail
 * Never more than a few hundred DOM tiles at once. Analysis runs in a Web Worker.
 */
export default function ScaleGrid({ seed, sampleId, onPickSample, onImportFiles }: Props) {
  const t = useScaleCopy()
  const stageRef = useRef<HTMLDivElement>(null)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const [manifest, setManifest] = useState<PackManifest | null>(null)
  const [doc, setDoc] = useState<MithDocument | null>(null)
  const [analysis, setAnalysis] = useState<ScaleAnalysis | null>(null)
  const [analysisVia, setAnalysisVia] = useState<string>('')
  const [error, setError] = useState('')
  const [lens, setLens] = useState<ScaleLens>('org')
  const [level, setLevel] = useState<Level>({ company: null, dept: null, team: null })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectAndReveal = useCallback((id: string | null) => {
    setSelectedId(id)
    setMobileDetailOpen(id !== null)
  }, [])
  const [chunks, setChunks] = useState<Map<string, ExpandedChunk>>(new Map())
  const [busy, setBusy] = useState('')
  const [query, setQuery] = useState('')
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [perf, setPerf] = useState<PerfRow[]>([])
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const [exportNote, setExportNote] = useState<string | null>(null)
  const { over, handlers: dropHandlers } = useMithFileDrop(onImportFiles)
  const userMoved = useRef(false)
  const fitPasses = useRef(0)
  // Timing mark for the next committed view change; recorded two frames later (after paint).
  const [mark, setMark] = useState<{ name: string; t0: number; note?: string } | null>(null)
  const [pathState, setPathState] = useState<{ key: string; result: PathResult } | null>(null)
  const path = pathState && pathState.key === selectedId ? pathState.result : null

  const record = useCallback((row: PerfRow) => {
    const rounded = { ...row, ms: Math.round(row.ms * 10) / 10 }
    window.__twinScalePerf = [...(window.__twinScalePerf ?? []), rounded]
    setPerf((p) => [...p.filter((x) => x.name !== row.name), rounded])
  }, [])

  // Generate the synthetic pack in a Web Worker (seeded), then analyze there; the UI renders the
  // index as soon as it arrives and paints heat when the analysis follows.
  useEffect(() => {
    let cancelled = false
    const t0 = now()
    window.__twinScalePerf = []
    const engine = sharedEngine(seed)
    engine.pack
      .then(({ load, ms }) => {
        if (cancelled) return
        const t = now()
        record({ name: `load · generate (${engine.via})`, ms: load.timings.generateMs, note: `seed ${seed}` })
        record({ name: `load · index parse (${engine.via})`, ms: load.timings.parseMs })
        record({ name: 'load · pack to UI (round trip)', ms: t - t0, note: `engine ${ms.toFixed(0)} ms + transfer` })
        setMark({ name: 'initial render', t0: t })
        setManifest(load.manifest)
        setDoc(load.doc)
      })
      .catch((err: Error) => !cancelled && setError(`Could not generate pack: ${err.message}`))
    engine.analysis
      .then(({ analysis: a, ms }) => {
        if (cancelled) return
        setAnalysis(a)
        setAnalysisVia(engine.via === 'worker' ? 'Web Worker' : 'inline (no Worker)')
        record({ name: 'analysis · exposure compute', ms: a.timings.analysisMs, note: engine.via })
        record({ name: 'analysis · aggregate', ms: a.timings.aggregateMs, note: engine.via })
        record({ name: 'analysis (load → ready)', ms: now() - t0, note: `analysis step ${ms.toFixed(0)} ms` })
      })
      .catch((err: Error) => !cancelled && setError(`Analysis failed: ${err.message}`))
    return () => {
      cancelled = true
    }
  }, [seed, record])

  // After the commit that carries a mark, wait two frames (so a paint happened) and record.
  useEffect(() => {
    if (!mark) return
    let id2 = 0
    const id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => record({ name: mark.name, ms: now() - mark.t0, note: mark.note }))
    })
    return () => {
      cancelAnimationFrame(id1)
      cancelAnimationFrame(id2)
    }
  }, [mark, record])

  const index = useMemo(() => {
    const boundaries = new Map<string, MithBoundary>()
    const children = new Map<string, MithBoundary[]>()
    const roles = new Map<string, MithRole>()
    const rolesByDept = new Map<string, MithRole[]>()
    const entities = new Map<string, MithEntity>()
    const channels = new Map<string, MithChannel>()
    const hosted = new Map<string, string[]>()
    const reachFrom = new Map<string, MithReach[]>()
    const reachTo = new Map<string, MithReach[]>()
    if (doc) {
      for (const e of doc.model.entities) if (e.layer === 'server' && e.zone) hosted.set(e.zone, [...(hosted.get(e.zone) ?? []), e.id])
      for (const r of doc.model.reach ?? []) {
        reachFrom.set(r.from, [...(reachFrom.get(r.from) ?? []), r])
        reachTo.set(r.to, [...(reachTo.get(r.to) ?? []), r])
      }
      for (const b of doc.model.boundaries ?? []) {
        boundaries.set(b.id, b)
        if (b.parent) children.set(b.parent, [...(children.get(b.parent) ?? []), b])
      }
      for (const r of doc.model.roles ?? []) {
        roles.set(r.id, r)
        rolesByDept.set(r.boundary, [...(rolesByDept.get(r.boundary) ?? []), r])
      }
      for (const e of doc.model.entities) entities.set(e.id, e)
      for (const c of doc.model.channels ?? []) channels.set(c.id, c)
    }
    const companyOf = (id: string | undefined): string | null => {
      let cur = id ? boundaries.get(id) : undefined
      while (cur && cur.kind !== 'subsidiary') cur = cur.parent ? boundaries.get(cur.parent) : undefined
      return cur?.id ?? null
    }
    return { boundaries, children, roles, rolesByDept, entities, channels, companyOf, hosted, reachFrom, reachTo }
  }, [doc])
  const weights = useMemo(() => resolveWeights(doc?.model.weights), [doc])
  const sat = weights.heatSaturation
  const zoneScore = useMemo(() => new Map((analysis?.report.zones ?? []).map((z) => [z.zone, z])), [analysis])

  // Mixed org + network path for the selected role / system, computed in the engine on demand.
  useEffect(() => {
    if (!selectedId || !analysis) return
    const isRole = index.roles.has(selectedId)
    const isSystem = index.entities.get(selectedId)?.layer === 'server'
    if (!isRole && !isSystem) return
    const engine = sharedEngine(seed)
    let cancelled = false
    const t0 = now()
    engine
      .path(isRole ? { role: selectedId } : { resource: selectedId })
      .then(({ result, ms }) => {
        if (cancelled) return
        setPathState({ key: selectedId, result })
        setMark({ name: 'drill · mixed path', t0, note: `engine ${ms.toFixed(1)} ms · ${result.hops.length} hops` })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [selectedId, analysis, index, seed])

  const companies = useMemo(() => new Map((manifest?.companies ?? []).map((c) => [c.id, c])), [manifest])
  const roleScore = useMemo(() => new Map((analysis?.report.roles ?? []).map((r) => [r.role, r])), [analysis])
  const labelOf = useCallback(
    (id: string) =>
      index.boundaries.get(id)?.label ??
      index.roles.get(id)?.label ??
      index.entities.get(id)?.label ??
      doc?.model.actors?.find((a) => a.id === id)?.label ??
      id,
    [index, doc],
  )
  const roleLabel = useCallback(
    (id: string) => {
      const r = index.roles.get(id)
      if (!r) return labelOf(id)
      const dept = index.boundaries.get(r.boundary)
      const co = index.companyOf(r.boundary)
      return `${r.label} · ${dept?.label ?? ''} · ${co ? co.replace('b:', '').toUpperCase() : ''}`
    },
    [index, labelOf],
  )

  const loadChunk = useCallback(
    async (company: string): Promise<{ chunk: ExpandedChunk; ms: number; cached: boolean }> => {
      const have = chunks.get(company)
      if (have) return { chunk: have, ms: 0, cached: true }
      if (!companies.get(company)) throw new Error(`unknown company ${company}`)
      const t = now()
      const { chunk: raw } = await sharedEngine(seed).chunk(company)
      const chunk = expandChunk(raw)
      setChunks((prev) => new Map(prev).set(company, chunk))
      return { chunk, ms: now() - t, cached: false }
    },
    [chunks, companies, seed],
  )

  const goTo = useCallback(
    async (next: Level, select: string | null = null) => {
      const name = next.team ? 'drill · team' : next.dept ? 'drill · department' : next.company ? 'drill · company' : 'drill · group'
      const t0 = now()
      let note = ''
      try {
        if (next.company) {
          setBusy('Loading company chunk…')
          const res = await loadChunk(next.company)
          note = res.cached ? 'chunk cached' : `chunk fetch+expand ${res.ms.toFixed(1)} ms`
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'chunk failed')
      } finally {
        setBusy('')
      }
      setMark({ name, t0, note })
      setLevel(next)
      selectAndReveal(select)
    },
    [loadChunk, selectAndReveal],
  )

  const openRole = useCallback(
    (id: string | null) => {
      if (!id) return selectAndReveal(null)
      const r = index.roles.get(id)
      if (r) {
        const company = index.companyOf(r.boundary)
        void goTo({ company, dept: r.boundary, team: null }, id)
        return
      }
      const e = index.entities.get(id)
      if (e?.boundary && e.sanctioned !== false) {
        const company = index.companyOf(e.boundary)
        void goTo({ company, dept: null, team: null }, id)
        return
      }
      selectAndReveal(id)
    },
    [index, goTo, selectAndReveal],
  )

  const pickLens = (next: ScaleLens) => {
    setMark({ name: `lens · ${next}`, t0: now() })
    setLens(next)
  }

  // ---- Floor layout (pure, memoized per level / lens) -----------------------------------
  const copy = t
  const floor = useMemo(() => {
    const frames: FrameSpec[] = []
    const tiles: TileSpec[] = []
    const links: LinkSpec[] = []
    let width = WORLD_W
    const height = WORLD_H
    if (!manifest || !doc) return { frames, tiles, links, width, height }
    const shareOf = (h: Record<string, Heat> | undefined, id: string) => h?.[id]?.share ?? 0
    const maxShadow = Math.max(1, ...Object.values(analysis?.companyShadow ?? {}))
    const devShare = (counts: [number, number, number, number] | undefined) =>
      counts && counts[0] ? (lens === 'software' ? counts[1] : counts[2]) / counts[0] : 0
    const devMeta = (counts: [number, number, number, number] | undefined) =>
      counts
        ? lens === 'software'
          ? copy('{high} of {total} devices with high ease', { high: fmt(counts[1]), total: fmt(counts[0]) })
          : `${copy('{gaps} of {total} devices with log gaps', { gaps: fmt(counts[2]), total: fmt(counts[0]) })}${counts[3] ? ` · ${copy('{count} unknown', { count: fmt(counts[3]) })}` : ''}`
        : copy('device data pending')
    const companyFill = (c: PackCompany) =>
      DEVICE_LENS(lens)
        ? shareColor(devShare(analysis?.devices?.company[c.id]), DEVICE_HEAT_SATURATION)
        : lens === 'shadow'
        ? shadowColor(analysis?.companyShadow[c.id] ?? 0, maxShadow)
        : lens === 'access'
          ? shareColor(shareOf(analysis?.companyAccessHeat, c.id), sat)
          : shareColor(shareOf(analysis?.companyHeat, c.id), sat)
    const shadowFrame = (apps: NonNullable<typeof analysis>['shadowApps'], filterDepts?: Set<string>) => {
      width = WORLD_W + 40 + SHADOW_W
      const rect = { x: WORLD_W + 40, y: 0, w: SHADOW_W, h: height }
      frames.push({ id: 'shadow', label: copy('Unsanctioned SaaS (outside the org boundary)'), rect, kind: 'shadow', dashed: true, tag: true, root: true })
      const used = apps
        .map((a) => ({ a, n: filterDepts ? a.departments.filter((d) => filterDepts.has(d)).length : a.departments.length }))
        .filter((x) => x.n > 0)
      const maxN = Math.max(1, ...used.map((x) => x.n))
      for (const t of treemap(used, (x) => x.n, inset(rect, 10, 30))) {
        tiles.push({
          id: t.item.a.id,
          label: t.item.a.label.replace(' (synthetic SaaS)', ''),
          rect: inset(t, 1.5),
          fill: shadowColor(t.item.n, maxN),
          meta: copy('{count} departments · {source}', { count: t.item.n, source: t.item.a.source }),
          kind: 'shadow',
          onClick: () => selectAndReveal(t.item.a.id),
        })
      }
    }

    if (!level.company) {
      const root = { x: 0, y: 0, w: WORLD_W, h: height }
      frames.push({ id: 'b:polaris', label: copy('北極星 Group · {count} subsidiaries (synthetic)', { count: fmt(manifest.counts.subsidiaries) }), rect: root, kind: 'company', root: true })
      if (lens === 'network') {
        // Every subsidiary zone (incl. server-only segments), sized by devices, colored by reach risk.
        const byKind = new Map<string, { id: string; zone: string; company: PackCompany; devices: number; risk: number }[]>()
        for (const c of manifest.companies) {
          const key = c.id.replace('b:', '')
          for (const e of doc.model.entities) {
            if (e.layer !== 'network' || !e.id.startsWith(`net:${key}.`)) continue
            const k = zoneKind(e.id)
            const zs = zoneScore.get(e.id)
            const risk = zs?.openToCrownJewel ? 2 : zs?.hostsCrownJewel ? 1 : 0
            byKind.set(k, [...(byKind.get(k) ?? []), { id: `${e.id}@${c.id}`, zone: e.id, company: c, devices: c.zones[e.id] ?? 0, risk }])
          }
        }
        const clusters = [...byKind].map(([k, list]) => ({ k, list, total: list.reduce((a, x) => a + x.devices + 20, 0) }))
        for (const cl of treemap(clusters, (x) => x.total, inset(root, 12, 36))) {
          const r = inset(cl, 5)
          const red = cl.item.list.filter((x) => x.risk === 2).length
          frames.push({ id: `zk:${cl.item.k}`, label: `${copy('{kind} · {count} zones', { kind: cl.item.k, count: cl.item.list.length })}${red ? ` · ${copy('{count} open → crown jewel', { count: red })}` : ''}`, rect: r, kind: 'zone', tag: true })
          const sorted = [...cl.item.list].sort((a, b) => b.risk - a.risk || b.devices - a.devices)
          const shown = sorted.slice(0, 80)
          const rest = sorted.slice(80)
          const items = [...shown, ...(rest.length ? [{ id: `more:${cl.item.k}`, zone: '', company: null as PackCompany | null, devices: rest.reduce((a, x) => a + x.devices, 0), risk: 0, more: rest.length }] : [])]
          for (const t of treemap(items, (x) => x.devices + 20, inset(r, 6, 26))) {
            const it = t.item as { id: string; zone: string; company: PackCompany | null; devices: number; risk: number; more?: number }
            const zs = zoneScore.get(it.zone)
            tiles.push({
              id: it.id,
              label: it.company ? it.company.label.replace('北極星 ', '') : copy('+{count} more zones', { count: it.more ?? 0 }),
              rect: inset(t, 1.2),
              fill: it.company ? zoneFill(zs) : 'rgba(230, 236, 232, 0.9)',
              meta: `${copy('{count} devices', { count: fmt(it.devices) })}${it.company && zs?.openToCrownJewel ? ` · ${copy('open → crown jewel')}` : it.company && zs?.hostsCrownJewel ? ` · ${copy('hosts crown jewel')}` : ''}`,
              kind: it.company ? 'zone' : 'more',
              hot: it.risk === 2,
              tag: it.risk === 2,
              onClick: it.company ? () => void goTo({ company: it.company!.id, dept: null, team: null }) : undefined,
            })
          }
        }
        return { frames, tiles, links, width, height }
      }
      const bySector = new Map<string, PackCompany[]>()
      for (const c of manifest.companies) bySector.set(c.sector, [...(bySector.get(c.sector) ?? []), c])
      const clusters = [...bySector].map(([sector, list]) => ({ sector, list, people: list.reduce((a, c) => a + c.people, 0) }))
      const placed: TileSpec[] = []
      for (const cl of treemap(clusters, (x) => x.people, inset(root, 12, 36))) {
        const r = inset(cl, 5)
        frames.push({ id: `sector:${cl.item.sector}`, label: copy('{sector} · {companies} companies · {people} people', { sector: cl.item.sector, companies: cl.item.list.length, people: fmt(cl.item.people) }), rect: r, kind: 'subsidiary', tag: true })
        for (const t of treemap(cl.item.list, (c) => c.people, inset(r, 6, 26))) {
          const c = t.item
          const hot = (lens === 'access' ? analysis?.companyAccessHeat[c.id]?.hot : analysis?.companyHeat[c.id]?.hot) ?? 0
          placed.push({
            id: c.id,
            label: c.label.replace('北極星 ', ''),
            rect: inset(t, 1.2),
            fill: companyFill(c),
            meta:
              DEVICE_LENS(lens)
                ? devMeta(analysis?.devices?.company[c.id])
                : lens === 'shadow'
                ? copy('{count} shadow apps · {people} people', { count: analysis?.companyShadow[c.id] ?? 0, people: fmt(c.people) })
                : `${copy('{people} people · {devices} devices', { people: fmt(c.people), devices: fmt(c.devices) })}${hot ? ` · ${copy('{count} hot', { count: hot })}` : ''}`,
            kind: 'company',
            hot: DEVICE_LENS(lens) ? devShare(analysis?.devices?.company[c.id]) >= DEVICE_HEAT_SATURATION : hot > 0,
            onClick: () => void goTo({ company: c.id, dept: null, team: null }),
          })
        }
      }
      // Screen-space name tags only for the largest tiles; the rest show on hover / zoom.
      const big = new Set([...placed].sort((a, b) => b.rect.w * b.rect.h - a.rect.w * a.rect.h).slice(0, TAG_CAP).map((t) => t.id))
      for (const t of placed) tiles.push({ ...t, tag: big.has(t.id) })
      if (lens === 'shadow' && analysis) shadowFrame(analysis.shadowApps)
      return { frames, tiles, links, width, height }
    }

    const company = companies.get(level.company)
    const chunk = chunks.get(level.company)
    if (!company) return { frames, tiles, links, width, height }
    const depts = index.children.get(company.id) ?? []

    if (!level.dept) {
      const root = { x: 0, y: 0, w: WORLD_W, h: height }
      frames.push({ id: company.id, label: copy('{company} · {count} departments', { company: company.label, count: company.departments }), rect: root, kind: 'subsidiary', root: true })
      if (lens === 'network') {
        // Subsidiary zones in the middle, internet / mobile on the left, group zones on the right;
        // reach edges drawn between them (red = open into a crown-jewel zone).
        const key = company.id.replace('b:', '')
        const own = doc.model.entities.filter((e) => e.layer === 'network' && e.id.startsWith(`net:${key}.`)).map((e) => e.id)
        const order = ['corp', 'mgmt', 'prod', 'pay', 'dmz', 'ot']
        own.sort((a, b) => order.indexOf(a.split('.').pop()!) - order.indexOf(b.split('.').pop()!))
        const touching = new Set<string>()
        for (const z of own) for (const r of [...(index.reachFrom.get(z) ?? []), ...(index.reachTo.get(z) ?? [])]) touching.add(r.from).add(r.to)
        const left = ['net:inet', 'net:mobile'].filter((z) => touching.has(z))
        const right = ['net:transit', 'net:gdc', 'net:gid', 'net:gcore'].filter((z) => touching.has(z) || z !== 'net:transit')
        const place = new Map<string, Rect>()
        const col = (ids: string[], x: number, w: number) => {
          const h = Math.min(220, (height - 80) / Math.max(1, ids.length) - 24)
          ids.forEach((z, i) => place.set(z, { x, y: 60 + i * (h + 24), w, h }))
        }
        col(left, 30, 220)
        const cols = own.length > 3 ? 2 : 1
        const cw = 360
        const perCol = Math.ceil(own.length / cols)
        for (let c = 0; c < cols; c++) col(own.slice(c * perCol, (c + 1) * perCol), 420 + c * (cw + 90), cw)
        col(right, WORLD_W - 280, 250)
        for (const [z, rect] of place) {
          const zs = zoneScore.get(z)
          const hostedIds = index.hosted.get(z) ?? []
          const cj = hostedIds.filter((id) => index.entities.get(id)?.criticality === 'crown-jewel').length
          const devices = company.zones[z] ?? 0
          tiles.push({
            id: z,
            label: GROUP_ZONES.includes(z) ? labelOf(z) : labelOf(z).replace(`${company.label} · `, ''),
            rect,
            fill: zoneFill(zs),
            meta: `${devices ? `${copy('{count} devices', { count: fmt(devices) })} · ` : ''}${copy('{count} systems', { count: hostedIds.length })}${cj ? ` · ${copy('{count} crown jewels', { count: cj })}` : ''}${zs?.crownJewelCost != null ? ` · ${copy('crown jewel cost {cost}', { cost: zs.crownJewelCost })}` : ''}`,
            kind: 'zone',
            hot: !!zs?.openToCrownJewel,
            tag: true,
            onClick: () => selectAndReveal(z),
          })
        }
        for (const z of own) {
          for (const r of [...(index.reachFrom.get(z) ?? []), ...(index.reachTo.get(z) ?? [])]) {
            const a = place.get(r.from)
            const b = place.get(r.to)
            if (!a || !b || links.some((l) => l.id === r.id)) continue
            const target = zoneScore.get(r.to)
            const red = r.kind === 'open' && !!(target?.hostsCrownJewel || target?.openToCrownJewel)
            links.push({ id: r.id, from: a, to: b, kind: r.kind, red, weight: r.weight ?? (r.jumpHost && r.kind !== 'blocked' ? weights.jumpHost : weights.reach[r.kind]) })
          }
        }
        return { frames, tiles, links, width, height }
      }
      const deptStats = (id: string) => manifest.departments[id] ?? [0, 0, 0]
      const maxDeptShadow = Math.max(1, ...depts.map((d) => analysis?.deptShadow[d.id]?.length ?? 0))
      for (const t of treemap(depts, (d) => deptStats(d.id)[0], inset(root, 12, 36))) {
        const d = t.item
        const [p, dv, tm] = deptStats(d.id)
        const heat = analysis?.deptHeat[d.id]
        tiles.push({
          id: d.id,
          label: d.label,
          rect: inset(t, 3),
          fill: DEVICE_LENS(lens)
            ? shareColor(devShare(analysis?.devices?.dept[d.id]), DEVICE_HEAT_SATURATION)
            : lens === 'shadow' ? shadowColor(analysis?.deptShadow[d.id]?.length ?? 0, maxDeptShadow) : shareColor(heat?.share ?? 0, sat),
          meta: DEVICE_LENS(lens)
            ? devMeta(analysis?.devices?.dept[d.id])
            : lens === 'shadow' ? copy('{count} shadow apps', { count: analysis?.deptShadow[d.id]?.length ?? 0 }) : copy('{people} people · {devices} devices · {teams} teams', { people: fmt(p), devices: fmt(dv), teams: tm }),
          kind: 'department',
          hot: DEVICE_LENS(lens) ? devShare(analysis?.devices?.dept[d.id]) >= DEVICE_HEAT_SATURATION : (heat?.hot ?? 0) > 0,
          tag: true,
          onClick: () => void goTo({ company: company.id, dept: d.id, team: null }),
        })
      }
      if (lens === 'shadow' && analysis) shadowFrame(analysis.shadowApps, new Set(depts.map((d) => d.id)))
      return { frames, tiles, links, width, height }
    }

    // Department (and team) level.
    const dept = index.boundaries.get(level.dept)
    const root = { x: 0, y: 0, w: WORLD_W, h: height }
    frames.push({ id: level.dept, label: `${company.label} › ${dept?.label ?? ''}`, rect: root, kind: 'department', root: true })
    const roles = index.rolesByDept.get(level.dept) ?? []
    const roleRow = { x: 12, y: 44, w: WORLD_W - 24, h: 120 }
    frames.push({ id: `${level.dept}#roles`, label: copy('Roles in this department'), rect: roleRow, kind: 'team' })
    const rw = Math.min(360, (roleRow.w - 20) / Math.max(1, roles.length))
    roles.forEach((r, i) => {
      const s = roleScore.get(r.id)
      tiles.push({
        id: r.id,
        label: r.label,
        rect: { x: roleRow.x + 10 + i * rw, y: roleRow.y + 32, w: rw - 10, h: roleRow.h - 42 },
        fill: heatColor(s?.score ?? 0),
        meta: s ? copy('score {score} · cost {cost} · {holders} holders', { score: s.score, cost: s.minCost ?? '—', holders: chunk?.holders.get(r.id)?.length ?? 0 }) : copy('score —'),
        kind: 'role',
        hot: (s?.score ?? 0) >= HOT,
        tag: true,
        onClick: () => selectAndReveal(r.id),
      })
    })
    const teams = (chunk?.teams ?? []).filter((t) => t.parent === level.dept)
    const body = { x: 12, y: roleRow.y + roleRow.h + 14, w: WORLD_W - 24, h: height - roleRow.y - roleRow.h - 26 }
    if (lens === 'shadow' && analysis) shadowFrame(analysis.shadowApps, new Set([level.dept]))
    for (const t of treemap(teams, (tm) => (chunk?.teamPeople.get(tm.id)?.length ?? 0) + (chunk?.teamDevices.get(tm.id)?.length ?? 0) * 0.6 + 1, body)) {
      const tm = t.item
      tiles.push({
        id: tm.id,
        label: tm.label.replace(`${dept?.label ?? ''} · `, ''),
        rect: inset(t, 5),
        fill: tm.id === level.team ? 'rgba(236, 244, 255, 1)' : 'rgba(255, 255, 255, 0.96)',
        meta: copy('{people} people · {devices} devices', { people: chunk?.teamPeople.get(tm.id)?.length ?? 0, devices: chunk?.teamDevices.get(tm.id)?.length ?? 0 }),
        kind: 'team',
        tag: true,
        canvas: { team: tm.id },
        onClick: () => void goTo({ company: company.id, dept: level.dept, team: tm.id }),
      })
    }
    return { frames, tiles, links, width, height }
  }, [manifest, doc, analysis, lens, level, companies, chunks, index, roleScore, labelOf, goTo, zoneScore, weights, sat, selectAndReveal, copy])

  // ---- Fit to the safe area (same rule as the Make grid) -------------------------------
  const viewKey = `${level.company}|${level.dept}|${level.team}|${lens}|${floor.width}`
  const lastView = useRef(viewKey)
  useLayoutEffect(() => {
    if (lastView.current !== viewKey) {
      // A new level or lens re-fits even if the user panned the previous one.
      lastView.current = viewKey
      fitPasses.current = 0
      userMoved.current = false
    }
    const stage = stageRef.current
    if (!stage || userMoved.current || fitPasses.current > 4) return
    const cards = [...stage.querySelectorAll<HTMLElement>('[data-plane-card]')]
    if (!cards.length) return
    const rects = cards.map((el) => el.getBoundingClientRect())
    const content = {
      left: Math.min(...rects.map((r) => r.left)),
      right: Math.max(...rects.map((r) => r.right)),
      top: Math.min(...rects.map((r) => r.top)),
      bottom: Math.max(...rects.map((r) => r.bottom)),
    }
    const box = stage.getBoundingClientRect()
    const leftRail = stage.querySelector('.make-rail-left')?.getBoundingClientRect()
    const rightRail = stage.querySelector('.make-rail-right')?.getBoundingClientRect()
    const bottomBar = stage.querySelector('.make-bottom')?.getBoundingClientRect()
    const safe = {
      left: (leftRail && leftRail.width > 0 ? leftRail.right : box.left) + 12,
      right: (rightRail && rightRail.width > 0 ? rightRail.left : box.right) - 12,
      top: box.top + 44,
      bottom: (bottomBar && bottomBar.height > 0 ? bottomBar.top : box.bottom) - 12,
    }
    const next = fitBoardsInSafeArea({ zoom, pan, content, safe, stageCenter: { x: box.left + box.width / 2, y: box.top + box.height / 2 } })
    if (!next) return
    fitPasses.current += 1
    setZoom(next.zoom)
    setPan(next.pan)
  }, [zoom, pan, viewKey, floor])

  const anchors = useBoardAnchors(stageRef, `${viewKey}|${zoom}|${pan.x}|${pan.y}|${floor.tiles.length}`)

  const onPointerDown = (event: REPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('button, input, select, a, .make-rail, .make-bottom, .make-zoom, .scale-crumbs')) return
    userMoved.current = true
    drag.current = { x: event.clientX, y: event.clientY, ox: pan.x, oy: pan.y }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: REPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (d) setPan({ x: d.ox + event.clientX - d.x, y: d.oy + event.clientY - d.y })
  }
  const onWheel = (event: REWheelEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('.make-rail')) return
    userMoved.current = true
    setZoom((z) => Math.min(3, Math.max(0.25, z * (event.deltaY < 0 ? 1.1 : 0.9))))
  }

  // ---- Search over the index (companies, departments, roles, systems) -------------------
  const q = query.trim().toLowerCase()
  const results = useMemo(() => {
    if (!q || !doc) return []
    const out: { id: string; label: string; kind: string; go: () => void }[] = []
    for (const c of manifest?.companies ?? []) {
      if (out.length >= 40) break
      if (c.label.toLowerCase().includes(q) || c.id.includes(q)) out.push({ id: c.id, label: c.label, kind: 'subsidiary', go: () => void goTo({ company: c.id, dept: null, team: null }) })
    }
    for (const b of doc.model.boundaries ?? []) {
      if (out.length >= 80) break
      if (b.kind === 'department' && `${b.label} ${b.id}`.toLowerCase().includes(q)) {
        out.push({ id: b.id, label: `${b.label} · ${b.parent?.replace('b:', '').toUpperCase()}`, kind: 'department', go: () => void goTo({ company: b.parent ?? null, dept: b.id, team: null }) })
      }
    }
    for (const r of doc.model.roles ?? []) {
      if (out.length >= 120) break
      if (`${r.label} ${r.id}`.toLowerCase().includes(q)) out.push({ id: r.id, label: roleLabel(r.id), kind: 'role', go: () => openRole(r.id) })
    }
    for (const e of doc.model.entities) {
      if (out.length >= 160) break
      if (e.layer === 'server' && `${e.label} ${e.id}`.toLowerCase().includes(q)) out.push({ id: e.id, label: e.label, kind: e.sanctioned === false ? 'shadow SaaS' : 'system', go: () => openRole(e.id) })
    }
    return out
  }, [q, doc, manifest, goTo, openRole, roleLabel])

  // ---- Scope for panels ------------------------------------------------------------------
  const scopeCompany = level.company ? companies.get(level.company) ?? null : null
  const inScope = useCallback(
    (boundary: string | undefined) => {
      if (!level.company) return true
      if (level.dept) return boundary === level.dept
      return index.companyOf(boundary) === level.company
    },
    [level, index],
  )
  const scopedReport = useMemo(() => {
    if (!analysis) return null
    const roles = analysis.report.roles.filter((r) => inScope(index.roles.get(r.role)?.boundary))
    const resources = analysis.report.resources.filter((r) => {
      if (!level.company) return true
      const e = index.entities.get(r.resource)
      // Group systems stay visible in every scope when a scoped role reaches them.
      return inScope(e?.boundary) || (r.viaRole != null && inScope(index.roles.get(r.viaRole)?.boundary))
    })
    const unverified = roles.reduce((a, r) => a + r.unverifiedPaths, 0)
    const paths = roles.reduce((a, r) => a + r.paths, 0)
    return { ...analysis.report, roles, resources, totals: { ...analysis.report.totals, unverifiedPaths: unverified, paths, roles: roles.length, reachableRoles: roles.filter((r) => r.minCost != null).length } }
  }, [analysis, inScope, index, level.company])

  const crumbs: { id: string; label: string; go: () => void }[] = [{ id: 'group', label: '北極星 Group', go: () => void goTo({ company: null, dept: null, team: null }) }]
  if (scopeCompany) crumbs.push({ id: scopeCompany.id, label: scopeCompany.label.replace('北極星 ', ''), go: () => void goTo({ company: scopeCompany.id, dept: null, team: null }) })
  if (level.dept) crumbs.push({ id: level.dept, label: labelOf(level.dept), go: () => void goTo({ ...level, team: null }) })
  if (level.team) crumbs.push({ id: level.team, label: labelOf(level.team) === level.team ? chunks.get(level.company!)?.teams.find((t) => t.id === level.team)?.label ?? level.team : labelOf(level.team), go: () => undefined })

  const levelName = level.team ? 'team' : level.dept ? 'department' : level.company ? 'company' : 'group'
  const tileCount = floor.tiles.length
  const ready = !!doc && !!manifest
  const onExport = () => {
    if (!doc) return
    try {
      const file = buildMithDownload(doc, {
        arrangement: doc.diagram.arrangement,
        camera: { ...doc.diagram.camera, zoom },
        selection: selectedId,
        // Software risk / Log gaps are enterprise-only lenses with no diagram.lens value; they export without one.
        ...((DIAGRAM_LENSES as readonly string[]).includes(lens) ? { lens: lens as DiagramLens, frame: 'org' as const } : {}),
      })
      saveMithFile(file)
      setExportNote(
        `Exported ${file.filename} · ${formatBytes(file.bytes)} · Mithril Form. This is the index only. People and devices stay in the chunked pack.`,
      )
    } catch (err) {
      setExportNote(err instanceof Error ? err.message : 'Export failed.')
    }
  }

  return (
    <div
      className={`make-app is-iso is-coplanar is-lens is-scale${over ? ' is-file-drop' : ''}`}
      {...dropHandlers}
      data-lens={lens}
      data-scale-level={levelName}
      data-scale-ready={ready ? 'true' : 'false'}
      data-analysis={analysis ? 'ready' : 'pending'}
      data-tiles={tileCount}
      style={{ ['--iso-tilt' as string]: '54deg', ['--iso-yaw' as string]: '-28deg' }}
    >
      <header className="make-top">
        <div className="make-brand">
          <span className="make-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <span className="make-word">
            <strong>Mithril Twin</strong>
            <h1 className="make-doc-title">{manifest?.title ?? '北極星 Group · enterprise scale (synthetic)'}</h1>
          </span>
        </div>
        <div className="make-top-actions">
          <span className="make-chip">synthetic-demo</span>
          <span className="make-chip warn">{t('generated')}</span>
          <span className="make-chip">{t('no-runners')}</span>
          <span className="make-chip warn">{t('viz only')}</span>
          <ThemeSwitcher />
          <GitHubLink className="make-github-link" />
          <button
            type="button"
            className="make-detail-toggle"
            aria-controls="scale-lens-detail"
            aria-expanded={mobileDetailOpen}
            onClick={() => setMobileDetailOpen((open) => !open)}
          >{t('Details')}</button>
        </div>
      </header>

      <div className="make-stage" ref={stageRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => { drag.current = null }} onWheel={onWheel}>
        {!ready && !error && <div className="make-loading">{t('Loading synthetic enterprise pack…')}</div>}
        {busy && <div className="make-loading scale-busy">{busy}</div>}
        {error && <div className="make-error" role="alert">{error}</div>}
        {over && <div className="make-drop-hint">{t('Drop a .mith file')}</div>}

        <nav className="scale-crumbs" aria-label={t('Drill path')}>
          {crumbs.map((c, i) => (
            <button key={c.id} type="button" className={i === crumbs.length - 1 ? 'active' : ''} onClick={c.go} disabled={i === crumbs.length - 1}>
              {c.label}
            </button>
          ))}
        </nav>

        <div className="make-world" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
          <div className="make-stack" style={{ width: floor.width, height: floor.height }}>
            <div className="make-floor" />
            {floor.frames.map((f) => (
              <div
                key={f.id}
                className={`lens-frame scale-frame kind-${f.kind === 'company' ? 'company' : f.kind} ${f.dashed ? 'is-dashed' : ''}`}
                data-lens-frame={f.id}
                data-frame-kind={f.kind}
                {...(f.root ? { 'data-plane-card': f.id } : {})}
                style={{ left: f.rect.x, top: f.rect.y, width: f.rect.w, height: f.rect.h, ['--lens-depth' as string]: f.root ? '0' : '1' }}
              >
                {(f.tag || f.root) && <i className="lens-tag-anchor" data-board-anchor={f.id} aria-hidden="true" />}
              </div>
            ))}
            {floor.links.length > 0 && <ReachLinks links={floor.links} width={floor.width} height={floor.height} />}
            {floor.tiles.map((t) => (
              <ScaleTile
                key={t.id}
                tile={t}
                selected={t.id === selectedId || t.id === level.team}
                dim={!!q && !t.label.toLowerCase().includes(q)}
                chunk={t.canvas && level.company ? chunks.get(level.company) ?? null : null}
                lens={lens}
                roleScore={roleScore}
                weights={weights}
                onPick={selectAndReveal}
              />
            ))}
          </div>
        </div>

        <div className="make-board-tags lens-frame-tags scale-tags" aria-hidden="true" style={{ ['--tag-scale' as string]: Math.min(1, Math.max(0.75, zoom + 0.2)).toFixed(2) }}>
          {floor.frames.filter((f) => f.tag || f.root).map((f) => {
            const a = anchors.get(f.id)
            if (!a) return null
            return (
              <span key={f.id} className={`lens-frame-tag kind-${f.kind} ${f.dashed ? 'is-dashed' : ''}`} data-frame-tag={f.id} style={{ left: a.x, top: a.y }}>
                <em>{t(f.kind === 'subsidiary' && !f.root ? 'sector' : f.kind === 'company' ? 'group' : f.kind === 'shadow' ? 'shadow IT' : f.kind === 'team' ? 'roles' : f.kind)}</em>
                {f.label}
              </span>
            )
          })}
          {floor.tiles.filter((t) => t.tag).map((t) => {
            const a = anchors.get(t.id)
            if (!a) return null
            return (
              <span key={t.id} className={`scale-tile-tag kind-${t.kind} ${t.hot ? 'is-hot' : ''}`} data-tile-tag={t.id} style={{ left: a.x, top: a.y }}>
                {t.label}
              </span>
            )
          })}
        </div>

        <aside className="make-rail make-rail-left" aria-label={t('Search')}>
          <label className="make-rail-search">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Search companies, depts, roles, systems')} aria-label={t('Search the enterprise')} />
          </label>
          <div className="make-list scale-results" role="list">
            {q && results.length === 0 && <p className="lens-blurb">{t('No match.')}</p>}
            {results.map((r) => (
              <button key={`${r.kind}:${r.id}`} type="button" className="make-row" onClick={r.go}>
                <span className="make-row-copy">
                  <strong>{r.label}</strong>
                  <span>{t(r.kind)}</span>
                </span>
              </button>
            ))}
            {!q && manifest && (
              <dl className="lens-stats scale-counts" aria-label={t('Dataset counts')}>
                <div><dt>{t('Subsidiaries')}</dt><dd>{fmt(manifest.counts.subsidiaries)}</dd></div>
                <div><dt>{t('Departments')}</dt><dd>{fmt(manifest.counts.departments)}</dd></div>
                <div><dt>{t('Teams')}</dt><dd>{fmt(manifest.counts.teams)}</dd></div>
                <div><dt>{t('Employees')}</dt><dd>{fmt(manifest.counts.employees)}</dd></div>
                <div><dt>{t('Devices')}</dt><dd>{fmt(manifest.counts.devices)}</dd></div>
                <div><dt>{t('Systems / SaaS')}</dt><dd>{fmt(manifest.counts.systems)}</dd></div>
                <div><dt>{t('Unsanctioned')}</dt><dd>{fmt(manifest.counts.unsanctioned)}</dd></div>
                <div><dt>{t('Zones')}</dt><dd>{fmt(manifest.counts.zones)}</dd></div>
                <div><dt>{t('Roles')}</dt><dd>{fmt(manifest.counts.roles)}</dd></div>
                <div><dt>{t('Grants')}</dt><dd>{fmt(manifest.counts.grants)}</dd></div>
                <div><dt>{t('Channels')}</dt><dd>{fmt(manifest.counts.channels)}</dd></div>
                <div><dt>{t('Ext. actors')}</dt><dd>{fmt(manifest.counts.actors)}</dd></div>
              </dl>
            )}
            {!q && manifest && (
              <p className="lens-blurb">
                {t('Seeded synthetic generator {name} v{version} (seed {seed}). No real people, companies, or systems.', { name: manifest.generator.name, version: manifest.generator.version, seed: manifest.generator.seed })}
              </p>
            )}
          </div>
          <div className="make-rail-foot">
            <select className="make-sample-select" aria-label={t('Sample document')} value={sampleId} onChange={(e) => onPickSample(e.target.value)}>
              {SAMPLE_DOCS.map((d) => (
                <option key={d.id} value={d.id}>{d.file}</option>
              ))}
            </select>
            <MithFileActions
              onFiles={onImportFiles}
              onExport={onExport}
              exportDisabled={!doc}
              exportTitle={t('Download the index as one .mith file. Company chunks stay in the pack.')}
            />
            {exportNote && <p className="make-file-note" role="status">{exportNote}</p>}
          </div>
        </aside>

        <aside
          id="scale-lens-detail"
          className={`make-rail make-rail-right${mobileDetailOpen ? ' is-mobile-open' : ''}`}
          aria-label={t('Lens detail')}
        >
          <button type="button" className="make-mobile-detail-close" aria-label={t('Close details')} onClick={() => setMobileDetailOpen(false)}>×</button>
          <ScalePanel
            lens={lens}
            levelName={levelName}
            manifest={manifest}
            analysis={analysis}
            analysisVia={analysisVia}
            scopedReport={scopedReport}
            scopeCompany={scopeCompany}
            level={level}
            chunks={chunks}
            index={index}
            roleScore={roleScore}
            selectedId={selectedId}
            onSelect={openRole}
            labelOf={labelOf}
            roleLabel={roleLabel}
            perf={perf}
            tileCount={tileCount}
            path={path}
            sat={sat}
            weights={weights}
            onPick={selectAndReveal}
            onDrill={(id) => {
              if (!id) return
              const company = index.companyOf(id)
              void goTo({ company, dept: company && company !== id ? id : null, team: null })
            }}
          />
        </aside>

        <div className="make-bottom">
          <div className="lens-switch" role="group" aria-label={t('Lens')}>
            {SCALE_LENSES.map((l) => (
              <button key={l.id} type="button" className={lens === l.id ? 'active' : ''} aria-pressed={lens === l.id} onClick={() => pickLens(l.id)}>
                {t(l.label)}
              </button>
            ))}
          </div>
          <span className="scale-level-chip" data-level={levelName}>{t('{level} · {count} tiles', { level: t(levelName), count: tileCount })}</span>
        </div>

        <div className="make-zoom">
          <button type="button" onClick={() => { userMoved.current = false; fitPasses.current = 0; setZoom((z) => z * 0.999) }}>{t('Fit')}</button>
          <button type="button" aria-label={t('Zoom out')} onClick={() => { userMoved.current = true; setZoom((z) => Math.max(0.25, z / 1.15)) }}>−</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" aria-label={t('Zoom in')} onClick={() => { userMoved.current = true; setZoom((z) => Math.min(3, z * 1.15)) }}>+</button>
        </div>
      </div>
    </div>
  )
}

function ScaleTile({
  tile,
  selected,
  dim,
  chunk,
  lens,
  roleScore,
  weights,
  onPick,
}: {
  tile: TileSpec
  selected: boolean
  dim: boolean
  chunk: ExpandedChunk | null
  lens: ScaleLens
  roleScore: Map<string, RoleScore>
  weights: ResolvedWeights
  onPick: (id: string) => void
}) {
  const { rect } = tile
  const showMeta = rect.w > 54 && rect.h > 22
  return (
    <button
      type="button"
      className={`scale-tile kind-${tile.kind} ${tile.hot ? 'is-hot' : ''} ${selected ? 'is-selected' : ''} ${dim ? 'is-dim' : ''}`}
      data-scale-tile={tile.id}
      data-tile-kind={tile.kind}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, background: tile.fill }}
      title={`${tile.label}${tile.meta ? ` — ${tile.meta}` : ''}`}
      aria-label={tile.label}
      onClick={(e) => {
        e.stopPropagation()
        tile.onClick?.()
      }}
    >
      {tile.canvas && chunk && <TeamCanvas team={tile.canvas.team} chunk={chunk} w={rect.w} h={rect.h} lens={lens} roleScore={roleScore} weights={weights} onPick={onPick} interactive={selected} />}
      {showMeta && tile.meta && <span className="scale-tile-meta">{tile.meta}</span>}
      {tile.tag && <i className="scale-anchor" data-board-anchor={tile.id} aria-hidden="true" />}
    </button>
  )
}

/** People (dots) and devices (squares) of one team, drawn on a canvas instead of DOM nodes. */
function TeamCanvas({
  team,
  chunk,
  w,
  h,
  lens,
  roleScore,
  weights,
  onPick,
  interactive,
}: {
  team: string
  chunk: ExpandedChunk
  w: number
  h: number
  lens: ScaleLens
  roleScore: Map<string, RoleScore>
  weights: ResolvedWeights
  onPick: (id: string) => void
  /** The drilled-into team: its dots / squares become clickable. */
  interactive: boolean
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const grid = useRef<{ cell: number; cols: number; ids: string[] }>({ cell: 1, cols: 1, ids: [] })
  const top = 26
  const bottom = 18
  const cw = Math.max(10, Math.floor(w - 12))
  const ch = Math.max(10, Math.floor(h - top - bottom))
  useLayoutEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = cw * dpr
    canvas.height = ch * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cw, ch)
    const people = chunk.teamPeople.get(team) ?? []
    const devices = chunk.teamDevices.get(team) ?? []
    // Person heat = best exposure score of any role they hold.
    const personHeat = new Map<number, number>()
    const prefix = chunk.people[0]?.id.replace(/p0$/, '') ?? ''
    for (const [role, holders] of chunk.holders) {
      const s = roleScore.get(role)?.score ?? 0
      for (const h of holders) {
        const i = Number(h.slice(prefix.length + 1))
        personHeat.set(i, Math.max(personHeat.get(i) ?? 0, s))
      }
    }
    const n = people.length + devices.length
    const cell = Math.max(3, Math.min(26, Math.floor(Math.sqrt((cw * ch) / Math.max(1, n)) * 0.8)))
    const cols = Math.max(1, Math.floor(cw / cell))
    grid.current = { cell, cols, ids: [...people.map((p) => chunk.people[p]!.id), ...devices.map((d) => chunk.devices[d]!.id)] }
    let k = 0
    const zoneColor = (z: string | undefined) => (z === 'net:mobile' ? '#7c9cf5' : z?.endsWith('.pay') ? '#e0a100' : z?.endsWith('.dmz') ? '#d9480f' : z?.endsWith('.mgmt') ? '#495057' : '#3aa37a')
    for (const p of people) {
      const x = (k % cols) * cell + cell / 2
      const y = Math.floor(k / cols) * cell + cell / 2
      k++
      if (y > ch) break
      const heat = personHeat.get(p) ?? 0
      ctx.fillStyle = lens === 'network' ? zoneColor(chunk.people[p]?.zone) : heat >= 50 ? '#d6283f' : heat >= 25 ? '#f08c2e' : heat > 0 ? '#e7b416' : '#7f5fe0'
      ctx.beginPath()
      ctx.arc(x, y, Math.max(1.2, cell * 0.32), 0, Math.PI * 2)
      ctx.fill()
    }
    for (const d of devices) {
      const x = (k % cols) * cell + cell / 2
      const y = Math.floor(k / cols) * cell + cell / 2
      k++
      if (y > ch) break
      const dev = chunk.devices[d]
      const s = Math.max(1.6, cell * 0.5)
      ctx.fillStyle =
        lens === 'network'
          ? zoneColor(dev?.zone)
          : lens === 'software'
            ? easeColor(deviceRisk(dev?.software, weights.device).ease)
            : lens === 'logs'
              ? coverageColor(logCoverage(dev?.logs, weights.minRetentionDays))
              : dev?.type === 'Server' ? '#343a40' : dev?.type === 'Phone' ? '#94a3d8' : '#adb5c7'
      ctx.fillRect(x - s / 2, y - s / 2, s, s)
    }
  }, [team, chunk, cw, ch, lens, roleScore, weights])
  // Click a dot / square to open that person or device (the tile click still drills otherwise).
  const pick = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const sx = r.width / cw
    const g = grid.current
    const col = Math.floor((e.clientX - r.left) / sx / g.cell)
    const row = Math.floor((e.clientY - r.top) / sx / g.cell)
    const id = col < g.cols ? g.ids[row * g.cols + col] : undefined
    if (id) {
      e.stopPropagation()
      onPick(id)
    }
  }
  return <canvas ref={ref} className="scale-canvas" style={{ left: 6, top, width: cw, height: ch, pointerEvents: interactive ? 'auto' : undefined, cursor: interactive ? 'pointer' : undefined }} aria-hidden="true" onClick={pick} data-team-canvas={team} />
}

type IndexLike = {
  boundaries: Map<string, MithBoundary>
  roles: Map<string, MithRole>
  entities: Map<string, MithEntity>
  channels: Map<string, MithChannel>
  companyOf: (id: string | undefined) => string | null
  reachFrom?: Map<string, MithReach[]>
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <h3 className="lens-h3">{title}</h3>
      {children}
    </>
  )
}

const LENS_BLURB: Record<ScaleLens, string> = {
  org: 'Subsidiaries clustered by sector, sized by headcount, tinted by the share of roles inside with exposure score ≥ 50. Click to drill: company → department → team.',
  network: 'Network zones and zone→zone reach (open / conditional / blocked, weighted). Red: an open-only path into a zone hosting a crown jewel. Drill into a subsidiary to see its reach edges.',
  access: 'Resources ranked by exposure: cheapest outside path (org channels, network reach, or shadow-SaaS entry) × criticality × grant level (network-only access counts at 0.6).',
  impersonation: 'Roles ranked by exposure score over mixed org + network paths: actor → channel → role → device → zone → reach → system. Weak controls count; red hops carry no verification or cross open reach.',
  software:
    'Share of devices whose installed software makes compromise easier (ease ≥ 0.25: EOL, unsanctioned, or unpatched medium+ vulnerabilities). Ease lowers the role → device pivot cost. Drill to a team and click a device for its software, logs, and people.',
  logs:
    'Share of devices with a log-coverage gap: logs not forwarded (blind spot) or kept below the minimum retention. Devices without a logs block count as unknown, not as gaps. Gaps are flagged on paths; they never change reachability.',
  shadow: 'Unsanctioned SaaS sits outside the org boundary, sized by how many departments use it. Selecting one shows its entry path: internet → SaaS → sync into users’ zones → reach.',
}

function ScalePanel(props: {
  lens: ScaleLens
  levelName: string
  manifest: PackManifest | null
  analysis: ScaleAnalysis | null
  analysisVia: string
  scopedReport: ScaleAnalysis['report'] | null
  scopeCompany: PackCompany | null
  level: Level
  chunks: Map<string, ExpandedChunk>
  index: IndexLike
  roleScore: Map<string, RoleScore>
  selectedId: string | null
  onSelect: (id: string | null) => void
  labelOf: (id: string) => string
  roleLabel: (id: string) => string
  perf: PerfRow[]
  tileCount: number
  path: PathResult | null
  sat: number
  weights: ResolvedWeights
  /** Select without navigating (devices / people inside the loaded chunk). */
  onPick: (id: string | null) => void
  /** Drill to a subsidiary or department tile. */
  onDrill: (id: string | null) => void
}) {
  const { lens, manifest, analysis, scopedReport, scopeCompany, level, chunks, index, roleScore, selectedId, onSelect, labelOf, roleLabel, perf } = props
  const t = useScaleCopy()
  const chunk = level.company ? chunks.get(level.company) ?? null : null
  const personDevices = useMemo(() => (chunk ? devicesByPerson(chunk) : new Map<string, never[]>()), [chunk])
  const roleWhere = (id: string) => {
    const r = index.roles.get(id)
    if (r) return `${labelOf(r.boundary)} · ${(index.companyOf(r.boundary) ?? '').replace('b:', '').toUpperCase()}`
    const e = index.entities.get(id)
    return e?.boundary ? (index.companyOf(e.boundary) ?? '').replace('b:', '').toUpperCase() : ''
  }
  const selectedRole = selectedId ? index.roles.get(selectedId) : undefined
  const selectedEntity = selectedId ? index.entities.get(selectedId) : undefined
  const shadowApp = selectedId ? analysis?.shadowApps.find((a) => a.id === selectedId) : undefined
  const selectedDevice = selectedId ? chunkDevice(chunk, selectedId) : undefined
  const selectedPerson = selectedId ? chunkPerson(chunk, selectedId) : undefined
  const pick = (id: string) => props.onPick(id)
  const scopedShadow = useMemo(() => {
    if (!analysis) return []
    if (!level.company) return analysis.shadowApps
    const deptSet = level.dept ? new Set([level.dept]) : null
    return analysis.shadowApps.filter((a) => (deptSet ? a.departments.some((d) => deptSet.has(d)) : a.companies.includes(level.company!)))
  }, [analysis, level])

  return (
    <div className="lens-panel scale-panel" data-lens-panel={lens}>
      <div className="lens-panel-head">
        <strong>{t('{lens} lens', { lens: t(SCALE_LENSES.find((l) => l.id === lens)?.label ?? lens) })}</strong>
        <span className="lens-badge">{t('display-only · synthetic')}</span>
      </div>
      <p className="lens-blurb">{t(LENS_BLURB[lens])}</p>
      {!analysis && <p className="lens-blurb" data-analysis-pending>{t('Exposure analysis running in a Web Worker…')}</p>}

      {selectedId && (
        <div className="lens-detail" aria-label={t('Selection')}>
          <div className="lens-detail-head">
            <h2>{selectedRole ? selectedRole.label : selectedDevice ? selectedDevice.label : selectedPerson ? selectedPerson.label : labelOf(selectedId)}</h2>
            <button type="button" className="make-icon-btn" aria-label={t('Clear selection')} onClick={() => onSelect(null)}>×</button>
          </div>
          {selectedRole && analysis && (
            <>
              <dl className="lens-kv">
                <div><dt>{t('where')}</dt><dd>{roleLabel(selectedRole.id)}</dd></div>
                <div><dt>{t('holders')}</dt><dd>{t('{count} synthetic people', { count: chunk?.holders.get(selectedRole.id)?.length ?? '—' })}</dd></div>
                <div><dt>{t('unverified paths')}</dt><dd>{t('{unverified} of {paths} (≤4 hops) · min hops {minimum}', { unverified: roleScore.get(selectedRole.id)?.unverifiedPaths ?? 0, paths: roleScore.get(selectedRole.id)?.paths ?? 0, minimum: roleScore.get(selectedRole.id)?.minHops ?? '—' })}</dd></div>
              </dl>
              <MixedPath path={props.path} index={index} labelOf={labelOf} />
            </>
          )}
          {selectedDevice && <DeviceDetail device={selectedDevice} weights={props.weights} labelOf={(id) => chunkPerson(chunk, id)?.label ?? labelOf(id)} onPick={pick} />}
          {selectedPerson && <PersonDevices person={selectedPerson} devices={personDevices.get(selectedPerson.id) ?? []} weights={props.weights} onPick={pick} />}
          {selectedEntity && !shadowApp && !selectedDevice && !selectedPerson && (
            <dl className="lens-kv">
              <div><dt>{t('type')}</dt><dd>{selectedEntity.type}</dd></div>
              <div><dt>{t('criticality')}</dt><dd>{selectedEntity.criticality ? t(selectedEntity.criticality) : t('not declared (level fallback)')}</dd></div>
              <div><dt>{t('zone')}</dt><dd>{selectedEntity.zone ? labelOf(selectedEntity.zone) : '—'}</dd></div>
              {analysis && (
                <div><dt>{t('exposure')}</dt><dd>{(() => { const r = analysis.report.resources.find((x) => x.resource === selectedEntity.id); return r ? t('score {score} via {route}{reach}', { score: r.score, route: r.viaRole ? roleLabel(r.viaRole) : r.viaNetwork ? t('network / shadow SaaS') : '—', reach: r.viaNetwork ? t(' · network-reachable') : '' }) : t('no grants') })()}</dd></div>
              )}
              {selectedEntity.layer === 'network' && (() => {
                const z = analysis?.report.zones.find((x) => x.zone === selectedEntity.id)
                return z ? <div><dt>{t('reach')}</dt><dd>{t('{count} zones reachable · crown jewel {target}{open}', { count: z.reachableZones, target: z.crownJewelCost != null ? t('at cost {cost} ({name})', { cost: z.crownJewelCost, name: labelOf(z.crownJewel!) }) : t('not reachable'), open: z.openToCrownJewel ? t(' · OPEN path') : '' })}</dd></div> : null
              })()}
            </dl>
          )}
          {selectedEntity?.layer === 'server' && !shadowApp && <MixedPath path={props.path} index={index} labelOf={labelOf} />}
          {shadowApp && (
            <dl className="lens-kv">
              <div><dt>{t('source')}</dt><dd>{shadowApp.source}</dd></div>
              <div><dt>{t('criticality')}</dt><dd>{t(shadowApp.criticality)}</dd></div>
              <div><dt>{t('used by')}</dt><dd>{t('{departments} departments in {subsidiaries} subsidiaries', { departments: shadowApp.departments.length, subsidiaries: shadowApp.companies.length })}</dd></div>
              <div><dt>{t('first users')}</dt><dd>{shadowApp.departments.slice(0, 6).map((d) => `${labelOf(d)} (${d.split('.')[0]!.replace('b:', '').toUpperCase()})`).join(', ')}</dd></div>
              {(() => {
                const x = analysis?.report.shadowEntries.find((e) => e.system === shadowApp.id)
                return x ? <div><dt>{t('entry path')}</dt><dd>{t('syncs into {zones} zones · {reachable} reachable · crown jewel {target}', { zones: x.syncZones, reachable: x.reachableZones, target: x.crownJewelCost != null ? t('at cost {cost} ({name})', { cost: x.crownJewelCost, name: labelOf(x.crownJewel!) }) : t('not reachable') })}</dd></div> : null
              })()}
            </dl>
          )}
        </div>
      )}

      {lens === 'org' && (
        <>
          {level.dept && manifest?.departments[level.dept] && (
            <Section title={t('Department · {name}', { name: labelOf(level.dept) })}>
              <dl className="lens-stats">
                <div><dt>{t('People')}</dt><dd>{fmt(manifest.departments[level.dept]![0])}</dd></div>
                <div><dt>{t('Devices')}</dt><dd>{fmt(manifest.departments[level.dept]![1])}</dd></div>
                <div><dt>{t('Teams')}</dt><dd>{manifest.departments[level.dept]![2]}</dd></div>
                <div><dt>{t('Roles ≥ {threshold}', { threshold: HOT })}</dt><dd>{analysis?.deptHeat[level.dept] ? t('{hot} of {roles}', { hot: analysis.deptHeat[level.dept]!.hot, roles: analysis.deptHeat[level.dept]!.roles }) : '—'}</dd></div>
              </dl>
            </Section>
          )}
          {scopeCompany && !level.dept && (
            <dl className="lens-stats">
              <div><dt>{t('People')}</dt><dd>{fmt(scopeCompany.people)}</dd></div>
              <div><dt>{t('Devices')}</dt><dd>{fmt(scopeCompany.devices)}</dd></div>
              <div><dt>{t('Departments')}</dt><dd>{scopeCompany.departments}</dd></div>
              <div><dt>{t('Teams')}</dt><dd>{scopeCompany.teams}</dd></div>
            </dl>
          )}
          {!scopeCompany && analysis && (
            <Section title={t('Hottest subsidiaries (share of roles ≥ {threshold})', { threshold: HOT })}>
              <div className="lens-list">
                {Object.entries(analysis.companyHeat)
                  .sort((a, b) => b[1].share - a[1].share || b[1].max - a[1].max)
                  .slice(0, 8)
                  .map(([id, h]) => (
                    <button key={id} type="button" className="lens-row" onClick={() => h.top && onSelect(h.top)}>
                      <span><strong>{labelOf(id)}</strong><small>{t('{share}% · {hot} of {roles} roles ≥ {threshold} · max {max} · top {top}', { share: Math.round(h.share * 100), hot: h.hot, roles: h.roles, threshold: HOT, max: h.max, top: h.top ? labelOf(h.top) : '—' })}</small></span>
                    </button>
                  ))}
              </div>
            </Section>
          )}
          {level.team && chunk && <TeamList team={level.team} chunk={chunk} lens={lens} weights={props.weights} selectedId={selectedId} onPick={pick} />}
          <HeatLegend sat={props.sat} />
        </>
      )}

      {lens === 'network' && manifest && analysis && (
        <NetworkPanel analysis={analysis} scopeCompany={scopeCompany} level={level} index={index} labelOf={labelOf} roleLabel={roleLabel} selectedId={selectedId} onSelect={onSelect} />
      )}

      {lens === 'access' && scopedReport && (
        <RankedResources report={scopedReport} labelOf={labelOf} subOf={roleWhere} selectedId={selectedId} onSelect={onSelect} limit={40} />
      )}

      {lens === 'impersonation' && scopedReport && (
        <>
          <p className="lens-metric">
            <b className="lens-num-hot">{fmt(scopedReport.totals.unverifiedPaths)}</b> {t('unverified of {paths} paths (≤{hops} hops){capped} · {reachable} of {roles} roles reachable from outside', { paths: fmt(scopedReport.totals.paths), hops: scopedReport.totals.maxHops, capped: scopedReport.totals.capped ? t(' (capped)') : '', reachable: fmt(scopedReport.totals.reachableRoles), roles: fmt(scopedReport.totals.roles) })}
          </p>
          <Section title={t('Mixed org + network paths (role → device → zone → system)')}>
            <div className="lens-list" data-mixed-roles>
              {scopedReport.roles
                .filter((r) => r.viaNetwork && r.score > 0)
                .slice(0, 8)
                .map((r) => (
                  <button key={r.role} type="button" className={`lens-row ${r.role === selectedId ? 'active' : ''}`} onClick={() => onSelect(r.role)}>
                    <span><strong>{roleLabel(r.role)}</strong><small>{t('score {score} · seize {seize} + network {network} → {resource} (no grant)', { score: r.score, seize: r.minCost ?? '—', network: r.topCost ?? '—', resource: r.topResource ? labelOf(r.topResource) : '—' })}</small></span>
                  </button>
                ))}
            </div>
          </Section>
          <RankedRoles report={scopedReport} labelOf={labelOf} subOf={roleWhere} selectedId={selectedId} onSelect={onSelect} limit={40} />
          <WeightsNote />
        </>
      )}

      {DEVICE_LENS(lens) && (
        <DeviceLensPanel lens={lens} analysis={analysis} level={level} chunk={chunk} labelOf={labelOf} sat={props.sat} weights={props.weights} selectedId={selectedId} onPick={pick} onOpen={props.onDrill} />
      )}

      {lens === 'shadow' && (
        <Section title={t('Unsanctioned SaaS in scope ({count})', { count: scopedShadow.length })}>
          <div className="lens-list">
            {scopedShadow.slice(0, 40).map((a) => (
              <button key={a.id} type="button" className={`lens-row ${a.id === selectedId ? 'active' : ''}`} onClick={() => onSelect(a.id)}>
                <span><strong>{a.label}</strong><small>{t('{source} · {criticality} · {departments} depts · {subsidiaries} subsidiaries', { source: a.source, criticality: t(a.criticality), departments: a.departments.length, subsidiaries: a.companies.length })}</small></span>
              </button>
            ))}
          </div>
        </Section>
      )}

      <Section title={t('Measured in this browser')}>
        <ul className="scale-perf" data-scale-perf>
          {perf.map((p) => (
            <li key={p.name}><span>{p.name}</span><b>{p.ms.toFixed(1)} ms</b>{p.note && <small>{p.note}</small>}</li>
          ))}
          <li><span>{t('DOM tiles at this level')}</span><b>{props.tileCount}</b></li>
          {props.analysisVia && <li><span>{t('analysis ran in')}</span><b>{props.analysisVia}</b></li>}
        </ul>
      </Section>
      <p className="lens-foot">{t('Measures exposure in the synthetic model only. No runners, no scanning, no credential collection.')}</p>
    </div>
  )
}

const NET_EDGE_TYPES = new Set<number>([EDGE.pivot, EDGE.device, EDGE.reach, EDGE.host, EDGE.entry, EDGE.sync])

/** Mixed org + network hop chain from the engine (actor → role → device → zone → … → system). */
function MixedPath({ path, index, labelOf }: { path: PathResult | null; index: IndexLike; labelOf: (id: string) => string }) {
  const t = useScaleCopy()
  if (!path) return <p className="lens-blurb" data-path-pending>{t('Computing mixed path…')}</p>
  if (!path.hops.length) return <p className="lens-blurb">{t('No path from an external actor in the model.')}</p>
  const net = path.hops.filter((h) => NET_EDGE_TYPES.has(h.edge)).length
  return (
    <div className="scale-path" data-mixed-path={path.target ?? path.role ?? ''}>
      <p className="lens-metric">
        {t('cost')} <b>{path.cost ?? '—'}</b> · {t('{hops} hops ({org} org, {network} network)', { hops: path.hops.length, org: path.hops.length - net, network: net })}{path.target ? ` → ${labelOf(path.target)}` : ''}
      </p>
      <ol className="scale-hops" aria-label={t('Mixed org and network path')}>
        {path.hops.map((h: MixedHop, i) => {
          const ch = h.edge === EDGE.channel ? index.channels.get(h.ref) : undefined
          const dim = NET_EDGE_TYPES.has(h.edge) ? 'net' : 'org'
          return (
            <li key={`${h.ref}:${i}`} className={`${h.red ? 'is-unverified' : ''} hop-${dim}`} data-hop-edge={dim}>
              <span>
                <em className={`scale-hop-dim dim-${dim}`}>{dim}</em>
                {labelOf(h.from)} → {labelOf(h.to)}
              </span>
              <small>
                {ch ? `${t(ch.kind)} · ${h.red ? t('no verification') : ch.verification.map((v) => t(v)).join(' + ')}` : t(h.kind)}
                {h.edge === EDGE.reach ? ` · ${h.red ? t('open') : t('conditional')}` : ''} · {t('cost')} {Number.isInteger(h.cost) ? h.cost : h.cost.toFixed(2)}
              </small>
              {h.blind && <em className={`scale-hop-blind blind-${h.blind}`} data-hop-blind={h.blind}>{t(h.blind === 'blind' ? 'detection blind spot' : 'short log retention')}</em>}
              {h.notes?.map((n) => <small key={n} className="scale-hop-note">{n}</small>)}
            </li>
          )
        })}
      </ol>
      {path.blast && (
        <dl className="lens-kv" aria-label={t('Weighted blast radius')}>
          <div><dt>{t('blast radius')}</dt><dd>{t('{resources} resources within cost ≤ {cost} · {jewels} crown jewel · {network} network-only', { resources: path.blast.count, cost: path.blast.maxCost, jewels: path.blast.crownJewels, network: path.blast.network })}</dd></div>
          {path.blast.top.slice(0, 5).map((r) => (
            <div key={r.resource}><dt>{t(r.level)}</dt><dd>{labelOf(r.resource)} · {t('cost')} {r.cost}</dd></div>
          ))}
        </dl>
      )}
    </div>
  )
}

/** Zone→zone reach edges on the floor. Red: open into a crown-jewel zone; dashed: conditional. */
function ReachLinks({ links, width, height }: { links: LinkSpec[]; width: number; height: number }) {
  const t = useScaleCopy()
  const center = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })
  const clip = (r: Rect, from: { x: number; y: number }, to: { x: number; y: number }) => {
    const dx = to.x - from.x
    const dy = to.y - from.y
    const t = Math.min(Math.abs(dx) > 1e-6 ? r.w / 2 / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-6 ? r.h / 2 / Math.abs(dy) : Infinity, 1)
    return { x: from.x + dx * t, y: from.y + dy * t }
  }
  return (
    <svg className="scale-reach" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-label={t('Zone reach')} data-reach-links={links.length}>
      <defs>
        {['red', 'open', 'conditional', 'blocked'].map((k) => (
          <marker key={k} id={`reach-arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className={`reach-head reach-${k}`} />
          </marker>
        ))}
      </defs>
      {links.map((l) => {
        const a = center(l.from)
        const b = center(l.to)
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
        // Offset so a→b and b→a do not overlap.
        const off = 7
        const nx = (-(b.y - a.y) / len) * off
        const ny = ((b.x - a.x) / len) * off
        const p = clip(l.from, { x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny })
        const q = clip(l.to, { x: b.x + nx, y: b.y + ny }, { x: a.x + nx, y: a.y + ny })
        const k = l.red ? 'red' : l.kind
        return (
          <g key={l.id} className={`reach-link reach-${k}`} data-reach={l.kind} data-reach-red={l.red ? 'true' : undefined}>
            <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} markerEnd={`url(#reach-arrow-${k})`} />
            {l.kind !== 'blocked' && (
              <text x={(p.x + q.x) / 2 + nx} y={(p.y + q.y) / 2 + ny}>{l.kind === 'open' ? t('open {weight}', { weight: l.weight }) : `${l.weight}`}</text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

function NetworkPanel(props: {
  analysis: ScaleAnalysis
  scopeCompany: PackCompany | null
  level: Level
  index: IndexLike
  labelOf: (id: string) => string
  roleLabel: (id: string) => string
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  const t = useScaleCopy()
  const { analysis, scopeCompany, index, labelOf, roleLabel, selectedId, onSelect } = props
  const key = scopeCompany?.id.replace('b:', '')
  const inScopeZone = (z: string | null) => !key || (!!z && z.startsWith(`net:${key}.`))
  const zones = analysis.report.zones.filter((z) => inScopeZone(z.zone))
  const open = zones.filter((z) => z.openToCrownJewel)
  const reach = (index.reachFrom ? [...index.reachFrom.values()].flat() : []).filter((r) => inScopeZone(r.from) || inScopeZone(r.to))
  const counts = { open: 0, conditional: 0, blocked: 0 }
  for (const r of reach) counts[r.kind] += 1
  const netExp = analysis.report.networkExposures.filter((x) => inScopeZone(x.hostZone))
  const shadow = analysis.report.shadowEntries.filter((x) => x.crownJewelCost != null)
  return (
    <>
      <dl className="lens-stats" aria-label={t('Zone reach')}>
        <div><dt>{t('Zones')}</dt><dd>{fmt(zones.length)}</dd></div>
        <div><dt>{t('Reach open')}</dt><dd className="lens-num-hot">{fmt(counts.open)}</dd></div>
        <div><dt>{t('Conditional')}</dt><dd>{fmt(counts.conditional)}</dd></div>
        <div><dt>{t('Blocked')}</dt><dd>{fmt(counts.blocked)}</dd></div>
      </dl>
      <Section title={t('Open paths into crown-jewel zones ({count})', { count: open.length })}>
        <div className="lens-list" data-open-cj>
          {open.slice(0, 10).map((z) => (
            <button key={z.zone} type="button" className={`lens-row ${z.zone === selectedId ? 'active' : ''}`} onClick={() => onSelect(z.zone)}>
              <span><strong className="lens-num-hot">{labelOf(z.zone)}</strong><small>{t('open reach only → {target} · weighted cost {cost}', { target: z.crownJewel ? labelOf(z.crownJewel) : t('crown-jewel zone'), cost: z.crownJewelCost ?? '—' })}</small></span>
            </button>
          ))}
          {!open.length && <p className="lens-blurb">{t('No open-only path into a crown-jewel zone in scope.')}</p>}
        </div>
      </Section>
      <Section title={t('Network-reachable without a grant ({count})', { count: fmt(netExp.length) })}>
        <div className="lens-list" data-net-no-grant>
          {netExp.slice(0, 8).map((x) => (
            <button key={x.resource} type="button" className={`lens-row ${x.resource === selectedId ? 'active' : ''}`} onClick={() => onSelect(x.resource)}>
              <span><strong>{labelOf(x.resource)}</strong><small>{t('{criticality} · cost {cost} · via {route} · hosted in {zone}', { criticality: t(x.criticality), cost: x.cost, route: x.viaRole ? roleLabel(x.viaRole) : t('shadow SaaS entry'), zone: x.hostZone ? labelOf(x.hostZone) : '—' })}</small></span>
            </button>
          ))}
        </div>
      </Section>
      <Section title={t('Shadow-IT SaaS entry paths to crown jewels ({count})', { count: shadow.length })}>
        <div className="lens-list" data-shadow-entry>
          {shadow.slice(0, 6).map((x) => (
            <button key={x.system} type="button" className={`lens-row ${x.system === selectedId ? 'active' : ''}`} onClick={() => onSelect(x.system)}>
              <span><strong>{labelOf(x.system)}</strong><small>{t('internet → SaaS → sync into {zones} zones → {target} · cost {cost}', { zones: x.syncZones, target: x.crownJewel ? labelOf(x.crownJewel) : '—', cost: x.crownJewelCost ?? '—' })}</small></span>
            </button>
          ))}
        </div>
      </Section>
      <div className="scale-legend" aria-label={t('Zone legend')}>
        <span style={{ background: zoneFill({ openToCrownJewel: true } as ZoneScore) }}>{t('open → CJ')}</span>
        <span style={{ background: zoneFill({ hostsCrownJewel: true } as ZoneScore) }}>{t('hosts CJ')}</span>
        <span style={{ background: zoneFill(undefined) }}>{t('other')}</span>
        <small>{t('arrows: red open into CJ zone · solid open · dashed conditional · dotted blocked')}</small>
      </div>
    </>
  )
}

function WeightsNote() {
  const t = useScaleCopy()
  return (
    <p className="lens-blurb scale-weights">
      {t('Hop cost = 1 + {controls}; network reach open {open}, conditional {conditional}, blocked impassable; jump host {jump}, device pivot / host 1; device pivot × (1 − ease), ease = min({maxEase}, EOL {eol} + unsanctioned {unsanctioned} + worst vuln {vulnerability}); log retention minimum {days} days (tunable defaults, per-document overrides in model.weights; not real-world success rates). Score = 100 × criticality × level ÷ 8 ÷ (cost to seize the role + network cost to the system).', {
        controls: Object.entries(CONTROL_WEIGHTS).filter(([k]) => k !== 'none').map(([k, v]) => `${t(k)} ${v}`).join(', '),
        open: DEFAULT_REACH_WEIGHTS.open,
        conditional: DEFAULT_REACH_WEIGHTS.conditional,
        jump: DEFAULT_JUMP_HOST_COST,
        maxEase: DEFAULT_DEVICE_WEIGHTS.maxEase,
        eol: DEFAULT_DEVICE_WEIGHTS.eol,
        unsanctioned: DEFAULT_DEVICE_WEIGHTS.unsanctioned,
        vulnerability: Object.entries(DEFAULT_DEVICE_WEIGHTS.vulnerability).map(([k, v]) => `${t(k)} ${v}`).join(' / '),
        days: DEFAULT_MIN_RETENTION_DAYS,
      })}
    </p>
  )
}

function HeatLegend({ sat, note }: { sat: number; note?: string }) {
  const t = useScaleCopy()
  return (
    <div className="scale-legend" aria-label={t('Heat legend')}>
      {[0, 0.2, 0.4, 0.6, 0.8, 1].map((k) => (
        <span key={k} style={{ background: shareColor(k * sat, sat) }}>{Math.round(k * sat * 100)}%{k === 1 ? '+' : ''}</span>
      ))}
      <small>{note ?? t('tile = share of roles with score ≥ {threshold}', { threshold: HOT })}</small>
    </div>
  )
}

/** Virtualized people / device list for one team. Only visible rows are in the DOM. */
function TeamList({
  team,
  chunk,
  lens,
  weights,
  selectedId,
  onPick,
}: {
  team: string
  chunk: ExpandedChunk
  lens: ScaleLens
  weights: ResolvedWeights
  selectedId: string | null
  onPick: (id: string) => void
}) {
  const t = useScaleCopy()
  const rows = useMemo(() => {
    const people = (chunk.teamPeople.get(team) ?? []).map((i) => chunk.people[i]!)
    const devices = (chunk.teamDevices.get(team) ?? []).map((i) => chunk.devices[i]!)
    // Device lenses list the riskiest devices first.
    if (lens === 'software') devices.sort((a, b) => deviceRisk(b.software, weights.device).ease - deviceRisk(a.software, weights.device).ease)
    if (lens === 'logs') {
      const rank = { blind: 0, short: 1, unknown: 2, forwarded: 3 } as const
      devices.sort((a, b) => rank[logCoverage(a.logs, weights.minRetentionDays)] - rank[logCoverage(b.logs, weights.minRetentionDays)])
    }
    return DEVICE_LENS(lens) ? [...devices, ...people] : [...people, ...devices]
  }, [team, chunk, lens, weights])
  const byPerson = useMemo(() => devicesByPerson(chunk), [chunk])
  const [top, setTop] = useState(0)
  const ROW = 34
  const H = 300
  const first = Math.max(0, Math.floor(top / ROW) - 4)
  const last = Math.min(rows.length, first + Math.ceil(H / ROW) + 8)
  return (
    <Section title={t('Team members & devices ({count})', { count: rows.length })}>
      <div className="scale-vlist" style={{ height: H }} onScroll={(e) => setTop(e.currentTarget.scrollTop)} data-vlist-rows={rows.length}>
        <div style={{ height: rows.length * ROW, position: 'relative' }}>
          {rows.slice(first, last).map((e, i) => {
            const isDevice = e.layer === 'node'
            const mine = isDevice ? [] : byPerson.get(e.id) ?? []
            const risk = isDevice ? deviceRisk(e.software, weights.device) : null
            const cov = isDevice ? logCoverage(e.logs, weights.minRetentionDays) : null
            return (
              <div
                key={e.id}
                className={`scale-vrow is-clickable ${e.id === selectedId ? 'active' : ''}`}
                style={{ top: (first + i) * ROW, height: ROW }}
                data-team-row={e.id}
              >
                <button type="button" className="scale-vrow-main" onClick={() => onPick(e.id)}>
                  <strong>{e.label}</strong>
                  <small>
                    {e.type}
                    {e.attrs.title ? ` · ${e.attrs.title}` : ''}
                    {risk && <> · {t('ease')} <b style={{ color: easeColor(risk.ease) }}>{risk.ease.toFixed(2)}</b></>}
                    {cov && <> · {t('logs')} <b style={{ color: coverageColor(cov) }}>{t(cov)}</b></>}
                  </small>
                </button>
                {mine.length > 0 && (
                  <span className="scale-vrow-links" aria-label={t('Devices of {name}', { name: e.label })}>
                    {mine.slice(0, 3).map(({ device, relation }) => (
                      <button key={device.id} type="button" className="scale-dev-chip" title={`${device.label} (${relation})`} onClick={() => onPick(device.id)} data-person-device-link={device.id}>
                        {device.type}
                        {relation === 'admin' ? ' ⚙' : ''}
                      </button>
                    ))}
                    {mine.length > 3 && <small>+{mine.length - 3}</small>}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </Section>
  )
}

/** Software-risk / log-gap lens panel: ranked subsidiaries or departments, then the team's devices. */
function DeviceLensPanel(props: {
  lens: ScaleLens
  analysis: ScaleAnalysis | null
  level: Level
  chunk: ExpandedChunk | null
  labelOf: (id: string) => string
  sat: number
  weights: ResolvedWeights
  selectedId: string | null
  onPick: (id: string) => void
  onOpen: (id: string | null) => void
}) {
  const t = useScaleCopy()
  const { lens, analysis, level, chunk, labelOf } = props
  const agg = analysis?.devices
  const col = lens === 'software' ? 1 : 2
  const scope = !agg
    ? []
    : level.company && !level.dept
      ? Object.entries(agg.dept).filter(([id]) => id.startsWith(`${level.company}.`))
      : !level.company
        ? Object.entries(agg.company)
        : []
  const ranked = scope
    .filter(([, c]) => c[0] > 0)
    .sort((a, b) => b[1][col]! / b[1][0] - a[1][col]! / a[1][0])
    .slice(0, 10)
  const total = agg ? Object.values(agg.company).reduce((a, c) => [a[0] + c[0], a[1] + c[1], a[2] + c[2], a[3] + c[3]], [0, 0, 0, 0]) : null
  const here = level.dept ? agg?.dept[level.dept] : level.company ? agg?.company[level.company] : total
  return (
    <>
      {here && (
        <dl className="lens-stats" data-device-lens={lens}>
          <div><dt>{t('Devices')}</dt><dd>{fmt(here[0])}</dd></div>
          {lens === 'software' ? (
            <div><dt>{t('High-ease')}</dt><dd>{fmt(here[1])} ({Math.round((here[1] / Math.max(1, here[0])) * 100)}%)</dd></div>
          ) : (
            <>
              <div><dt>{t('Log gaps')}</dt><dd>{fmt(here[2])} ({Math.round((here[2] / Math.max(1, here[0])) * 100)}%)</dd></div>
              <div><dt>{t('Unknown')}</dt><dd>{fmt(here[3])}</dd></div>
            </>
          )}
        </dl>
      )}
      {ranked.length > 0 && (
        <Section title={t(lens === 'software' ? 'Highest share of high-ease devices' : 'Highest share of log-coverage gaps')}>
          <div className="lens-list">
            {ranked.map(([id, c]) => (
              <button key={id} type="button" className="lens-row" onClick={() => props.onOpen(id)}>
                <span>
                  <strong>{labelOf(id)}</strong>
                  <small>{t('{share}% · {count} of {total} devices', { share: Math.round((c[col]! / c[0]) * 100), count: fmt(c[col]!), total: fmt(c[0]) })}</small>
                </span>
              </button>
            ))}
          </div>
        </Section>
      )}
      {level.team && chunk && <TeamList team={level.team} chunk={chunk} lens={lens} weights={props.weights} selectedId={props.selectedId} onPick={props.onPick} />}
      {level.dept && !level.team && <p className="lens-blurb">{t('Pick a team to list its devices; click a device for software, logs, and people.')}</p>}
      <HeatLegend sat={DEVICE_HEAT_SATURATION} note={t(lens === 'software' ? 'tile = share of devices with ease ≥ 0.25' : 'tile = share of devices with a log gap')} />
    </>
  )
}
