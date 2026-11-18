# Twin World API and MCP — design v1

Status: design, 2026-11-18. Nothing here is implemented or deployed.
Tracking: MITHRIL-2603 (parent), MITHRIL-2605 (P0 foundations), MITHRIL-2610 (bot ingest).
Contract: [`proto/mithril/twin/world/v1/world.proto`](../proto/mithril/twin/world/v1/world.proto) (passes `buf lint` STANDARD and `protoc`).

## Purpose

Mithril bots maintain the global, time-aware Twin World ontology. They add facts, end facts that stopped being true, and correct mistakes. They do this only through this API or its MCP server. This document describes that write path, the read path the Twin viewer and bots share, and the safety rules both enforce.

## Principles

1. **`.mith` is the payload.** Every write is a `.mith` world document (Mithril Form text). Protobuf carries that text plus the metadata needed to admit, gate, deduplicate and trace it. Reads return statements, or `.mith` view chunks for the viewer.
2. **Bots propose, the pipeline publishes.** A bot submits a *change set*. The server runs the gates. The existing ingress → drain → catalog path writes it to R2 Data Catalog (`world.statements`, layout `ontology-statements-v2`). Publication to the public surface happens automatically once every gate has passed (owner decision 2026-11-18). No bot credential can write Iceberg directly or publish.
3. **Nothing published is deleted.** `END` sets `valid_to` on a record. `CORRECT` adds a new record that supersedes the old one and must give a reason. Both records stay readable through record time (`known_at_snapshot_id`).
4. **Bitemporal reads.** `as_of` selects valid time (true in the world). `known_at_snapshot_id` selects record time (what Mithril knew, via an Iceberg snapshot).
5. **Unknown is not success.** A change set whose outcome has not been read back stays `UNKNOWN`.

## Transport

| Surface | Endpoint (Fund API Worker) | Protocol |
|---|---|---|
| RPC | `POST /v1/world/rpc/mithril.twin.world.v1.<Service>/<Method>` | Connect protocol: `application/proto` (binary) or `application/json` (protobuf JSON mapping) |
| MCP | `POST /v1/world/mcp` | MCP Streamable HTTP, JSON-RPC 2.0, protocol versions 2025-06-18 / 2025-11-25 |
| Viewer chunks | `GET /v1/world/views/{view}/{jurisdiction}/{as_of}.mith` | cacheable `.mith`, public surface only |

Implementation home: `mithril-fund/apps/api`, beside the existing `/v1/ontology/builder/mcp`. It reuses the same bounded-input, origin and credential checks. The proto in this repository is the contract. Fund vendors it as a pinned snapshot that records its source revision and SHA-256.

MCP itself is JSON-RPC, so protobuf is not the MCP wire format. Each MCP tool's `inputSchema` and `outputSchema` are generated from the matching proto message (protobuf JSON mapping). As a result, an MCP call and an RPC call with the same JSON body are byte-equivalent after decoding. One generator produces both, so the two surfaces cannot drift.

## Operations

| RPC | MCP tool | Scope | Effect |
|---|---|---|---|
| `WorldReadService.GetEntity` | `world_get_entity` | public: none; private: `world:read` | read |
| `WorldReadService.ListStatements` | `world_list_statements` | same | read, paged (≤ 1000) |
| `WorldReadService.GetView` | `world_get_view` | same | read `.mith` chunk + `view_hash` + input snapshot ids |
| `WorldReadService.Diff` | `world_diff` | same | read `.mith` change summary between two years |
| `WorldWriteService.ValidateChangeSet` | `world_validate_change_set` | `world:propose` | runs all gates, stores nothing |
| `WorldWriteService.SubmitChangeSet` | `world_submit_change_set` | `world:propose` | stores in private ingress, runs gates; idempotent on `content_sha256` |
| `WorldWriteService.GetChangeSet` / `ListChangeSets` | `world_get_change_set` / `world_list_change_sets` | `world:propose` (own) | read state + gate findings |
| `WorldWriteService.WithdrawChangeSet` | `world_withdraw_change_set` | `world:propose` (own, before `COMMITTED`) | withdraw |
| `WorldWriteService.RegisterSource` | `world_register_source` | `world:propose` | records a pinned snapshot; never widens the licence register |

MCP tool annotations: reads are `readOnlyHint: true`. Submit and register are `readOnlyHint: false, destructiveHint: false`. Withdraw is `destructiveHint: true`. All tools are `openWorldHint: false`.

Scopes held only by services, never by bots: `world:drain` (ingress → catalog) and `world:publish` (catalog → public surface). A bot credential is an API token whose **only** scope is `world:propose`, plus `world:read` if it needs private reads. This mirrors `ontology:builder`, which must be the sole scope of its token.

## Change set lifecycle

```
SubmitChangeSet
   │  parse + gates (sync, bounded)
   ├──► REJECTED   (any gate failed; findings returned)
   └──► RECEIVED ─► ADMITTED ─► COMMITTED ─► PUBLISHED
            │            │           (drain)      (publisher, after gates)
            └─ WithdrawChangeSet (submitter, before COMMITTED) ─► WITHDRAWN
   any step whose result was not read back ─► UNKNOWN
```

Gates, in order (`Gate` enum):

| Gate | Rule |
|---|---|
| `MITH_PARSE` | The Form reader and closed twin vocabulary accept the document: a `(mithril/twin-document …)` with `datasetKind` `public-registry-snapshot` and non-empty `citations` (mithril-lang/mithril#170). |
| `SHACL` | `world-v1.mith` shapes: domain/range, cardinality, identifier formats, and every statement has a source, licence and valid interval. |
| `LICENCE` | Every `SourceRef` is registered and its licence is allowed in `config/data-source-terms.json`. Excluded sources (OpenSanctions) always fail. |
| `PERSON_SCOPE` | A person may appear only in a public or accountable role (office holder, legal representative, director or officer), citing an official register or record. Published `address`, `email`, `phone` and `website` are admitted when pinned to that source (owner decision 2026-11-18, mithril#172 / ADR 0042 amendment); ID numbers and full birth dates still fail. A jurisdiction without a recorded privacy check and removal path fails. |
| `SIZE` | At most 12 MiB of `.mith` and 50,000 changes per set. |
| `CONFLICT` | `base_snapshot_id` is not older than the retention window, and every `END`/`CORRECT` target is still the current record (optimistic concurrency). |

## Concurrency and idempotency

- `content_sha256` (SHA-256 of the `.mith` text) is the idempotency key. Resubmitting identical content returns the existing change set with `deduplicated: true`.
- Optimistic concurrency: each change set carries the `base_snapshot_id` the bot read. A target record changed after that snapshot fails `CONFLICT`. The bot re-reads and resubmits.
- One drain writer per surface, as in the existing `drain.lock` pattern. Bots never hold catalog locks.

## Example (MCP)

```json
{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"world_submit_change_set","arguments":{
  "mith":"(mithril/twin-document :id \"https://mithril.fund/world/batch/gleif-2026-11-18-0001\" :title \"GLEIF 2026-11-18\" :dataset-kind \"public-registry-snapshot\" :citations [...] :entities [...])",
  "baseSnapshotId":"8231947712340012",
  "provenance":{"agentProfile":"mithril-world-ontology","runId":"r-20261118-0001","linearIssue":"MITHRIL-2608","sourceRevision":"<git sha>","model":"UNKNOWN"}}}}
```

The response carries the `ChangeSet`, with `state` and the per-gate `findings`.

## Limits and abuse controls

- Request body ≤ 12 MiB plus envelope. JSON nesting and element limits reuse `@mithril/shared/http-input`.
- Per-credential rate limits on submit and read (values set at implementation, then measured).
- Runner, executor, payload and secret fields are rejected, as in the Twin reader today.
- No live cross-org fetches in request paths. Sources are pinned snapshots registered ahead of time.

## Observability

- Each change set records `Provenance` (bot profile, run id, Linear issue, source revision, observed model). Provenance is recorded but never trusted for authorization.
- Counts come from manifests and Iceberg snapshot summaries, never `count(*)`.
- Metrics: gate pass rate per gate; time from `RECEIVED` to `PUBLISHED` (p50/p95); conflicts and deduplications per bot; drain lag.

## Open items before implementation

1. Upstream mithril vocabulary (done). The payload is a `mithril/twin-document` with `datasetKind` `public-registry-snapshot` and the time / provenance terms (mithril-lang/mithril#170; TS reader mirrored in this repository). There is no separate world document tag. Python writer: `mithril_pipelines.mith_form` (mithril-lang/mithril-fund#2729).
2. Proto vendoring and code generation for TypeScript (Worker) and Python (bots). Connect-ES is the proposed generator; this needs a dependency review.
3. Credential issuance for `world:propose` tokens: one per bot profile, stored in 1Password at creation (credential custody rule), never in the profile or repository.
4. Drain re-qualification (MITHRIL-2604) before any `COMMITTED` state can occur.
