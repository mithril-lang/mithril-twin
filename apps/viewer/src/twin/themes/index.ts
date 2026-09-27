import type { ThemeId, ThemeTokenSet, NodeToken } from './types'
import { DEFAULT_NODE } from './types'
import { enterprise } from './enterprise'
import { make } from './make'
import { mithrilDark } from './mithril-dark'
import { polarOps } from './polar-ops'

/** design-system `data-theme` values. Make is the lilac grid; Enterprise is the light flat board. */
export const DATA_THEME: Record<ThemeId, 'light' | 'dark' | 'polar-ops' | 'make'> = {
  make: 'make',
  enterprise: 'light',
  'mithril-dark': 'dark',
  'polar-ops': 'polar-ops',
}

export const THEMES: Record<ThemeId, ThemeTokenSet> = {
  make,
  enterprise,
  'mithril-dark': mithrilDark,
  'polar-ops': polarOps,
}

export const THEME_LIST: ThemeTokenSet[] = Object.values(THEMES)

export function getTheme(id: ThemeId): ThemeTokenSet {
  return THEMES[id] ?? mithrilDark
}

export function nodeToken(theme: ThemeTokenSet, type: string | undefined): NodeToken {
  if (!type) return DEFAULT_NODE
  return theme.nodes[type] ?? DEFAULT_NODE
}

export function edgeColor(theme: ThemeTokenSet, kind: string | undefined): string {
  if (!kind) return theme.canvas.muted
  return theme.edges[kind] ?? theme.canvas.muted
}

/** Push design-system `data-theme` plus canvas mirrors used by the graph renderer. */
export function applyThemeToDom(theme: ThemeTokenSet) {
  const root = document.documentElement
  const dataTheme = DATA_THEME[theme.id as ThemeId] ?? 'light'
  root.setAttribute('data-theme', dataTheme)
  const c = theme.canvas
  const map: Record<string, string> = {
    '--tw-bg': c.bg,
    '--tw-grid': c.grid,
    '--tw-plane': c.plane,
    '--tw-plane-border': c.planeBorder,
    '--tw-plane-shadow': c.planeShadow,
    '--tw-text': c.text,
    '--tw-muted': c.muted,
    '--tw-accent': c.accent,
    '--tw-panel': c.panel,
    '--tw-panel-border': c.panelBorder,
    '--tw-chrome': c.chrome,
    '--tw-danger': c.danger,
    '--tw-warn': c.warn,
    '--tw-halo-explore': theme.halos.explore,
    '--tw-halo-trust': theme.halos.trustBoundary,
    '--tw-halo-traffic': theme.halos.traffic,
    '--tw-halo-compute': theme.halos.compute,
    '--tw-halo-attack': theme.halos.attackPath,
  }
  for (const [k, v] of Object.entries(map)) root.style.setProperty(k, v)
}

export type { ThemeId, ThemeTokenSet, NodeToken, HaloMode, CanvasTokens, NodeShape } from './types'
export { DEFAULT_NODE } from './types'
