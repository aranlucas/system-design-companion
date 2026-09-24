# System Design Companion — Design

A collaborative Excalidraw canvas that a human, an interviewer and an AI agent (Claude Code over MCP) edit together in real time.

## Architecture

```
 Browser tab(s)  ──WebSocket──►  DiagramRoom DO (one per diagram)  ◄──RPC──  /mcp (stateless, MCP SDK v2)
 (you, interviewer)               live scene in DO SQLite                    ▲
                                  snapshots → R2, metadata → D1              │ Streamable HTTP /mcp
                                                                             Claude Code
```

- **DiagramRoom DO** is the core. It owns the live scene, merges concurrent edits using Excalidraw element versioning (higher `version` wins, tie → lower `versionNonce`), broadcasts to all tabs, and exposes an **ops layer** (`applyPatch`, `getGraph`, `snapshot`, …). MCP is a thin adapter over it, and a future in-room agent will reuse the same layer.
- **MCP endpoint** (`/mcp`, MCP TypeScript SDK v2 `@modelcontextprotocol/server`) is fully stateless, per the 2026-07-28 spec (no protocol sessions). State is held by the client: the diagram's **share link is the handle**, and every diagram tool takes it as the `diagram` argument. The server stores nothing per agent. (The Agents SDK's `McpAgent` only supports SDK v1, so it isn't used.)
- **Frontend**: Vite + React + `@excalidraw/excalidraw`, served as Workers static assets.
- **Storage**: live scene in the DO's SQLite; snapshots and user templates as JSON in R2; diagram and snapshot metadata in D1.

## Auth: capability links

- Each diagram has a link `/d/:id?k=<key>`. The key is stored as a SHA-256 hash in D1 and is required for WebSocket and ops access.
- There is no user account. The agent can touch a diagram only if its context holds that diagram's link.
- The link is the edit-share link; hand it to the interviewer.

## Selection and focus

Tabs report `focus`, `selection` and `viewport` to their room. `get_selection` and screenshots use the most recently focused tab of that diagram.

## Agent edits

- Scene edits are prepared on isolated element copies. Element writes roll back together on failure; the room updates memory and broadcasts only after the transaction succeeds.
- Every `apply_patch` / `import_mermaid` / `layout` batch takes an automatic snapshot first, and `restore` undoes it.
- Agent-created elements are tinted violet and tagged `customData.author = "agent"`.
- The agent may modify or delete anything, with snapshots as the safety net.
- Nodes are addressed by element id or unique label; ambiguous labels are an error.
- Placement hints (`right_of`, `left_of`, `below`, `above`, `near`, `inside` frame) are resolved to coordinates with overlap nudging. Existing layout is never reflowed unless `layout` is called.

## MCP surface

| Tool                                                           | Purpose                                              |
| -------------------------------------------------------------- | ---------------------------------------------------- |
| `join_session(diagram)`                                        | Validate the link, return summary                    |
| `create_diagram(name, template?)`                              | New diagram, returns its link (the handle)           |
| `get_scene(diagram, format)`                                   | `graph` (nodes/edges/frames/notes/sketches) or `raw` |
| `get_selection(diagram)`                                       | Current human selection + viewport, as graph         |
| `get_screenshot(diagram, scope)`                               | PNG rendered by an open tab                          |
| `apply_patch(ops[])`                                           | Batched semantic ops                                 |
| `layout(direction, scope?)`                                    | Explicit dagre auto-layout                           |
| `import_mermaid(source)`                                       | Rendered by the open tab, added as agent elements    |
| `snapshot(name)` / `list_snapshots()` / `restore(snapshot_id)` | Versions                                             |
| `list_templates()` / `save_as_template(name)`                  | Starter layouts                                      |

**Prompts**: `review_design`, `suggest_next_step`, `estimate_capacity`. **Resource**: `rubric://system-design`.

## Formatting without overriding

- **Prevention on agent edits**: notes are word-wrapped at about 64 characters. New nodes and notes join the frame of whatever they are placed relative to, or the frame they land inside. Moving a frame moves its contents. A frame that grows pushes overlapping frames right or down, moving each as a block.
- **`tidy`** (MCP tool, **Tidy** button, and automatically on the frames each agent patch touched): attach loose items to the frame they sit in, wrap over-long notes, snap nearly-aligned boxes onto the largest box in the row or column, separate overlaps with the smallest push, grow frames to fit, and pull overlapping frames apart. It never changes connections, labels, colours or relative order. It is idempotent: a second run changes nothing. It is snapshotted first, and the full dagre `layout` stays opt-in.

## Deferred (post-interview)

In-room agent with chat panel and push reactions; anchored comment threads; GitHub OAuth; proposal/ghost layer; server-side lint.
