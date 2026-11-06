# Untangle decision log — 2026-11-06

## Scope and baseline (before edits)

Whole-repository inventory at `31736e4`: application/home/canvas/interviewer,
shared element contracts/catalog/icons, Worker HTTP/OAuth/MCP/events, diagram
storage and rooms, scene/layout/routing, inline view, test fakes and behavioral
suites, CI/build/deployment configuration and product/setup/design documentation.
Working tree was clean. Preserve the recent deliberate test/documentation pruning
and frozen routing baseline. Both comment and test additions are selected.

Tests/builds/browser checks run only in CI under the user's latest constraint.
No thread-owned local validation process was running. Main's latest CI run
41701747131 passed; this is baseline evidence, not a local test result.

## Design and inventory

1. Put platform-independent scene operations beside shared element contracts.
   - `app/library.ts` imports `worker/scene.ts` despite using pure logic.
   - Scene, layout solver and router change together but their Worker location
     suggests a platform dependency that none has.
   - Retain the cohesive Scene class: geometry mutation, bindings and tidy share
     invariants; splitting it by line count would expose those internals.
2. Give stable identity primitives and schema initialization their own ownership.
   - `store.ts` imports the whole scene engine only for `newId`.
   - `browser-auth.ts` imports diagram storage only for SHA-256.
   - `chatgpt.ts` and events import diagram storage for schema initialization.
   - Auth login expiry is repeated as 600 seconds in browser storage/cookies and
     600,000 milliseconds in OIDC state. Export one login lifetime.
   - Capability IDs retain their existing alphabet and lengths; use native Web
     Crypto randomness rather than scene-local Math.random for access credentials.
3. Declare common Worker configuration once, varying only actual resource IDs.
   - `cloudflare.config.ts` duplicates exports, assets, flags, observability and
     entrypoint across preview and production. Preserve both resource identities.
4. Remove comments that merely name the declaration or restate adjacent code.
   - Storage row-shape/module labels and event helper descriptions add no contract.
   - Keep external protocol, security, recovery, RPC-brand and lint explanations.
5. Keep meaningful tests; remove only assertions that cannot observe a regression.
   - `frontend-boundaries.test.ts` asserts `created.id` after validation, although
     that field is a test literal. Replace with a behavioral validation assertion.
   - Existing schema-comparison tests protect the deliberate lightweight frontend
     validators against their independent Zod contract; keep them.

## Required special cases retained

- Tombstones, deletion markers, owner-authenticated retry and compensating creation
  cleanup: reconnect and cross-store failure requirements, with regression tests.
- Retry/backoff, callback verification cache, bounded readers and grant rechecks:
  external webhook/network/security requirements, not incidental workarounds.
- Focused-tab RPC selection, timeout/reconnect wait, nominal Excalidraw brands,
  lossless extension fields and mobile feedback: platform/library requirements.
- Native Excalidraw UI slots, opt-in Dagre and frozen orthogonal routing behavior.
- Lightweight home validators avoid pulling heavier canvas/schema code into home.
- Explicit MCP text plus structured output serves clients with different support.
- Private/template ownership, empty tidy scope, auto/named snapshots, OIDC return
  path allowlist and legacy share links represent supported product behavior.
- Existing test fakes validate storage/DO failure paths; do not weaken them.

## Review and validation

Initial read-only inventory review is running sequentially. Implementation and
final review results, CI evidence and delivery will be appended here.

Initial review agreed with items 1–5 and identified two related wire-contract links:
RPC results use a boolean plus optional fields, forcing room.ts to reconstruct
the union; ServerMessage variants repeat the runtime schema. Express RPC results
as a discriminated union and infer ServerMessage from its existing shared schema.
No local validation commands were run.

## Implementation

Moved scene/solver/router unchanged in behavior to `src/shared`; updated all
consumers and the frozen-routing path in PRODUCT.md (router implementation remains
unchanged). Moved schema initialization to `worker/database.ts` and Web Crypto
identity primitives to `shared/identity.ts`. Auth now imports neither diagram
storage nor geometry for hashing. Consolidated login lifetime and deployment
configuration. Inferred ServerMessage from its shared schema; RPC validation now
models success/failure directly, removing room's reconstruction branch.

CI already runs all unit/regression tests and browser journeys on PRs. Added
socket-result boundary cases: valid success (including omitted data) and failure
must survive parsing, while a missing/oversized error or nonboolean tag must be
rejected. These protect the actual untrusted-wire contract when simplifying the
room adapter. Existing room tests protect successful RPC routing and unchanged
scene/snapshot state. No local test execution.

Final sequential static review found no further worthwhile issues. It checked the
remaining imports, scene consumers, authentication, RPC handling, event delivery,
resource identities and tests; retained special cases remain justified. Local
lint, formatting and whitespace checks passed. Runtime regression validation is
pending PR CI; no local tests, builds, benchmarks or browser checks ran.

## CI correction

PR CI run 42268122985 passed typecheck, lint and build and 319 unit tests,
but the new omitted-data RPC case caught an introduced compatibility regression.
Zod requires unknown fields to be explicitly optional in the installed version.
Keep successful RPC data optional in both the wire schema and ClientMessage;
consumers already validate the method-specific payload before using it. The
regression test remains unchanged. No local reproduction/test execution.
