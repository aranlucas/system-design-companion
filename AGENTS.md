# Agent notes

## Scripts: native first

Before adding a script file (`scripts/`, `bin/`, `tools/`, root `*.sh|*.py|*.mjs`) or a package script that runs one, take the first rung that works:

1. A flag or subcommand of a tool the repo already uses (`<tool> --help`).
2. Declarative config for that tool (`pnpm-workspace.yaml`, `vite.config.ts`, `cloudflare.config.ts`, `vitest.config.ts`, `oxfmt.config.ts`).
3. A maintained plugin for that tool.
4. A one-line package.json script that calls a native command.
5. A test in the existing runner (Vitest), for anything that asserts.
6. A custom script, only for behavior specific to this repo. Its first comment names the native rung it couldn't use and why. It has a test in the existing runner, and the PR that adds it quotes that comment.

## Code: libraries first

Use existing libraries for general-purpose behavior; custom code belongs to domain logic and integration glue. A PR adding a dependency explains its fit; a PR reimplementing library behavior explains why the library did not fit.

- Canvas UI and scene operations → `@excalidraw/excalidraw`, including its existing menus, panels and export APIs.
- Server state → TanStack Query (`useQuery`/`useMutation`).
- Directed graph layout → `@dagrejs/dagre`.
- HTTP input validation → `zod` with `@hono/zod-validator`.

### Canvas UI

For canvas UI (button, panel, toast, overlay, cursor, dialog, menu item), read the exports in `node_modules/@excalidraw/excalidraw/dist/types/excalidraw/index.d.ts` and the props in `.../types.d.ts` (`ExcalidrawProps`, `ExcalidrawImperativeAPI`, `AppState`).

- **Styling.** Use Excalidraw's CSS tokens (`--island-bg-color`, `--color-surface-low`, `--text-primary-color`, `--color-primary`, …) and existing classes (`sidebar-trigger`) so the UI follows its light/dark theme. Those tokens only work inside `.excalidraw`, so render our UI inside it: pass it as `<Excalidraw>` children or slots, not as siblings.
- **`<Footer>` is desktop-only.** Excalidraw doesn't render it on mobile, so every footer action also needs a `MainMenu` item.
- **`<Footer>` spacing.** Excalidraw exports its `FooterCenter` component as `Footer`. It has no leading margin, so our content needs its own `0.6em` gap from the undo/redo buttons.
