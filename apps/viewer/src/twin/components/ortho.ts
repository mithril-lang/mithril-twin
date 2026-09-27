/** Axis-aligned connector, in the spirit of a bpmn sequence flow. */
export function orthoPath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = x2 - x1
  const dy = y2 - y1
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return `M ${x1} ${y1} L ${x2} ${y2}`
  if (Math.abs(dx) >= Math.abs(dy)) {
    const mx = x1 + dx / 2
    return `M ${x1} ${y1} L ${mx} ${y1} L ${mx} ${y2} L ${x2} ${y2}`
  }
  const my = y1 + dy / 2
  return `M ${x1} ${y1} L ${x1} ${my} L ${x2} ${my} L ${x2} ${y2}`
}
