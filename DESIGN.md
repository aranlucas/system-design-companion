---
name: System Design Companion
description: A clear collaborative workspace with a violet connection rail and native canvas.
colors:
  primary: "#6140c4"
  primary-hover: "#5530bc"
  primary-foreground: "#ffffff"
  rail-background: "#29233f"
  rail-card: "#302b48"
  rail-foreground: "#f6f0ff"
  rail-muted: "#c9c6e3"
  rail-border: "#4c456e"
  rail-accent: "#dfd0ff"
  rail-node: "#c3a8f5"
  rail-connector: "#6e5c93"
  background: "#f8f9fa"
  foreground: "#1e1e1e"
  card: "#ffffff"
  workspace-background: "#f4f3fb"
  workspace-foreground: "#242138"
  workspace-muted: "#625d76"
  workspace-border: "#d9d7e8"
  selection-background: "#e5dbff"
  selection-foreground: "#38206f"
  error-border: "#c92a2a"
  live: "#2f9e44"
  offline: "#e03131"
  inactive: "#adb5bd"
  dark-background: "#121212"
  dark-foreground: "#e9ecef"
  dark-workspace-background: "#171322"
  dark-workspace-foreground: "#f2eaf9"
  dark-workspace-muted: "#bfb2cf"
  dark-workspace-border: "#4e405e"
  dark-card: "#241c30"
  dark-primary: "#c5a8f2"
  dark-primary-hover: "#c6b3ff"
  dark-primary-foreground: "#241343"
typography:
  display:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: "36px"
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  headline:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: "32px"
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: "22px"
    letterSpacing: "-0.02em"
  body:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
    lineHeight: 1.6
  label:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 600
  command:
    fontFamily: "monospace"
    fontSize: "12px"
  canvas-ui:
    fontFamily: "Assistant, system-ui, BlinkMacSystemFont, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
rounded:
  field: "7px"
  action: "8px"
  panel: "16px"
  card: "10px"
  tag: "4px"
  skeleton: "6px"
spacing:
  control-gap: "8px"
  field-gap: "8px"
  form-gap: "16px"
  panel-inset: "36px"
  rail-inset: "28px"
  workspace-gap: "40px"
  section-gap: "36px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.field}"
    padding: "7px 24px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  action-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.action}"
    padding: "12px 20px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.workspace-foreground}"
    rounded: "{rounded.field}"
    padding: "7px 10px"
  input:
    backgroundColor: "{colors.card}"
    textColor: "{colors.workspace-foreground}"
    rounded: "{rounded.field}"
    padding: "7px 10px"
  start-panel:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.panel}"
    padding: "36px"
  collaboration-rail:
    backgroundColor: "{colors.rail-background}"
    textColor: "{colors.rail-foreground}"
    rounded: "{rounded.panel}"
    padding: "28px"
  diagram-link:
    textColor: "{colors.workspace-foreground}"
  notice:
    rounded: "{rounded.action}"
    padding: "12px 16px"
  native-version-tag:
    backgroundColor: "var(--color-surface-low)"
    textColor: "var(--color-primary)"
    rounded: "{rounded.tag}"
    padding: "1px 6px"
  native-copy-control:
    backgroundColor: "var(--color-surface-low)"
    textColor: "var(--text-primary-color)"
    rounded: "{rounded.field}"
    padding: "7px 10px"
---

# Design System: System Design Companion

## Overview

**Creative North Star: "The Collaborative Catalogue"**

A clear workspace and a deep violet collaboration rail put the architecture work and its connection sequence side by side. Familiar operative typography, explicit labels, and a divided diagram library carry the catalogue character without imitating a drawing on the page.

The purple architecture icon anchors the identity. Form controls stay conventional; the canvas is the central work surface and keeps Excalidraw's native interface, typography, and theme. The application's palette governs entry and library work, while native canvas tokens govern editor integrations.

**Key Characteristics:**

- Familiar system typography with deliberate heading and control hierarchy.
- A quiet creation surface beside a deep violet collaboration rail.
- Divided, searchable diagram entries with visible state and recovery actions.
- Native Excalidraw menus, panels, keyboard hints, and mobile behavior.

## Colors

Violet actions and a dark collaboration rail sit against restrained neutral page surfaces. The frontmatter records exact values, including scoped workspace and dark-theme colors.

### Primary

- **Workspace Violet** (`primary`): home actions, links, input caret, and focus outlines.
- **Deep Violet Hover** (`primary-hover`): home primary-action hover.
- **Lavender Action** (`dark-primary`): the dark workspace counterpart, paired with dark plum action ink and its own lighter hover value.
- **Deep Collaboration Violet** (`rail-background`): the connection rail. Its pale text, muted lavender, border, accent, node, and connector colors remain scoped to this dark region in both page themes.

### Secondary

- **Error Red** (`error-border`): recoverable notices use a red border, retaining readable foreground text and an explicit action.
- **Live Green**, **Offline Red**, and **Inactive Grey**: connection dots pair color with the visible connection state.

### Neutral

- **Page Grey** (`background`) and **Page Ink** (`foreground`): the root document surface and inherited text.
- **White Card** (`card`): the light-theme start panel and fields.
- **Workspace Lavender**, **Workspace Plum Ink**, **Muted Plum**, and **Lavender Rule**: locally scoped home variables for commands, controls, diagram links, supporting text, and rules. The scoped background variable does not repaint the root page.
- Dark mode uses the root dark page and text plus separately scoped plum card, field, border, and command values.
- Pale lavender selection and deep selection ink are recorded as the existing text-selection pair.

**The Scope Boundary Rule.** Preserve the root page, home workspace, collaboration rail, and native canvas token scopes; resolving all four through one violet palette changes the implemented contrast relationships.

## Typography

**Application Font:** system-ui, with -apple-system, Segoe UI, and sans-serif fallbacks. This is the familiar operative voice for creation, library, and joining tasks.

**Command Font:** the browser's monospace code stack. **Native Canvas UI Font:** Excalidraw's `--ui-font`, which begins with Assistant. Drawing fonts, including the locally supplied Excalifont asset, belong to the canvas rather than the application's heading hierarchy.

### Hierarchy

- **Display:** start-panel heading, the frontmatter's display role, constrained to (18ch); it becomes (30px) below the mobile breakpoint.
- **Headline:** product heading, the frontmatter's headline role, reduced to (26px) on mobile. The native purple icon remains adjacent to it.
- **Title:** library, join, and collaboration headings. Ordinary third-level home headings use (17px).
- **Body:** page paragraphs use line height (1.6); introductory panel text is limited to (60ch). Supporting home text is (14px).
- **Label:** fields use (14px) and weight (600). Form text is (14px) on desktop and (16px) on mobile.
- **Command:** copyable code uses (12px). The native canvas panel uses (0.875rem) body text and smaller (0.8125rem) labels, following its native UI font.

**The Operative Type Rule.** Preserve the familiar application type hierarchy and let the native canvas supply its own UI and drawing fonts.

## Layout

The home container is centered with maximum width (1180px), including desktop padding (48px 32px 64px). The header has a thin bottom rule, bottom padding (32px), and a following margin (36px). The architecture icon is (44px) square.

The workspace uses `minmax(0, 1fr) 320px` columns with a gap (40px). Creation occupies the main start panel; owner diagrams follow as a divided list, and joining follows the main work. The rail contains the connection sequence and expandable setup commands. The start panel uses padding (36px), while the rail uses (28px).

At (760px) and below, the workspace becomes one column with a gap (32px). Creation fields stack; the rail follows the main content in document order. The page uses padding `28px 20px max(40px, env(safe-area-inset-bottom))`; the start panel uses (28px), and the brand icon becomes (36px). Forms keep zero-minimum-width columns, long diagram names wrap, and command text changes from horizontal scrolling to wrapping.

Home buttons and fields have minimum height (44px); the sign-in action has minimum height (48px). Canvas-panel buttons and fields have minimum height (40px), rising to (44px) on mobile. The setup disclosure has minimum height (44px), block padding (12px), and line height (20px). Labelled copy commands retain their own row and allow manual copy when the clipboard is unavailable.

The canvas fills the viewport with a fixed inset (0). Integrations render within Excalidraw's children or native slots so native tokens resolve. Its Footer is desktop-only: every footer action also has a MainMenu path on mobile. Footer content uses the existing (0.6em) gap and leading margin. Desktop toasts sit above footer controls using `calc(var(--lg-button-size) + 1.75rem)`. Connection interruption and application action feedback use a native viewport status label on both desktop and mobile.

## Elevation & Depth

The home system is flat: card tone, borders, divisions, and spacing create hierarchy. The large creation and collaboration panels have no decorative shadow. Inside the canvas, use native islands, dialogs, and their library-owned elevation. Canvas-panel buttons use the existing one-pixel surface-lowest outline shadow, which follows the native theme.

**The Native Layer Rule.** Let Excalidraw determine editor elevation and overlays; keep home hierarchy grounded in tone, spacing, and rules.

## Shapes

Large workspace and rail panels have gently curved corners (16px). Home fields and ordinary buttons use a tighter curve (7px); the primary link action and notices use (8px). Existing generic cards and the architecture icon use (10px), while compact version tags use (4px). Do not promote the generic card radius into the panel role.

The collaboration sequence uses small outlined circular nodes connected by a thin vertical rule. That is the rail's structural signature, not a decorative diagram. The canvas retains Excalidraw's own shapes, borders, and clipping behavior.

## Components

### Buttons and fields

Home controls have a thin workspace rule, card background, and compact padding (7px 10px). Primary create actions use violet, white text, and wider horizontal padding (24px); the sign-in link uses padding (12px 20px), weight (600), and a spaced arrow. Quiet controls remain transparent with a border. Hover changes the border or primary fill; focus uses an explicit two-pixel accent outline with a three-pixel offset.

Disabled home actions use opacity (0.6) and a waiting cursor. Input placeholders keep full-opacity muted ink; input caret uses the accent. Dark mode changes the primary fill and text pair together.

### Creation and library

The start panel carries the main heading and labelled creation form. The library uses divided rows rather than an equal card grid: names wrap, creation metadata remains secondary, and each destructive action names the diagram through its accessible label. Diagram links have minimum height (44px). Link hover underlines the name and uses the workspace accent. Search is explicitly scoped to loaded diagrams; loading, empty, no-match, and error states retain their actual meaning.

### Collaboration rail

The dark rail has pale ink, outlined connection nodes, a quieter connecting rule, and separate muted copy. Setup commands live in a disclosure whose summary meets the touch target. Copy controls use the rail's scoped card and border values. An unavailable clipboard exposes manual-copy guidance rather than showing a success state.

### Notices and recovery

Home notices use compact inset, a gentle curve, and a border; errors change the border and retain explicit retry or correction text. Canvas access errors use Excalidraw's native ErrorDialog through `appState.errorMessage`, with the rendered recovery message, optional "Retry canvas" action, and "All diagrams" link. Unavailable diagrams offer a fresh-link instruction and return path.

Connection state and transient action feedback use Excalidraw's native `viewportStatusFrame` label on desktop and phones; its native wrapper supplies `role="status"`. The label uses surface-low background and text-primary ink, with the viewport frame border disabled. "Offline, reconnecting…" takes priority over any transient notice. Reopening the socket clears the offline state; a pending notice may then become visible. A permanent unavailable-diagram close also clears the offline state and shows the native recovery dialog.

Action notices cover clipboard success or manual-copy recovery, version actions, component-library failures, and other canvas feedback. Each new notice replaces the previous notice and resets its lifetime (2500ms); unmounting clears the cleanup timer. The installed mobile interface omits toasts, so these actions retain the native status label rather than depending on toast visibility.

### Native canvas controls

Use Excalidraw exports before introducing custom canvas UI: MainMenu, DefaultSidebar tabs, Sidebar triggers, LiveCollaborationTrigger, WelcomeScreen, CommandPalette, native viewport status labels, and library-owned desktop toasts cover the main integrations. The MainMenu trigger is labelled "Canvas menu" through a scoped integration that survives responsive remounts.

Shared canvas-panel styles map application aliases to native values: background to surface-low, card to input background, foreground to text-primary, muted text to native grey, border to input-border, and accent to native primary. Native keyboard hints and keybindings use text-primary ink on surface-low, keeping the light and dark contrast pairs together. The canvas-scoped selector includes the explicit native dark-theme class so this pair takes precedence over the library's dark hint styling. Keep every editor integration inside `.excalidraw`.

## Do's and Don'ts

### Do:

- **Do** preserve the purple architecture icon and familiar operative control typography.
- **Do** keep creation and library work beside the collaboration rail on desktop and before it on mobile.
- **Do** preserve token scopes and pair dark action text with its corresponding dark fill.
- **Do** keep errors, empty states, and copy feedback truthful and recoverable.
- **Do** use native Excalidraw components and tokens for canvas UI, including keyboard hints and recovery.

### Don't:

- **Don't** replace native editor menus, dialogs, or sidebars with home-page styling.
- **Don't** apply home form rules globally to Excalidraw controls.
- **Don't** rely on desktop Footer actions as the only access path on mobile.
- **Don't** turn the loaded-diagram list into decorative canvas previews or unrelated equal cards.
