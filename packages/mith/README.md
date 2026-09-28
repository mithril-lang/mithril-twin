# @mithril-twin/mith — twin vocabulary for Mithril .mith

Twin vocabulary/viewer for Mithril `.mith` ([github.com/mithril-lang/mithril](https://github.com/mithril-lang/mithril)). This is not a separate language. Twin documents are Mithril Form with the upstream top-level tag `mithril/twin-document`, which lowers to JSON-LD `@type TwinDocument` under the pinned context `https://mithril.fund/context/twin/v1` (twin-local terms: `https://mithril.fund/lib/twin/v1#`). The tag, the context and the closed vocabulary were added upstream in [mithril-lang/mithril#7](https://github.com/mithril-lang/mithril/pull/7), merge commit `dd014e419c9dcca2911540f222c735e7d7c3d931`, and extended by [mithril-lang/mithril#8](https://github.com/mithril-lang/mithril/pull/8) (merge commit `ba4919f2a1435ca895d6673d2de4334a859def9d`: `lens` / `frame` diagram terms and the closed `datasetKind` set `synthetic-demo` / `workshop-export`); this package follows that pin.

This package holds the TypeScript reader (Form reader and lowering that mirror upstream `mithril.form`, the closed-vocabulary check that mirrors upstream `mithril.twin`), the in-memory types, the strict validator, the Form writer, layout geometry, the org / network / device analysis, a legacy layer-JSON importer, samples and tests.

Specification: [`docs/mith-spec.md`](../../docs/mith-spec.md). Lenses, device fields and weights: [`ORG-LENSES.md`](./ORG-LENSES.md).

```ts
import { readMith, toTwinForm } from '@mithril-twin/mith'

const { doc, format, deprecated } = readMith(text) // Form, twin JSON-LD, or legacy v0 JSON
const form = toTwinForm(doc) // (mithril/twin-document …)
```

`readMith` throws with a readable message (Form errors keep the upstream `mithril.form/*` codes). Legacy v0 JSON (`{"mith": "0.1", …}`) still reads and is reported as `deprecated: true`.

Samples in [`samples/`](./samples), all written as Form:

- `polaris-fi.mith`: five boards for a fictional financial group (北極星 / Polaris FI) on one coplanar floor.
- `polaris-floor.mith`: a two-board minimal floor.
- `polaris-org.mith`: org boundaries, roles, grants, channels, actors, shadow IT, and per-device software, logs and people for the lenses.
- `polaris-fi.mithril`: a package manifest that lists the documents.

`test/fixtures/` holds the upstream examples `twin-polaris-device.mith` and `twin-workshop-view.mith` (a `workshop-export` floor with a saved lens and frame) with their upstream-lowered JSON-LD (the Form reader must produce the same document) and one legacy v0 JSON file.

All sample data is synthetic (`dataset_kind` `synthetic-demo`) and describes no real institution. Display only: no runners.
