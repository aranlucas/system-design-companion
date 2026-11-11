# Plan 004: CI no longer rewrites source files to replay a one-off audit baseline

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 15d5dbf..HEAD -- .github/workflows/ci.yml docs/reliability-audit.md`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (land after any in-flight PR that relies on the replay)
- **Category**: dx
- **Planned at**: commit `15d5dbf`, 2026-11-11

## Why this matters

Every CI run takes two steps from PR #54's audit proof. Together they require
that old code still fails in exactly the expected way:

- `.github/workflows/ci.yml:54-74`:
  1. Overwrite `src/worker/room.ts`, `store.ts`, `events.ts`, `socket-schema.ts` and
     `src/app/canvas.tsx` with their versions from `6a6c919`.
  2. Run `vitest -t 'reliability regression'` against the _current_ tests.
  3. Assert `numFailedTests == 8` and four label substrings.
- `ci.yml:76-93`: a second full e2e run that must fail with one exact message.

Things that turn CI red with nothing actually broken:

- adding a ninth "reliability regression" test;
- changing a shared import the old files use;
- editing the e2e failure text.

It also costs a full-history clone (`fetch-depth: 0`, line 27) and a second browser
pass on every run. The proof has already been recorded:
`docs/reliability-audit.md:110-118` and run 42309946253's artifacts.

## Current state

- `ci.yml:27` sets `fetch-depth: 0`, needed only for `git show 6a6c919:…`.
- `ci.yml:54-104` holds the two replay steps, the restore step and the
  `audit-baseline-regressions` artifact upload.
- `ci.yml:106-113` uploads E2E evidence. Keep it.

## Commands you will need

| Purpose       | Command             | Expected                                    |
| ------------- | ------------------- | ------------------------------------------- |
| Validate YAML | `pnpm format:check` | exit 0                                      |
| Local tests   | `pnpm test`         | pass (the regression tests themselves stay) |

## Scope

**In scope**: `.github/workflows/ci.yml`, plus one line in `docs/reliability-audit.md`
saying that the replay was retired and where the evidence lives.
**Out of scope**: the regression tests themselves. Do not rename or delete them.

## Steps

1. Delete the steps "Reproduce storage and protocol defects on audit baseline",
   "Reproduce reconnect defect on audit baseline", "Restore audited implementation" and
   "Upload baseline regression evidence".
2. Remove `fetch-depth: 0`, unless another step needs history:
   `grep -n "git " .github/workflows/*.yml`.
3. Optional, if the maintainer wants to keep the proof: move the removed steps
   unchanged into `.github/workflows/audit-baseline.yml` with `on: workflow_dispatch` only.
4. **Verify**: `pnpm format:check` → exit 0. Open a PR and confirm the CI job passes.

## Done criteria

- [ ] `grep -n "6a6c919" .github/workflows/ci.yml` → no matches
- [ ] CI passes on the PR

## STOP conditions

- The maintainer wants the replay kept as a permanent gate. Then convert it to
  dispatch-only instead.

## Maintenance notes

Future audit proofs belong in the PR description, or in a dispatch-only workflow,
not in the required job.
