import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as REPointerEvent, type WheelEvent as REWheelEvent } from 'react'
import type { TwinLayer } from '../data/types'
import { boardForEntity, coplanarFloor, crossArcPath, fitBoardsInSafeArea, linksFor, sharedEntityIds, visiblePlanes } from '../mith/geometry'
import type { MithDocument, MithEntity, MithPlacement, MithPlane } from '../mith/types'
import { LENSES, lensLayout, type FrameDim, type Lens } from '../mith/lensLayout'
import { lensFocus } from '../mith/lensLinks'
import { hasOrgModel } from '../mith/org'
import { buildMithDownload, formatBytes, saveMithFile } from '../mith/io'
import { SAMPLE_DOCS } from '../mith/load'
import { MithFileActions, useMithFileDrop } from '../components/MithFileActions'
import ThemeSwitcher from '../components/ThemeSwitcher'
import GitHubLink from '../components/GitHubLink'
import { BoardTags, iconKind, Node3D, useBoardAnchors } from './node3d'
import LensFloor, { LensFrameTags } from './LensFloor'
import LensPanel from './LensPanel'
import './make-grid.css'

type RailTab = 'objects' | 'attributes' | 'filters'
type Point = { x: number; y: number; planeId: string }
type Arc = { id: string; d: string; kind: 'cross' | 'shared' | 'hypothesis' | 'lens'; cls?: string; label?: string; lx?: number; ly?: number }

function samePoints(a: Map<string, Point[]>, b: Map<string, Point[]>) {
  if (a.size !== b.size) return false
  for (const [id, points] of b) {
    const prev = a.get(id)
    if (!prev || prev.length !== points.length) return false
    for (let i = 0; i < points.length; i++) {
      const left = prev[i]
      const right = points[i]
      if (!left || !right || left.x !== right.x || left.y !== right.y || left.planeId !== right.planeId) return false
    }
  }
  return true
}

type Props = {
  doc: MithDocument | null
  loading: boolean
  error: string
  source: 'mith' | 'file'
  packageId: string | null
  /** Committed sample id (see SAMPLE_DOCS). */
  sampleId?: string
  onPickSample?: (id: string) => void
  /** Local file name when `source` is `file`. */
  fileName?: string | null
  fileNote?: string | null
  /** Bumps whenever a new document is applied, so lens state follows that file. */
  docEpoch?: number
  onImportFiles?: (files: File[]) => void
  focusPlaneId: string | null
  selectedId: string | null
  hypothesisId: string | null
  onFocusPlane: (id: string) => void
  onSelect: (id: string | null) => void
  onHypothesis: (id: string | null) => void
  onOpenLayer: (layer: TwinLayer) => void
  onOpenBoard: () => void
}

const ARC_CAP = 5

function toneOf(placement: MithPlacement | undefined): 'quiet' | 'accent' | 'info' {
  return placement?.tone ?? 'quiet'
}

function shortLabel(label: string) {
  return label.length > 18 ? `${label.slice(0, 17)}…` : label
}

function ModGlyph({ type }: { type: string }) {
  const kind = iconKind(type)
  if (kind === 'net') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="4" cy="8" r="1.6" fill="currentColor" />
        <circle cx="11" cy="4.5" r="1.6" fill="currentColor" />
        <circle cx="11.5" cy="11.5" r="1.6" fill="currentColor" />
        <path d="M5.4 7.4 L9.6 5.2 M5.5 8.8 L10 10.8" stroke="currentColor" strokeWidth="1.2" fill="none" />
      </svg>
    )
  }
  if (kind === 'fw') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 1.8 L13 4.2 V8.2 C13 11 10.8 13.2 8 14.2 C5.2 13.2 3 11 3 8.2 V4.2 Z" fill="none" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    )
  }
  if (kind === 'server') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2.5" y="3" width="11" height="3.2" rx="0.8" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <rect x="2.5" y="8" width="11" height="3.2" rx="0.8" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="4.6" cy="4.6" r="0.6" fill="currentColor" />
        <circle cx="4.6" cy="9.6" r="0.6" fill="currentColor" />
      </svg>
    )
  }
  if (kind === 'node') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="3" y="3" width="10" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <path d="M6 8 H10 M8 6 V10" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    )
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 13 V6.5 L8 3.5 L13 6.5 V13 H9.5 V9.5 H6.5 V13 Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}

function placementOn(plane: MithPlane, entityId: string) {
  return plane.placements.find((p) => p.entity === entityId)
}

function lensFromDoc(doc: MithDocument | null): Lens {
  if (!doc || !hasOrgModel(doc)) return 'layers'
  return doc.diagram.lens ?? 'org'
}

export default function MakeGrid({
  doc, loading, error, source, packageId, sampleId, onPickSample, fileName, fileNote, docEpoch = 0,
  onImportFiles, focusPlaneId, selectedId, hypothesisId,
  onFocusPlane, onSelect, onHypothesis, onOpenLayer, onOpenBoard,
}: Props) {
  const stageRef = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<RailTab>('objects')
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [zoom, setZoom] = useState(1)
  const [flat, setFlat] = useState(false)
  const [stacked, setStacked] = useState(false)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [points, setPoints] = useState<Map<string, Point[]>>(new Map())
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const userMoved = useRef(false)
  const fitPasses = useRef(0)
  const [stageSize, setStageSize] = useState(0)
  // Lens choice is keyed to the document epoch so a newly opened file restores diagram.lens.
  const [lensPick, setLensPick] = useState<{ epoch: number; lens: Lens } | null>(null)
  const [framePick, setFramePick] = useState<{ epoch: number; frame: FrameDim } | null>(null)
  const [exportNote, setExportNote] = useState<{ epoch: number; text: string } | null>(null)
  const selectAndReveal = (id: string | null) => {
    onSelect(id)
    setMobileDetailOpen(id !== null)
  }
  const exportText = exportNote && exportNote.epoch === docEpoch ? exportNote.text : null
  const { over, handlers: dropHandlers } = useMithFileDrop((files) => onImportFiles?.(files))

  const orgMode = hasOrgModel(doc)
  const lens: Lens = lensPick && lensPick.epoch === docEpoch ? lensPick.lens : lensFromDoc(doc)
  const lensOn = lens !== 'layers'
  const storedFrame: FrameDim = framePick && framePick.epoch === docEpoch ? framePick.frame : (doc?.diagram.frame ?? 'org')
  const frameDim: FrameDim = lens === 'org' ? 'org' : lens === 'network' ? 'network' : storedFrame
  // Stack only applies to the layer boards. Lenses always lay frames on one floor.
  const stackedView = stacked && !lensOn
  const layout = useMemo(() => (doc && lensOn ? lensLayout(doc, lens, frameDim) : null), [doc, lensOn, lens, frameDim])
  const focus = useMemo(
    () => (doc && lensOn ? lensFocus(doc, lens, selectedId) : { links: [], hot: new Set<string>() }),
    [doc, lensOn, lens, selectedId],
  )
  const pickLens = (next: Lens) => {
    if (!doc) return
    setLensPick({ epoch: docEpoch, lens: next })
  }
  // Org and Network lenses fix the frame dimension. Access / Impersonation / Shadow IT default
  // to org frames and can be re-framed by network zone.
  const analysisLens = lens === 'access' || lens === 'impersonation' || lens === 'shadow'

  const planes = doc?.diagram.planes ?? []
  const focusId = focusPlaneId && planes.some((p) => p.id === focusPlaneId)
    ? focusPlaneId
    : doc?.diagram.camera.focusPlane ?? planes[0]?.id ?? null
  const onExport = () => {
    if (!doc) return
    try {
      const file = buildMithDownload(doc, {
        arrangement: stacked ? 'stacked' : 'coplanar',
        camera: {
          mode: flat ? 'ortho' : 'iso',
          tilt: doc.diagram.camera.tilt,
          yaw: doc.diagram.camera.yaw,
          zoom,
          focusPlane: focusId ?? doc.diagram.camera.focusPlane,
        },
        selection: selectedId,
        lens,
        frame: frameDim,
      })
      saveMithFile(file)
      setExportNote({ epoch: docEpoch, text: `Exported ${file.filename} · ${formatBytes(file.bytes)} · ${file.format === 'form' ? 'Mithril Form' : 'legacy v0 JSON'}.${file.note ? ` ${file.note}` : ''}` })
    } catch (err) {
      setExportNote({ epoch: docEpoch, text: err instanceof Error ? err.message : 'Export failed.' })
    }
  }
  const shown = useMemo(
    () => (stackedView ? visiblePlanes(planes, focusId) : planes),
    [planes, focusId, stackedView],
  )
  const floor = useMemo(() => coplanarFloor(shown), [shown])
  const boardAt = useMemo(() => new Map(floor.boards.map((b) => [b.id, b])), [floor])
  const entities = useMemo(() => new Map((doc?.model.entities ?? []).map((e) => [e.id, e])), [doc])
  const shared = useMemo(() => (doc ? sharedEntityIds(doc) : new Set<string>()), [doc])
  const hypothesis = doc?.inference.hypotheses.find((h) => h.id === hypothesisId) ?? null
  const hot = useMemo(() => new Set(hypothesis?.node_ids ?? []), [hypothesis])

  useEffect(() => {
    if (!doc) return
    // Reset the camera to the document's authored view whenever a new document loads.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setZoom(doc.diagram.camera.zoom || 1)
    setFlat(doc.diagram.camera.mode === 'ortho')
    setStacked(doc.diagram.arrangement === 'stacked')
    setPan({ x: 0, y: doc.diagram.arrangement === 'stacked' ? 12 : 0 })
  }, [doc])

  const tilt = doc?.diagram.camera.tilt ?? 54
  const yaw = doc?.diagram.camera.yaw ?? -28

  const shownKey = shown.map((p) => p.id).join('|')
  const viewKey = `${doc?.id ?? ''}|${stackedView}|${flat}|${shownKey}|${lens}|${frameDim}`
  const lastView = useRef(viewKey)

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      fitPasses.current = 0
      setStageSize(stage.clientWidth * 10000 + stage.clientHeight)
    })
    ro.observe(stage)
    return () => ro.disconnect()
  }, [])

  useLayoutEffect(() => {
    if (lastView.current !== viewKey) {
      lastView.current = viewKey
      userMoved.current = false
      fitPasses.current = 0
    }
    const stage = stageRef.current
    if (!stage || stackedView || (flat && !lensOn) || userMoved.current || fitPasses.current > 4) return
    const cards = [...stage.querySelectorAll<HTMLElement>('[data-plane-card]')]
    if (!cards.length) return
    const rects = cards.map((el) => el.getBoundingClientRect())
    const content = {
      left: Math.min(...rects.map((r) => r.left)),
      right: Math.max(...rects.map((r) => r.right)),
      top: Math.min(...rects.map((r) => r.top)),
      bottom: Math.max(...rects.map((r) => r.bottom)),
    }
    const stageBox = stage.getBoundingClientRect()
    const leftRail = stage.querySelector('.make-rail-left')?.getBoundingClientRect()
    const rightRail = stage.querySelector('.make-rail-right')?.getBoundingClientRect()
    const bottomBar = stage.querySelector('.make-bottom')?.getBoundingClientRect()
    const pad = 12
    const safe = {
      left: (leftRail && leftRail.width > 0 ? leftRail.right : stageBox.left) + pad,
      right: (rightRail && rightRail.width > 0 ? rightRail.left : stageBox.right) - pad,
      top: stageBox.top + 8,
      bottom: (bottomBar && bottomBar.height > 0 ? bottomBar.top : stageBox.bottom) - pad,
    }
    const next = fitBoardsInSafeArea({
      zoom,
      pan: { x: pan.x, y: pan.y },
      content,
      safe,
      stageCenter: {
        x: stageBox.left + stageBox.width / 2,
        y: stageBox.top + stageBox.height / 2,
      },
    })
    if (!next) return
    fitPasses.current += 1
    setZoom(next.zoom)
    setPan(next.pan)
  }, [zoom, pan.x, pan.y, stackedView, flat, lensOn, shownKey, stageSize, viewKey])

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const measure = () => {
      const box = stage.getBoundingClientRect()
      const next = new Map<string, Point[]>()
      stage.querySelectorAll<HTMLElement>('[data-entity]').forEach((el) => {
        const id = el.dataset.entity
        const planeId = el.dataset.plane
        if (!id || !planeId) return
        const r = el.getBoundingClientRect()
        const pt = {
          x: Math.round(r.left + r.width / 2 - box.left),
          y: Math.round(r.top + r.height / 2 - box.top),
          planeId,
        }
        const list = next.get(id) ?? []
        list.push(pt)
        next.set(id, list)
      })
      setPoints((prev) => (samePoints(prev, next) ? prev : next))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(stage)
    return () => ro.disconnect()
  }, [doc, zoom, flat, stackedView, pan.x, pan.y, focusId, shownKey, query, hypothesisId, lens, frameDim, selectedId])

  const boardAnchors = useBoardAnchors(
    stageRef,
    `${doc?.id ?? ''}|${zoom}|${flat}|${stackedView}|${lens}|${frameDim}|${pan.x}|${pan.y}|${focusId ?? ''}|${shownKey}`,
  )

  const arcs = useMemo(() => {
    if (!doc) return [] as Arc[]
    if (lensOn) {
      const at = (id: string) => (points.get(id) ?? []).find((p) => p.planeId === 'lens')
      const out: Arc[] = []
      for (const link of focus.links) {
        const a = at(link.from)
        const b = at(link.to)
        if (!a || !b || (a.x === b.x && a.y === b.y)) continue
        // Lens links stay low over the floor so labels sit near the frames they join.
        const cx = (a.x + b.x) / 2
        const cy = Math.min(a.y, b.y) - (18 + Math.hypot(a.x - b.x, a.y - b.y) * 0.12)
        const d = `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`
        out.push({
          id: link.id,
          d,
          kind: 'lens',
          cls: `${link.cls}${link.faded ? ' is-faded' : ''}`,
          label: link.faded ? undefined : link.label,
          lx: 0.25 * a.x + 0.5 * cx + 0.25 * b.x,
          ly: 0.25 * a.y + 0.5 * cy + 0.25 * b.y,
        })
      }
      return out
    }
    const visible = new Set(shown.map((p) => p.id))
    const pair = (aId: string, bId: string) => {
      const a = (points.get(aId) ?? []).filter((p) => visible.has(p.planeId))
      const b = (points.get(bId) ?? []).filter((p) => visible.has(p.planeId))
      if (!a.length || !b.length) return null
      const left = a.find((p) => b.some((q) => q.planeId !== p.planeId)) ?? a[0]
      const right = b.find((p) => p.planeId !== left?.planeId) ?? b[0]
      if (!left || !right || (left.x === right.x && left.y === right.y)) return null
      return { left, right }
    }
    const scored: { arc: Arc; score: number }[] = []
    for (const link of doc.diagram.crossLinks) {
      const hit = pair(link.from, link.to)
      if (!hit) continue
      const score = (link.from === selectedId || link.to === selectedId ? 3 : 0) + 1
      scored.push({
        score,
        arc: { id: link.id, d: crossArcPath(hit.left, hit.right), kind: 'cross' },
      })
    }
    for (const id of shared) {
      const pts = (points.get(id) ?? []).filter((p) => visible.has(p.planeId))
      if (pts.length < 2) continue
      const score = (id === selectedId ? 4 : 0) + 1
      scored.push({
        score,
        arc: { id: `shared:${id}`, d: crossArcPath(pts[0]!, pts[1]!), kind: 'shared' },
      })
    }
    scored.sort((a, b) => b.score - a.score)
    const kept = scored.slice(0, ARC_CAP).map((s) => s.arc)
    if (hypothesis) {
      for (const step of hypothesis.steps) {
        const hit = pair(step.from, step.to)
        if (!hit) continue
        kept.push({
          id: `hyp:${step.from}:${step.to}`,
          d: crossArcPath(hit.left, hit.right),
          kind: 'hypothesis',
        })
      }
    }
    return kept
  }, [doc, points, shown, selectedId, shared, hypothesis, lensOn, focus])

  const focusPlane = planes.find((p) => p.id === focusId) ?? null
  const selected = selectedId ? entities.get(selectedId) ?? null : null
  const selectedBoard = selected ? boardForEntity(planes, selected.id, String(selected.layer)) : undefined
  const selectedPlacement = focusPlane && selected ? placementOn(focusPlane, selected.id) : undefined
  const selectedTone = toneOf(
    selectedPlacement ??
      planes.flatMap((p) => p.placements).find((p) => p.entity === selectedId),
  )
  const q = query.trim().toLowerCase()

  const objectRows = useMemo(() => {
    if (!doc) return [] as { entity: MithEntity; plane: MithPlane; placement: MithPlacement }[]
    const rows: { entity: MithEntity; plane: MithPlane; placement: MithPlacement }[] = []
    const pool = q ? planes : shown
    for (const plane of pool) {
      for (const placement of plane.placements) {
        const entity = entities.get(placement.entity)
        if (!entity) continue
        if (q && !`${entity.label} ${entity.type} ${entity.id}`.toLowerCase().includes(q)) continue
        if (rows.some((r) => r.entity.id === entity.id && r.plane.id === plane.id)) continue
        rows.push({ entity, plane, placement })
      }
    }
    return rows
  }, [doc, planes, shown, entities, q])

  const attrRows = selected
    ? [
        ['type', selected.type],
        ['layer', String(selected.layer)],
        ['id', selected.id],
        ...Object.entries(selected.attrs),
        ...selected.citations.map((c, i) => [`citation ${i + 1}`, c.source] as [string, string]),
      ]
    : []

  const otherSharedPlane = selected
    ? planes.find((p) => p.id !== focusId && p.placements.some((pl) => pl.entity === selected.id))
    : undefined

  const onPlanePointerDown = (event: REPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('button, input, select, a, .make-rail, .make-bottom, .make-zoom')) return
    userMoved.current = true
    drag.current = { x: event.clientX, y: event.clientY, ox: pan.x, oy: pan.y }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPlanePointerMove = (event: REPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    setPan({ x: d.ox + event.clientX - d.x, y: d.oy + event.clientY - d.y })
  }

  const onWheel = (event: REWheelEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('.make-rail')) return
    userMoved.current = true
    setZoom((z) => Math.min(1.45, Math.max(0.55, z + (event.deltaY < 0 ? 0.08 : -0.08))))
  }

  const sampleFile = SAMPLE_DOCS.find((d) => d.id === sampleId)?.file ?? 'polaris-fi.mith'
  const sourceName = source === 'file' && fileName ? fileName : sampleFile
  const datasetKind = doc?.dataset_kind ?? 'synthetic-demo'

  return (
    <div
      className={`make-app ${flat ? 'is-flat' : 'is-iso'} ${stackedView ? 'is-stacked' : 'is-coplanar'}${lensOn ? ' is-lens' : ''}${over ? ' is-file-drop' : ''}`}
      data-projection={flat ? 'flat' : 'iso'}
      data-arrangement={stackedView ? 'stacked' : 'coplanar'}
      data-lens={lens}
      data-frame-dim={lensOn ? frameDim : ''}
      data-source={source}
      data-dataset-kind={datasetKind}
      data-focus-plane={focusId ?? ''}
      {...dropHandlers}
      style={{ ['--iso-tilt' as string]: `${tilt}deg`, ['--iso-yaw' as string]: `${yaw}deg` }}
    >
      <header className="make-top">
        <div className="make-brand">
          <span className="make-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <span className="make-word">
            <strong>Mithril Twin</strong>
            <h1 className="make-doc-title">{doc?.title ?? 'Mithril Twin'}</h1>
          </span>
        </div>
        <label className="make-top-search">
          <SearchIcon />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search objects"
            aria-label="Search objects"
          />
        </label>
        <div className="make-top-actions">
          <span className="make-chip make-dataset" title={datasetKind === 'synthetic-demo' ? 'Synthetic sample' : 'Label declared by the file'}>
            {datasetKind}
          </span>
          <span className="make-chip warn">non-prod</span>
          <span className="make-chip">no-runners</span>
          <span className="make-chip warn">viz only</span>
          <ThemeSwitcher />
          <GitHubLink className="make-github-link" />
          <button type="button" className="make-board-btn" onClick={onOpenBoard}>
            Board
          </button>
          <button
            type="button"
            className="make-detail-toggle"
            aria-controls="make-object-detail"
            aria-expanded={mobileDetailOpen}
            onClick={() => setMobileDetailOpen((open) => !open)}
          >
            Details
          </button>
        </div>
      </header>

      <div
        className="make-stage"
        ref={stageRef}
        onPointerDown={onPlanePointerDown}
        onPointerMove={onPlanePointerMove}
        onPointerUp={() => { drag.current = null }}
        onWheel={onWheel}
      >
        {loading && <div className="make-loading">Loading .mith…</div>}
        {error && <div className="make-error" role="alert">{error}</div>}
        {over && <div className="make-drop-hint">Drop a .mith file</div>}
        {hypothesis && (
          <div className="make-hyp-banner">
            hypothesis · {hypothesis.label} · score {hypothesis.relative_score.toFixed(2)} · no runners
          </div>
        )}

        <div className="make-world" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
          <div className="make-floor-shadow" />
          <div
            className="make-stack"
            style={
              layout
                ? { width: layout.width, height: layout.height }
                : !stackedView && !flat
                  ? { width: floor.width, height: floor.height }
                  : undefined
            }
          >
            {!stackedView && !flat && <div className="make-floor" />}
            {layout && (
              <LensFloor
                layout={layout}
                lens={lens}
                selectedId={selectedId}
                hot={focus.hot}
                query={query}
                onSelect={selectAndReveal}
                glyph={(type) => <ModGlyph type={type} />}
              />
            )}
            {!layout && shown.map((plane, index) => {
              const depth = index
              const board = boardAt.get(plane.id)
              const placed = new Map(plane.placements.map((p) => [p.entity, p]))
              const inPlane = (doc?.model.edges ?? [])
                .filter((e) => placed.has(e.source) && placed.has(e.target))
                .slice(0, 6)
              return (
                <div
                  key={plane.id}
                  className={`make-plane ${plane.id === focusId ? 'is-focus' : ''}`}
                  data-plane-card={plane.id}
                  style={
                    stackedView
                      ? { ['--depth' as string]: String(depth) }
                      : flat
                        ? undefined
                        : { left: board?.x ?? 0, top: board?.y ?? 0 }
                  }
                  role="group"
                  aria-label={`${plane.label} layer`}
                >
                  <svg className="make-plane-edges" viewBox="0 0 100 100" preserveAspectRatio="none">
                    {inPlane.map((edge) => {
                      const a = placed.get(edge.source)
                      const b = placed.get(edge.target)
                      if (!a || !b) return null
                      return (
                        <line
                          key={edge.id}
                          x1={a.x * 100}
                          y1={a.y * 100}
                          x2={b.x * 100}
                          y2={b.y * 100}
                        />
                      )
                    })}
                  </svg>
                  {plane.placements.map((placement) => {
                    const entity = entities.get(placement.entity)
                    if (!entity) return null
                    const dim = q && !`${entity.label} ${entity.type}`.toLowerCase().includes(q)
                    const showLabel = placement.showLabel || placement.entity === selectedId
                    return (
                      <div
                        key={`${plane.id}:${placement.entity}`}
                        className="make-mod-wrap"
                        style={{ left: `${placement.x * 100}%`, top: `${placement.y * 100}%` }}
                      >
                        <span className="make-mod-shadow" aria-hidden="true" />
                        <button
                          type="button"
                          className={`make-mod tone-${toneOf(placement)} ${placement.entity === selectedId ? 'is-selected' : ''} ${hot.has(placement.entity) ? 'is-hot' : ''} ${dim ? 'is-dim' : ''}`}
                          data-entity={placement.entity}
                          data-plane={plane.id}
                          aria-label={entity.label}
                          onClick={(event) => {
                            event.stopPropagation()
                            selectAndReveal(placement.entity)
                            onFocusPlane(plane.id)
                          }}
                        >
                          <Node3D type={entity.type}>
                            <ModGlyph type={entity.type} />
                          </Node3D>
                        </button>
                        {showLabel && <span className="make-pill make-upright">{shortLabel(entity.label)}</span>}
                      </div>
                    )
                  })}
                  <span className="make-board-anchor" data-board-anchor={plane.id} aria-hidden="true" />
                </div>
              )
            })}
          </div>
        </div>

        <svg className="make-arcs" aria-hidden="true">
          {arcs.map((arc) => (
            <g key={arc.id}>
              <path
                d={arc.d}
                className={arc.kind === 'lens' ? `lens-arc ${arc.cls ?? ''}` : arc.kind === 'hypothesis' ? 'arc-hypothesis' : 'arc-cross'}
                data-lens-link={arc.kind === 'lens' ? arc.cls : undefined}
              />
            </g>
          ))}
        </svg>
        {lensOn && (
          // Link labels sit above the frame tags so a red "no verification" hop is always readable.
          <svg className="make-arcs lens-arc-labels" aria-hidden="true">
            {arcs.map((arc) =>
              arc.kind === 'lens' && arc.label && arc.lx != null && arc.ly != null ? (
                <text key={arc.id} x={arc.lx} y={arc.ly} textAnchor="middle" className={`lens-arc-label ${arc.cls ?? ''}`}>
                  {arc.label}
                </text>
              ) : null,
            )}
          </svg>
        )}

        {layout ? (
          <LensFrameTags frames={layout.frames} anchors={boardAnchors} selectedId={selectedId} zoom={zoom} />
        ) : (
          <BoardTags planes={shown} anchors={boardAnchors} focusId={focusId} />
        )}

        <aside className="make-rail make-rail-left" aria-label="Objects">
          <label className="make-rail-search">
            <SearchIcon />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              aria-label="Filter objects"
            />
          </label>
          <div className="make-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'objects'} className={tab === 'objects' ? 'active' : ''} onClick={() => setTab('objects')}>
              Objects<span className="make-tab-count">{objectRows.length}</span>
            </button>
            <button type="button" role="tab" aria-selected={tab === 'attributes'} className={tab === 'attributes' ? 'active' : ''} onClick={() => setTab('attributes')}>
              Attributes<span className="make-tab-count">{attrRows.length}</span>
            </button>
            <button type="button" role="tab" aria-selected={tab === 'filters'} className={tab === 'filters' ? 'active' : ''} onClick={() => setTab('filters')}>
              Filters<span className="make-tab-count">{hypothesis ? 1 : 0}</span>
            </button>
          </div>

          {tab === 'objects' && (
            <div className="make-list" role="list">
              {objectRows.map((row) => (
                <button
                  key={`${row.plane.id}:${row.entity.id}`}
                  type="button"
                  className={`make-row ${row.entity.id === selectedId ? 'active' : ''}`}
                  onClick={() => {
                    selectAndReveal(row.entity.id)
                    onFocusPlane(row.plane.id)
                  }}
                >
                  <span className={`make-mini tone-${toneOf(row.placement)}`}><ModGlyph type={row.entity.type} /></span>
                  <span className="make-row-copy">
                    <strong>{row.entity.label}</strong>
                    <span>{row.entity.type} · {row.plane.label}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {tab === 'attributes' && (
            <dl className="make-kv">
              {attrRows.length === 0 && <div><dt>Selection</dt><dd>Choose an object on a plane.</dd></div>}
              {attrRows.map(([key, value]) => (
                <div key={key}><dt>{key}</dt><dd>{value}</dd></div>
              ))}
            </dl>
          )}

          {tab === 'filters' && (
            <div className="make-filters">
              <div className="make-filter-label">Dataset</div>
              <button type="button" className="make-filter-btn active" disabled>
                {datasetKind}
                <small>
                  {datasetKind === 'synthetic-demo'
                    ? 'Synthetic sample. This twin stays fictional.'
                    : 'Declared by the file. This viewer does not verify it and does not connect to any system.'}
                </small>
              </button>
              <div className="make-filter-label">Hypotheses</div>
              <button type="button" className={`make-filter-btn ${hypothesisId == null ? 'active' : ''}`} onClick={() => onHypothesis(null)}>
                None
                <small>Clear the overlay.</small>
              </button>
              {(doc?.inference.hypotheses ?? []).map((h) => (
                <button
                  key={h.id}
                  type="button"
                  className={`make-filter-btn ${hypothesisId === h.id ? 'active' : ''}`}
                  onClick={() => onHypothesis(h.id)}
                >
                  {h.label}
                  <small>hypothesis · relative {h.relative_score.toFixed(2)} · observation_count=0</small>
                </button>
              ))}
            </div>
          )}

          <div className="make-rail-foot">
            {onPickSample ? (
              <select
                className="make-sample-select"
                aria-label="Sample document"
                title={packageId ?? sourceName}
                value={source === 'file' ? '' : (sampleId ?? '')}
                onChange={(e) => {
                  if (e.target.value) onPickSample(e.target.value)
                }}
              >
                {source === 'file' && fileName && <option value="">{fileName}</option>}
                {SAMPLE_DOCS.map((d) => (
                  <option key={d.id} value={d.id}>{d.file}</option>
                ))}
              </select>
            ) : (
              <span className="make-source" title={packageId ?? sourceName}>{sourceName}</span>
            )}
            <MithFileActions
              onFiles={(files) => onImportFiles?.(files)}
              onExport={onExport}
              exportDisabled={!doc}
              exportTitle="Download this document as .mith"
            />
            {(fileNote || exportText) && <p className="make-file-note" role="status">{exportText ?? fileNote}</p>}
          </div>
        </aside>

        <aside
          id="make-object-detail"
          className={`make-rail make-rail-right${mobileDetailOpen ? ' is-mobile-open' : ''}`}
          aria-label="Object detail"
        >
          <button type="button" className="make-mobile-detail-close" aria-label="Close details" onClick={() => setMobileDetailOpen(false)}>×</button>
          {lensOn && doc ? (
            <LensPanel doc={doc} lens={lens} dim={frameDim} selectedId={selectedId} onSelect={selectAndReveal} />
          ) : selected ? (
            <>
              <div className="make-detail-head">
                <div className={`make-detail-icon tone-${selectedTone}`}><ModGlyph type={selected.type} /></div>
                <button type="button" className="make-icon-btn" aria-label="Close detail" onClick={() => selectAndReveal(null)}>×</button>
              </div>
              <div className="make-detail">
                <h2>{selected.label}</h2>
                <p className="make-crumb">{selected.type} / {selectedBoard?.label ?? selected.layer}</p>
                <p className="make-summary">
                  {selected.attrs.cidr ? `${selected.attrs.cidr}. ` : ''}
                  {datasetKind === 'synthetic-demo' ? 'Synthetic-demo object' : 'Object'} on the {String(selected.layer)} layer.
                  {hypothesis && hot.has(selected.id) ? ` Hypothesis “${hypothesis.label}” touches this object.` : ''}
                </p>
                <div className="make-actions">
                  <button
                    type="button"
                    className="make-open"
                    onClick={() => onOpenLayer(selected.layer as TwinLayer)}
                  >
                    Open
                  </button>
                </div>
                {shared.has(selected.id) && (
                  <div className="make-shared">
                    <div>
                      <strong>Shared object</strong>
                      <span>This object is part of multiple layers.</span>
                    </div>
                    {otherSharedPlane && (
                      <button type="button" onClick={() => onFocusPlane(otherSharedPlane.id)}>Explore</button>
                    )}
                  </div>
                )}
                <div className="make-links">
                  <h3>Links</h3>
                  {linksFor(doc!, selected.id).map((link) => {
                    const other = entities.get(link.otherId)
                    return (
                      <button
                        key={link.id}
                        type="button"
                        className="make-link"
                        onClick={() => {
                          selectAndReveal(link.otherId)
                          const host = planes.find((p) => p.placements.some((pl) => pl.entity === link.otherId))
                          if (host) onFocusPlane(host.id)
                        }}
                      >
                        <ModGlyph type={other?.type ?? 'Other'} />
                        <span>{other?.label ?? link.otherId}</span>
                        <em>{link.kind}</em>
                      </button>
                    )
                  })}
                  {linksFor(doc!, selected.id).length === 0 && (
                    <p className="make-summary">No links in this sample.</p>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="make-empty-detail">
              Select an object on a plane. Detail, links, and the Open action stay on this side.
            </div>
          )}
        </aside>

        <div className="make-bottom">
          {orgMode && (
            <>
              <div className="lens-switch" role="group" aria-label="Lens">
                {LENSES.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    className={lens === l.id ? 'active' : ''}
                    aria-pressed={lens === l.id}
                    onClick={() => pickLens(l.id)}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
              {analysisLens && (
                <div className="lens-switch" role="group" aria-label="Frame the grid by">
                  <span className="lens-switch-label">Frames</span>
                  {(['org', 'network'] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={frameDim === d ? 'active' : ''}
                      aria-pressed={frameDim === d}
                      onClick={() => setFramePick({ epoch: docEpoch, frame: d })}
                    >
                      {d === 'org' ? 'Org' : 'Network'}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {!lensOn && (
          <label className="make-select">
            Select Layer
            <select
              aria-label="Select Layer"
              value={focusId ?? ''}
              onChange={(e) => onFocusPlane(e.target.value)}
            >
              {planes.map((plane) => (
                <option key={plane.id} value={plane.id}>{plane.label}</option>
              ))}
            </select>
          </label>
          )}
          {!orgMode && planes.map((plane) => (
            <button
              key={plane.id}
              type="button"
              className={`make-pill-btn ${plane.id === focusId ? 'active' : ''}`}
              onClick={() => onFocusPlane(plane.id)}
            >
              {plane.label}
            </button>
          ))}
        </div>

        <div className="make-zoom">
          <button
            type="button"
            className={`make-zoom-text ${stackedView ? 'active' : ''}`}
            aria-pressed={stackedView}
            aria-label="Stack layers"
            disabled={lensOn}
            title={lensOn ? 'Stack applies to the Layers lens' : 'Stack layers on separate planes'}
            onClick={() => {
              setStacked((v) => !v)
              setPan({ x: 0, y: 8 })
            }}
          >
            Stack
          </button>
          <button
            type="button"
            className={flat ? 'active' : ''}
            aria-pressed={flat}
            onClick={() => setFlat((v) => !v)}
          >
            2D
          </button>
          <button type="button" aria-label="Zoom out" onClick={() => { userMoved.current = true; setZoom((z) => Math.max(0.55, Number((z - 0.1).toFixed(2)))) }}>−</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" aria-label="Zoom in" onClick={() => { userMoved.current = true; setZoom((z) => Math.min(1.45, Number((z + 0.1).toFixed(2)))) }}>+</button>
        </div>
      </div>
    </div>
  )
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="4.2" fill="none" stroke="#8d879c" strokeWidth="1.4" />
      <path d="M10.4 10.4 L13.2 13.2" stroke="#8d879c" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}
