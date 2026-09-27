/** Flat 2D symbol families for twin types (org / network / firewall / node / server). */
export type TwinSymbol = 'org' | 'network' | 'firewall' | 'node' | 'server' | 'person' | 'process' | 'alert'

const NETWORK = new Set(['transit', 'vlan', 'dmz', 'edge', 'device'])
const FIREWALL = new Set(['fw', 'guard'])
const SERVER = new Set(['server'])
const NODE = new Set(['cloud', 'ws', 'cluster'])
const PERSON = new Set(['person', 'role'])
const PROCESS = new Set(['process'])
const ALERT = new Set(['attack', 'tech', 'entry'])

export function twinSymbol(iconKey?: string): TwinSymbol {
  const key = iconKey || ''
  if (NETWORK.has(key)) return 'network'
  if (FIREWALL.has(key)) return 'firewall'
  if (SERVER.has(key)) return 'server'
  if (NODE.has(key)) return 'node'
  if (PERSON.has(key)) return 'person'
  if (PROCESS.has(key)) return 'process'
  if (ALERT.has(key)) return 'alert'
  return 'org'
}
