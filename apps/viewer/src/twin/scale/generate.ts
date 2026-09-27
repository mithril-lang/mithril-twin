import type {
  MithActor,
  MithBoundary,
  MithChannel,
  MithCriticality,
  MithEdge,
  MithEntity,
  MithGrant,
  MithGrantLevel,
  MithRole,
  MithVerification,
} from '../mith/types'
import { PACK_VERSION, type PackChunk, type PackCompany, type PackManifest } from './pack'

/**
 * Deterministic, seeded generator for the enterprise-scale 北極星 (Polaris) group.
 * EVERYTHING it emits is synthetic: company names, people, devices, systems, roles, channels.
 * Same seed → byte-identical output. No network, no clock, no randomness outside the seed.
 */

export const ENTERPRISE_SEED = 20260927
export const GENERATOR = { name: 'polaris-enterprise', version: 1 }
export const TARGETS = {
  subsidiaries: 300,
  departments: 2000,
  employees: 50_000,
  devices: 70_000,
  systems: 1500,
  unsanctioned: 150,
  groupSystems: 30,
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Rng = () => number
const pick = <T>(r: Rng, list: readonly T[]): T => list[Math.floor(r() * list.length)]!
const pad = (n: number, w = 3) => String(n).padStart(w, '0')

// Sector: [key, label, count, base headcount]
const SECTORS: [string, string, number, number][] = [
  ['bank', 'Bank', 10, 3000],
  ['regional', 'Regional Bank', 22, 800],
  ['trust', 'Trust', 8, 600],
  ['securities', 'Securities', 16, 700],
  ['card', 'Card', 12, 600],
  ['payments', 'Payments', 18, 300],
  ['leasing', 'Leasing', 20, 200],
  ['insurance', 'Insurance', 16, 700],
  ['asset', 'Asset Management', 20, 150],
  ['it', 'IT Services', 24, 400],
  ['ops', 'Shared Operations', 16, 500],
  ['realestate', 'Real Estate', 18, 120],
  ['overseas', 'Overseas', 44, 150],
  ['ventures', 'Ventures', 56, 40],
]
const REGIONS = [
  'Tokyo', 'Osaka', 'Nagoya', 'Fukuoka', 'Sapporo', 'Sendai', 'Hiroshima', 'Kobe', 'Yokohama', 'Kyoto',
  'Niigata', 'Okayama', 'Kumamoto', 'Kanazawa', 'Shizuoka', 'Chiba', 'Saitama', 'Naha', 'Matsuyama', 'Takamatsu',
]
const OVERSEAS = ['Singapore', 'London', 'New York', 'Hong Kong', 'Sydney', 'Frankfurt', 'Bangkok', 'Jakarta', 'Shanghai', 'Seoul', 'Mumbai', 'Toronto']

type RoleTpl = [key: string, label: string]
const DEPT: Record<string, { label: string; roles: RoleTpl[] }> = {
  exec: { label: 'Executive Office', roles: [['exec', 'Executive'], ['ea', 'Executive assistant']] },
  finance: { label: 'Finance', roles: [['controller', 'Finance controller'], ['ap', 'AP clerk']] },
  treasury: { label: 'Treasury', roles: [['treasury-clerk', 'Treasury clerk'], ['treasury-approver', 'Treasury approver']] },
  payments: { label: 'Payments Operations', roles: [['pay-op', 'Payments operator'], ['pay-approver', 'Payments approver']] },
  it: { label: 'IT', roles: [['servicedesk', 'Service desk agent'], ['it-admin', 'IT admin']] },
  security: { label: 'Information Security', roles: [['soc', 'SOC analyst'], ['iam-admin', 'IAM admin']] },
  hr: { label: 'Human Resources', roles: [['hr', 'HR partner'], ['payroll', 'Payroll admin']] },
  sales: { label: 'Sales', roles: [['rm', 'Relationship manager'], ['sales-asst', 'Sales assistant']] },
  cs: { label: 'Customer Service', roles: [['cs-agent', 'Contact center agent'], ['cs-lead', 'Contact center lead']] },
  ops: { label: 'Operations', roles: [['ops-clerk', 'Operations clerk'], ['ops-lead', 'Operations supervisor']] },
  compliance: { label: 'Compliance', roles: [['compliance', 'Compliance officer']] },
  legal: { label: 'Legal', roles: [['counsel', 'Counsel']] },
  risk: { label: 'Risk Management', roles: [['risk', 'Risk analyst']] },
  procurement: { label: 'Procurement', roles: [['buyer', 'Buyer'], ['proc-approver', 'Procurement approver']] },
  marketing: { label: 'Marketing', roles: [['marketing', 'Marketing manager']] },
  audit: { label: 'Internal Audit', roles: [['auditor', 'Internal auditor']] },
  trading: { label: 'Trading', roles: [['trader', 'Trader'], ['trade-ops', 'Trade settlement']] },
  underwriting: { label: 'Underwriting', roles: [['underwriter', 'Underwriter']] },
  claims: { label: 'Claims', roles: [['claims', 'Claims handler'], ['claims-approver', 'Claims approver']] },
  lending: { label: 'Lending', roles: [['loan-officer', 'Loan officer'], ['credit-approver', 'Credit approver']] },
  dev: { label: 'Engineering', roles: [['engineer', 'Software engineer'], ['sre', 'SRE']] },
  branch: { label: 'Branch Operations', roles: [['teller', 'Branch teller'], ['branch-mgr', 'Branch manager']] },
}
const BASE_DEPTS = ['exec', 'finance', 'it']
const SECTOR_DEPTS: Record<string, string[]> = {
  bank: ['treasury', 'payments', 'security', 'lending', 'cs', 'ops', 'hr', 'compliance', 'risk', 'legal', 'audit', 'procurement', 'sales', 'marketing', 'dev', 'trading'],
  regional: ['treasury', 'payments', 'lending', 'cs', 'ops', 'hr', 'compliance', 'risk', 'security', 'audit', 'sales', 'legal'],
  trust: ['treasury', 'ops', 'compliance', 'sales', 'hr', 'risk', 'legal', 'security', 'audit'],
  securities: ['trading', 'treasury', 'ops', 'compliance', 'sales', 'risk', 'hr', 'dev', 'security', 'legal', 'audit'],
  card: ['payments', 'cs', 'ops', 'treasury', 'risk', 'compliance', 'marketing', 'dev', 'security', 'hr', 'sales'],
  payments: ['payments', 'ops', 'treasury', 'dev', 'compliance', 'cs', 'security', 'risk', 'sales'],
  leasing: ['lending', 'sales', 'ops', 'treasury', 'hr', 'compliance', 'legal'],
  insurance: ['underwriting', 'claims', 'cs', 'sales', 'ops', 'treasury', 'compliance', 'risk', 'hr', 'dev', 'security', 'legal', 'audit'],
  asset: ['trading', 'ops', 'sales', 'compliance', 'risk', 'treasury'],
  it: ['dev', 'security', 'ops', 'hr', 'procurement', 'sales', 'cs'],
  ops: ['ops', 'cs', 'hr', 'procurement', 'payments', 'treasury', 'security', 'compliance', 'legal', 'audit'],
  realestate: ['sales', 'ops', 'treasury', 'legal'],
  overseas: ['sales', 'treasury', 'ops', 'compliance', 'hr', 'legal'],
  ventures: ['sales', 'dev', 'ops'],
}

// Group-wide systems (always sanctioned).
const GROUP_SYSTEMS: [key: string, label: string, crit: MithCriticality, type: string][] = [
  ['idp', 'Group IdP', 'crown-jewel', 'System'],
  ['erp', 'Group ERP', 'high', 'System'],
  ['mail', 'Group Mail', 'medium', 'SaaS'],
  ['hris', 'Group HRIS', 'high', 'SaaS'],
  ['payroll', 'Group Payroll', 'high', 'SaaS'],
  ['payhub', 'Group Payments Hub', 'crown-jewel', 'System'],
  ['swift', 'SWIFT Gateway', 'crown-jewel', 'System'],
  ['tms', 'Group Treasury Mgmt', 'crown-jewel', 'System'],
  ['itsm', 'Group ITSM', 'medium', 'SaaS'],
  ['siem', 'Group SIEM', 'high', 'System'],
  ['lake', 'Group Data Lake', 'high', 'System'],
  ['crm', 'Group CRM', 'medium', 'SaaS'],
  ['wiki', 'Group Wiki', 'low', 'SaaS'],
  ['files', 'Group File Share', 'medium', 'SaaS'],
  ['chat', 'Group Chat', 'medium', 'SaaS'],
  ['expense', 'Group Expense', 'medium', 'SaaS'],
  ['procure', 'Group Procurement', 'high', 'SaaS'],
  ['pam', 'Group PAM Vault', 'crown-jewel', 'System'],
  ['backup', 'Group Backup', 'high', 'System'],
  ['mdm', 'Group MDM', 'high', 'SaaS'],
  ['repo', 'Group Code Repo', 'high', 'SaaS'],
  ['cicd', 'Group CI/CD', 'high', 'System'],
  ['grc', 'Group GRC', 'medium', 'SaaS'],
  ['contracts', 'Group Contract Mgmt', 'medium', 'SaaS'],
  ['bi', 'Group BI', 'medium', 'SaaS'],
  ['video', 'Group Video Conf', 'low', 'SaaS'],
  ['esign', 'Group e-Sign', 'medium', 'SaaS'],
  ['vendorportal', 'Group Vendor Portal', 'high', 'SaaS'],
  ['cardswitch', 'Group Card Switch', 'crown-jewel', 'System'],
  ['ledger', 'Group Core Ledger', 'crown-jewel', 'System'],
]

// Local systems by tag. Order = priority per sector.
const LOCAL: Record<string, [label: string, crit: MithCriticality | null]> = {
  accounting: ['Local Accounting', 'high'],
  bankportal: ['Bank Portal', 'crown-jewel'],
  directory: ['Local Directory', 'high'],
  core: ['Core Banking', 'crown-jewel'],
  online: ['Online Banking', 'crown-jewel'],
  los: ['Loan Origination', 'high'],
  teller: ['Branch Teller', 'high'],
  aml: ['AML Monitoring', 'high'],
  trading: ['Trading Platform', 'crown-jewel'],
  settlement: ['Settlement System', 'crown-jewel'],
  policy: ['Policy Admin', 'high'],
  claims: ['Claims System', 'high'],
  cardproc: ['Card Processing', 'crown-jewel'],
  gateway: ['Payment Gateway', 'crown-jewel'],
  crm: ['Local CRM', 'medium'],
  files: ['File Server', 'medium'],
  intranet: ['Intranet', 'low'],
  reporting: ['Reporting', 'medium'],
  docs: ['Document Mgmt', 'medium'],
  ticketing: ['Ticketing', 'low'],
  app: ['Line-of-business App', 'medium'],
  legacy: ['Legacy App', null],
}
const SECTOR_LOCAL: Record<string, string[]> = {
  bank: ['accounting', 'bankportal', 'directory', 'core', 'online', 'los', 'teller', 'aml', 'trading', 'settlement', 'crm', 'files', 'reporting', 'docs'],
  regional: ['accounting', 'bankportal', 'core', 'online', 'los', 'teller', 'aml', 'directory', 'crm', 'files'],
  trust: ['accounting', 'bankportal', 'core', 'settlement', 'aml', 'crm', 'files'],
  securities: ['accounting', 'bankportal', 'trading', 'settlement', 'aml', 'directory', 'crm', 'reporting'],
  card: ['accounting', 'bankportal', 'cardproc', 'gateway', 'crm', 'aml', 'directory', 'reporting'],
  payments: ['accounting', 'bankportal', 'gateway', 'aml', 'crm', 'app'],
  leasing: ['accounting', 'bankportal', 'los', 'crm', 'files'],
  insurance: ['accounting', 'bankportal', 'policy', 'claims', 'crm', 'directory', 'reporting', 'docs'],
  asset: ['accounting', 'bankportal', 'trading', 'reporting'],
  it: ['accounting', 'directory', 'app', 'ticketing', 'files'],
  ops: ['accounting', 'bankportal', 'app', 'docs', 'files'],
  realestate: ['accounting', 'bankportal', 'crm'],
  overseas: ['accounting', 'bankportal', 'crm', 'files'],
  ventures: ['accounting', 'app'],
}
const LOCAL_FILL = ['files', 'intranet', 'reporting', 'docs', 'ticketing', 'app', 'legacy', 'crm']

const SHADOW_PREFIX = ['Drift', 'Sign', 'Note', 'Form', 'Chat', 'Pixel', 'Task', 'Share', 'Meet', 'Sheet', 'Clip', 'Vault', 'Flow', 'Snap', 'Doc']
const SHADOW_SUFFIX = ['box', 'quick', 'nest', 'fox', 'pod', 'board', 'tide', 'leaf', 'mint', 'hub']
const SHADOW_SOURCES = ['sso-missing', 'oauth-grant', 'expense']

const ACTORS: [id: string, label: string][] = [
  ['actor:caller', 'Unknown caller (synthetic)'],
  ['actor:email', 'External email sender (synthetic)'],
  ['actor:vendor', 'Look-alike vendor (synthetic)'],
  ['actor:exec', 'Fake executive (synthetic)'],
  ['actor:customer', 'Fake customer (synthetic)'],
  ['actor:itsupport', 'Fake IT support (synthetic)'],
  ['actor:auditor', 'Fake auditor (synthetic)'],
  ['actor:recruiter', 'Fake recruiter (synthetic)'],
]
// role key → [actor, channel kind, probability]
const ENTRY: Record<string, [string, string, number][]> = {
  servicedesk: [['actor:caller', 'phone', 0.95], ['actor:itsupport', 'chat', 0.5]],
  'cs-agent': [['actor:customer', 'phone', 0.95], ['actor:caller', 'phone', 0.5]],
  'cs-lead': [['actor:customer', 'email', 0.4]],
  teller: [['actor:customer', 'counter', 0.8]],
  ap: [['actor:vendor', 'email', 0.9], ['actor:email', 'email', 0.6]],
  buyer: [['actor:vendor', 'email', 0.8]],
  ea: [['actor:exec', 'email', 0.9], ['actor:email', 'email', 0.7]],
  'treasury-clerk': [['actor:exec', 'phone', 0.6]],
  controller: [['actor:exec', 'email', 0.5], ['actor:auditor', 'email', 0.4]],
  hr: [['actor:recruiter', 'email', 0.7], ['actor:email', 'email', 0.4]],
  payroll: [['actor:email', 'email', 0.5]],
  'sales-asst': [['actor:email', 'email', 0.6]],
  rm: [['actor:customer', 'email', 0.6]],
  compliance: [['actor:auditor', 'email', 0.6]],
  'ops-clerk': [['actor:itsupport', 'chat', 0.4]],
}
// role key → target role keys in the same company (request that makes the target act)
const INTERNAL: Record<string, string[]> = {
  ea: ['exec', 'controller', 'treasury-clerk'],
  ap: ['treasury-clerk', 'pay-op'],
  'treasury-clerk': ['treasury-approver'],
  'pay-op': ['pay-approver'],
  servicedesk: ['it-admin', 'iam-admin'],
  'cs-agent': ['ops-clerk', 'cs-lead'],
  'cs-lead': ['ops-lead'],
  'ops-clerk': ['ops-lead', 'pay-op'],
  buyer: ['proc-approver', 'ap'],
  hr: ['payroll'],
  'sales-asst': ['rm'],
  rm: ['credit-approver'],
  'loan-officer': ['credit-approver'],
  teller: ['branch-mgr'],
  controller: ['treasury-approver'],
  'trade-ops': ['pay-op'],
  claims: ['claims-approver'],
  engineer: ['sre'],
  exec: ['treasury-approver'],
}
const APPROVER_KEYS = new Set(['treasury-approver', 'pay-approver', 'credit-approver', 'claims-approver', 'proc-approver', 'branch-mgr', 'exec', 'iam-admin', 'ops-lead'])

type Company = {
  idx: number
  id: string
  key: string
  label: string
  sector: string
  size: number
  maturity: number
  federated: boolean
  depts: Dept[]
  zones: { corp: string; pay?: string; dmz?: string; mgmt?: string }
  local: Map<string, string[]>
}
type Dept = { id: string; kind: string; label: string; people: number; teams: number; roles: MithRole[] }

export type GeneratedPack = {
  manifest: PackManifest
  index: Record<string, unknown>
  chunks: Map<string, PackChunk>
}

export function generateEnterprise(seed = ENTERPRISE_SEED): GeneratedPack {
  const r = mulberry32(seed)
  const boundaries: MithBoundary[] = [{ id: 'b:polaris', label: '北極星 Group (synthetic)', kind: 'company' }]
  const entities: MithEntity[] = []
  const edges: MithEdge[] = []
  const roles: MithRole[] = []
  const grants: MithGrant[] = []
  const channels: MithChannel[] = []
  const actors: MithActor[] = ACTORS.map(([id, label]) => ({ id, label, kind: 'external' }))

  const zone = (id: string, label: string, type: string, extra: Partial<MithEntity> = {}) => {
    entities.push({ id, label, type, layer: 'network', citations: [], attrs: {}, ...extra })
    return id
  }
  zone('net:inet', 'Internet edge', 'InternetEdge')
  zone('net:transit', 'Group transit', 'TransitNetwork')
  zone('net:gdc', 'Group data center', 'CorpVLAN')
  zone('net:mobile', 'Managed mobile (MDM)', 'CorpVLAN')

  // --- Companies and sizes -------------------------------------------------------------
  const companies: Company[] = []
  const sectorSeq: string[] = []
  for (const [key, , count] of SECTORS) for (let i = 0; i < count; i++) sectorSeq.push(key)
  // Company 0 is group shared services (IT sector) and hosts group-level roles.
  sectorSeq.splice(sectorSeq.indexOf('it'), 1)
  sectorSeq.unshift('it')
  const regionUse = new Map<string, number>()
  const rawSize = sectorSeq.map((sector, i) => {
    const base = SECTORS.find((s) => s[0] === sector)![3]
    const noise = Math.exp((r() + r() + r() - 1.5) * 0.9)
    return i === 0 ? 2400 : base * noise
  })
  const rawSum = rawSize.reduce((a, b) => a + b, 0)
  const sizes = rawSize.map((s) => Math.max(8, Math.round((s / rawSum) * TARGETS.employees)))
  let diff = TARGETS.employees - sizes.reduce((a, b) => a + b, 0)
  for (let i = 0; diff !== 0; i = (i + 1) % sizes.length) {
    const step = diff > 0 ? 1 : -1
    if (sizes[i]! + step >= 8) {
      sizes[i]! += step
      diff -= step
    }
  }
  sectorSeq.forEach((sector, i) => {
    const sectorLabel = SECTORS.find((s) => s[0] === sector)![1]
    const region = i === 0 ? 'Group' : sector === 'overseas' ? pick(r, OVERSEAS) : pick(r, REGIONS)
    const base = i === 0 ? '北極星 Group Shared Services' : `北極星 ${sectorLabel} ${region}`
    const seen = (regionUse.get(base) ?? 0) + 1
    regionUse.set(base, seen)
    const key = `s${pad(i + 1)}`
    companies.push({
      idx: i,
      id: `b:${key}`,
      key,
      label: seen > 1 ? `${base} ${seen}` : base,
      sector,
      size: sizes[i]!,
      maturity: i === 0 ? 0.8 : Math.min(1, Math.max(0, r() * 0.8 + (sector === 'bank' || sector === 'trust' ? 0.2 : 0))),
      federated: i === 0 || r() < 0.6,
      depts: [],
      zones: { corp: '' },
      local: new Map(),
    })
  })

  // --- Departments ---------------------------------------------------------------------
  const sqrtSum = companies.reduce((a, c) => a + Math.sqrt(c.size), 0)
  const k = (TARGETS.departments - 2 * companies.length) / sqrtSum
  const deptCounts = companies.map((c) => Math.max(2, Math.min(Math.floor(c.size / 3), Math.round(2 + Math.sqrt(c.size) * k))))
  let dd = TARGETS.departments - deptCounts.reduce((a, b) => a + b, 0)
  for (let i = 0; dd !== 0 && i < 100000; i++) {
    const ci = i % companies.length
    const step = dd > 0 ? 1 : -1
    const next = deptCounts[ci]! + step
    if (next >= 2 && next <= Math.floor(companies[ci]!.size / 3)) {
      deptCounts[ci] = next
      dd -= step
    }
  }

  for (const c of companies) {
    boundaries.push({ id: c.id, label: c.label, kind: 'subsidiary', parent: 'b:polaris' })
    c.zones.corp = zone(`net:${c.key}.corp`, `${c.label} · Corp VLAN`, 'CorpVLAN')
    if (['bank', 'regional', 'trust', 'securities', 'card', 'payments'].includes(c.sector)) {
      c.zones.pay = zone(`net:${c.key}.pay`, `${c.label} · Payments VLAN`, 'CorpVLAN')
    }
    if (c.size > 500) c.zones.dmz = zone(`net:${c.key}.dmz`, `${c.label} · DMZ`, 'DMZ')
    if (c.size > 200) c.zones.mgmt = zone(`net:${c.key}.mgmt`, `${c.label} · Mgmt VLAN`, 'CorpVLAN')

    const nd = deptCounts[c.idx]!
    const kinds = [...BASE_DEPTS, ...SECTOR_DEPTS[c.sector]!]
    const chosen: string[] = []
    for (let i = 0; i < nd; i++) chosen.push(i < kinds.length ? kinds[i]! : 'branch')
    // People per department: weighted, each ≥ 2.
    const w = chosen.map((kind) => (kind === 'exec' ? 0.4 : kind === 'branch' || kind === 'cs' || kind === 'ops' ? 2 : 1) * (0.5 + r()))
    const ws = w.reduce((a, b) => a + b, 0)
    const counts = w.map((x) => Math.max(2, Math.floor((x / ws) * c.size)))
    let rest = c.size - counts.reduce((a, b) => a + b, 0)
    for (let i = 0; rest !== 0; i = (i + 1) % counts.length) {
      const step = rest > 0 ? 1 : -1
      if (counts[i]! + step >= 2) {
        counts[i]! += step
        rest -= step
      }
    }
    let branchN = 0
    chosen.forEach((kind, i) => {
      const id = `${c.id}.d${pad(i + 1, 2)}`
      const label = kind === 'branch' ? `${DEPT.branch!.label} ${pad(++branchN, 2)}` : DEPT[kind]!.label
      boundaries.push({ id, label, kind: 'department', parent: c.id })
      const people = counts[i]!
      const dept: Dept = { id, kind, label, people, teams: Math.max(1, Math.min(10, Math.round(people / 8))), roles: [] }
      for (const [rk, rl] of DEPT[kind]!.roles) {
        const role: MithRole = { id: `role:${id.slice(2)}.${rk}`, label: rl, boundary: id, holders: [] }
        roles.push(role)
        dept.roles.push(role)
      }
      c.depts.push(dept)
    })
  }

  // --- Systems -------------------------------------------------------------------------
  const sys = (id: string, label: string, type: string, extra: Partial<MithEntity>) => {
    entities.push({ id, label, type, layer: 'server', citations: [], attrs: {}, sanctioned: true, ...extra })
    return id
  }
  const group = new Map<string, string>()
  const itDeptOf = (c: Company) => (c.depts.find((d) => d.kind === 'it') ?? c.depts[c.depts.length - 1]!).id
  for (const [key, label, crit, type] of GROUP_SYSTEMS) {
    group.set(key, sys(`sys:g.${key}`, label, type, { criticality: crit, boundary: itDeptOf(companies[0]!), zone: type === 'SaaS' ? 'net:inet' : 'net:gdc' }))
  }
  const localBudget = TARGETS.systems - TARGETS.unsanctioned - GROUP_SYSTEMS.length
  const lsq = companies.reduce((a, c) => a + Math.sqrt(c.size), 0)
  const localCounts = companies.map((c) => Math.max(2, Math.round((Math.sqrt(c.size) / lsq) * localBudget)))
  let ld = localBudget - localCounts.reduce((a, b) => a + b, 0)
  for (let i = 0; ld !== 0; i = (i + 1) % companies.length) {
    const step = ld > 0 ? 1 : -1
    if (localCounts[i]! + step >= 2) {
      localCounts[i]! += step
      ld -= step
    }
  }
  for (const c of companies) {
    const tags = [...SECTOR_LOCAL[c.sector]!]
    const n = localCounts[c.idx]!
    const used = new Map<string, number>()
    for (let i = 0; i < n; i++) {
      const tag = i < tags.length ? tags[i]! : LOCAL_FILL[(i - tags.length) % LOCAL_FILL.length]!
      const nth = (used.get(tag) ?? 0) + 1
      used.set(tag, nth)
      const [label, crit0] = LOCAL[tag]!
      // A few legacy records carry no criticality; the analysis falls back to grant level.
      const crit = crit0 && r() < 0.03 ? null : crit0
      const id = `sys:${c.key}.${tag}${nth > 1 ? nth : ''}`
      const zoneId = tag === 'online' || tag === 'gateway' ? c.zones.dmz ?? c.zones.corp : tag === 'core' || tag === 'cardproc' || tag === 'settlement' || tag === 'bankportal' ? c.zones.pay ?? c.zones.corp : c.zones.corp
      sys(id, `${label}${nth > 1 ? ` ${nth}` : ''} · ${c.key.toUpperCase()}`, tag === 'bankportal' ? 'SaaS' : 'System', {
        boundary: itDeptOf(c),
        zone: zoneId,
        ...(crit ? { criticality: crit } : {}),
      })
      const list = c.local.get(tag) ?? []
      list.push(id)
      c.local.set(tag, list)
    }
  }
  // Shadow IT: unsanctioned SaaS used by departments.
  const allDepts = companies.flatMap((c) => c.depts)
  let edgeN = 0
  for (let i = 0; i < TARGETS.unsanctioned; i++) {
    const name = `${SHADOW_PREFIX[i % SHADOW_PREFIX.length]}${SHADOW_SUFFIX[Math.floor(i / SHADOW_PREFIX.length) % SHADOW_SUFFIX.length]}`
    const id = `sys:x.${pad(i + 1)}`
    const crit: MithCriticality = r() < 0.1 ? 'high' : r() < 0.5 ? 'medium' : 'low'
    entities.push({
      id,
      label: `${name} (synthetic SaaS)`,
      type: 'SaaS',
      layer: 'server',
      citations: [],
      attrs: {},
      sanctioned: false,
      source: pick(r, SHADOW_SOURCES),
      zone: 'net:inet',
      criticality: crit,
    })
    const users = Math.max(1, Math.round(Math.pow(r(), 3) * 40))
    const seen = new Set<string>()
    for (let u = 0; u < users; u++) {
      const d = pick(r, allDepts)
      if (seen.has(d.id)) continue
      seen.add(d.id)
      edges.push({ id: `u:${++edgeN}`, source: d.id, target: id, kind: 'uses' })
    }
  }

  // --- Grants --------------------------------------------------------------------------
  let gN = 0
  const grant = (role: MithRole, resource: string | undefined, level: MithGrantLevel) => {
    if (!resource) return
    grants.push({ id: `g:${++gN}`, role: role.id, resource, level })
  }
  const G = (key: string) => group.get(key)
  for (const c of companies) {
    const L = (tag: string, fallback = 'accounting') => (c.local.get(tag) ?? c.local.get(fallback) ?? [])[0]
    const isGroup = c.idx === 0
    for (const d of c.depts) {
      for (const role of d.roles) {
        const rk = role.id.slice(role.id.lastIndexOf('.') + 1)
        switch (rk) {
          case 'exec': grant(role, G('erp'), 'approve'); grant(role, G('bi'), 'read'); break
          case 'ea': grant(role, G('mail'), 'read'); grant(role, G('expense'), 'approve'); break
          case 'controller': grant(role, L('accounting'), 'admin'); grant(role, G('erp'), 'approve'); break
          case 'ap': grant(role, L('accounting'), 'approve'); grant(role, G('vendorportal'), 'approve'); grant(role, G('erp'), 'read'); break
          case 'treasury-clerk': grant(role, L('bankportal'), 'read'); grant(role, G('payhub'), 'read'); break
          case 'treasury-approver': grant(role, L('bankportal'), 'approve'); if (isGroup || r() < 0.3) grant(role, G('tms'), 'approve'); break
          case 'pay-op': grant(role, G('payhub'), 'read'); grant(role, L('gateway', 'bankportal'), 'read'); break
          case 'pay-approver': grant(role, G('payhub'), 'approve'); if (c.sector === 'bank' || isGroup) grant(role, G('swift'), 'approve'); break
          case 'servicedesk': grant(role, G('itsm'), 'admin'); grant(role, c.federated ? G('idp') : L('directory', 'accounting'), 'approve'); break
          case 'it-admin': {
            const pool = [...c.local.values()].flat()
            const n = 1 + Math.floor(r() * 3)
            for (let i = 0; i < n && pool.length; i++) grant(role, pool[Math.floor(r() * pool.length)], 'admin')
            if (r() < 0.15) grant(role, G('mdm'), 'admin')
            break
          }
          case 'soc': grant(role, G('siem'), 'read'); break
          case 'iam-admin': grant(role, isGroup ? G('idp') : L('directory', 'accounting'), 'admin'); if (isGroup) grant(role, G('pam'), 'admin'); break
          case 'hr': grant(role, G('hris'), 'read'); break
          case 'payroll': grant(role, G('payroll'), 'approve'); break
          case 'rm': grant(role, G('crm'), 'read'); grant(role, L('crm', 'accounting'), 'read'); break
          case 'sales-asst': grant(role, G('crm'), 'read'); break
          case 'cs-agent': grant(role, L('core', 'crm'), c.sector === 'bank' || c.sector === 'regional' || c.sector === 'card' ? 'approve' : 'read'); break
          case 'cs-lead': grant(role, L('core', 'crm'), 'approve'); break
          case 'ops-clerk': grant(role, L('core', 'app'), 'read'); break
          case 'ops-lead': grant(role, L('core', 'app'), 'approve'); break
          case 'compliance': grant(role, G('grc'), 'read'); grant(role, L('aml', 'reporting'), 'read'); break
          case 'counsel': grant(role, G('contracts'), 'read'); break
          case 'risk': grant(role, G('lake'), 'read'); break
          case 'buyer': grant(role, G('procure'), 'read'); break
          case 'proc-approver': grant(role, G('procure'), 'approve'); break
          case 'marketing': grant(role, G('crm'), 'read'); break
          case 'auditor': grant(role, G('grc'), 'read'); grant(role, L('accounting'), 'read'); break
          case 'trader': grant(role, L('trading', 'accounting'), 'approve'); break
          case 'trade-ops': grant(role, L('settlement', 'trading'), 'approve'); break
          case 'underwriter': grant(role, L('policy', 'app'), 'approve'); break
          case 'claims': grant(role, L('claims', 'app'), 'read'); break
          case 'claims-approver': grant(role, L('claims', 'app'), 'approve'); break
          case 'loan-officer': grant(role, L('los', 'app'), 'read'); break
          case 'credit-approver': grant(role, L('los', 'app'), 'approve'); break
          case 'engineer': grant(role, G('repo'), 'read'); grant(role, L('app', 'accounting'), 'admin'); break
          case 'sre': grant(role, isGroup ? G('cicd') : L('app', 'accounting'), 'admin'); break
          case 'teller': grant(role, L('teller', 'core'), 'read'); break
          case 'branch-mgr': grant(role, L('core', 'teller'), 'approve'); break
        }
      }
    }
  }

  // --- Channels ------------------------------------------------------------------------
  let cN = 0
  const controlsFor = (c: Company, kind: 'entry' | 'approver' | 'internal'): MithVerification[] => {
    const m = c.maturity
    const pNone = kind === 'entry' ? 0.4 - 0.36 * m : kind === 'approver' ? 0.3 - 0.25 * m : 0.6 - 0.4 * m
    if (r() < pNone) return ['none']
    const x = r()
    if (kind === 'approver') {
      if (x < 0.45) return ['dual-approval']
      if (x < 0.65) return ['callback']
      if (x < 0.85) return ['mfa']
      return ['callback', 'dual-approval']
    }
    if (x < 0.45) return ['callback']
    if (x < 0.8) return ['mfa']
    if (x < 0.95) return ['callback', 'mfa']
    return ['dual-approval']
  }
  const rk = (role: MithRole) => role.id.slice(role.id.lastIndexOf('.') + 1)
  const groupCo = companies[0]!
  const groupRole = (key: string) => groupCo.depts.flatMap((d) => d.roles).find((x) => rk(x) === key)
  for (const c of companies) {
    const byKey = new Map<string, MithRole[]>()
    for (const d of c.depts) for (const role of d.roles) byKey.set(rk(role), [...(byKey.get(rk(role)) ?? []), role])
    for (const d of c.depts) {
      for (const role of d.roles) {
        const key = rk(role)
        for (const [actor, kind, p] of ENTRY[key] ?? []) {
          if (r() >= p) continue
          channels.push({ id: `ch:${++cN}`, kind, from: actor, to: role.id, verification: controlsFor(c, 'entry') })
        }
        for (const target of INTERNAL[key] ?? []) {
          const pool = byKey.get(target)
          if (!pool?.length) continue
          const to = pool.find((x) => x.boundary === role.boundary) ?? pool[0]!
          if (to.id === role.id) continue
          channels.push({
            id: `ch:${++cN}`,
            kind: key === 'servicedesk' || key === 'engineer' ? 'ticket' : key === 'ea' || key === 'exec' ? 'email' : 'chat',
            from: role.id,
            to: to.id,
            verification: controlsFor(c, APPROVER_KEYS.has(target) ? 'approver' : 'internal'),
          })
        }
        // Cross-company escalation into group shared services.
        if (c.idx !== 0 && key === 'servicedesk' && r() < 0.8) {
          const to = groupRole('iam-admin')
          if (to) channels.push({ id: `ch:${++cN}`, kind: 'ticket', from: role.id, to: to.id, verification: controlsFor(c, 'approver') })
        }
        if (c.idx !== 0 && key === 'controller' && r() < 0.5) {
          const to = groupRole('treasury-clerk')
          if (to) channels.push({ id: `ch:${++cN}`, kind: 'email', from: role.id, to: to.id, verification: controlsFor(c, 'internal') })
        }
      }
    }
  }

  // --- People, devices, chunks ---------------------------------------------------------
  const chunks = new Map<string, PackChunk>()
  const packCompanies: PackCompany[] = []
  const deptAgg: Record<string, [number, number, number]> = {}
  const DEVICE_KINDS = ['Laptop', 'Phone', 'Workstation', 'Server']
  let totalTeams = 0
  let totalDevices = 0
  for (const c of companies) {
    const zones: string[] = []
    const zi = (id: string) => {
      let i = zones.indexOf(id)
      if (i < 0) i = zones.push(id) - 1
      return i
    }
    const titles: string[] = []
    const ti = (t: string) => {
      let i = titles.indexOf(t)
      if (i < 0) i = titles.push(t) - 1
      return i
    }
    const teams: PackChunk['teams'] = []
    const people: PackChunk['people'] = { team: [], zone: [], title: [] }
    const devices: PackChunk['devices'] = { owner: [], team: [], kind: [], zone: [] }
    const holders: Record<string, number[]> = {}
    const zoneCount: Record<string, number> = {}
    const addDevice = (owner: number, team: number, kind: number, zoneId: string) => {
      devices.owner.push(owner)
      devices.team.push(team)
      devices.kind.push(kind)
      devices.zone.push(zi(zoneId))
      zoneCount[zoneId] = (zoneCount[zoneId] ?? 0) + 1
    }
    for (const d of c.depts) {
      const first = teams.length
      for (let t = 0; t < d.teams; t++) {
        teams.push({ id: `${d.id}.t${t + 1}`, label: `${d.label} · Team ${String.fromCharCode(65 + t)}`, parent: d.id })
      }
      const deptStart = people.team.length
      const devStart = devices.owner.length
      const personZone = (d.kind === 'treasury' || d.kind === 'payments') && c.zones.pay ? c.zones.pay : c.zones.corp
      for (let p = 0; p < d.people; p++) {
        const team = first + (p % d.teams)
        const idx = people.team.length
        people.team.push(team)
        people.zone.push(zi(personZone))
        people.title.push(ti(p === 0 ? `${d.label} head` : DEPT[d.kind]!.roles[p % DEPT[d.kind]!.roles.length]![1]))
        addDevice(idx, team, 0, personZone)
        if (r() < 0.3) addDevice(idx, team, 1, 'net:mobile')
        if ((d.kind === 'trading' || d.kind === 'dev') && r() < 0.6) addDevice(idx, team, 2, personZone)
      }
      if (d.kind === 'it') {
        const servers = Math.round(c.size * 0.075 + 1)
        for (let s = 0; s < servers; s++) addDevice(-1, first + (s % d.teams), 3, c.zones.dmz && s % 3 === 0 ? c.zones.dmz : c.zones.mgmt ?? c.zones.corp)
      }
      // Role holders: 1 to a handful of people in the department.
      d.roles.forEach((role, ri) => {
        const want = Math.max(1, Math.min(d.people, Math.round(1 + r() * (d.people / 6))))
        const list: number[] = []
        for (let h = 0; h < want; h++) list.push(deptStart + ((ri + h * d.roles.length) % d.people))
        holders[role.id] = [...new Set(list)]
      })
      deptAgg[d.id] = [d.people, devices.owner.length - devStart, d.teams]
    }
    totalTeams += teams.length
    totalDevices += devices.owner.length
    const file = `companies/${c.key}.json`
    chunks.set(file, {
      mith_chunk: PACK_VERSION,
      dataset_kind: 'synthetic-demo',
      company: c.id,
      teams,
      zones,
      titles,
      deviceKinds: DEVICE_KINDS,
      people,
      devices,
      holders,
    })
    packCompanies.push({
      id: c.id,
      label: c.label,
      sector: c.sector,
      chunk: file,
      people: c.size,
      devices: devices.owner.length,
      departments: c.depts.length,
      teams: teams.length,
      systems: [...c.local.values()].reduce((a, l) => a + l.length, 0),
      zones: zoneCount,
    })
  }

  const systems = entities.filter((e) => e.layer === 'server')
  const index = {
    mith: '0.1',
    kind: 'document',
    id: 'polaris-enterprise-synthetic',
    title: '北極星 Group · enterprise scale (synthetic)',
    dataset_kind: 'synthetic-demo',
    generated_at: '2026-09-27T21:14:00+09:00',
    disclaimer:
      'Synthetic, seeded-generator data for the fictional 北極星 (Polaris) group. Every company, person, device, system, role, channel, and external actor is made up. Exposure numbers are display-only arithmetic over tunable weights, not real-world success rates. No runners, no scanning, no credential collection.',
    model: {
      citations: [{ source: 'synthetic-demo', note: `${GENERATOR.name} v${GENERATOR.version}, seed ${seed}; people and devices live in per-company chunks` }],
      entities,
      edges,
      boundaries,
      roles,
      grants,
      actors,
      channels,
    },
    diagram: {
      arrangement: 'coplanar',
      camera: { mode: 'iso', tilt: 54, yaw: -28, zoom: 1, focusPlane: 'org' },
      selection: null,
      planes: [{ id: 'org', layer: 'organization', label: 'Organization', transform: { x: 0, y: 0, z: 0, tilt: 0, yaw: 0 }, placements: [] }],
      crossLinks: [],
    },
    inference: { viz_only: true, no_runners: true, hypotheses: [] },
  }

  const manifest: PackManifest = {
    mith_pack: PACK_VERSION,
    kind: 'chunked-document',
    id: 'polaris-enterprise',
    title: index.title,
    dataset_kind: 'synthetic-demo',
    disclaimer: index.disclaimer,
    generated_at: index.generated_at,
    generator: { ...GENERATOR, seed },
    index: 'index.mith',
    counts: {
      subsidiaries: companies.length,
      departments: allDepts.length,
      teams: totalTeams,
      employees: companies.reduce((a, c) => a + c.size, 0),
      devices: totalDevices,
      systems: systems.length,
      unsanctioned: systems.filter((s) => s.sanctioned === false).length,
      zones: entities.filter((e) => e.layer === 'network').length,
      roles: roles.length,
      grants: grants.length,
      channels: channels.length,
      actors: actors.length,
    },
    companies: packCompanies,
    departments: deptAgg,
  }
  return { manifest, index, chunks }
}

/** Serialized files, keyed by path relative to the pack root. Compact JSON (no indentation). */
export function enterpriseFiles(seed = ENTERPRISE_SEED): Map<string, string> {
  const pack = generateEnterprise(seed)
  const out = new Map<string, string>()
  out.set('manifest.json', JSON.stringify(pack.manifest))
  out.set('index.mith', JSON.stringify(pack.index))
  for (const [file, chunk] of pack.chunks) out.set(file, JSON.stringify(chunk))
  return out
}
