import type { ReactNode } from 'react'
import type { Lens, LensFrame, LensItem, LensLayout } from '../mith/lensLayout'
import { Node3D } from './node3d'
import './lens.css'

type Props = {
  layout: LensLayout
  lens: Lens
  selectedId: string | null
  hot: Set<string>
  query: string
  onSelect: (id: string) => void
  /** Glyph for ordinary model entities (network, firewall, node, server). */
  glyph: (type: string) => ReactNode
}

const KIND_TAG: Record<string, string> = {
  company: 'company',
  subsidiary: 'subsidiary',
  department: 'dept',
  team: 'team',
  zone: 'zone',
  unassigned: 'unassigned',
  external: 'outside',
  shadow: 'shadow IT',
}

export function LensGlyph({ item, glyph }: { item: Pick<LensItem, 'kind' | 'type'>; glyph: (type: string) => ReactNode }) {
  if (item.kind === 'role') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2.5" y="4" width="11" height="8.5" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <path d="M6 4 V2.8 H10 V4" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <path d="M2.5 7.6 H13.5" stroke="currentColor" strokeWidth="1.1" />
      </svg>
    )
  }
  if (item.kind === 'actor') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="5.4" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <path d="M3.2 13.5 C3.8 10.4 5.7 9.2 8 9.2 C10.3 9.2 12.2 10.4 12.8 13.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <path d="M11.5 2.5 L14 5 M14 2.5 L11.5 5" stroke="currentColor" strokeWidth="1.1" />
      </svg>
    )
  }
  if (item.type === 'Person') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="5.4" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <path d="M3.2 13.5 C3.8 10.4 5.7 9.2 8 9.2 C10.3 9.2 12.2 10.4 12.8 13.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    )
  }
  if (item.type === 'SaaS' || item.type === 'System') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4.6 12 H11.8 C13.4 12 14.4 10.9 14.4 9.6 C14.4 8.3 13.4 7.3 12.1 7.3 C11.8 5.3 10.2 4 8.3 4 C6.4 4 4.9 5.3 4.6 7.1 C3 7.3 1.8 8.4 1.8 9.7 C1.8 11 2.9 12 4.6 12 Z" fill="none" stroke="currentColor" strokeWidth="1.25" />
      </svg>
    )
  }
  return <>{glyph(item.type)}</>
}

/** Nested boundary / zone frames and their items on the shared isometric floor. */
export default function LensFloor({ layout, lens, selectedId, hot, query, onSelect, glyph }: Props) {
  const q = query.trim().toLowerCase()
  return (
    <>
      {layout.frames.map((frame) => (
        <div
          key={frame.id}
          className={`lens-frame kind-${frame.kind} ${frame.dashed ? 'is-dashed' : ''} ${hot.has(frame.id) ? 'is-hot' : ''} ${selectedId === frame.id ? 'is-selected' : ''}`}
          data-lens-frame={frame.id}
          data-frame-kind={frame.kind}
          {...(frame.depth === 0 ? { 'data-plane-card': frame.id } : {})}
          style={{
            left: frame.x,
            top: frame.y,
            width: frame.w,
            height: frame.h,
            ['--lens-depth' as string]: String(frame.depth),
          }}
          role="group"
          aria-label={`${frame.label} ${KIND_TAG[frame.kind] ?? frame.kind}`}
        >
          <i className="lens-anchor" data-entity={frame.id} data-plane="lens" aria-hidden="true" />
          {/* Measured by useBoardAnchors; LensFrameTags draws the label in screen space above everything. */}
          <i className="lens-tag-anchor" data-board-anchor={frame.id} aria-hidden="true" />
        </div>
      ))}
      {layout.items.map((item) => {
        const dim = q && !`${item.label} ${item.type} ${item.id}`.toLowerCase().includes(q)
        const selected = item.id === selectedId
        const showLabel =
          selected ||
          hot.has(item.id) ||
          item.kind !== 'entity' ||
          lens === 'org' ||
          lens === 'network'
        return (
          <div
            key={`${item.frame}:${item.id}`}
            className={`make-mod-wrap lens-item-wrap kind-${item.kind}`}
            style={{ left: item.x, top: item.y, ['--lens-depth' as string]: String(item.depth) }}
          >
            <span className="make-mod-shadow" aria-hidden="true" />
            <button
              type="button"
              className={`make-mod lens-mod kind-${item.kind} type-${item.type} ${selected ? 'is-selected' : ''} ${hot.has(item.id) ? 'is-hot' : ''} ${dim ? 'is-dim' : ''}`}
              data-entity={item.id}
              data-plane="lens"
              data-lens-item={item.kind}
              aria-label={item.label}
              onClick={(event) => {
                event.stopPropagation()
                onSelect(item.id)
              }}
            >
              <Node3D type={item.kind === 'role' ? 'Role' : item.kind === 'actor' ? 'ExternalActor' : item.type}>
                <LensGlyph item={item} glyph={glyph} />
              </Node3D>
            </button>
            {showLabel && <span className="make-pill lens-pill">{item.label}</span>}
          </div>
        )
      })}
    </>
  )
}

/**
 * Boundary / zone labels in a screen-space layer above frames, nodes, and arcs, like the board
 * folder tags, so a tilted frame or a standing node never covers them.
 */
export function LensFrameTags({
  frames,
  anchors,
  selectedId,
  zoom = 1,
}: {
  frames: LensFrame[]
  anchors: Map<string, { x: number; y: number }>
  selectedId: string | null
  /** Grid zoom. Tags shrink with it (down to 70%) so a zoomed-out floor stays legible. */
  zoom?: number
}) {
  const scale = Math.min(1, Math.max(0.7, zoom + 0.15))
  return (
    <div className="make-board-tags lens-frame-tags" aria-hidden="true" style={{ ['--tag-scale' as string]: scale.toFixed(2) }}>
      {frames.map((frame) => {
        const a = anchors.get(frame.id)
        if (!a) return null
        return (
          <span
            key={frame.id}
            className={`lens-frame-tag kind-${frame.kind} ${frame.dashed ? 'is-dashed' : ''} ${frame.id === selectedId ? 'is-focus' : ''}`}
            data-frame-tag={frame.id}
            style={{ left: a.x, top: a.y }}
          >
            <em>{KIND_TAG[frame.kind] ?? frame.kind}</em>
            {frame.label}
          </span>
        )
      })}
    </div>
  )
}
