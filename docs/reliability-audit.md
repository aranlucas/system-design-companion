# Correctness and reliability audit — 2026-11-06

Baseline: remote `main`, `6a6c919` (merged untangle pass). Clean isolated worktree;
no structural cleanup. Tests and builds run only in CI.

## Inventory and boundaries

- React home: browser session, account library pagination, create from template,
  delete and logout. TanStack Query owns requests/cache; local storage remembers
  convenience links, not ownership.
- Excalidraw canvas: capability-key metadata/files/WebSocket; reconnect merges
  element versions, uploads image bytes separately, snapshots/restore and rename.
- Interviewer: ChatGPT session, diagram context/image capture, streamed responses,
  pause/resume and retry. Existing e2e journeys use controlled model/account/socket
  fixtures, without model credentials.
- Hono Worker: bounded requests, same-origin cookie mutations, Zod input validation,
  owner-only library/deletion/template management, capability collaboration.
- OAuth/MCP: provider-validated principals, read/write tool scopes, bounded patches,
  tab RPC with timeouts, event subscriptions bound to consent/capability/expiry.
- Persistence: D1 metadata/owners/deletion markers; per-room SQLite transactional
  elements/tombstones; R2 image/template/snapshot objects; KV browser sessions and
  rate budgets. Cross-store creation uses publication-last and compensation;
  deletion revokes first and retains owner identity for cleanup retries.
- Events: explicit callback host allowlist, public DNS preflight, no redirects,
  signed delivery and bounded retries with consent recheck. CI/config/docs and
  shared scene/layout/schema code are included in static review.

## Findings recorded before fixes

### R1 — duplicate IDs can roll a scene backwards (medium, high confidence)

`src/worker/room.ts`, WebSocket update acceptance loop; `socket-schema.ts` permits
repeated IDs. With stored version 1, send versions 3 then 2 of the same element in
one valid message. Both compare against version 1, then persistence leaves version 2. The same error violates the lower-nonce tie rule. Expected: the winning version
is independent of batch order, matching the existing version/nonce contract.
Fix: resolve each ID's winner before transactional persistence and broadcast.
Regression: both input orders, version and nonce ties, persisted state and one
broadcast winner. Existing separate-message tests do not cover this trigger.

### R2 — template copy reports success with missing image bytes (medium, high confidence)

`src/worker/store.ts`, `copyFiles`: when R2 returns null for an image referenced by
live elements, copying silently continues. Saving a board while an image upload
is pending, or using a template with missing bytes, publishes an unrecoverably
incomplete destination. Expected: fail creation and compensate the destination,
retain source and allow retry once bytes are present. Existing recovery tests
cover thrown storage failures, but not successful reads returning null.
Fix: reject missing referenced files; retain all-settled completion before cleanup.
Regression: save and instantiate paths, source preservation, hidden failed
publication, successful retry after restoring the bytes.

### R3 — library-link event grants disappear before delivery (medium, high confidence)

Independent review traced `events.ts`: subscribe accepts verifyKey's supplementary
library capability but delivery compares its hash only to the original key hash.
Expected: an edit delivers while either matching capability remains valid; removal
of that library capability stops delivery. Fix rechecks both supported capability
sources on every attempt, without allowing templates or deleted boards.

### R4 — malformed index poisons persisted room state (high, high confidence)

Independent review found socket-schema accepts a numeric `index` extension while
storedElementSchema requires string/null/absent. A valid socket update persists it;
canvas parsing fails and the room constructor rejects it after hibernation.
Expected: reject invalid named core fields before persistence. Fix aligns socket
index validation with the stored wire contract; test rejection and rehydration.

### R5 — reconnect suppresses local conflict winners (medium, high confidence)

Independent review traced canvas `synced`: it records only version, whereas
Excalidraw and the room break ties by lower nonce. Reconnect can retain a local
same-version winner but flush never sends it. Also an unacknowledged new element
absent from init retains its old sent marker. Expected: diff against the current
server init using the complete version/nonce signature. Fix resets server knowledge
on init and tracks nonce; deterministic e2e disconnect/reconnect asserts resend.

## Reconciled and rejected hypotheses

- Library-generated capabilities intentionally supplement original share links;
  they are not intended key rotation. Library queries require account ownership.
- Shared-link collaborators can edit; possession is the intended authorization
  boundary, while destructive deletion and private template access require owner.
- Cross-store deletion is not atomic by design: durable revocation precedes cleanup
  and owner records permit retries. Creation already uses D1 batch publication and
  compensation, including waiting for all copy writes before cleanup.
- Tombstone collection intentionally waits for no connected tabs. Existing tests
  protect resurrection/version behavior, SQL rollback and async snapshot races.
- Webhook DNS preflight alone is not rebinding protection; code explicitly uses a
  trusted host allowlist and strictly-public fetch, and documents the limitation.

## Validation and framework applicability

Published npm metadata confirms real `e2e@0.21.2` (tester-army/e2e) and
`@e2e-dev/web@0.15.2`, Node `^22.22.3 || >=24.8.0`; repo pins Node 24.22.1.
Current quickstart and CI/GitHub Actions docs were fetched on 2026-11-06.
Existing deterministic browser journeys cover sign-in/create, drawing-to-interview,
view-only changes, pause/resume, retry, mobile menu and fixed model selection.
They exercise the frontend with controlled service boundaries, not live OAuth or
production Worker storage. Vitest covers those protocol/storage boundaries.
Keep both layers and upload `.e2e/` evidence; no paid model or production secrets.
Runner/engine versions will be exact-pinned at their existing lockfile versions.
CI will run the new regressions against baseline source (expected failure) and
fixed source (full suite), plus existing typecheck/lint/build/e2e gates.

Independent review: all five findings and fixes challenged by a separate native
reviewer. Baseline failure count, required event payload, committed drawing capture
and unique reconnect failure message corrected; final review found no remaining
concrete objections.

CI evidence so far: runs `42308117031` and `42308402300` passed the full unit suite
and production build. The latter also passed lint; browser test type declaration
needed correction. Latest-head full CI, browser journeys and pre-fix reproductions
remain pending. No local tests or builds ran. PR: #54.
