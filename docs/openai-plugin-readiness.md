# Public publishing acceptance

This is a release plan derived from the September 2026 publishing assessment,
not a current production status report. The private plugin package lives outside
this repository; package changes belong in its canonical source, not the cache.
Revalidate portal requirements against the linked official guidance before release.

## Decisions and remaining evidence

- Confirm the verified publisher/organization, canonical plugin source, payment
  behavior, support channel, and published website/support/privacy/terms URLs.
  The prior plan selected all available countries; reconfirm that release decision.
- Define total storage/subscription quotas and snapshot retention. Request and
  operation bounds do not limit total retained storage. Verify log redaction before
  committing to privacy claims.
- Decide legacy-board ownership migration and whether sharing needs withdrawal,
  key rotation, or a viewer tier. Preserve the intentional editing capability of
  existing links; never assign legacy boards to their first visitor.
- Privacy commitments must account for diagram/image data, Auth identity,
  Cloudflare storage/logs, webhook recipients, deletion retries, and independent
  template copies. Confirm retention and erasure behavior before promising it.
- Use dedicated reviewer accounts and sample data that require no publisher MFA,
  private network, or personal mailbox. Enter credentials only in secure portal fields.

Current access, deletion, and persistence contracts are in
[design.md](design.md#identity-and-board-access). Implementation and unit tests do
not establish what is deployed or prove hosted authorization.

## Host acceptance

Verify ChatGPT and Codex can install, authenticate, escalate to write scope,
refresh, disconnect, and reconnect. Inspect emitted tool metadata against enforced
scopes and effects, including partial patch failures. Inputs remain enumerated
operations; never extend a documented diagram operation into an undisclosed executor.

Test inline preview, app-only tool authorization, CSP/font loading, fullscreen,
light/dark appearance, narrow layouts, keyboard access, and error recovery.
Screenshots, Mermaid import, and focus need an open canvas tab; test recovery
without one. The inline preview uses placeholders for images/embeds/iframes.
Review and capacity estimation are prompts, so verify equivalent bundled-skill
workflows in hosts without prompt/resource discovery.

If events ship, test real callback verification, agent-edit suppression,
unsubscribe, and grant revocation. Follow [event setup](setup.md#mcp-events);
monitoring remains best-effort with no replay. Browser reachability alone does
not prove scanner reachability. Enterprise identity requirements need separate
validation; never synthesize a verified email from an Auth subject.

References: [authentication](https://developers.openai.com/plugins/build/auth),
[tool annotations](https://developers.openai.com/plugins/plugin-guidelines#correct-annotation).

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

The September 2026 publishing plan used five positive and three negative cases.
Recheck current portal/package requirements before encoding them in a public manifest.
Keep execution status and private access details outside the package.

## Package and release handoff

Reuse the existing stable package name, skill, and branding. Prepare the public
package from canonical source with portable manifests, MCP configuration, skills,
and assets. Exclude credentials, private app bindings, and unsupported hooks.
The public logo and composer-icon candidates are
[`system-design-512.png`](../public/icons/system-design-512.png) and
[`system-design-128.png`](../public/icons/system-design-128.png).

Record a real host walkthrough with sample prompts, tool results, inline preview,
browser canvas, restore, and one unsupported request. Record host/server versions,
check playback for secrets and readability, then provide a reviewer-accessible URL.
A canvas-only recording does not demonstrate the plugin conversation.

Validate the versioned archive itself, including manifest compatibility, endpoint,
contained assets, skills, listing links, review cases, and release metadata. Use the
intended organization/project and verified publisher for a draft upload. Connect
the authenticated MCP server, complete [domain verification](setup.md#domain-verification),
inspect scans, and run the review cases against the saved draft. Developer policy
attestations, submission, and publication are separate release steps.

References: [packaging](https://developers.openai.com/plugins/build/plugins),
[submission errors](https://developers.openai.com/plugins/deploy/submission-errors),
[submission and publication](https://developers.openai.com/plugins/deploy/submission).
