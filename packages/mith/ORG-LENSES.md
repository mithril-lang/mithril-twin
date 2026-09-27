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
| `reach` | `{ id, from, to, kind, weight?, jumpHost? }`, kind `open` \| `conditional` \| `blocked`; directed zone → zone network reach; `jumpHost: true` marks an admin path through a bastion (costed by `weights.jumpHost`); `weight` overrides both for that edge | both ends are network-layer entities, not the same zone; `jumpHost` is a boolean |
| `weights` | `{ base?, controls?, reach?, pivot?, host?, blastRadius?, networkValue?, jumpHost?, sync?, heatSaturation? }` — per-document overrides of the defaults below | known keys only; see the ranges in the weights table |

Roles may set `zone` (where their holders' devices sit). Devices are node-layer entities with a `zone` and `attrs.owner` = a person id; systems sit in a zone via `zone`.

Ids are unique across entities and all sections. `uses` edges in `model.edges` link a shadow system to the people or boundaries that use it.

A channel from A to role R means a request arriving over that channel from A can get R to act (or get R's access handed over). A hop is **unverified** when its `verification` list is empty or holds only `none`.

## Measures

Pure functions over the parsed document (`src/org.ts`, `src/exposure.ts`).

- **High-value grant.** The resource is `high` or `crown-jewel`. When the resource declares no `criticality` (older files), the old rule applies: level `approve` or `admin`.
- **Unified attack graph** (`graph.ts`). One graph over external actors, roles, devices, zones, and systems. Edges and their default costs:

  | Edge | From → to | Cost |
  | --- | --- | --- |
  | channel | actor / role → role | 1 + control weights |
  | pivot | role → holder's device (or → zone when no device is modeled) | 1 |
  | device | device → its zone | 0 |
  | reach | zone → zone | open 1 · conditional 4 · **blocked impassable** · jump host 2 · or the edge's `weight` |
  | host | zone → system hosted there | 1 |
  | grant | role → system | 0 (level goes into the value) |
  | entry | internet → unsanctioned SaaS that someone uses | 1 |
  | sync | shadow SaaS → zones of the people / departments using it | `sync.open` when `source: oauth-grant`, else `sync.conditional` (defaults follow `reach`: 1 / 4) |

  A path can mix both dimensions: `actor → channel → role → device → zone → reach → zone → host → system`, or `internet → shadow SaaS → sync → zone → … → system`. Red hops: channels with no verification, open reach, open SaaS sync.
- **Blast radius** (`blastRadius`). Dijkstra from the impersonated role over the whole graph; every resource within the cost threshold counts (default 6, `weights.blastRadius`, or `maxCost`). Grants of every role reached count at their level; systems reached only over the network count as `network`.
- **Impersonation paths** (`impersonationPaths`). Every simple path from an external actor to a role over channels, up to 4 hops (listing capped at 2,000). A path is unverified when no hop carries a control.
- **Exposure** (`analyzeExposure`). Per role: cheapest cost to seize it from any actor (`minCost`), then the best of (direct grant value ÷ minCost) and (network value ÷ (minCost + network cost from the role's zone to the system)). Network value = criticality × `networkValue` (default 0.6; no grant). Per resource: cheapest actor path of any kind. It also returns **network-reachable without grant** systems (last hop is `host` and the entry role holds no grant), **zone posture** (per zone: hosts a crown jewel, open-only path into a crown-jewel zone, cheapest cost to a crown jewel), and **shadow-SaaS entry paths** (sync zones, reachable zones, cheapest cost to a crown jewel). A shadow-SaaS path to a crown jewel counts as a finding (`totals.shadowToCrownJewel`) only when its cost is within the blast-radius threshold, so it follows `weights.blastRadius` (default 6).
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

All other defaults, and the `model.weights` key that overrides each one:

| Weight | Default | Key (range) |
| --- | --- | --- |
| Base hop cost | 1 | `base` (≥ 0) |
| Control costs | callback 2 · mfa 5 · dual-approval 9 · none 0 | `controls.<control>` (≥ 0) |
| Reach by kind | open 1 · conditional 4 · blocked impassable | `reach.<kind>` (≥ 0; a finite `blocked` models a bypass) |
| Jump-host reach edge (`reach[].jumpHost`) | 2 | `jumpHost` (≥ 0); a per-edge `weight` still wins; blocked stays impassable |
| Device pivot / host | 1 / 1 | `pivot`, `host` (≥ 0) |
| Shadow-SaaS sync | open = `reach.open`, conditional = `reach.conditional` | `sync.open`, `sync.conditional` (≥ 0) |
| Network-only access value | 0.6 | `networkValue` (0 – 1) |
| Blast-radius threshold (also the shadow-SaaS finding cut-off) | 6 | `blastRadius` (≥ 0) |
| Tile-heat saturation (share of roles ≥ 50 at full red) | 25 % | `heatSaturation` (> 0 and ≤ 1) |

The parser rejects unknown keys, negative numbers, non-numbers, out-of-range values, unknown `sync` keys, and a non-boolean `jumpHost`, each with the path of the bad value. When a key is absent, the default applies.

**Exposure score** (0–100) = 100 × (criticality weight × level factor) ÷ 8 ÷ (cost to seize the role + network cost to the system; 0 for a direct grant). With a direct grant this is the old 100 × ease × value ÷ 8. A one-hop unverified path to an admin on a crown-jewel scores 100. A role reached only through a dual-approval hop scores at most 10. Unreachable roles score 0. The unverified path count and min hops stay alongside the score, and no-verification hops stay red in every lens.

Path counting is a bounded DFS (≤ 4 hops, 3,000,000 steps). If the bound is hit the totals are marked `capped` and are lower bounds.

## Lenses on the Make grid

Documents with at least one boundary get a lens switcher. Org is the default.

| Lens | Frames | Shows |
| --- | --- | --- |
| Org | company › subsidiary › department › team | people and sanctioned systems in their boundary; shadow IT in dashed frames outside |
| Network | zones, nested by `zone` | the same objects by network placement; enterprise pack: zone reach edges, red where an open path leads into a crown-jewel zone |
| Access | Org (Frames toggle: Network) | roles in their boundary, grant links colored by level; select a role for its blast radius |
| Access | … | also ranks resources by exposure score (criticality × easiest path) |
| Impersonation | Org (toggle: Network) | external actors outside the org; channel links, red where unverified; roles ranked by exposure score with cost, unverified count, and min hops; the selected role's easiest path |
| Shadow IT | Org (toggle: Network) | dashed unsanctioned systems linked to their users |
| Layers | diagram planes | the original boards; Stack applies here |

`?doc=polaris-org`, `?doc=polaris-fi`, or `?doc=polaris-floor` picks a committed sample. `?doc=polaris-enterprise` (the default landing) opens the enterprise-scale pack below. The left-rail picker does the same.

## Enterprise scale: 北極星 (Polaris) group pack

A deterministic, seeded generator (`scale/generate.ts`, v2, seed `20260927`) builds a synthetic group. Everything in it is made up.

| | Count |
| --- | --- |
| Subsidiaries (14 sectors) | 300 |
| Departments | 2,000 |
| Teams | 6,339 |
| Employees | 50,000 |
| Devices (laptop, phone, workstation, server, OT controller) | 70,832 |
| Systems / SaaS (30 group, 1,320 local, 150 unsanctioned) | 1,500 |
| Network zones | 868 |
| Zone reach edges (open = seeded misconfigurations) | 2,748 (68 open) |
| Roles / grants / channels / external actors | 3,840 / 6,237 / 5,295 / 8 |

### Segmentation

Every subsidiary has a corp user VLAN and a prod server zone; larger ones add a mgmt VLAN (> 200 people) and a DMZ (> 500); financial sectors add a payments core segment (servers only); banks, regional banks, card, real estate, and shared ops add an OT / branch & building zone. Group zones: internet edge, managed mobile, group transit, group data center, group identity & PAM tier, group core payments segment (SWIFT, payments hub, ledger, card switch, TMS).

Defaults: internet → DMZ conditional; DMZ → prod conditional; corp → prod / DMZ / transit conditional; corp → payments / mgmt / OT blocked; mgmt → prod / corp / DMZ conditional through a jump host (`jumpHost: true`, cost `weights.jumpHost`, default 2); payments → group core conditional; transit → subsidiary zones blocked. Seeded misconfigurations turn a few of these open (likelier at low security maturity): corp → prod, corp → payments, corp → mgmt, OT → corp (flat branch networks), DMZ → prod / payments, transit → a subsidiary's servers, plus one legacy jump host from group shared-services mgmt into the core segment. The reach stream uses its own seed so the org data does not move when segmentation changes.

The index carries one representative holder per role (a person + laptop with the same ids as the chunk) so the graph can walk role → device → zone without loading chunks.

### Generated in the browser

The pack is **not shipped as files**. `scale/engine.worker.ts` runs the generator in a Web Worker when the page opens, parses the index there, posts the parsed document to the UI, then runs the analysis and posts scores, heat, and zone posture. Per-company chunks (teams, people, devices, role holders, column-wise ints) stay in the worker and are sent on drill-down; mixed paths and blast radius for a selected role or system are computed there on demand. Without Worker support (tests) the same engine runs inline, loaded lazily so the generator stays out of the main bundle. `enterpriseFiles()` still serializes the same pack for tests and Node tooling; output is byte-identical for a seed (tested).

### Rendering: level of detail

- **Group**: 300 subsidiary tiles in sector clusters (squarified treemap by headcount). Tile heat = **share of roles in the tile with score ≥ 50** (color saturates at `weights.heatSaturation`, default 25 %). Access: share of company systems ≥ 50. Shadow IT: unsanctioned apps used. Name tags only for the 16 largest tiles and the clusters.
- **Subsidiary**: department tiles with people / devices / teams counts and the same share heat.
- **Department**: role tiles colored by score, and team tiles where people (dots, colored by the exposure of roles they hold) and devices (squares) are drawn on a `<canvas>`, not as DOM nodes.
- **Team**: a virtualized people / device list in the right rail.
- **Network lens**: group level shows every subsidiary zone by kind, red when an open-only reach path ends in a zone hosting a crown jewel, amber when the zone hosts one. Subsidiary level shows its zones with the internet / mobile and group zones around them, and every reach edge touching them (red open into a crown-jewel zone, solid open, dashed conditional, dotted blocked, with weights). The panel lists open paths into crown-jewel zones, network-reachable-without-grant systems, and shadow-SaaS entry paths.
- **Impersonation lens**: roles ranked by score; the panel lists the top mixed org + network paths, and selecting a role shows its hop chain (org / net badges, costs, red hops) and weighted blast radius.

The largest level has ≈ 450 tiles (Shadow IT at group level). No level renders per-person DOM nodes.
