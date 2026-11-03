# Design intent

The canvas is the central work surface. The home page helps people create or find
work, then connect their collaborator and agent. Keep the purple architecture icon,
system typography, and deep violet collaboration rail as the product identity.

Creation and the diagram library lead on desktop, beside the connection sequence.
On mobile, creation comes first and the rail follows in document order. Use divided
library rows with meaningful names and recovery actions; search covers loaded
diagrams, so label that scope explicitly.

## Theme boundaries

Keep the root page, home workspace, collaboration rail, and native canvas as separate
style scopes. The rail stays dark in both themes; dark home actions need their paired
foreground and fill. Exact tokens, dimensions, and breakpoints belong in
[src/app/styles.css](src/app/styles.css), rather than a second token catalog here.

Excalidraw owns editor menus, dialogs, typography, elevation, and drawing controls.
Home form styles must remain scoped so they do not leak into native canvas controls.
For canvas integrations, follow [AGENTS.md](AGENTS.md#canvas-ui).

## Feedback and recovery

Keep empty, loading, offline, and error states distinct. Give recoverable failures an
action or return path. Clipboard failure needs manual-copy guidance. Color must be
paired with text for connection state.

Use native canvas recovery dialogs and the viewport status label. The installed
mobile interface omits desktop toasts, so important feedback must also reach the
status label. Offline status takes priority over transient action notices.
