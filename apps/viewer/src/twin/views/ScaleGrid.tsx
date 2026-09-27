import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as REPointerEvent,
  type ReactNode,
  type WheelEvent as REWheelEvent,
} from 'react'
import GitHubLink from '../components/GitHubLink'
import ThemeSwitcher from '../components/ThemeSwitcher'
import { CONTROL_WEIGHTS, hopCost, isUnverified, type RoleScore } from '../mith/exposure'
import { fitBoardsInSafeArea } from '../mith/geometry'
import { SAMPLE_DOCS } from '../mith/load'
import type { MithBoundary, MithChannel, MithDocument, MithEntity, MithRole } from '../mith/types'
import {
  analyzeScale,
  fetchJson,
  HOT,
  packUrl,
  parseIndex,
  parseManifest,
  runScaleAnalysis,
  type Heat,
  type ScaleAnalysis,
} from '../scale/model'
import { expandChunk, type ExpandedChunk, type PackChunk, type PackCompany, type PackManifest } from '../scale/pack'
import { inset, treemap, type Rect } from '../scale/treemap'
import { useBoardAnchors } from './node3d'
import { EasiestPath, RankedResources, RankedRoles } from './LensPanel'
import './make-grid.css'
import './lens.css'
import './scale.css'

type ScaleLens = 'org' | 'network' | 'access' | 'impersonation' | 'shadow'
const SCALE_LENSES: { id: ScaleLens; label: string }[] = [
  { id: 'org', label: 'Org' },
  { id: 'network', label: 'Network' },
  { id: 'access', label: 'Access' },
  { id: 'impersonation', label: 'Impersonation' },
  { id: 'shadow', label: 'Shadow IT' },
]
type Level = { company: string | null; dept: string | null; team: string | null }
type PerfRow = { name: string; ms: number; note?: string }

type Props = {
  manifestUrl: string
  sampleId: string
  onPickSample: (id: string) => void
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
  id === 'net:mobile' ? 'Managed mobile' : id.endsWith('.pay') ? 'Payments VLAN' : id.endsWith('.dmz') ? 'DMZ' : id.endsWith('.mgmt') ? 'Mgmt VLAN' : id.endsWith('.corp') ? 'Corp VLAN' : 'Group'

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
type FrameSpec = { id: string; label: string; rect: Rect; kind: string; dashed?: boolean; tag?: boolean; root?: boolean }

/**
 * Enterprise-scale grid. Level of detail:
 *   group → sector clusters of subsidiary tiles (counts + exposure heat)
 *   subsidiary → department tiles
 *   department → team tiles with people / devices drawn on canvas, roles as tiles
 *   team → virtualized people / device list in the right rail
 * Never more than a few hundred DOM tiles at once. Analysis runs in a Web Worker.
 */
export default function ScaleGrid({ manifestUrl, sampleId, onPickSample }: Props) {
  const stageRef = useRef<HTMLDivElement>(null)
  const [manifest, setManifest] = useState<PackManifest | null>(null)
  const [doc, setDoc] = useState<MithDocument | null>(null)
  const [analysis, setAnalysis] = useState<ScaleAnalysis | null>(null)
  const [analysisVia, setAnalysisVia] = useState<string>('')
  const [error, setError] = useState('')
  const [lens, setLens] = useState<ScaleLens>('org')
  const [level, setLevel] = useState<Level>({ company: null, dept: null, team: null })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [chunks, setChunks] = useState<Map<string, ExpandedChunk>>(new Map())
  const [busy, setBusy] = useState('')
  const [query, setQuery] = useState('')
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [perf, setPerf] = useState<PerfRow[]>([])
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const userMoved = useRef(false)
  const fitPasses = useRef(0)
  // Timing mark for the next committed view change; recorded two frames later (after paint).
  const [mark, setMark] = useState<{ name: string; t0: number; note?: string } | null>(null)
  const docRef = useRef<MithDocument | null>(null)

  const record = useCallback((row: PerfRow) => {
    const rounded = { ...row, ms: Math.round(row.ms * 10) / 10 }
    window.__twinScalePerf = [...(window.__twinScalePerf ?? []), rounded]
    setPerf((p) => [...p.filter((x) => x.name !== row.name), rounded])
  }, [])

  // Load manifest + index on the main thread (for rendering); analysis in a worker in parallel.
  useEffect(() => {
    let cancelled = false
    const t0 = now()
    window.__twinScalePerf = []
    async function run() {
      try {
        const m = parseManifest(await fetchJson(manifestUrl))
        const indexUrl = packUrl(manifestUrl, m.index)
        const tA = now()
        const startAnalysis = () =>
          runScaleAnalysis(indexUrl, () => docRef.current).then((res) => {
            if (cancelled) return
            if (!res.ok) {
              // Fall back to the main thread if the worker could not run.
              const d = docRef.current
              if (d) {
                const t = now()
                setAnalysis(analyzeScale(d))
                setAnalysisVia('main thread (worker failed)')
                record({ name: 'analysis', ms: now() - t, note: 'main thread fallback' })
              }
              return
            }
            setAnalysis(res.analysis)
            setAnalysisVia(res.via)
            record({ name: 'analysis (round trip)', ms: now() - tA, note: res.via })
            record({ name: 'analysis · exposure compute', ms: res.analysis.timings.analysisMs, note: res.via })
            record({ name: 'analysis · index parse in worker', ms: res.analysis.timings.parseMs, note: res.via })
          })
        // With a Worker, analysis starts now and overlaps the main-thread index parse.
        const hasWorker = typeof Worker !== 'undefined'
        if (hasWorker) void startAnalysis()
        const tIdx = now()
        const raw = await fetchJson(indexUrl)
        const tParse = now()
        const d = parseIndex(raw)
        const tDone = now()
        if (cancelled) return
        docRef.current = d
        record({ name: 'load · manifest', ms: tA - t0 })
        record({ name: 'load · index fetch', ms: tParse - tIdx })
        record({ name: 'load · index parse (main)', ms: tDone - tParse })
        record({ name: 'load · total', ms: tDone - t0 })
        setMark({ name: 'initial render', t0: tDone })
        setManifest(m)
        setDoc(d)
        if (!hasWorker) void startAnalysis()
      } catch (err) {
        if (!cancelled) setError(`Could not load pack: ${err instanceof Error ? err.message : 'unknown'}`)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [manifestUrl, record])

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
    if (doc) {
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
    return { boundaries, children, roles, rolesByDept, entities, channels, companyOf }
  }, [doc])

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
      const meta = companies.get(company)
      if (!meta) throw new Error(`unknown company ${company}`)
      const t = now()
      const raw = (await fetchJson(packUrl(manifestUrl, meta.chunk))) as PackChunk
      const chunk = expandChunk(raw)
      setChunks((prev) => new Map(prev).set(company, chunk))
      return { chunk, ms: now() - t, cached: false }
    },
    [chunks, companies, manifestUrl],
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
      setSelectedId(select)
    },
    [loadChunk],
  )

  const openRole = useCallback(
    (id: string | null) => {
      if (!id) return setSelectedId(null)
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
      setSelectedId(id)
    },
    [index, goTo],
  )

  const pickLens = (next: ScaleLens) => {
    setMark({ name: `lens · ${next}`, t0: now() })
    setLens(next)
  }

  // ---- Floor layout (pure, memoized per level / lens) -----------------------------------
  const floor = useMemo(() => {
    const frames: FrameSpec[] = []
    const tiles: TileSpec[] = []
    let width = WORLD_W
    const height = WORLD_H
    if (!manifest || !doc) return { frames, tiles, width, height }
    const heatOf = (h: Record<string, Heat> | undefined, id: string) => h?.[id]?.max ?? 0
    const maxShadow = Math.max(1, ...Object.values(analysis?.companyShadow ?? {}))
    const companyFill = (c: PackCompany) =>
      lens === 'shadow'
        ? shadowColor(analysis?.companyShadow[c.id] ?? 0, maxShadow)
        : lens === 'access'
          ? heatColor(heatOf(analysis?.companyAccessHeat, c.id))
          : heatColor(heatOf(analysis?.companyHeat, c.id))
    const shadowFrame = (apps: NonNullable<typeof analysis>['shadowApps'], filterDepts?: Set<string>) => {
      width = WORLD_W + 40 + SHADOW_W
      const rect = { x: WORLD_W + 40, y: 0, w: SHADOW_W, h: height }
      frames.push({ id: 'shadow', label: 'Unsanctioned SaaS (outside the org boundary)', rect, kind: 'shadow', dashed: true, tag: true, root: true })
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
          meta: `${t.item.n} dept${t.item.n === 1 ? '' : 's'} · ${t.item.a.source}`,
          kind: 'shadow',
          onClick: () => setSelectedId(t.item.a.id),
        })
      }
    }

    if (!level.company) {
      const root = { x: 0, y: 0, w: WORLD_W, h: height }
      frames.push({ id: 'b:polaris', label: `北極星 Group · ${fmt(manifest.counts.subsidiaries)} subsidiaries (synthetic)`, rect: root, kind: 'company', root: true })
      if (lens === 'network') {
        const byKind = new Map<string, { id: string; company: PackCompany; devices: number }[]>()
        for (const c of manifest.companies) {
          for (const [z, n] of Object.entries(c.zones)) {
            const k = zoneKind(z)
            byKind.set(k, [...(byKind.get(k) ?? []), { id: `${z}@${c.id}`, company: c, devices: n }])
          }
        }
        const clusters = [...byKind].map(([k, list]) => ({ k, list, total: list.reduce((a, x) => a + x.devices, 0) }))
        for (const cl of treemap(clusters, (x) => x.total, inset(root, 12, 36))) {
          const r = inset(cl, 5)
          frames.push({ id: `zk:${cl.item.k}`, label: `${cl.item.k} · ${fmt(cl.item.total)} devices`, rect: r, kind: 'zone', tag: true })
          const sorted = [...cl.item.list].sort((a, b) => b.devices - a.devices)
          const shown = sorted.slice(0, 80)
          const rest = sorted.slice(80)
          const items = [...shown, ...(rest.length ? [{ id: `more:${cl.item.k}`, company: null as PackCompany | null, devices: rest.reduce((a, x) => a + x.devices, 0), more: rest.length }] : [])]
          for (const t of treemap(items, (x) => x.devices, inset(r, 6, 26))) {
            const it = t.item as { id: string; company: PackCompany | null; devices: number; more?: number }
            tiles.push({
              id: it.id,
              label: it.company ? it.company.label.replace('北極星 ', '') : `+${it.more} more zones`,
              rect: inset(t, 1.2),
              fill: it.company ? 'rgba(214, 243, 228, 0.95)' : 'rgba(230, 236, 232, 0.9)',
              meta: `${fmt(it.devices)} devices`,
              kind: it.company ? 'zone' : 'more',
              onClick: it.company ? () => void goTo({ company: it.company!.id, dept: null, team: null }) : undefined,
            })
          }
        }
        return { frames, tiles, width, height }
      }
      const bySector = new Map<string, PackCompany[]>()
      for (const c of manifest.companies) bySector.set(c.sector, [...(bySector.get(c.sector) ?? []), c])
      const clusters = [...bySector].map(([sector, list]) => ({ sector, list, people: list.reduce((a, c) => a + c.people, 0) }))
      const placed: TileSpec[] = []
      for (const cl of treemap(clusters, (x) => x.people, inset(root, 12, 36))) {
        const r = inset(cl, 5)
        frames.push({ id: `sector:${cl.item.sector}`, label: `${cl.item.sector} · ${cl.item.list.length} cos · ${fmt(cl.item.people)} people`, rect: r, kind: 'subsidiary', tag: true })
        for (const t of treemap(cl.item.list, (c) => c.people, inset(r, 6, 26))) {
          const c = t.item
          const hot = (lens === 'access' ? analysis?.companyAccessHeat[c.id]?.hot : analysis?.companyHeat[c.id]?.hot) ?? 0
          placed.push({
            id: c.id,
            label: c.label.replace('北極星 ', ''),
            rect: inset(t, 1.2),
            fill: companyFill(c),
            meta:
              lens === 'shadow'
                ? `${analysis?.companyShadow[c.id] ?? 0} shadow apps · ${fmt(c.people)} ppl`
                : `${fmt(c.people)} ppl · ${fmt(c.devices)} dev${hot ? ` · ${hot} hot` : ''}`,
            kind: 'company',
            hot: hot > 0,
            onClick: () => void goTo({ company: c.id, dept: null, team: null }),
          })
        }
      }
      // Screen-space name tags only for the largest tiles; the rest show on hover / zoom.
      const big = new Set([...placed].sort((a, b) => b.rect.w * b.rect.h - a.rect.w * a.rect.h).slice(0, TAG_CAP).map((t) => t.id))
      for (const t of placed) tiles.push({ ...t, tag: big.has(t.id) })
      if (lens === 'shadow' && analysis) shadowFrame(analysis.shadowApps)
      return { frames, tiles, width, height }
    }

    const company = companies.get(level.company)
    const chunk = chunks.get(level.company)
    if (!company) return { frames, tiles, width, height }
    const depts = index.children.get(company.id) ?? []

    if (!level.dept) {
      const root = { x: 0, y: 0, w: WORLD_W, h: height }
      frames.push({ id: company.id, label: `${company.label} · ${company.departments} departments`, rect: root, kind: 'subsidiary', root: true })
      if (lens === 'network') {
        const zs = Object.entries(company.zones).map(([z, n]) => ({ z, n }))
        for (const t of treemap(zs, (x) => x.n, inset(root, 12, 36))) {
          tiles.push({ id: t.item.z, label: labelOf(t.item.z).replace(`${company.label} · `, ''), rect: inset(t, 4), fill: 'rgba(214, 243, 228, 0.95)', meta: `${fmt(t.item.n)} devices`, kind: 'zone', tag: true })
        }
        return { frames, tiles, width, height }
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
          fill: lens === 'shadow' ? shadowColor(analysis?.deptShadow[d.id]?.length ?? 0, maxDeptShadow) : heatColor(heat?.max ?? 0),
          meta: lens === 'shadow' ? `${analysis?.deptShadow[d.id]?.length ?? 0} shadow apps` : `${fmt(p)} ppl · ${fmt(dv)} dev · ${tm} teams`,
          kind: 'department',
          hot: (heat?.hot ?? 0) > 0,
          tag: true,
          onClick: () => void goTo({ company: company.id, dept: d.id, team: null }),
        })
      }
      if (lens === 'shadow' && analysis) shadowFrame(analysis.shadowApps, new Set(depts.map((d) => d.id)))
      return { frames, tiles, width, height }
    }

    // Department (and team) level.
    const dept = index.boundaries.get(level.dept)
    const root = { x: 0, y: 0, w: WORLD_W, h: height }
    frames.push({ id: level.dept, label: `${company.label} › ${dept?.label ?? ''}`, rect: root, kind: 'department', root: true })
    const roles = index.rolesByDept.get(level.dept) ?? []
    const roleRow = { x: 12, y: 44, w: WORLD_W - 24, h: 120 }
    frames.push({ id: `${level.dept}#roles`, label: 'Roles in this department', rect: roleRow, kind: 'team' })
    const rw = Math.min(360, (roleRow.w - 20) / Math.max(1, roles.length))
    roles.forEach((r, i) => {
      const s = roleScore.get(r.id)
      tiles.push({
        id: r.id,
        label: r.label,
        rect: { x: roleRow.x + 10 + i * rw, y: roleRow.y + 32, w: rw - 10, h: roleRow.h - 42 },
        fill: heatColor(s?.score ?? 0),
        meta: s ? `score ${s.score} · cost ${s.minCost ?? '—'} · ${chunk?.holders.get(r.id)?.length ?? 0} holders` : 'score —',
        kind: 'role',
        hot: (s?.score ?? 0) >= HOT,
        tag: true,
        onClick: () => setSelectedId(r.id),
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
        meta: `${chunk?.teamPeople.get(tm.id)?.length ?? 0} ppl · ${chunk?.teamDevices.get(tm.id)?.length ?? 0} dev`,
        kind: 'team',
        tag: true,
        canvas: { team: tm.id },
        onClick: () => void goTo({ company: company.id, dept: level.dept, team: tm.id }),
      })
    }
    return { frames, tiles, width, height }
  }, [manifest, doc, analysis, lens, level, companies, chunks, index, roleScore, labelOf, goTo])

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

  return (
    <div
      className="make-app is-iso is-coplanar is-lens is-scale"
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
          <span className="make-chip warn">generated</span>
          <span className="make-chip">no-runners</span>
          <span className="make-chip warn">viz only</span>
          <ThemeSwitcher />
          <GitHubLink className="make-github-link" />
        </div>
      </header>

      <div className="make-stage" ref={stageRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => { drag.current = null }} onWheel={onWheel}>
        {!ready && !error && <div className="make-loading">Loading synthetic enterprise pack…</div>}
        {busy && <div className="make-loading scale-busy">{busy}</div>}
        {error && <div className="make-error" role="alert">{error}</div>}

        <nav className="scale-crumbs" aria-label="Drill path">
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
            {floor.tiles.map((t) => (
              <ScaleTile
                key={t.id}
                tile={t}
                selected={t.id === selectedId || t.id === level.team}
                dim={!!q && !t.label.toLowerCase().includes(q)}
                chunk={t.canvas && level.company ? chunks.get(level.company) ?? null : null}
                lens={lens}
                roleScore={roleScore}
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
                <em>{f.kind === 'subsidiary' && !f.root ? 'sector' : f.kind === 'company' ? 'group' : f.kind === 'shadow' ? 'shadow IT' : f.kind === 'team' ? 'roles' : f.kind}</em>
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

        <aside className="make-rail make-rail-left" aria-label="Search">
          <label className="make-rail-search">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search companies, depts, roles, systems" aria-label="Search the enterprise" />
          </label>
          <div className="make-list scale-results" role="list">
            {q && results.length === 0 && <p className="lens-blurb">No match.</p>}
            {results.map((r) => (
              <button key={`${r.kind}:${r.id}`} type="button" className="make-row" onClick={r.go}>
                <span className="make-row-copy">
                  <strong>{r.label}</strong>
                  <span>{r.kind}</span>
                </span>
              </button>
            ))}
            {!q && manifest && (
              <dl className="lens-stats scale-counts" aria-label="Dataset counts">
                <div><dt>Subsidiaries</dt><dd>{fmt(manifest.counts.subsidiaries)}</dd></div>
                <div><dt>Departments</dt><dd>{fmt(manifest.counts.departments)}</dd></div>
                <div><dt>Teams</dt><dd>{fmt(manifest.counts.teams)}</dd></div>
                <div><dt>Employees</dt><dd>{fmt(manifest.counts.employees)}</dd></div>
                <div><dt>Devices</dt><dd>{fmt(manifest.counts.devices)}</dd></div>
                <div><dt>Systems / SaaS</dt><dd>{fmt(manifest.counts.systems)}</dd></div>
                <div><dt>Unsanctioned</dt><dd>{fmt(manifest.counts.unsanctioned)}</dd></div>
                <div><dt>Zones</dt><dd>{fmt(manifest.counts.zones)}</dd></div>
                <div><dt>Roles</dt><dd>{fmt(manifest.counts.roles)}</dd></div>
                <div><dt>Grants</dt><dd>{fmt(manifest.counts.grants)}</dd></div>
                <div><dt>Channels</dt><dd>{fmt(manifest.counts.channels)}</dd></div>
                <div><dt>Ext. actors</dt><dd>{fmt(manifest.counts.actors)}</dd></div>
              </dl>
            )}
            {!q && manifest && (
              <p className="lens-blurb">
                Seeded synthetic generator {manifest.generator.name} v{manifest.generator.version} (seed {manifest.generator.seed}). No real people, companies, or systems.
              </p>
            )}
          </div>
          <div className="make-rail-foot">
            <select className="make-sample-select" aria-label="Sample document" value={sampleId} onChange={(e) => onPickSample(e.target.value)}>
              {SAMPLE_DOCS.map((d) => (
                <option key={d.id} value={d.id}>{d.file}</option>
              ))}
            </select>
          </div>
        </aside>

        <aside className="make-rail make-rail-right" aria-label="Lens detail">
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
          />
        </aside>

        <div className="make-bottom">
          <div className="lens-switch" role="group" aria-label="Lens">
            {SCALE_LENSES.map((l) => (
              <button key={l.id} type="button" className={lens === l.id ? 'active' : ''} aria-pressed={lens === l.id} onClick={() => pickLens(l.id)}>
                {l.label}
              </button>
            ))}
          </div>
          <span className="scale-level-chip" data-level={levelName}>{levelName} · {tileCount} tiles</span>
        </div>

        <div className="make-zoom">
          <button type="button" onClick={() => { userMoved.current = false; fitPasses.current = 0; setZoom((z) => z * 0.999) }}>Fit</button>
          <button type="button" aria-label="Zoom out" onClick={() => { userMoved.current = true; setZoom((z) => Math.max(0.25, z / 1.15)) }}>−</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" aria-label="Zoom in" onClick={() => { userMoved.current = true; setZoom((z) => Math.min(3, z * 1.15)) }}>+</button>
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
}: {
  tile: TileSpec
  selected: boolean
  dim: boolean
  chunk: ExpandedChunk | null
  lens: ScaleLens
  roleScore: Map<string, RoleScore>
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
      {tile.canvas && chunk && <TeamCanvas team={tile.canvas.team} chunk={chunk} w={rect.w} h={rect.h} lens={lens} roleScore={roleScore} />}
      {showMeta && tile.meta && <span className="scale-tile-meta">{tile.meta}</span>}
      {tile.tag && <i className="scale-anchor" data-board-anchor={tile.id} aria-hidden="true" />}
    </button>
  )
}

/** People (dots) and devices (squares) of one team, drawn on a canvas instead of DOM nodes. */
function TeamCanvas({ team, chunk, w, h, lens, roleScore }: { team: string; chunk: ExpandedChunk; w: number; h: number; lens: ScaleLens; roleScore: Map<string, RoleScore> }) {
  const ref = useRef<HTMLCanvasElement>(null)
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
      ctx.fillStyle = lens === 'network' ? zoneColor(dev?.zone) : dev?.type === 'Server' ? '#343a40' : dev?.type === 'Phone' ? '#94a3d8' : '#adb5c7'
      ctx.fillRect(x - s / 2, y - s / 2, s, s)
    }
  }, [team, chunk, cw, ch, lens, roleScore])
  return <canvas ref={ref} className="scale-canvas" style={{ left: 6, top, width: cw, height: ch }} aria-hidden="true" />
}

type IndexLike = {
  boundaries: Map<string, MithBoundary>
  roles: Map<string, MithRole>
  entities: Map<string, MithEntity>
  channels: Map<string, MithChannel>
  companyOf: (id: string | undefined) => string | null
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
  org: 'Subsidiaries clustered by sector, sized by headcount, tinted by the highest role exposure score inside. Click to drill: company → department → team.',
  network: 'Network zones, sized by device count. The same people keep their org boundary.',
  access: 'Resources ranked by exposure: easiest outside path to a role that holds the grant × resource criticality × grant level.',
  impersonation: 'Roles ranked by exposure score. Weak controls count: each hop costs 1 + control weights; red hops carry no verification.',
  shadow: 'Unsanctioned SaaS sits outside the org boundary, sized by how many departments use it.',
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
}) {
  const { lens, manifest, analysis, scopedReport, scopeCompany, level, chunks, index, roleScore, selectedId, onSelect, labelOf, roleLabel, perf } = props
  const chunk = level.company ? chunks.get(level.company) ?? null : null
  const roleWhere = (id: string) => {
    const r = index.roles.get(id)
    if (r) return `${labelOf(r.boundary)} · ${(index.companyOf(r.boundary) ?? '').replace('b:', '').toUpperCase()}`
    const e = index.entities.get(id)
    return e?.boundary ? (index.companyOf(e.boundary) ?? '').replace('b:', '').toUpperCase() : ''
  }
  const selectedRole = selectedId ? index.roles.get(selectedId) : undefined
  const selectedEntity = selectedId ? index.entities.get(selectedId) : undefined
  const shadowApp = selectedId ? analysis?.shadowApps.find((a) => a.id === selectedId) : undefined
  const scopedShadow = useMemo(() => {
    if (!analysis) return []
    if (!level.company) return analysis.shadowApps
    const deptSet = level.dept ? new Set([level.dept]) : null
    return analysis.shadowApps.filter((a) => (deptSet ? a.departments.some((d) => deptSet.has(d)) : a.companies.includes(level.company!)))
  }, [analysis, level])

  return (
    <div className="lens-panel scale-panel" data-lens-panel={lens}>
      <div className="lens-panel-head">
        <strong>{lens === 'shadow' ? 'Shadow IT' : lens.charAt(0).toUpperCase() + lens.slice(1)} lens</strong>
        <span className="lens-badge">display-only · synthetic</span>
      </div>
      <p className="lens-blurb">{LENS_BLURB[lens]}</p>
      {!analysis && <p className="lens-blurb" data-analysis-pending>Exposure analysis running in a Web Worker…</p>}

      {selectedId && (
        <div className="lens-detail" aria-label="Selection">
          <div className="lens-detail-head">
            <h2>{selectedRole ? selectedRole.label : labelOf(selectedId)}</h2>
            <button type="button" className="make-icon-btn" aria-label="Clear selection" onClick={() => onSelect(null)}>×</button>
          </div>
          {selectedRole && analysis && (
            <>
              <dl className="lens-kv">
                <div><dt>where</dt><dd>{roleLabel(selectedRole.id)}</dd></div>
                <div><dt>holders</dt><dd>{chunk?.holders.get(selectedRole.id)?.length ?? '—'} (synthetic people)</dd></div>
                <div><dt>unverified paths</dt><dd>{roleScore.get(selectedRole.id)?.unverifiedPaths ?? 0} of {roleScore.get(selectedRole.id)?.paths ?? 0} (≤4 hops) · min hops {roleScore.get(selectedRole.id)?.minHops ?? '—'}</dd></div>
              </dl>
              <EasiestPath report={analysis.report} roleId={selectedRole.id} labelOf={labelOf} />
              <HopChain role={roleScore.get(selectedRole.id)} index={index} labelOf={labelOf} />
            </>
          )}
          {selectedEntity && !shadowApp && (
            <dl className="lens-kv">
              <div><dt>type</dt><dd>{selectedEntity.type}</dd></div>
              <div><dt>criticality</dt><dd>{selectedEntity.criticality ?? 'not declared (level fallback)'}</dd></div>
              <div><dt>zone</dt><dd>{selectedEntity.zone ? labelOf(selectedEntity.zone) : '—'}</dd></div>
              {analysis && (
                <div><dt>exposure</dt><dd>{(() => { const r = analysis.report.resources.find((x) => x.resource === selectedEntity.id); return r ? `score ${r.score} via ${r.viaRole ? roleLabel(r.viaRole) : '—'}` : 'no grants' })()}</dd></div>
              )}
            </dl>
          )}
          {shadowApp && (
            <dl className="lens-kv">
              <div><dt>source</dt><dd>{shadowApp.source}</dd></div>
              <div><dt>criticality</dt><dd>{shadowApp.criticality}</dd></div>
              <div><dt>used by</dt><dd>{shadowApp.departments.length} departments in {shadowApp.companies.length} subsidiaries</dd></div>
              <div><dt>first users</dt><dd>{shadowApp.departments.slice(0, 6).map((d) => `${labelOf(d)} (${d.split('.')[0]!.replace('b:', '').toUpperCase()})`).join(', ')}</dd></div>
            </dl>
          )}
        </div>
      )}

      {lens === 'org' && (
        <>
          {level.dept && manifest?.departments[level.dept] && (
            <Section title={`Department · ${labelOf(level.dept)}`}>
              <dl className="lens-stats">
                <div><dt>People</dt><dd>{fmt(manifest.departments[level.dept]![0])}</dd></div>
                <div><dt>Devices</dt><dd>{fmt(manifest.departments[level.dept]![1])}</dd></div>
                <div><dt>Teams</dt><dd>{manifest.departments[level.dept]![2]}</dd></div>
                <div><dt>Max role score</dt><dd>{analysis?.deptHeat[level.dept]?.max ?? '—'}</dd></div>
              </dl>
            </Section>
          )}
          {scopeCompany && !level.dept && (
            <dl className="lens-stats">
              <div><dt>People</dt><dd>{fmt(scopeCompany.people)}</dd></div>
              <div><dt>Devices</dt><dd>{fmt(scopeCompany.devices)}</dd></div>
              <div><dt>Departments</dt><dd>{scopeCompany.departments}</dd></div>
              <div><dt>Teams</dt><dd>{scopeCompany.teams}</dd></div>
            </dl>
          )}
          {!scopeCompany && analysis && (
            <Section title="Hottest subsidiaries (max role score)">
              <div className="lens-list">
                {Object.entries(analysis.companyHeat)
                  .sort((a, b) => b[1].max - a[1].max || b[1].hot - a[1].hot)
                  .slice(0, 8)
                  .map(([id, h]) => (
                    <button key={id} type="button" className="lens-row" onClick={() => h.top && onSelect(h.top)}>
                      <span><strong>{labelOf(id)}</strong><small>max {h.max} · {h.hot} roles ≥ {HOT} · top {h.top ? labelOf(h.top) : '—'}</small></span>
                    </button>
                  ))}
              </div>
            </Section>
          )}
          {level.team && chunk && <TeamList team={level.team} chunk={chunk} />}
          <HeatLegend />
        </>
      )}

      {lens === 'network' && manifest && (
        <Section title={scopeCompany ? 'Zones in this subsidiary' : 'Zones across the group'}>
          <div className="lens-list">
            {(scopeCompany
              ? Object.entries(scopeCompany.zones)
              : Object.entries(
                  manifest.companies.reduce<Record<string, number>>((acc, c) => {
                    for (const [z, n] of Object.entries(c.zones)) acc[zoneKind(z)] = (acc[zoneKind(z)] ?? 0) + n
                    return acc
                  }, {}),
                )
            )
              .sort((a, b) => b[1] - a[1])
              .map(([z, n]) => (
                <div key={z} className="lens-row"><span><strong>{scopeCompany ? labelOf(z) : z}</strong><small>{fmt(n)} devices</small></span></div>
              ))}
          </div>
        </Section>
      )}

      {lens === 'access' && scopedReport && (
        <RankedResources report={scopedReport} labelOf={labelOf} subOf={roleWhere} selectedId={selectedId} onSelect={onSelect} limit={40} />
      )}

      {lens === 'impersonation' && scopedReport && (
        <>
          <p className="lens-metric">
            <b className="lens-num-hot">{fmt(scopedReport.totals.unverifiedPaths)}</b> unverified of {fmt(scopedReport.totals.paths)} paths (≤{scopedReport.totals.maxHops} hops){scopedReport.totals.capped ? ' (capped)' : ''} · {fmt(scopedReport.totals.reachableRoles)} of {fmt(scopedReport.totals.roles)} roles reachable from outside
          </p>
          <RankedRoles report={scopedReport} labelOf={labelOf} subOf={roleWhere} selectedId={selectedId} onSelect={onSelect} limit={40} />
          <WeightsNote />
        </>
      )}

      {lens === 'shadow' && (
        <Section title={`Unsanctioned SaaS in scope (${scopedShadow.length})`}>
          <div className="lens-list">
            {scopedShadow.slice(0, 40).map((a) => (
              <button key={a.id} type="button" className={`lens-row ${a.id === selectedId ? 'active' : ''}`} onClick={() => onSelect(a.id)}>
                <span><strong>{a.label}</strong><small>{a.source} · {a.criticality} · {a.departments.length} depts · {a.companies.length} subsidiaries</small></span>
              </button>
            ))}
          </div>
        </Section>
      )}

      <Section title="Measured in this browser">
        <ul className="scale-perf" data-scale-perf>
          {perf.map((p) => (
            <li key={p.name}><span>{p.name}</span><b>{p.ms.toFixed(1)} ms</b>{p.note && <small>{p.note}</small>}</li>
          ))}
          <li><span>DOM tiles at this level</span><b>{props.tileCount}</b></li>
          {props.analysisVia && <li><span>analysis ran in</span><b>{props.analysisVia}</b></li>}
        </ul>
      </Section>
      <p className="lens-foot">Measures exposure in the synthetic model only. No runners, no scanning, no credential collection.</p>
    </div>
  )
}

function HopChain({ role, index, labelOf }: { role: RoleScore | undefined; index: IndexLike; labelOf: (id: string) => string }) {
  if (!role?.easiest) return null
  const path = role.easiest
  return (
    <ol className="scale-hops" aria-label="Easiest path hops">
      {path.channels.map((cid, i) => {
        const ch = index.channels.get(cid)
        if (!ch) return null
        const red = isUnverified(ch)
        return (
          <li key={cid} className={red ? 'is-unverified' : ''}>
            <span>{labelOf(path.nodes[i]!)} → {labelOf(path.nodes[i + 1]!)}</span>
            <small>
              {ch.kind} · {red ? 'no verification' : ch.verification.join(' + ')} · cost {hopCost(ch)}
            </small>
          </li>
        )
      })}
    </ol>
  )
}

function WeightsNote() {
  return (
    <p className="lens-blurb scale-weights">
      Hop cost = 1 + {Object.entries(CONTROL_WEIGHTS).filter(([k]) => k !== 'none').map(([k, v]) => `${k} ${v}`).join(', ')} (tunable defaults, not real-world success rates). Score = 100 × (1 / path cost) × criticality × level ÷ 8.
    </p>
  )
}

function HeatLegend() {
  return (
    <div className="scale-legend" aria-label="Heat legend">
      {[0, 10, 25, 50, 80, 100].map((s) => (
        <span key={s} style={{ background: heatColor(s) }}>{s}</span>
      ))}
      <small>exposure score (max role in tile)</small>
    </div>
  )
}

/** Virtualized people / device list for one team. Only visible rows are in the DOM. */
function TeamList({ team, chunk }: { team: string; chunk: ExpandedChunk }) {
  const rows = useMemo(() => {
    const people = (chunk.teamPeople.get(team) ?? []).map((i) => chunk.people[i]!)
    const devices = (chunk.teamDevices.get(team) ?? []).map((i) => chunk.devices[i]!)
    return [...people, ...devices]
  }, [team, chunk])
  const [top, setTop] = useState(0)
  const ROW = 30
  const H = 260
  const first = Math.max(0, Math.floor(top / ROW) - 4)
  const last = Math.min(rows.length, first + Math.ceil(H / ROW) + 8)
  return (
    <Section title={`Team members & devices (${rows.length})`}>
      <div className="scale-vlist" style={{ height: H }} onScroll={(e) => setTop(e.currentTarget.scrollTop)} data-vlist-rows={rows.length}>
        <div style={{ height: rows.length * ROW, position: 'relative' }}>
          {rows.slice(first, last).map((e, i) => (
            <div key={e.id} className="scale-vrow" style={{ top: (first + i) * ROW, height: ROW }}>
              <strong>{e.label}</strong>
              <small>{e.type}{e.attrs.title ? ` · ${e.attrs.title}` : ''}</small>
            </div>
          ))}
        </div>
      </div>
    </Section>
  )
}
