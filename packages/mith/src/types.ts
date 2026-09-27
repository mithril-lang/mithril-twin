import type { TwinLayer } from './layers'

/** BPMN-analog sections of a .mith document. v0 is JSON, not XML DI. */
export const MITH_VERSION = '0.1' as const

export type MithCitation = {
  source: string
  note?: string
}

export type MithEntity = {
  id: string
  label: string
  type: string
  /** Ontology layer this entity belongs to (org / network / firewall / node / server). */
  layer: TwinLayer | string
  citations: MithCitation[]
  attrs: Record<string, string>
  /** Org dimension: id of the `model.boundaries` entry this person / asset belongs to. */
  boundary?: string
  /** Network dimension: id of a network-layer entity (VLAN, DMZ, transit…) this object sits in. */
  zone?: string
  /** Systems / SaaS only. `false` marks shadow IT. Omitted means sanctioned. */
  sanctioned?: boolean
  /** How an unsanctioned system was found: `sso-missing`, `oauth-grant`, `expense`, … */
  source?: string
  /** Systems / resources: business criticality. Drives high-value and exposure scores. */
  criticality?: MithCriticality
  /** Devices (node layer) only: installed software. Synthetic inventory, not a scan. */
  software?: MithSoftware[]
  /** Devices only: log sources, forwarding, retention, and a few synthetic sample events. */
  logs?: MithDeviceLogs
  /** Devices only: people who use the device. `attrs.owner`, when set, is the primary user. */
  users?: MithDeviceUser[]
}

export const VULN_SEVERITIES = ['none', 'low', 'medium', 'high', 'critical'] as const
export type MithVulnSeverity = (typeof VULN_SEVERITIES)[number]

/** One installed package on a device. `sanctioned` defaults to true; `vulnerability` to none. */
export type MithSoftware = {
  name: string
  version: string
  vendor?: string
  sanctioned?: boolean
  /** Vendor end-of-life: no more security fixes. */
  eol?: boolean
  /** Worst known unpatched vulnerability severity for this version. */
  vulnerability?: MithVulnSeverity
}

export const LOG_SOURCES = ['edr', 'os-auth', 'process', 'network', 'saas-audit'] as const
export type MithLogSource = (typeof LOG_SOURCES)[number]
export const LOG_SEVERITIES = ['info', 'low', 'medium', 'high'] as const
export type MithLogSeverity = (typeof LOG_SEVERITIES)[number]

/** A synthetic sample event. Illustrative only: never real telemetry. */
export type MithLogEvent = {
  at: string
  source: MithLogSource
  action: string
  severity?: MithLogSeverity
  /** Person id the event is attributed to. */
  user?: string
  note?: string
}

/** Device logging. `forwardTo` is a destination such as `siem`, or `none` (kept on the device only). */
export type MithDeviceLogs = {
  sources: MithLogSource[]
  forwardTo: string
  retentionDays: number
  events?: MithLogEvent[]
}

export const DEVICE_USER_RELATIONS = ['primary', 'user', 'admin'] as const
export type MithDeviceRelation = (typeof DEVICE_USER_RELATIONS)[number]
export type MithDeviceUser = { person: string; relation: MithDeviceRelation }

export const CRITICALITIES = ['low', 'medium', 'high', 'crown-jewel'] as const
export type MithCriticality = (typeof CRITICALITIES)[number]

export type MithEdge = {
  id: string
  source: string
  target: string
  kind: string
}

export const BOUNDARY_KINDS = ['company', 'subsidiary', 'department', 'team'] as const
export type MithBoundaryKind = (typeof BOUNDARY_KINDS)[number]

/** Organizational boundary. Separate from network zones. `parent` nests company > department > team. */
export type MithBoundary = {
  id: string
  label: string
  kind: MithBoundaryKind
  parent?: string
}

/** Job title / position inside one boundary. `holders` are person entity ids. */
export type MithRole = {
  id: string
  label: string
  boundary: string
  holders: string[]
  /**
   * Network dimension for the role's holders: the zone their devices sit in. Optional.
   * When absent, the analysis derives it from the holders' `zone` (person entities).
   * The enterprise index sets it directly because holders live in per-company chunks.
   */
  zone?: string
}

export const GRANT_LEVELS = ['read', 'approve', 'admin'] as const
export type MithGrantLevel = (typeof GRANT_LEVELS)[number]

/** Access right: role → system / resource entity at one level. */
export type MithGrant = {
  id: string
  role: string
  resource: string
  level: MithGrantLevel
}

/** External party that can only reach the org through channels. Synthetic, never a real sender. */
export type MithActor = {
  id: string
  label: string
  kind: 'external'
}

export const VERIFICATION_CONTROLS = ['callback', 'mfa', 'dual-approval', 'none'] as const
export type MithVerification = (typeof VERIFICATION_CONTROLS)[number]

/**
 * A request path into a role: email, phone, helpdesk, chat, vendor-portal, …
 * `from` is an actor or a role; `to` is a role. `verification` lists the controls on that hop.
 */
export type MithChannel = {
  id: string
  kind: string
  from: string
  to: string
  verification: MithVerification[]
}

export const REACH_KINDS = ['open', 'conditional', 'blocked'] as const
export type MithReachKind = (typeof REACH_KINDS)[number]

/**
 * Directed network reach from one zone to another. `kind` sets the default bypass difficulty
 * (open lightest, conditional heavier, blocked impassable). `weight` overrides the default for
 * this edge. Reach is between network-layer entities (zones); it never enters a role.
 */
export type MithReach = {
  id: string
  from: string
  to: string
  kind: MithReachKind
  weight?: number
  /** Admin path through a jump host / bastion. Costs `weights.jumpHost` (default 2) unless `weight` is set. */
  jumpHost?: boolean
}

/**
 * Optional per-document weight overrides for the attack-graph analysis. Every field is optional;
 * missing values fall back to the tunable defaults in `mith/exposure.ts`.
 */
export type MithWeights = {
  /** Base cost added to every hop before controls. */
  base?: number
  /** Per-control cost added to a channel hop. */
  controls?: Partial<Record<MithVerification, number>>
  /** Per-kind cost for a zone→zone reach hop. `blocked` stays impassable unless set finite. */
  reach?: Partial<Record<MithReachKind, number>>
  /** Cost to pivot from an impersonated identity onto its device's zone. */
  pivot?: number
  /** Cost to reach a system hosted in a zone you already stand in. */
  host?: number
  /**
   * Blast radius: max total cost from the impersonated role for a resource to count as reached.
   * Also the cut-off for counting a shadow-SaaS entry path to a crown jewel as a finding.
   */
  blastRadius?: number
  /** Value factor for a system reached over the network without a grant, 0–1 (default 0.6). */
  networkValue?: number
  /** Cost of a reach edge marked `jumpHost` (default 2). */
  jumpHost?: number
  /** Shadow-SaaS sync cost into users' zones: `open` for oauth-grant, `conditional` otherwise. Defaults follow `reach`. */
  sync?: { open?: number; conditional?: number }
  /** Tile heat: share of hot roles at which a tile is fully red, in (0, 1] (default 0.25). */
  heatSaturation?: number
  /**
   * Device compromise ease from software, each in [0, 1]. Ease = min(maxEase, eol + unsanctioned +
   * vulnerability[worst]); the role → device pivot costs `pivot × (1 − ease)`.
   */
  device?: {
    eol?: number
    unsanctioned?: number
    vulnerability?: Partial<Record<Exclude<MithVulnSeverity, 'none'>, number>>
    maxEase?: number
  }
  /** Forwarded logs kept fewer days than this count as a coverage gap (default 30, 1–3650). */
  minRetentionDays?: number
}

/** Where one entity sits on one plane. The same entity may be placed on several planes (shared object). */
export type MithPlacement = {
  entity: string
  /** 0–1 across the plane, origin top-left. */
  x: number
  y: number
  tone?: 'quiet' | 'accent' | 'info'
  showLabel?: boolean
}

export type MithArrangement = 'coplanar' | 'stacked'

/** Lenses the grid can restore from `diagram.lens`. Absent on older files. */
export const DIAGRAM_LENSES = ['layers', 'org', 'network', 'access', 'impersonation', 'shadow'] as const
export type DiagramLens = (typeof DIAGRAM_LENSES)[number]

/** Frame dimension for Access, Impersonation, and Shadow IT. Absent means org. */
export const DIAGRAM_FRAMES = ['org', 'network'] as const
export type DiagramFrame = (typeof DIAGRAM_FRAMES)[number]

export type MithPlaneTransform = {
  /** Floor position. Coplanar boards share `z` and differ in `x`/`y`. */
  x: number
  y: number
  /**
   * Floor height. Coplanar boards share one z.
   * Stacked layers use a distinct z per plane.
   */
  z: number
  tilt: number
  yaw: number
}

export type MithPlane = {
  id: string
  layer: TwinLayer | string
  label: string
  transform: MithPlaneTransform
  placements: MithPlacement[]
}

export type MithCrossLink = {
  id: string
  from: string
  to: string
  kind: string
}

export type MithCamera = {
  mode: 'iso' | 'ortho'
  tilt: number
  yaw: number
  zoom: number
  focusPlane: string
}

export type MithHypothesisStep = {
  from: string
  to: string
  kind: string
}

/** Viz-only hypothesis. relative_score is an illustrative rank, not a detection. */
export type MithHypothesis = {
  id: string
  label: string
  summary: string
  category: string
  honesty: 'hypothesis'
  observation_count: number
  relative_score: number
  score_note: string
  node_ids: string[]
  steps: MithHypothesisStep[]
}

/**
 * .mith v0 — one editable document.
 * model ≈ BPMN semantics, diagram ≈ BPMN DI, inference ≈ hypothesis overlay.
 */
export type MithDocument = {
  mith: typeof MITH_VERSION
  kind: 'document'
  id: string
  title: string
  /**
   * Label the file declares. Committed samples and the generated pack use `synthetic-demo`.
   * Import keeps any other declared label and export writes it back unchanged.
   */
  dataset_kind: string
  generated_at: string
  disclaimer: string
  model: {
    citations: MithCitation[]
    entities: MithEntity[]
    edges: MithEdge[]
    /**
     * Org / access / impersonation sections. Optional: a document without them parses exactly
     * as before and the keys stay absent on the parsed result.
     */
    boundaries?: MithBoundary[]
    roles?: MithRole[]
    grants?: MithGrant[]
    actors?: MithActor[]
    channels?: MithChannel[]
    /** Zone→zone network reach edges (network dimension of the attack graph). */
    reach?: MithReach[]
    /** Per-document overrides for the attack-graph weights. */
    weights?: MithWeights
  }
  diagram: {
    /**
     * `coplanar` (default): boards sit on one isometric floor.
     * `stacked`: optional vertical stair of layers.
     */
    arrangement: MithArrangement
    camera: MithCamera
    selection: string | null
    planes: MithPlane[]
    crossLinks: MithCrossLink[]
    /** Active lens. Omitted on files from before this field; the grid then uses its default. */
    lens?: DiagramLens
    /** Frame dimension for Access, Impersonation, and Shadow IT. Omitted means org frames. */
    frame?: DiagramFrame
  }
  inference: {
    viz_only: true
    no_runners: true
    hypotheses: MithHypothesis[]
  }
}

/** .mithril v0 stub: a manifest that names member documents. Zip bundling is later. */
export type MithrilPackage = {
  mithril: typeof MITH_VERSION
  kind: 'package'
  id: string
  /** Same rule as a document: the package keeps the label it declares. */
  dataset_kind: string
  documents: string[]
  attachments: string[]
  note?: string
}
