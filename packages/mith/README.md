# .mith / .mithril v0

`.mith` is a small interchange format for display-only "digital twin" diagrams, shaped like BPMN. v0 is JSON; an XML form may come later. This package contains the TypeScript types, a strict parser, layout geometry helpers, and an importer for the legacy layer-JSON format.

Specification: [`docs/mith-spec.md`](../../docs/mith-spec.md).

```ts
import { parseMith, parseMithrilPackage } from '@mithril-twin/mith'

const doc = parseMith(JSON.parse(text)) // throws MithParseError with a readable message
```

Samples live in [`samples/`](./samples):

- `polaris-fi.mith`: five boards for a fictional financial group (北極星 / Polaris FI), laid out on one coplanar floor.
- `polaris-floor.mith`: a two-board minimal floor.
- `polaris-org.mith`: org boundaries, roles, grants, channels, actors, and shadow IT for the lenses (see [`ORG-LENSES.md`](./ORG-LENSES.md)).
- `polaris-fi.mithril`: a v0 package manifest that lists the three documents.

All sample data is synthetic (`dataset_kind: "synthetic-demo"`) and describes no real institution.
