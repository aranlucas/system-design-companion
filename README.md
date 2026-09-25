<p align="center">
  <img src="public/icons/system-design-128.png" alt="" width="96" height="96" />
</p>

<h1 align="center">System Design Companion</h1>

<p align="center">
  A shared whiteboard for system design interviews, where your AI agent draws alongside you.
</p>

<p align="center">
  <a href="#a-session">A session</a> ·
  <a href="#what-you-can-do">Features</a> ·
  <a href="docs/setup.md">Set up</a> ·
  <a href="docs/design.md">Design</a>
</p>

You, your interviewer and Claude Code (or Codex) work on the same Excalidraw canvas in
real time. The agent sees the diagram as components and connections, not pixels. It can
add to it, rearrange it, point at parts of it and review it, while everyone watches the
changes land.

## A session

1. **Start a diagram**, blank or from a template: an interview framework (requirements,
   estimates, API, high-level design, deep dives), a web-service baseline, a read-heavy
   URL shortener or a realtime chat/feed fan-out.
2. **Share the link** with your interviewer. Anyone with it can edit, and you see each
   other's cursors and selections.
3. **Tell your agent "join" and paste the link.** From then on, you can talk about the
   diagram in plain words: "add a cache in front of the database", "split the write
   path into a queue".
4. **Point and ask.** Select something on the canvas and ask "what about this?". The
   agent knows what you selected.
5. **Go deeper.** Ask the agent to review the design against a system design rubric,
   suggest the next step, or do back-of-envelope capacity estimates and write them onto
   the canvas.

## What you can do

**Draw together**

- Live multiplayer canvas with cursors, selections and presence, for any number of tabs.
- A component library of editable icons: people, devices, phones, databases, servers,
  caches, queues, load balancers, clouds, object storage, search, auth, DNS,
  notifications and schedulers. Each icon connects, moves and resizes as a single piece.
- Frames to organise a design into sections, like the interview framework's stages.

**Work with the agent**

- The agent edits with high-level operations (add a component, connect two, rename,
  restyle, group into a frame) rather than raw drawing commands. Its work shows up in
  violet, and a toast tells you when it changed something.
- It can **focus** everyone's view on a component, or **point** at it with a temporary
  laser marker, without touching the diagram.
- Each edit brings the changed components into view in every open tab.
- It can import Mermaid diagrams, lay out a section as a layered graph when you ask,
  and take a screenshot of the canvas to check its own work.
- In chat apps that support [MCP Apps](https://modelcontextprotocol.io/extensions/apps)
  (Claude Desktop and web, ChatGPT, VS Code), the conversation shows a live hand-drawn
  picture of the canvas.

**Keep it readable**

- **Tidy** cleans up without redesigning: it fixes overlaps, near-miss alignments and
  uneven spacing, keeps connections inside their frame, and moves grouped artwork as one
  piece. Select something first to tidy only that part.
- Agent edits are tidied as they land, and long notes wrap automatically.

**Never lose work**

- Every agent edit is saved as a version first, named after the change, so one click in
  **Versions** undoes it.
- Save your own checkpoints, and save a good layout as a template to start from next time.

**Find your diagrams**

- **All diagrams** lists every board in the deployment, including ones the agent created.
  Rename a diagram from its title, and delete it (with confirmation) for everyone.

> A deployment is a shared workspace: anyone who can reach it can list, open and edit its
> diagrams. Put it behind access controls if it should be private.

## Get started

Run it locally or deploy it to Cloudflare, then connect your agent. It takes one command
each: see [docs/setup.md](docs/setup.md).

How it's built (a Cloudflare Worker with one Durable Object per diagram) is in
[docs/design.md](docs/design.md).
