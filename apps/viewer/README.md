# @mithril-twin/viewer

The same display-only Mithril Twin web viewer used at `twin.mithril.fund`, packaged as static HTML, JavaScript, CSS and data assets. It reads `.mith` in the browser. The package does not include a server, an execution engine or an upload path.

## Build and consume

From this repository, `npm pack -w @mithril-twin/viewer` builds a package with relative asset URLs. Mount **all** files in `dist/` under one path on the consuming application's origin, preserving names and relative paths. Serve `index.html` for that path with the application's ordinary content security policy. Do not load the packaged code from a different origin when it displays private data.

For a Mithril CS repository draft, open the mounted viewer at:

```text
/twin-viewer/?csRepository=1463656144&lang=en
```

The viewer accepts only a positive decimal repository ID of at most 16 digits. It fetches `/api/twin/repositories/<id>/export.mith` from **its own origin**, using the current browser session, parses the document with the Twin reader and skips bundled demo data. It does not write to Twin World. The host must protect that endpoint with its existing tenant and project authorization, and must serve the viewer under the same origin. A missing or rejected document is shown as a load error. Ordinary `twin.mithril.fund` sample behavior remains available when `csRepository` is absent.

The CS integration must pin the exact package version and asset digest, include the complete asset set in its source-bound build, and verify the live route after release. The package alone does not deploy CS.

License: Apache-2.0. See `LICENSE`.
