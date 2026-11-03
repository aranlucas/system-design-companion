<p align="center">
  <img src="public/icons/system-design-128.png" alt="" width="96" height="96" />
</p>

<h1 align="center">System Design Companion</h1>

<p align="center">
  Draw the system. Explain the trade-offs. Let your AI agent keep up.
</p>

<p align="center">
  <a href="https://github.com/aranlucas/system-design-companion/actions/workflows/ci.yml"><img src="https://github.com/aranlucas/system-design-companion/actions/workflows/ci.yml/badge.svg" alt="Checks" /></a>
</p>

<p align="center">
  <a href="#a-session">A session</a> ·
  <a href="docs/setup.md">Set up</a> ·
  <a href="docs/design.md">Design</a>
</p>

You, your interviewer and Claude Code (or Codex) work on the same Excalidraw canvas in
real time. The agent sees the diagram as components and connections, not pixels. It can
add to it, rearrange it, point at parts of it and review it, while everyone watches the
changes land.

> **Try the interview moment:** say “add a cache in front of the database,” then
> point at the write path and ask “what breaks at 10× traffic?” The canvas and
> the conversation move together.

The browser link is the capability: anyone who has a diagram's share link can
edit that board. Sign in through [Auth](https://auth.aranlucas.workers.dev/) to create diagrams and manage your private
library and templates. Collaborators can draw using a shared link without signing
in. Agents authorize access through OAuth using your signed-in account.

## A session

1. Create a diagram, blank or from a template, and share its link with your interviewer.
2. Tell your MCP agent “join” and paste the link. Approve its browser sign-in and consent
   request on first connection.
3. Draw together. Select a component to give “this” a precise meaning, then ask the agent
   to add a cache, explain a trade-off, or review the design.
4. Use **Versions** to restore an agent edit or save a named checkpoint. Save reusable
   layouts as private templates.

The canvas includes a component library, frames, **Tidy** for local cleanup, and
opt-in graph layout. Agents can import Mermaid, point at components, and take
screenshots; those three actions require an open canvas tab. Supporting MCP Apps
hosts can show an inline diagram preview.

For solo practice, open **Interviewer**, connect your ChatGPT account, and select
**Start interview**. It observes drawing changes and asks questions in the sidebar.
Closing the sidebar pauses automatic requests; the conversation resets on reload.
See [interviewer setup and limits](docs/setup.md#sidebar-interviewer).

## Set up and contribute

[Setup](docs/setup.md) covers local development, Cloudflare resources, sign-in,
MCP clients, and checks. [Architecture and contracts](docs/design.md) explains
collaboration, persistence, security, and recovery. [Product priorities](ROADMAP.md)
records the proposed practice-session releases and acceptance criteria.

Treat share links as editing credentials. Owners can permanently delete a board,
including its uploaded files and versions; independently saved template copies
remain separate. Legacy boards stay reachable through their original links but
need explicit ownership assignment to appear in private libraries.

Agents can subscribe to board changes through signed webhooks. Delivery is
best-effort with no replay; see [event setup](docs/setup.md#mcp-events) before
using this for monitoring. Interactive browser sign-in is required to authorize
MCP clients.
