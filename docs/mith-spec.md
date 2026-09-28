# Twin profile of Mithril .mith — specification

Mithril Twin is the **twin vocabulary/viewer for Mithril `.mith`** ([github.com/mithril-lang/mithril](https://github.com/mithril-lang/mithril)). It is not a separate language: `.mith` is Mithril Form, and this repository defines how twin diagrams are spelled in it and how the viewer draws them. Twin documents are written in upstream Mithril Form as `(mithril/twin-document …)`, which lowers to JSON-LD `@type TwinDocument` with the pinned context `https://mithril.fund/context/twin/v1`. Twin-local terms live in `https://mithril.fund/lib/twin/v1#`. The tag, the context and the closed vocabulary were added upstream in [mithril-lang/mithril#7](https://github.com/mithril-lang/mithril/pull/7) (merge commit `dd014e419c9dcca2911540f222c735e7d7c3d931`) and extended by [#8](https://github.com/mithril-lang/mithril/pull/8) (merge commit `ba4919f2a1435ca895d6673d2de4334a859def9d`: `lens` / `frame` terms and the closed `datasetKind` set), which this reader follows.

The viewer loads the generated enterprise pack by default; `?doc=polaris-org` opens the org sample and `?doc=polaris-fi` opens the layer-board sample `polaris-fi.mith`. The grid imports and exports `.mith` files (see *Import and export* below). `fromLayers` can still turn legacy per-layer JSON into a document for tests; that JSON is not a grid import. All three samples in `packages/mith/samples/` (`polaris-org`, `polaris-fi`, `polaris-floor`) are Form. Upstream `twin/compile-twin-text` admits each of them, and the checks it runs include the rule that no term is lost in RDF lowering.

## Reading and writing

| Input | Reader | Status |
| --- | --- | --- |
| `(mithril/twin-document …)` Form | `packages/mith/src/form.ts` (EDN reader + lowering that mirrors upstream `mithril.form`; tags and key-names in `formTables.ts` are generated from `form.cljk`) → `twin.ts` `admitTwin` (closed vocabulary) → `parseMith` | primary |
| Lowered JSON-LD with `"@context": "https://mithril.fund/context/twin/v1"` | `twin.ts` `admitTwin` → `parseMith` | supported |
| v0 JSON `{"mith": "0.1", …}` | `parseMith` | **deprecated** legacy path; still loads, and the loader logs a warning |

`readMith(text)` returns `{ doc, format, deprecated }`. `toTwinForm(doc)` writes Form. Non-integers are written as typed literals, for example `(rdf/literal "0.3" :datatype "xsd:decimal")`, because upstream Form has no bare decimals. The reader refuses what upstream refuses and uses the same `mithril.form/*` error codes. It also refuses unknown twin keys, an unpinned context, non-synthetic data and non-display-only inference.

The in-memory shape below is unchanged from v0; Form only changes the spelling. Kebab-case Form keys map to the camelCase terms (`:forward-to` → `forwardTo`, `:dataset-kind` → `dataset_kind` in memory). Nested twin nodes use `:key` for their id.

### Import and export

Import (file picker or drop) reads Form, twin JSON-LD, or legacy v0 JSON; a legacy file opens with a note that the spelling is deprecated. Export writes `(mithril/twin-document …)` Form with media type `application/vnd.mithril.form`, including `diagram.lens` and `diagram.frame`. The twin vocabulary admits a closed `dataset_kind` set, `synthetic-demo` and `workshop-export` (an illustrative workshop diagram, not collected from live systems); both export as Form with their label. A document that declares any other label cannot be spelled as twin Form, so export writes it as legacy v0 JSON and says so rather than relabelling it.

The lens / frame terms and the `workshop-export` label come from the upstream follow-up [mithril-lang/mithril#8](https://github.com/mithril-lang/mithril/pull/8) (merge commit `ba4919f2a1435ca895d6673d2de4334a859def9d`); this reader follows that pin.

## Sections (BPMN analog)

| .mith | BPMN analog | Holds |
| --- | --- | --- |
| `model` | semantic model | Entities (org / network / firewall / node / server), edges, citations. `dataset_kind` is `synthetic-demo` or `workshop-export`. |
| `diagram` | BPMN DI | `arrangement`, planes (one board each), placements (`x`/`y` in 0..1), plane `transform` (`x`,`y`,`z`,`tilt`,`yaw`), `camera`, `selection`, `crossLinks`, optional `lens` and `frame`. The same entity id on two planes is a shared object. |
| `inference` | analysis overlay | Optional hypotheses. `honesty` is `hypothesis`, `observation_count` is `0`, `relative_score` is an illustrative rank. `viz_only` and `no_runners` are required. |

A document is rejected if it carries runner, executor, payload, or secret fields. Export runs the same check before the download is built.

`dataset_kind` is the label the file declares. Committed samples and the generated pack use `synthetic-demo`. Import keeps any other non-empty label (no surrounding space, at most 64 characters, no control characters) and export writes that same label back. The grid shows the label. It does not treat the label as proof that the file was checked against a live system.

Optional org sections (`boundaries`, `roles`, `grants`, `actors`, `channels`) and entity fields (`boundary`, `zone`, `sanctioned`, `source`) drive the Org / Network / Access / Impersonation / Shadow IT lenses. Device fields (`software`, `logs`, `users`) drive the device detail panel and the Software risk / Log gaps lenses. See [ORG-LENSES.md](../packages/mith/ORG-LENSES.md). Files without them load exactly as before.

## Arrangement

`diagram.arrangement` is `coplanar` or `stacked`. When the field is omitted, distinct `transform.z` values are read as `stacked`, so a 0.1 file from before this field still loads. A shared z is read as `coplanar`.

- **coplanar (default).** Every board shares `transform.z` and sits on one isometric floor. `transform.x` and `transform.y` are pixel offsets of the board’s top-left on that floor, so folders read side by side or in a grid. `polaris-fi.mith` uses z `0` with a 3-over-2 spread. Cross-links still arc between those boards.
- **stacked (optional).** Planes use distinct `transform.z` values and the grid stair-steps them. The overview’s Stack control can show this stair without rewriting the file. It is not the default.

The parser rejects an explicit coplanar document whose planes disagree on z, a coplanar document whose 280×176 board rectangles overlap, and an explicit stacked document whose planes share one z. Messages name the planes and the values that failed. Omitting `arrangement` does not apply the coplanar z check to a stair of distinct z values.

## .mithril

`polaris-fi.mithril` is a v0 package stub: a manifest that names member `.mith` files and attachments. It lists `polaris-fi.mith`, the smaller coplanar sample `polaris-floor.mith`, and the org / access sample `polaris-org.mith`. It is not a zip.

Opening a `.mithril` file reads the manifest locally. Member `.mith` files are taken from the same selection (the file picker allows several files, and a drop can include the manifest plus members). If a listed member is missing, the grid names it and leaves the current picture in place. URLs in `documents` are not fetched.

## Import and export

Both stay in the browser. A chosen or dropped file is parsed with `parseMith` and is not uploaded.

| | |
| --- | --- |
| Extension | `.mith` for a document, `.mithril` for a package manifest |
| Document MIME | `application/vnd.mithril.mith+json` |
| Package MIME | `application/vnd.mithril.mithril+json` |
| Size cap | 12 MB per file, so a drop cannot freeze the page |

Export writes the current diagram view into the file:

- `diagram.arrangement` — the Stack toggle. A stacked view of a shared-z floor assigns a distinct `transform.z` and keeps board `x`/`y`. A coplanar view of an overlapping stair spreads boards so the 280×176 rectangles do not intersect.
- `diagram.camera` — 2D maps to `ortho`, otherwise `iso`; zoom and the focused plane are included.
- `diagram.selection` — the selected entity, or a boundary / role / grant / actor / channel / reach id. A selection that is not in the model (a person loaded from a company chunk, for example) is left null.
- `diagram.lens` and `diagram.frame` — the active lens and the Frames toggle, written as the twin `:lens` / `:frame` terms. Files without them open on Org when they have boundaries, and on Layers otherwise.

The enterprise pack exports its **index** as one `.mith` (the in-memory index, about 2.2 MB). People and devices stay in the per-company chunks and are not copied into the download. The status line states the file size.

## Camera

`diagram.camera.mode` is `iso` (tilted floor) or `ortho` (2D). The grid’s 2D control flips that view. Export writes the mode that is on screen. `focusPlane` is the board the Select Layer control highlights. On a coplanar floor every board stays visible; focus draws that board forward. Stacked view still windows three planes around the focus.

`diagram.lens` is `layers`, `org`, `network`, `access`, `impersonation`, or `shadow`. `diagram.frame` is `org` or `network`. Both are optional closed enums, the same sets upstream `mithril.twin` admits.
