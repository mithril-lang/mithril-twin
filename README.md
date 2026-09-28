# Mithril Twin

Mithril Twin is the **twin vocabulary/viewer for Mithril `.mith`** ([github.com/mithril-lang/mithril](https://github.com/mithril-lang/mithril)): a **display-only** isometric viewer for organization, network and device "digital twins", and the twin vocabulary it reads. It is not a separate language. A twin document is Mithril Form written with the upstream top-level tag `mithril/twin-document`, which lowers to JSON-LD `@type TwinDocument` under the pinned context `https://mithril.fund/context/twin/v1`. The tag, the context and its closed vocabulary live upstream ([mithril-lang/mithril#7](https://github.com/mithril-lang/mithril/pull/7), merge commit `dd014e419c9dcca2911540f222c735e7d7c3d931`; view terms `lens` / `frame` and the closed `datasetKind` set `synthetic-demo` / `workshop-export` from [mithril-lang/mithril#8](https://github.com/mithril-lang/mithril/pull/8), merge commit `ba4919f2a1435ca895d6673d2de4334a859def9d`).

Live demo: **https://twin.mithril.fund**

```clojure
(mithril/twin-document
  :id "https://mithril.fund/lib/twin/polaris-floor"
  :title "Polaris floor"
  :dataset-kind "synthetic-demo"
  :entities [(rdf/node :type "Device" :key "dev:cfo" :label "Laptop" :layer "node"
               :software [(rdf/node :name "PDF viewer" :version "9.1" :eol true :vulnerability "high")]
               :logs (rdf/node :sources ["edr"] :forward-to "siem" :retention-days 90))]
  …)
```

- **Viewer** (`apps/viewer`): a Vite + React app. Boards sit side by side on one isometric floor, in the style of Make.com's grid. Nodes are 3D blocks whose shape and color follow the entity type. Lenses: Org, Network, Access, Impersonation, Shadow IT, **Software risk** and **Log gaps**; a device detail panel lists software, log coverage and the people linked to the device. Import and export read and write `.mith` locally in the browser.
- **Twin vocabulary** (`packages/mith`): a TypeScript reader for upstream Mithril Form (mirrors `mithril.form` lowering and `mithril.twin` closed-vocabulary rules), a Form writer, strict validation, types, geometry helpers, org / network / device analysis, and a legacy importer for the older v0 JSON spelling (deprecated). See [`docs/mith-spec.md`](docs/mith-spec.md) and [`packages/mith/ORG-LENSES.md`](packages/mith/ORG-LENSES.md).

## What this is, and isn't

- **Defensive and explanatory.** The project exists to help people see how an organization's structure could be abused (for example business email compromise or spoofing paths), so victims and defenders can understand and explain it.
- **Visualization only.** Attack paths are drawn as *hypotheses* (`honesty: "hypothesis"`, `observation_count: 0`). No runners, exploits, scanners, or intrusion tooling exist here, and the reader rejects documents that carry runner, executor, payload, or secret fields.
- **Synthetic demo data.** The bundled "北極星 / Polaris FI" dataset is fictional (`dataset_kind: "synthetic-demo"`) and describes no real institution.

## Run it

Requires Node.js 22+.

```bash
npm install
npm run dev        # viewer at http://localhost:5173
npm run build      # production build in apps/viewer/dist
npm test           # parser + viewer tests (vitest)
npm run typecheck
npm run lint
```

The viewer needs no backend: everything is static files. Samples (all synthetic):

- **Enterprise scale** (default): a seeded generator (`apps/viewer/src/twin/scale/generate.ts`) builds a chunked 北極星 pack (~50k fictional people, ~70k devices with synthetic software, log profiles and linked people) in a Web Worker when the page opens. It is not committed or shipped as files.
- **Org & access lenses** (`?doc=polaris-org`): org boundaries, roles, grants, channels, shadow IT, and per-device software / logs / people, shown through the lenses and the device detail panel. See [`packages/mith/ORG-LENSES.md`](packages/mith/ORG-LENSES.md).
- **Layer boards** (`?doc=polaris-fi`) and **Tiny floor** (`?doc=polaris-floor`).

The `.mith` samples in `packages/mith/samples/` (Mithril Form) are copied into `apps/viewer/public/data/` automatically before dev, build, and test.

## Layout

```
packages/mith/        twin vocabulary: Form reader/writer, types, validation, geometry, org/network/device analysis, samples, tests
apps/viewer/          Vite + React viewer (Make-style grid, 3D nodes, lenses, enterprise-scale view)
docs/mith-spec.md     twin profile of Mithril .mith (spec)
```

## License

Apache-2.0. See [LICENSE](LICENSE). Copyright 2026 Kotoba Labs.
