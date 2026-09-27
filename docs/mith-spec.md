# .mith / .mithril v0 specification

Status: v0 (`"mith": "0.1"`). JSON encoding.

`.mith` describes a picture of an organization's structure, from companies through networks, firewalls, and endpoints down to servers, as a set of boards on an isometric floor. It is built for **display only**. A document holds no executable content, and the parser rejects anything that looks like it.

## Document shape

```jsonc
{
  "mith": "0.1",
  "kind": "document",
  "id": "polaris-fi-synthetic",
  "title": "北極星 FI",
  "dataset_kind": "synthetic-demo",   // required; v0 accepts synthetic demo data only
  "model": { … },
  "diagram": { … },
  "inference": { … }
}
```

The three sections follow BPMN's split between the semantic model and diagram interchange (DI):

| Section | BPMN analog | Holds |
| --- | --- | --- |
| `model` | semantic model | `entities` (id, label, type, layer, attrs, citations), `edges` (source, target, kind), `citations`. |
| `diagram` | BPMN DI | `arrangement`, `camera`, `selection`, `planes` (one board each, with `transform` and `placements`), `crossLinks`. When the same entity id appears on two planes, it is one shared object. |
| `inference` | analysis overlay | Optional `hypotheses`. `viz_only: true` and `no_runners: true` are required. Every hypothesis has `honesty: "hypothesis"` and `observation_count: 0`. `relative_score` (0..1) is an illustrative rank, not a detection score. |

Layers are `organization`, `network`, `firewall`, `node`, and `server`.

## Safety rules

- The parser rejects any object key named `runner`, `execute`, `executor`, `payload`, `secret`, `secrets`, or `weaponize`, at any depth.
- `dataset_kind` must be `synthetic-demo`.
- Hypotheses (for example a phishing or spoofing path drawn across boards) are pictures. They carry no steps a machine could execute, and v0 does not allow observations (`observation_count` must be `0`).

## Placements

`placements[]` puts model entities on a board. `x` and `y` run from 0 to 1 within the board. `tone` is `quiet`, `accent`, or `info`, and `showLabel` is optional. Every placed entity must exist in `model.entities`.

## Arrangement

`diagram.arrangement` is `coplanar` or `stacked`.

- **coplanar (default).** Every board shares one `transform.z` and sits on a single isometric floor. `transform.x` and `transform.y` are pixel offsets of the board's top-left corner on that floor, so boards (folders) read side by side or in a grid. Boards are 280×176. Cross-links arc between boards.
- **stacked (optional).** Planes use distinct `transform.z` values, and the viewer stair-steps them. The viewer's Stack control shows this view without rewriting the file.

When the field is omitted, distinct z values are read as `stacked`, so v0 files written before the field existed still load. A shared z is read as `coplanar`.

The parser rejects three cases:

- an explicit `coplanar` document whose planes disagree on z
- a coplanar document whose board rectangles overlap
- an explicit `stacked` document whose planes all share one z

Error messages name the planes and the values that failed.

## Camera

`diagram.camera`: `mode` is `iso` or `ortho`, plus `tilt`, `yaw`, `zoom`, and `focusPlane`. `focusPlane` is the board that the viewer's Select Layer control highlights. On a coplanar floor every board stays visible and the focused board is drawn forward.

## .mithril package (stub)

A `.mithril` file is a manifest (`"mithril": "0.1"`, `"kind": "package"`) that lists member `.mith` documents and attachments. In v0 it is not an archive.

## Legacy layer JSON

`fromLayers()` imports older per-layer Cytoscape-style JSON (`{ layer, dataset_kind, elements: { nodes, edges } }`) and produces a coplanar `.mith` document. It is a secondary path. `.mith` is the primary document.

## Org sections

Optional `model` sections (`boundaries`, `roles`, `grants`, `actors`, `channels`) and entity fields (`boundary`, `zone`, `sanctioned`, `source`) drive the viewer lenses. Documents without them parse exactly as before. See [`packages/mith/ORG-LENSES.md`](../packages/mith/ORG-LENSES.md).
