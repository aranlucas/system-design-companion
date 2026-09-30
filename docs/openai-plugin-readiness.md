# OpenAI plugin publishing readiness

Assessment date: 2026-09-29. Scope: repository source, the installed private
plugin package, current official OpenAI documentation, read-only production
endpoint checks, and repository validation. No submission, deployment, publisher
verification, reviewer sign-in, or hosted model-driven review cases were performed.

## Decision

The local implementation now has GitHub browser sessions, owner-scoped libraries
and saved templates, owner-only permanent board deletion, explicit annotations
for all 16 tools, bounded request bodies and WebSocket messages, scene/operation
limits, rate budgets, and exact verification-token routing. These changes are
not deployed. The package is not ready for public submission.

Remaining engineering work includes total storage and subscription quotas,
snapshot retention, log-query redaction verification, and an explicit operator
migration for legacy boards. Live OAuth and MCP Apps verification in the intended
OpenAI hosts, public packaging, listing pages, reviewer access, and a recorded
demo remain outstanding. All available countries is confirmed; verified
publisher identity and payment behavior are still unknown.

The detailed findings below describe the original audit baseline. Where a finding
has been fixed locally, the implementation status above takes precedence; the
read-only production observations still describe the unchanged deployment.

## Evidence and limits

- `pnpm check`: passed (TypeScript, lint, formatting).
- `pnpm test`: passed, 286 tests across 16 files.
- `pnpm check:bundle`: passed. Home JavaScript 82,203 bytes gzip; canvas static
  JavaScript 756,503 bytes gzip; all Worker JavaScript 182,272 bytes gzip;
  self-contained MCP view 72,503 bytes gzip. Vite reports large canvas chunks
  and an ineffective dynamic import warning.
- The installed `system-design-companion` 1.0.0 package contains a portable
  manifest, MCP configurations, compatibility manifests, SVG branding, and an
  onboarding skill. It lives in the plugin cache, outside this repository;
  preserve it and prepare a separate public upload from its canonical source.
- Its subtitle has 45 characters, exceeding the public listing limit of 30.
  Its display name has 23 characters and fits.
- Its interface lacks `websiteURL`, `supportURL`, `privacyPolicyURL`, and
  `termsOfServiceURL`. The root `homepage` does not populate those fields.
- Its public review cases, recording URL, release notes, and country selection
  are absent. The publisher name in a private manifest does not prove verification.

Production URL found in the installed package:
`https://system-design-companion.aranlucas.workers.dev`.

Read-only checks through the collaborative browser:

| Endpoint                                     | Observed result                                                                                     |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `/`                                          | System Design application loads                                                                     |
| `/mcp` without a token                       | 401 with Bearer challenge and resource metadata URL                                                 |
| `/.well-known/oauth-protected-resource/mcp`  | 200 JSON; canonical MCP resource and issuer                                                         |
| `/.well-known/oauth-authorization-server`    | 200 JSON; PKCE S256, authorization code, refresh, CIMD, registration, revocation, read/write scopes |
| `/.well-known/openid-configuration`          | 200 HTML from SPA fallback; no OIDC discovery                                                       |
| `/.well-known/openai-apps-challenge`         | 200 HTML from SPA fallback; no verification token                                                   |
| `/mcp-view.html`                             | 200 HTML with the expected MCP view marker                                                          |
| `/api/diagrams?limit=1`, credentials omitted | 200; returns a diagram access key anonymously                                                       |

The library check recorded only booleans and status; no diagram titles, contents,
IDs, or keys are retained in this report. No production board was edited.
Shell HTTP requests were blocked with Cloudflare error 1010 while browser
requests worked. Investigate bot/WAF rules and check the actual OpenAI scanner;
browser reachability does not prove scanner reachability.

## Product and access control

Source: `src/worker/index.ts`, `store.ts`, `oauth.ts`, and `room.ts`.

1. **Board ownership and library isolation — release blocker for private use.**
   `/api/diagrams` is anonymous and returns additional edit capabilities for
   all boards, including boards created through MCP. There is no owner or
   workspace column. MCP's authenticated principal is not used when creating
   or checking a board. Add owner/workspace identity, authenticated browser
   sessions, and owner-scoped listing and creation. Make legacy-board ownership
   an explicit migration decision; never let the first public visitor claim them.
2. **Sharing permissions.** A capability currently allows viewing, editing,
   deleting, restoring, and publishing templates. Preserve intentional sharing,
   but decide whether viewers, editors, and owners need different powers.
   Add revocation or rotation if users must withdraw access without deleting.
   Enforce the same rules across HTTP, WebSockets, MCP, files, and events.
3. **Template privacy — release blocker for private use.** Saved templates and
   their names are deployment-wide, and `createDiagram` can copy a saved template
   by its ID without an owner check. Default saved templates to private;
   make public publishing a separate, explicit operation if offered.
4. **Retention and deletion.** Board deletion disables links and live sockets,
   but retains Durable Object scene data, D1 records, R2 files and snapshots.
   The seven-day element tombstone cleanup is not permanent board deletion.
   Choose retention periods, permanent erasure, template-copy treatment, and
   account-disconnection behavior before drafting policy commitments.
5. **Public-service limits.** Add per-user creation/storage limits, request and
   operation bounds, snapshot retention, subscription quotas, and WebSocket
   message validation/size bounds. File uploads already have a 4 MiB limit;
   that is not a total storage or request-memory budget. Avoid unbounded reads
   before rejecting oversized streamed bodies.
6. **Recovery.** `createDiagram` persists a board before validating/loading a
   requested saved template. Failed creation can leave a board behind. Validate
   before persistence or implement cleanup. Verify idempotency where retries
   can create duplicate artifacts.

Required acceptance coverage: user A cannot list, clone, restore, retrieve files
from, subscribe to, or mutate user B's private board/template; explicit sharing
works; revocation and deletion stop existing connections; legacy migration
does not expose existing interview material.

## OAuth and host integration

The authorization foundation is present. Tests cover consent/browser binding,
GitHub PKCE, token exchange, incorrect verifier, code replay, resource mismatch,
read/write enforcement, refresh, revocation, denial, and forged upstream state.
These tests use fake infrastructure; repeat the real flow in the intended hosts.

- Confirm ChatGPT and Codex can install, authenticate, request additional write
  scope, refresh, disconnect, and reconnect using the production configuration.
- Inspect authenticated `tools/list`: `scopeChallenge` enforces write permissions,
  but source configuration alone does not establish the emitted host-facing
  security schemes and scope metadata. Align discovery with the enforced scopes.
- The authorization server advertises read/write scopes; protected-resource
  metadata currently advertises only read. Verify the host's escalation flow.
- For Enterprise workspace domain restrictions, OpenAI documents OIDC discovery,
  `openid` and `email` scopes, and a UserInfo endpoint returning verified email.
  These are absent. This is an Enterprise compatibility gap, not evidence that
  ordinary OAuth linking must fail. Adding it would require obtaining an actual
  verified email; never synthesize `email_verified: true` from GitHub user ID.
- Use a dedicated reviewer account and sample data. Verify reviewers can sign
  in without the publisher's phone, mailbox, MFA approval, or private network.
  Put credentials only in secure portal fields, never in the package.

See [Authenticate users](https://developers.openai.com/plugins/build/auth).

## Tool metadata

There are 16 registered tools, including the app-only `render_scene`. Seven
specify only `readOnlyHint: true`; nine omit annotations. Every tool should
explicitly set all three booleans. The following is a proposed classification,
to be checked against the final permission model and emitted tool scan:

| Tools                                                                                                              | Read-only | Destructive | Open world                  | Reason                                                                               |
| ------------------------------------------------------------------------------------------------------------------ | --------- | ----------- | --------------------------- | ------------------------------------------------------------------------------------ |
| `join_session`, `get_scene`, `render_scene`, `get_selection`, `get_screenshot`, `list_snapshots`, `list_templates` | true      | false       | false                       | Retrieve data within this service's diagram/catalog boundary                         |
| `create_diagram`, `snapshot`, `import_mermaid`                                                                     | false     | false       | false                       | Add a board, saved version, or imported elements                                     |
| `apply_patch`, `restore`                                                                                           | false     | true        | false                       | Can remove or overwrite existing content; snapshots do not negate that               |
| `tidy`, `layout`                                                                                                   | false     | true        | false                       | Overwrite existing layout/property values; check final scanner feedback              |
| `save_as_template`                                                                                                 | false     | false       | false for private templates | Creates a reusable copy; reconsider open-world classification if publishing publicly |
| `focus_view`                                                                                                       | false     | false       | false                       | Changes another connected tab's viewport/pointer, without modifying scene content    |

`apply_patch` has an enumerated operation schema. Keep every operation visible
to review; do not extend it into an executor for undisclosed actions. Its partial
failure result must not be described as a completely successful edit.

The current [plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines#correct-annotation)
say annotation justifications are no longer required. Some older review/error
documentation still asks for them. Use the current guidelines and inspect the
actual portal findings; do not invent a requirement or promise the portal's behavior.

## Canvas UI and events

The MCP view already registers a resource, uses the host bridge for tool calls,
declares its font origin in CSP, adapts host theme/style variables, supports
refresh and host-supported fullscreen, and opens the canvas through the host.

- Verify inline view, app-only tool authorization, CSP/font loading, fullscreen,
  light/dark appearance, narrow layouts, keyboard access, and error recovery in
  ChatGPT and Codex. A served HTML asset is not a verified host integration.
- The inline renderer shows images, embeds, and iframes as dashed placeholders.
  Describe it as a diagram preview, not a complete Excalidraw rendering.
- Screenshot, Mermaid import, and focus/point require an open canvas browser
  tab. Test no-tab errors and explain how to recover. Core semantic edits and
  reads do not require that tab.
- Review feedback and capacity estimation are MCP prompts, not dedicated tools.
  Ensure the bundled skill supports those workflows in hosts that do not expose
  prompt/resource discovery; verify actual model behavior before claiming it.
- Event code has signed webhooks, receiver verification, callback allowlisting,
  public-address checks, expiry/revocation checks, retries, and suppression of
  agent-generated feedback loops. It is best-effort without durable replay.
  Test real callback hosts and unsubscribe/revocation if events ship in v1.
  Do not advertise guaranteed monitoring or silently drop a packaged feature.

## Public package and listing

Reuse the private package's stable name and skill; keep the cache unchanged.
Maintain a public package in its canonical source with portable `plugin.json`,
`mcp.json`, `skills/`, and `assets/`. Check every compatibility manifest too.
Exclude private credentials, app-reference bindings, and unsupported lifecycle
hooks from author-supplied public uploads.

Draft supported listing copy:

- Display name: **System Design Companion** (23 characters).
- Subtitle: **Draw and review architecture** (28 characters).
- Description: **Create and edit system-design diagrams with your agent on a
  shared canvas. Add standard architecture components and connections, tidy
  layouts, save versions, and discuss design tradeoffs. Open the board in your
  browser for live collaboration, screenshots, and Mermaid import.**
- Starter prompts: **Create a URL-shortener architecture diagram.**;
  **Review my shared diagram for scaling bottlenecks.**;
  **Add a cache to my diagram and explain where it belongs.**

Required facts still need confirmation: verified publisher/organization,
commerce/payment behavior, support channel, canonical
plugin-source repository, and the four published listing URLs. The cached
package's repository points to `lucas-plugins`; this application's remote points
to `system-design-companion`. These can be different intentionally.

Existing PNGs are suitable candidates: 512×512 logo (184,046 bytes) and 128×128
composer icon (11,061 bytes). Check actual legibility on light/dark backgrounds
and include them in the archive. Avoid new branding work unless needed.
Screenshots are optional and should come from the actual hosted experience.

Privacy policy drafting needs confirmed facts about diagram and image content,
GitHub identity, Cloudflare storage and operational logs, callback recipients,
retention, deletion, public sharing, and template copying. Do not claim zero
collection, immediate erasure, or guaranteed privacy until implementation matches.

See [Package your plugin](https://developers.openai.com/plugins/build/plugins)
and [Submission errors](https://developers.openai.com/plugins/deploy/submission-errors).

## Draft review cases

All cases below are **not run in the intended OpenAI host**. Automated repository
tests are supporting evidence, not substitutes for model-driven review cases.
Use a dedicated test workspace; replace “my board” with the board created in the
reviewer's conversation. Supply the same setup in package case descriptions.

| Positive case and natural prompt                                                                                 | Setup and expected tools                                                                                               | Observable pass condition                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Create: “Create a URL-shortener architecture diagram with clients, an API service, a cache, and a database.”     | Authorized write account; `create_diagram`, `get_scene`, `apply_patch`                                                 | Valid board link; four requested roles and meaningful connections; returned graph agrees with description                                        |
| Selection: “Rename the selected service to Redirect API and add a queue to its right.”                           | Open the test board and select one service; `join_session` if needed, `get_scene`, `get_selection`, `apply_patch`      | Only selected service renamed; queue placed to its right without overlap; no unrelated labels changed                                            |
| Review: “Review my diagram for scaling bottlenecks and suggest the next improvement. Keep the drawing as it is.” | Board with an API-to-database bottleneck; `get_scene`, optional `get_screenshot`                                       | Feedback refers to actual components and a concrete improvement; no write tools; scene unchanged                                                 |
| Versions: “Save a checkpoint called Before cache, add a cache, then restore that checkpoint.”                    | Authorized write account and test board; `snapshot`, `apply_patch`, `list_snapshots` if needed, `restore`, `get_scene` | Named checkpoint exists; cache appears after edit and is absent after restore; prior nodes/connections preserved; restore returns safety version |
| Mermaid: “Add this flowchart to my board: flowchart LR; Client-->API; API-->Queue; Queue-->Worker.”              | Open canvas tab; `get_scene`, `import_mermaid`, `get_scene`, optional `get_screenshot`                                 | Four imported labeled nodes and three arrows; existing content preserved; actual canvas and returned graph agree                                 |

| Negative prompt                                                  | Expected behavior                                                                                                                       |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| “Deploy the architecture on this board to my AWS account.”       | Explain deployment is unsupported; may discuss a plan, but no diagram mutation, external deployment, or fabricated success              |
| “Load-test this architecture and tell me its measured peak QPS.” | Explain no real load-testing capability; distinguish estimates from measurements; do not invent traffic, benchmarks, or completed tests |
| “Draw whatever architecture is in my mind.”                      | Ask what system and requirements the user means; do not create or mutate a board before enough direction exists                         |

Invalid share links, expired tokens, read-only writes, foreign snapshots, and
closed-tab RPCs are additional failure/recovery tests. They are supported
workflows hitting validation failures, not the three capability-boundary cases.

When finalized, put exactly five positive and three negative cases under
`extensions.com.openai.review.test_cases`; store release notes under
`publication.release_notes`. Keep execution status and private access details
outside the public manifest.

## Demo, archive, and portal

Rehearse the five positive workflows and one negative example in an existing
development installation of ChatGPT or Codex. Capture real prompts, tool results,
the inline preview, the browser canvas, and restore behavior using sample data.
Record host/platform and server version. Review playback for readability and
secrets, host it at a reviewer-accessible URL, then set `review.demo_recording_url`.
Browser control/recording is available here, but a canvas-only recording does not
prove the conversation/plugin integration. No walkthrough has been recorded.

Build a complete versioned ZIP after the missing facts and materials are supplied.
Inspect the archive itself: one plugin root, supported manifest, exact endpoint,
contained assets, valid skills, no secrets/app references/hooks, field lengths,
verified page/recording URLs, case counts, and release metadata. A parseable ZIP
with missing policies or evidence is not submission-ready.

Then use the intended organization/project and verified publisher to upload a
draft. Connect/authenticate the MCP server, host the portal's exact plain-text
challenge token at `/.well-known/openai-apps-challenge`, and run domain verification.
Ensure asset routing reaches that token instead of the SPA fallback. Inspect
imported metadata and all tool/skill scans, run the cases against the saved draft,
and enter reviewer credentials securely. The developer completes policy
attestations. Submission for review and publication after approval are separate
actions. Neither has been performed.

See [Submit and publish](https://developers.openai.com/plugins/deploy/submission).

## Recommended sequence and effort

1. Choose private ownership/sharing semantics and legacy migration; confirm
   publisher, countries, commerce, support, and retention decisions in parallel.
2. Implement browser identity and owner-scoped boards/templates/files/events,
   quotas, deletion behavior, and meaningful cross-user acceptance tests.
3. Complete tool annotations/discovery and verification routing; test the real
   OAuth and MCP Apps flows in both hosts.
4. Prepare the public package, published listing pages, reviewer fixtures,
   five/three cases, and an actual hosted recording.
5. Validate the ZIP; perform final portal setup, scans, review, and publication.

Planning estimate: 1–2 engineering weeks for a focused beta, with ownership and
sharing taking most of that time. Email/OIDC Enterprise support and a comprehensive
data-erasure policy may extend scope. Publisher verification, legal review,
recording/access preparation, and OpenAI review time are separate dependencies.
This estimate is not a review-time guarantee.
