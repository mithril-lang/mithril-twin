# AGENTS.md — mithril-lang/mithril-twin

- Purpose: Display-only twin viewer and the twin vocabulary for Mithril `.mith`.
- Owner: Platform Engineering (Jun Kawasaki, @com-junkawasaki).
- Visibility: public. Do not change it without Jun's GO.
- Separate-repository reason: Public distribution with its own Pages site (policy section 4, reason 3).
- Verification: `npm ci && npm run build && npm test`.
- Release path: GitHub Pages from `main` (`.github/workflows/pages.yml`). `twin.mithril.fund` is published separately from mithril-fund.

Rules: merge with a merge commit (no squash or rebase). Never commit secrets,
customer data or real target details. Run `gitleaks git --redact` before
pushing when it is installed.

Repository rules and classification: [mithril-fund repository policy](https://github.com/mithril-lang/mithril-fund/blob/main/docs/operations/repository-policy.md)
(`docs/operations/repository-policy.md` in mithril-fund).
