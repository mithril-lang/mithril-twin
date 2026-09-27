import type { ThemeTokenSet } from './types'
import { enterprise } from './enterprise'

/**
 * Default twin theme. Lilac canvas matches the isometric grid chrome.
 * Node grammar stays the enterprise set so the secondary board can reuse it.
 */
export const make: ThemeTokenSet = {
  ...enterprise,
  id: 'make',
  label: 'Make',
  description: 'Lilac isometric grid — main twin overview',
  canvas: {
    bg: '#e6e0f4',
    grid: 'rgba(109, 74, 255, 0.08)',
    plane: '#ffffff',
    planeBorder: 'rgba(140, 110, 200, 0.45)',
    planeShadow: 'rgba(92, 64, 160, 0.16)',
    text: '#1c1630',
    muted: '#6d6580',
    accent: '#6d4aff',
    panel: '#ffffff',
    panelBorder: 'rgba(120, 96, 180, 0.18)',
    chrome: '#f4f1fb',
    danger: '#dc2626',
    warn: '#d97706',
  },
}
