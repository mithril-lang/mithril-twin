import type { Lens } from './lensLayout'
import { blastRadius, impersonationPaths, isUnverified, orgModel, shadowSystems } from './org'
import type { MithDocument, MithGrantLevel } from './types'

export type LensLinkClass =
  | `grant-${MithGrantLevel}`
  | 'holder'
  | 'lateral'
  | 'channel-unverified'
  | 'channel-verified'
  | 'shadow-use'
  | 'grant-network'
  | 'reach-open'
  | 'reach-open-crown'
  | 'reach-conditional'

export type LensLink = {
  id: string
  from: string
  to: string
  cls: LensLinkClass
  label?: string
  /** Drawn faint because another selection is in focus. */
  faded?: boolean
}

export type LensFocus = {
  links: LensLink[]
  /** Items to ring as reachable / on-path. */
  hot: Set<string>
}

function controlsLabel(verification: string[]) {
  const real = verification.filter((v) => v !== 'none')
  return real.length ? real.join('+') : 'no verification'
}

/** Links and highlights for one lens and the current selection. Display only. */
export function lensFocus(doc: MithDocument, lens: Lens, selectedId: string | null): LensFocus {
  const { roles, grants, channels } = orgModel(doc)
  const roleIds = new Set(roles.map((r) => r.id))
  const links: LensLink[] = []
  const hot = new Set<string>()

  if (lens === 'access') {
    if (selectedId && roleIds.has(selectedId)) {
      const radius = blastRadius(doc, selectedId)
      const role = roles.find((r) => r.id === selectedId)!
      for (const h of role.holders) links.push({ id: `holder:${h}:${role.id}`, from: h, to: role.id, cls: 'holder' })
      const lateralSeen = new Set<string>()
      for (const reached of radius.resources) {
        hot.add(reached.resource)
        const holder = reached.via[reached.via.length - 1]!
        links.push({
          id: `reach:${holder}:${reached.resource}`,
          from: holder,
          to: reached.resource,
          cls: reached.level === 'network' ? 'grant-network' : `grant-${reached.level}`,
          label: reached.level === 'network' ? 'network · no grant' : reached.level,
        })
        for (let i = 0; i < reached.via.length - 1; i++) {
          const key = `${reached.via[i]}>${reached.via[i + 1]}`
          if (lateralSeen.has(key)) continue
          lateralSeen.add(key)
          hot.add(reached.via[i + 1]!)
          links.push({ id: `lateral:${key}`, from: reached.via[i]!, to: reached.via[i + 1]!, cls: 'lateral', label: `cost ≤ ${reached.cost}` })
        }
      }
    } else {
      // A selected resource narrows to the roles that hold it; any other selection leaves every grant lit.
      const narrow = !!selectedId && grants.some((g) => g.resource === selectedId)
      for (const g of grants) {
        const faded = narrow && g.resource !== selectedId
        if (!faded && selectedId) hot.add(g.role)
        links.push({ id: `grant:${g.id}`, from: g.role, to: g.resource, cls: `grant-${g.level}`, faded })
      }
    }
  }

  if (lens === 'impersonation') {
    const onPath = new Set<string>()
    let narrow = false
    if (selectedId) {
      for (const p of impersonationPaths(doc)) {
        if (!p.nodes.includes(selectedId)) continue
        narrow = true
        p.channels.forEach((c) => onPath.add(c))
        p.nodes.forEach((n) => hot.add(n))
      }
    }
    for (const c of channels) {
      const unverified = isUnverified(c)
      const onSelectedPath = narrow && onPath.has(c.id)
      links.push({
        id: `channel:${c.id}`,
        from: c.from,
        to: c.to,
        cls: unverified ? 'channel-unverified' : 'channel-verified',
        // Red hops are always labelled; verified hops only when they sit on a selected path.
        ...(unverified || onSelectedPath ? { label: `${c.kind} · ${controlsLabel(c.verification)}` } : {}),
        faded: narrow && !onSelectedPath,
      })
    }
  }

  if (lens === 'network') {
    const crown = crownJewelZones(doc)
    const narrow = !!selectedId && (doc.model.reach ?? []).some((r) => r.from === selectedId || r.to === selectedId)
    for (const r of doc.model.reach ?? []) {
      if (r.kind === 'blocked') continue
      const focus = !narrow || r.from === selectedId || r.to === selectedId
      if (focus && narrow) { hot.add(r.from); hot.add(r.to) }
      const cls: LensLinkClass = r.kind === 'open' ? (crown.has(r.to) ? 'reach-open-crown' : 'reach-open') : 'reach-conditional'
      links.push({
        id: `reach:${r.id}`,
        from: r.from,
        to: r.to,
        cls,
        // Open reach into a crown-jewel zone is always labelled.
        ...(cls === 'reach-open-crown' || (narrow && focus) ? { label: `${r.kind}${crown.has(r.to) ? ' → crown-jewel zone' : ''}` } : {}),
        faded: narrow && !focus,
      })
    }
  }

  if (lens === 'shadow') {
    const systems = shadowSystems(doc)
    const narrow = !!selectedId && systems.some((s) => s.entity.id === selectedId || s.usedBy.includes(selectedId))
    for (const s of systems) {
      const focus = !narrow || selectedId === s.entity.id || s.usedBy.includes(selectedId!)
      if (focus && narrow) {
        hot.add(s.entity.id)
        s.usedBy.forEach((u) => hot.add(u))
      }
      for (const u of s.usedBy) {
        links.push({ id: `uses:${u}:${s.entity.id}`, from: s.entity.id, to: u, cls: 'shadow-use', label: s.source, faded: !focus })
      }
    }
  }

  return { links, hot }
}

/** Zones that host at least one crown-jewel system. */
export function crownJewelZones(doc: MithDocument): Set<string> {
  const out = new Set<string>()
  for (const e of doc.model.entities) if (e.layer === 'server' && e.zone && e.criticality === 'crown-jewel') out.add(e.zone)
  return out
}
