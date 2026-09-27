import type { NodeShape, NodeToken } from './types'

type Spec = [color: string, border: string, shape: NodeShape, w?: number, h?: number, iconKey?: string]

export function n(
  color: string,
  border: string,
  shape: NodeShape,
  w = 28,
  h = 28,
  iconKey?: string,
): NodeToken {
  return { color, border, shape, size: { w, h }, ...(iconKey ? { iconKey } : {}) }
}

/** Compact builder: record of Spec tuples → NodeToken map. */
export function fromSpecs(specs: Record<string, Spec>): Record<string, NodeToken> {
  const out: Record<string, NodeToken> = {}
  for (const [k, s] of Object.entries(specs)) {
    out[k] = n(s[0], s[1], s[2], s[3] ?? 28, s[4] ?? 28, s[5])
  }
  return out
}
