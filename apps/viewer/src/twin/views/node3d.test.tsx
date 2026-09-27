import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { iconKind, Node3D, nodeShapeOf } from './node3d'

describe('grid node 3D look', () => {
  it('maps entity types to one shape per kind', () => {
    expect(iconKind('HoldingCompany')).toBe('org')
    expect(nodeShapeOf('HoldingCompany')).toBe('hex-prism')
    expect(nodeShapeOf('CorpVLAN')).toBe('puck')
    expect(nodeShapeOf('Firewall')).toBe('tri-prism')
    expect(nodeShapeOf('Server')).toBe('block')
    expect(nodeShapeOf('Workstation')).toBe('tile')
    expect(nodeShapeOf('SomethingNew')).toBe('hex-prism')
    expect(nodeShapeOf('SaaS')).toBe('block')
    expect(nodeShapeOf('Person')).toBe('post')
    expect(nodeShapeOf('Role')).toBe('diamond')
    expect(nodeShapeOf('ExternalActor')).toBe('pent-prism')
  })

  it('draws top face, side faces, and the glyph', () => {
    const { container } = render(
      <svg>
        <Node3D type="Firewall">
          <circle data-glyph r="1" />
        </Node3D>
      </svg>,
    )
    const node = container.querySelector('.make-node3d')
    expect(node?.getAttribute('data-shape')).toBe('tri-prism')
    // lower face + 3 side faces + top face + rim
    expect(node?.querySelectorAll('polygon')).toHaveLength(6)
    expect(node?.querySelector('[data-glyph]')).toBeTruthy()
  })
})
