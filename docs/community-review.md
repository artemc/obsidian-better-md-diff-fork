# Community scan notes

These notes come from the upstream project ([kamacheng/better-md-diff](https://github.com/kamacheng/better-md-diff)) and describe its community catalog listing. This fork is not listed in the catalog.

## 0.2.0 report and reproduction

Source: the [public community page](https://community.obsidian.md/plugins/better-md-diff). At the time it scanned version `0.2.0`, source commit `d250d56f34c394dfe309cf7456f12573e7ad99b8`. The report showed 713 warnings and also listed missing release provenance attestations and an unavailable malware scan. Counts may change as the platform rescans.

A controlled comparison on the same 0.2.0 source with the recommended configuration of the official `eslint-plugin-obsidianmd@0.4.2`, changing only whether dependencies resolve:

| Type-safety rule | Page count | Without dependencies | Dependencies resolved |
| --- | ---: | ---: | ---: |
| no-unsafe-member-access | 289 | 289 | 3 |
| no-unsafe-call | 273 | 273 | 0 |
| no-unsafe-assignment | 78 | 78 | 0 |
| no-unsafe-return | 30 | 30 | 0 |
| no-unsafe-argument | 30 | 30 | 2 |
| no-redundant-type-constituents | 1 | 1 | 0 |

Most `error` / `any` warnings are reproduced exactly by missing SDK, CodeMirror, Node and diff declarations; they should not be read as the same number of real defects. The platform's install logs are not visible, so we cannot say why those dependencies did not resolve there. The lockfile, newer than the 0.2.0 tag, fixes npm 10 install compatibility; the local gate runs the official lint after `npm ci`.

The real type issue that remained with complete dependencies was `Array.isArray` narrowing CodeMirror's read-only block array to `any[]`. It now uses an enum-typed discriminant, without forced type assertions or disabled type-safety rules.

## Local fixes

- The official recommended ESLint rules run in `npm run check` and in cross-platform CI with a zero-warning gate.
- Timers explicitly use `window.setTimeout` / `window.clearTimeout`.
- Obsidian DOM helpers are used; gutter elements belong to the target editor's document, and notes are still rendered as text only.
- Settings use shared definitions: searchable on 1.13+, with the same settings and interaction on 1.8-1.12.
- New hosts use the destructive button API, older hosts keep a compatible style; the deprecated slider tooltip call is removed.
- The `box-decoration-break` style flagged by the scan is removed; base highlighting and copying are unchanged.
- A contributing guide and a release workflow with signed artifacts were added.

## Capability notices that should not be hidden

**Shell execution / child_process**: the plugin must call the local Git. It uses `execFile` with an argument array, no shell, no network sync and no Git write commands; paths are literal, and output size and time are limited. The configured executable still runs with the current user's permissions, so only a trusted Git path should be used. This notice may remain; it must not be evaded by renaming, dynamic imports or wrapper APIs.

**Malware scan not available**: this is an availability disclosure of the platform's scanning service and cannot be enabled from source. Local lint and dependency audits are not a malware scan.

**GitHub artifact attestations**: the workflow is configured, but provenance can only be verified after it runs on GitHub for a new tag and publishes the original signed assets. Do not claim a workflow that has not run has cleared the notice.

## 0.4.0 dependency review

- `npm audit --omit=dev` found no known production dependency vulnerabilities; this is not a "zero risk" statement for the whole toolchain or host.
- The development dependency `source-map-js` was updated from 1.2.1 to 1.2.2 to fix [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) (denial of service with indexed source maps); runtime dependencies and the minimum Obsidian version did not change. The lockfile was regenerated with npm 10 for compatible metadata.
- The full audit still lists three moderate development-chain findings: the SDK's Moment dependency, propagating to `obsidian` and `eslint-plugin-obsidianmd` ([GHSA-4p3w-j4w9-5jqw](https://github.com/advisories/GHSA-4p3w-j4w9-5jqw)). These npm packages are not bundled into the plugin, and the plugin does not call that locale API. The older lint plugin suggested by `npm audit fix --force` was not adopted just to clear the audit. Future SDK or toolchain upgrades should be verified separately.

## How to re-check

```bash
npm ci
npm run check
npm audit --omit=dev
```

Do not describe local "zero lint warnings" as "zero risk" on the community platform.
