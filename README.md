# Mithril Twin

Mithril Twin is a **display-only** isometric viewer for organization and network "digital twins", together with **.mith**, the small diagram language it reads.

Live demo: **https://twin.mithril.fund**

- **Viewer** (`apps/viewer`): a Vite + React app. Boards (folders) sit side by side on one isometric floor, in the style of Make.com's grid. Nodes are 3D blocks whose shape and color follow the entity type. Curved links join objects shared across boards. You can switch on an optional stacked view, a 2D view, and a flat board.
- **.mith language** (`packages/mith`): a BPMN-shaped JSON interchange with three sections: `model` (entities, edges), `diagram` (boards, placements, camera), and `inference` (hypothesis overlays). It comes with a strict parser, types, geometry helpers, and a legacy layer-JSON importer. See [`docs/mith-spec.md`](docs/mith-spec.md).

## What this is, and isn't

- **Defensive and explanatory.** The project exists to help people see how an organization's structure could be abused (for example business email compromise or spoofing paths), so victims and defenders can understand and explain it.
- **Visualization only.** Attack paths are drawn as *hypotheses* (`honesty: "hypothesis"`, `observation_count: 0`). No runners, exploits, scanners, or intrusion tooling exist here, and the `.mith` parser rejects documents that carry runner, executor, payload, or secret fields.
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

- **Enterprise scale** (default): a seeded generator (`apps/viewer/src/twin/scale/generate.ts`) builds a chunked 北極星 pack (~50k fictional people, ~70k devices) at build time and serves it from memory in dev. It is not committed.
- **Org & access lenses** (`?doc=polaris-org`): org boundaries, roles, grants, channels, and shadow IT, shown through the Org / Network / Access / Impersonation / Shadow IT lenses. See [`packages/mith/ORG-LENSES.md`](packages/mith/ORG-LENSES.md).
- **Layer boards** (`?doc=polaris-fi`) and **Tiny floor** (`?doc=polaris-floor`).

The `.mith` samples in `packages/mith/samples/` are copied into `apps/viewer/public/data/` automatically before dev, build, and test.

## Layout

```
packages/mith/        .mith types, parser, geometry, org/exposure analysis, legacy importer, samples, tests
apps/viewer/          Vite + React viewer (Make-style grid, 3D nodes, lenses, enterprise-scale view)
docs/mith-spec.md     .mith / .mithril v0 specification
```

## License

Apache-2.0. See [LICENSE](LICENSE). Copyright 2026 Kotoba Labs.
