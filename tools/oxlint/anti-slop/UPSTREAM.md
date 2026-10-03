# Upstream provenance

Source: https://github.com/dmmulroy/anti-slop

Revision: c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b

Canonical production `src/` is vendored here. All 38 production files are byte-identical to that revision; the root MIT license and nested ESLint Stylistic license/provenance are preserved. No intentional upstream source deviations, no unofficial npm package, and no upstream development dependencies were copied.

## Integration

- Exact matched `oxlint` / `@oxlint/plugins` versions: 1.85.0 / 1.85.0, preserving the previously resolved linter version.
- All 18 generic anti-slop rules plus native `oxc/no-accumulating-spread` are errors. Effect rules are not enabled because Effect is not a direct dependency.
- Existing type-aware lint, local named-type rule, formatter, unused-disable reporting, CI triggers, and bundle budgets remain enforced. `pnpm lint` and the existing `pnpm check` CI step load this plugin.
- Existing wire keys named `shape` remain unchanged; local symbols use geometry/primitive names. Formatter `quoteProps: preserve` retains deliberately quoted wire keys.
- `no-runtime-typeof` uses upstream `allowInTypeGuards` only in the actual boundary-guard files listed in `.oxlintrc.json` (room frames, frontend validation, and three test runtime adapters).

## Explicit compatibility boundary

One per-line `anti-slop/no-unsafe-dictionary-type` exception remains on `El`'s opaque extension index in `src/shared/protocol.ts`. Versioned Excalidraw library/custom-data extensions must remain lossless, including nullable fields, readonly arrays, optional omission and arbitrary extension values. Only the named core fields are validated; the opaque index is **not** proof of extension-field safety. Consumers of concrete points/auto-fit values validate those values. Round-trip and special-own-key tests cover this contract.

Test-only runtime seams check supplied members against real Cloudflare interfaces. The awaited RPC adapter checks real `DiagramRoom` methods and derives the stub from that same owner; its one explicit assertion supports awaiting only, while unsupported pipelining/disposal throws. Strict fakes throw on missing members, preserve method receivers, and allow absent `then` only for explicitly marked ordinary R2 data objects. They do not claim full Cloudflare platform fidelity.

## Verification (2026-10-03)

Local Node 24.19.0, actual declared pnpm 12.6.0, oxlint/plugins 1.85.0, oxfmt 0.70.0:

- `pnpm check`: TypeScript, zero-warning lint and format check pass.
- `pnpm test`: 312 tests across 21 files pass, including real in-memory SQL rollback, auth boundaries, strict fakes, awaited RPC success/rejection/capability checks, frontend boundary edge cases, and Excalidraw extension preservation.
- `node scripts/scene-smoke.ts`: pass.
- `pnpm check:bundle`: pass; Home JS 272,560 bytes (<300,000), Worker JS 647,646 bytes (<700,000). An intermediate full-Zod frontend migration failed at 362,250 Home bytes; small actual type guards and Zod Mini preserve the unchanged budget.
- A second lint-fix/format pass produces no changes.
- A temporary chained-assertion probe makes lint fail with `anti-slop/no-chained-type-assertions`, confirming enforcement; the probe is removed.
- 441 previously reported policy findings after the initial spacing pass are resolved; final configured diagnostics are zero.

Hosted exact-head checks and independent review are recorded on the pull request. Local unit/build evidence is not a claim of hosted deployment or authenticated browser end-to-end verification.

Cloud-browser smoke attempt: local built assets could not be opened because the browser returned `net::ERR_BLOCKED_BY_CLIENT` for loopback. No authenticated browser flow or live deployment was exercised.
