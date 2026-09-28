# Twin Pages locale and mobile candidate — 2026-09-28

This branch ports the Mithril Web Twin's mobile layout correction and `?lang=` / `mf_locale` selection to the separate GitHub Pages viewer. It keeps the project-site base `/mithril-twin/`, the selected `?doc=` sample, and the original synthetic data and display-only boundary. The other 20 languages show an explicit localized notice that some viewer content remains in English.

The Pages build (`GITHUB_PAGES=true npm run build`) and preview (`GITHUB_PAGES=true npm run preview -w @mithril-twin/viewer`) passed at `/mithril-twin/`. Root HTML, JavaScript, CSS, the `.mith` sample and a layer JSON all returned HTTP 200. `twin-pages-preview-2026-09-28.json` records 22 mobile visits at 390 px, including all five RTL languages, with the selector value, document language and direction, visible header and search rail, no horizontal overflow and no browser exception. Switching Arabic to Japanese preserved `?doc=polaris-enterprise`, updated `?lang=` and `mf_locale`, and the cookie restored Japanese without a language query. See `twin-pages-mobile-ar-candidate-2026-09-28.png`.

The package typechecks, its 62 parser and 38 viewer tests pass, and the Pages build succeeds. The two existing MakeGrid hook warnings remain warnings.

This is a candidate, not publication approval. Most internal controls, inspectors, explanations and generated synthetic labels remain English. The old live Pages build and `twin.mithril.fund` still need a source-by-source interaction comparison, mobile detail-panel review and translation coverage before this branch can be merged into auto-publishing `main` or counted as a Twin site/locale receipt.
