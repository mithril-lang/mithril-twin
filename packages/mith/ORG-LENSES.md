# .mith v0 — org, access, impersonation, and shadow-IT sections

Optional additions to `model` in a `.mith` 0.1 document. A document without them parses exactly as before: the parser leaves the new keys off the result, `diagram.arrangement` inference is unchanged, and the grid shows the layer boards (coplanar by default, Stack for the stair). The sample is `samples/polaris-org.mith`. Every person, role, system, channel, and actor in it is synthetic.

The lenses only visualize and measure exposure in the document. Nothing here runs an action, collects credentials, or scans a system.

## Two dimensions on every object

| Field on an entity | Meaning |
| --- | --- |
| `boundary` | Org dimension. Id in `model.boundaries`. |
| `zone` | Network dimension. Id of a network-layer entity (VLAN, DMZ, transit, internet). A network entity's own `zone` nests it inside another zone. |
| `sanctioned` | Systems / SaaS. `false` marks shadow IT. Omitted means sanctioned. |
| `source` | How shadow IT was found: `sso-missing`, `oauth-grant`, `expense`, … |
| `criticality` | Systems / resources: `low` \| `medium` \| `high` \| `crown-jewel`. Drives high-value and exposure scores. Omitted falls back to the grant level (see below). |

Org boundaries and network zones are independent. A person can sit in Treasury Ops (org) and the Payments VLAN (network) at once.

## Sections

| Section | Shape | Checks |
| --- | --- | --- |
| `boundaries` | `{ id, label, kind, parent? }`, kind `company` \| `subsidiary` \| `department` \| `team` | parent exists, no parent cycle |
| `roles` | `{ id, label, boundary, holders[] }` — a job title or position; holders are person entity ids | boundary and holders exist |
| `grants` | `{ id, role, resource, level }`, level `read` \| `approve` \| `admin`; resource is an entity id | role and resource exist |
| `actors` | `{ id, label, kind: "external" }` | — |
| `channels` | `{ id, kind, from, to, verification[] }`; kind is free text (`email`, `phone`, `helpdesk`, `chat`, `vendor-portal`, …); verification items are `callback` \| `mfa` \| `dual-approval` \| `none` | `from` is an actor or role, `to` is a role |

Ids are unique across entities and all sections. `uses` edges in `model.edges` link a shadow system to the people or boundaries that use it.

A channel from A to role R means a request arriving over that channel from A can get R to act (or get R's access handed over). A hop is **unverified** when its `verification` list is empty or holds only `none`.

## Measures

Pure functions over the parsed document (`src/org.ts`, `src/exposure.ts`).

- **High-value grant.** The resource is `high` or `crown-jewel`. When the resource declares no `criticality` (older files), the old rule applies: level `approve` or `admin`.
- **Blast radius** (`blastRadius`). If a role is impersonated: its direct grants, plus grants of roles reachable from it over unverified role→role channels (free lateral reach). Highest level per resource wins; ties keep the shorter path.
- **Impersonation paths** (`impersonationPaths`). Every simple path from an external actor to a role over channels, up to 4 hops (listing capped at 2,000). A path is unverified when no hop carries a control.
- **Weighted attack graph** (`analyzeExposure`). Weak controls count. Each channel hop has a bypass-difficulty cost; the easiest path to a role is the minimum-cost path from any external actor (Dijkstra over all channels, verified or not). Per role it reports: easiest path and its cost, ease = 1 / cost, exposure score, unverified path count, total path count (≤ 4 hops), min hops, min unverified hops. Resources are ranked by the best score of any role granted on them.
- **Shadow IT** (`shadowSystems`). Entities with `sanctioned: false`, their `source`, and who uses them.

### Tunable default weights

These are defaults for ranking inside the model. They are **not** claims about real-world bypass success rates, and they are meant to be tuned.

| Control on a hop | Added cost | Hop cost alone |
| --- | --- | --- |
| none / empty | 0 | 1 |
| `callback` | 2 | 3 |
| `mfa` | 5 | 6 |
| `dual-approval` | 9 | 10 |

Hop cost = 1 + the sum of listed controls (each counted once), so combinations add up: `callback` + `mfa` = 8. Path cost = sum of hop costs.

| Criticality | Weight | | Grant level | Factor |
| --- | --- | --- | --- | --- |
| low | 1 | | read | 0.4 |
| medium | 2 | | approve | 0.8 |
| high | 4 | | admin | 1.0 |
| crown-jewel | 8 | | | |

Without `criticality`, approve / admin count as `high` and read as `medium`.

**Exposure score** (0–100) = 100 × ease × (criticality weight × level factor) ÷ 8, using the role's most valuable direct grant. A one-hop unverified path to an admin on a crown-jewel scores 100. A role reached only through a dual-approval hop scores at most 10. Unreachable roles score 0. The unverified path count and min hops stay alongside the score, and no-verification hops stay red in every lens.

Path counting is a bounded DFS (≤ 4 hops, 3,000,000 steps). If the bound is hit the totals are marked `capped` and are lower bounds.

## Lenses on the Make grid

Documents with at least one boundary get a lens switcher. Org is the default.

| Lens | Frames | Shows |
| --- | --- | --- |
| Org | company › subsidiary › department › team | people and sanctioned systems in their boundary; shadow IT in dashed frames outside |
| Network | zones, nested by `zone` | the same objects by network placement |
| Access | Org (Frames toggle: Network) | roles in their boundary, grant links colored by level; select a role for its blast radius |
| Access | … | also ranks resources by exposure score (criticality × easiest path) |
| Impersonation | Org (toggle: Network) | external actors outside the org; channel links, red where unverified; roles ranked by exposure score with cost, unverified count, and min hops; the selected role's easiest path |
| Shadow IT | Org (toggle: Network) | dashed unsanctioned systems linked to their users |
| Layers | diagram planes | the original boards; Stack applies here |

`?doc=polaris-org`, `?doc=polaris-fi`, or `?doc=polaris-floor` picks a committed sample. `?doc=polaris-enterprise` (the default landing) opens the enterprise-scale pack below. The left-rail picker does the same.

## Enterprise scale: 北極星 (Polaris) group pack

A deterministic, seeded generator (`scale/generate.ts`, seed `20260927`) builds a synthetic group. Everything in it is made up.

| | Count |
| --- | --- |
| Subsidiaries (14 sectors) | 300 |
| Departments | 2,000 |
| Teams | 6,339 |
| Employees | 50,000 |
| Devices (laptop, phone, workstation, server) | 70,190 |
| Systems / SaaS (30 group, 1,320 local, 150 unsanctioned) | 1,500 |
| Network zones | 488 |
| Roles / grants / channels / external actors | 3,840 / 6,237 / 5,295 / 8 |

### Storage: chunked `.mith` pack

```
data/polaris-enterprise/
  manifest.json          counts, per-company and per-department aggregates, chunk list
  index.mith             ordinary .mith 0.1 (parseMith): boundaries to department level, zones,
                         systems with criticality, roles, grants, actors, channels, shadow `uses` edges
  companies/sNNN.json    one per subsidiary: teams, people, devices, role holders, column-wise ints
```

The analysis only needs `index.mith`. People and devices load one company at a time on drill-down (`expandChunk` turns a chunk into ordinary entities and team boundaries). Role `holders` are empty in the index and filled from the chunk.

The pack is **not committed**. `vite.config.ts` runs the generator: `generateBundle` emits it into `dist/data/polaris-enterprise/`, and the dev server serves it from memory. Output is byte-identical for a seed (tested). Size: 302 files, ≈ 4.2 MB raw / ≈ 0.56 MB gzip in total; `index.mith` ≈ 2.2 MB raw / 0.15 MB gzip; `manifest.json` 114 KB / 20 KB; chunks 0.8–60 KB each. Committing it would add megabytes of generated JSON to every diff for no information the 700-line generator does not already hold.

### Rendering: level of detail

- **Group**: 300 subsidiary tiles in sector clusters (squarified treemap by headcount), tinted by the highest role exposure score inside (Access: highest resource score; Shadow IT: unsanctioned apps used). Name tags only for the 16 largest tiles and the clusters.
- **Subsidiary**: department tiles with people / devices / teams counts and heat.
- **Department**: role tiles colored by score, and team tiles where people (dots, colored by the exposure of roles they hold) and devices (squares) are drawn on a `<canvas>`, not as DOM nodes.
- **Team**: a virtualized people / device list in the right rail.
- Network lens: zones sized by device count (top 80 per zone kind, the rest aggregated). Shadow IT: unsanctioned SaaS in a dashed frame outside the org, sized by departments using it.

The largest level has ≈ 450 tiles (Shadow IT at group level). No level renders per-person DOM nodes.

The exposure analysis runs in a Web Worker (`scale/analysis.worker.ts`): it fetches and parses `index.mith` and returns scores, per-company / per-department heat, and shadow-IT aggregates. The main thread parses the index in parallel for rendering. Without Worker support (tests) it runs inline.
