import { useEffect, useRef } from 'react'
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape'
import type { AttackScenario, GraphItem, SelectMode } from '../data/types'
import { edgeMatchesMode, nodeMatchesMode } from '../data/halo'
import { useTheme } from '../themes/ThemeContext'
import { edgeColor, nodeToken } from '../themes/index'

type GraphElements = { nodes: GraphItem[]; edges: GraphItem[] }
type Props = {
  elements: GraphElements
  selectMode: SelectMode
  onSelect: (element: GraphItem | null) => void
  attackScenario?: AttackScenario | null
}

export default function TopologyGraph({ elements, selectMode, onSelect, attackScenario = null }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const graph = useRef<Core | null>(null)
  const { theme } = useTheme()

  useEffect(() => {
    if (!container.current) return
    graph.current?.destroy()

    const nodes = elements.nodes.map((n) => {
      const d = { ...n.data } as Record<string, unknown>
      const st = nodeToken(theme, String(d.type || ''))
      d._bg = st.color
      d._border = st.border
      d._shape = mapShape(st.shape)
      d._w = st.size.w
      d._h = st.size.h
      d._halo = nodeMatchesMode(selectMode, String(d.type || ''), { scenario: attackScenario, nodeId: String(d.id || '') })
      return { data: d }
    })
    const edges = elements.edges.map((e) => {
      const d = { ...e.data } as Record<string, unknown>
      const kind = String(d.kind || '')
      d._line = edgeColor(theme, kind)
      d._kindShort = kind.length > 12 ? kind.slice(0, 10) + '…' : kind
      d._halo = edgeMatchesMode(selectMode, kind, { scenario: attackScenario, source: String(d.source || ''), target: String(d.target || '') })
      return { data: d }
    })

    const cy = cytoscape({
      container: container.current,
      elements: [...nodes, ...edges] as ElementDefinition[],
        layout: {
        name: 'cose',
        animate: false,
        fit: true,
        padding: 56,
        nodeRepulsion: () => 18000,
        idealEdgeLength: () => 96,
      },
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(_bg)',
            'border-color': 'data(_border)',
            'border-width': 2,
            shape: 'data(_shape)' as unknown as 'ellipse',
            width: 'data(_w)',
            height: 'data(_h)',
            label: 'data(label)',
            color: theme.canvas.text,
            'font-size': 12,
            'text-wrap': 'wrap',
            'text-max-width': 120,
            'text-valign': 'bottom',
            'text-margin-y': 8,
            'text-outline-width': 2,
            'text-outline-color': theme.canvas.bg,
            'overlay-opacity': 0,
          },
        },
        {
          selector: 'node[_halo]',
          style: {
            'border-width': 5,
            'border-color': theme.halos[selectMode].replace(/[\d.]+\)$/, '1)'),
            'background-opacity': 1,
          },
        },
        {
          selector: 'edge',
          style: {
            width: 1.6,
            'line-color': 'data(_line)',
            'target-arrow-color': 'data(_line)',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            label: 'data(_kindShort)',
            color: theme.canvas.muted,
            'font-size': 10,
            'text-rotation': 'none',
            'text-background-color': theme.canvas.chrome,
            'text-background-opacity': 0.85,
            'text-background-padding': 2,
          },
        },
        {
          selector: 'edge[_halo]',
          style: {
            width: 3.2,
            'line-color': theme.canvas.accent,
            'target-arrow-color': theme.canvas.accent,
            'line-style': 'solid',
          },
        },
        {
          selector: ':selected',
          style: {
            'border-color': '#ffffff',
            'border-width': 4,
            'line-color': theme.canvas.accent,
            'target-arrow-color': theme.canvas.accent,
            color: theme.canvas.text,
          },
        },
      ] as unknown as cytoscape.StylesheetJson,
    })

    // Boolean data attrs: cytoscape treats truthy string; set filter via data
    cy.nodes().forEach((n) => {
      if (!n.data('_halo')) n.removeData('_halo')
    })
    cy.edges().forEach((e) => {
      if (!e.data('_halo')) e.removeData('_halo')
    })

    cy.on('tap', 'node, edge', (event) => {
      onSelect({ data: event.target.data() as Record<string, string> })
    })
    cy.on('tap', (event) => {
      if (event.target === cy) onSelect(null)
    })
    graph.current = cy
    return () => {
      cy.destroy()
      graph.current = null
    }
  }, [elements, onSelect, theme, selectMode, attackScenario])

  return <div ref={container} className="graph" aria-label="Cytoscape topology graph" />
}

/** Map theme shapes to Cytoscape-supported shapes. All are flat. */
function mapShape(shape: string): string {
  if (shape === 'tag') return 'tag'
  return shape
}
