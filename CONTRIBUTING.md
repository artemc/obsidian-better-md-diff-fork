# Contributing

Issues and small improvements are welcome. Never attach real notes, access tokens or personal configuration to issues, tests or demos.

Everything in the repository is English: interface text, settings, comments, documentation and commit messages. `npm run check` fails on Chinese, Cyrillic, Japanese or Korean text outside `tests/` and the host scripts, which keep deliberate Unicode fixtures.

## Development

Use Node.js 22.12+ (22.x) or 24+, npm, and a local Git installation:

```bash
npm ci
npm run check
npm run dev
```

`npm run check` runs the official Obsidian ESLint recommended rules with zero warnings, tests, strict TypeScript checking, build, and release validation. Install dependencies **before** linting: missing Obsidian, CodeMirror, Node or diff declarations can produce hundreds of misleading `no-unsafe-*` diagnostics.

When changing dependencies with npm 11, also run `npx npm@10 install --package-lock-only --ignore-scripts` and verify `npx npm@10 ci` as well as `npm ci`: npm 11 can omit a nested esbuild lock entry that npm 10 requires. Do not hand-edit that entry.

The ESLint plugin's old Obsidian peer/dependency requirement is overridden to the project's pinned SDK version. This keeps one set of host declarations and allows plain `npm ci`; do not use `--force` or disable the type-safety rules to silence diagnostics. Brand/acronym allowances preserve `Better MD Diff`, `Markdown`, `Git`, `HEAD` and `PATH`.

## Changes and testing

- Keep Git operations read-only. Never introduce staging, reset, checkout, commit, push, or implicit file writes.
- Per-change restoration must retain confirmation, cancellation, fresh HEAD/buffer validation, and a single undoable editor transaction. Display context must never expand its scope.
- Add regression tests at public interfaces. Tests use temporary Git repositories and may mock the Obsidian runtime boundary (the npm SDK provides declarations, not a host).
- Use an isolated test vault for real Obsidian checks. Test source mode, Live Preview, popout windows, copy, restore, cancel and undo; disable unrelated formatting plugins.
- `getSettingDefinitions()` supports Obsidian 1.13+ settings search. Keep the `display()` fallback for 1.8–1.12; both use the same definitions.
- Do not commit `node_modules`, built bundles, personal configuration, recordings of private notes, or temporary test vaults.

## Release and attestations

Releases follow the same flow as the author's other Obsidian plugins: `npm version` bumps every version file, the tag push builds and publishes.

1. Start from a clean, up-to-date `main` and run `npm ci && npm run check`, plus the isolated-vault checks when the change affects the interface.
2. Run `npm version <x.y.z>` with a **new** version. It updates `package.json` and `package-lock.json`; `version-bump.mjs` copies the version into `manifest.json` and adds it to `versions.json`. npm then commits `<x.y.z>` and creates the tag without a `v` prefix (`.npmrc`).
3. Push with `git push --follow-tags`. Never move or reuse an existing tag.
4. `.github/workflows/release.yml` runs `npm run check` with `RELEASE_TAG` (the tag must equal `manifest.json`'s version), signs `main.js`, `manifest.json` and `styles.css` with GitHub artifact attestations, and publishes the release with generated notes.
5. If the workflow fails, fix the cause and release a new version; do not replace an asset with a locally rebuilt file after signing.

A downloaded asset can be verified with GitHub CLI 2.49 or newer:

```bash
gh attestation verify main.js --repo artemc/obsidian-better-md-diff-fork
gh attestation verify styles.css --repo artemc/obsidian-better-md-diff-fork
```

Attestations prove build provenance, not absence of vulnerabilities. See [community scan notes](docs/community-review.md) for disclosures inherited from the upstream project.
