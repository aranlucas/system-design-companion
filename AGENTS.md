# Agent notes

## Canvas UI: library first

Before building any canvas UI (button, panel, toast, overlay, cursor, dialog, menu item), look for an Excalidraw feature that already does it, and use that instead. Read the exports in `node_modules/@excalidraw/excalidraw/dist/types/excalidraw/index.d.ts` and the props in `.../types.d.ts` (`ExcalidrawProps`, `ExcalidrawImperativeAPI`, `AppState`). Build something custom only when nothing fits, and say in the change why the library didn't cover it.

Things we've learned from this:

- **Styling.** Use Excalidraw's CSS tokens (`--island-bg-color`, `--color-surface-low`, `--text-primary-color`, `--color-primary`, …) and existing classes (`sidebar-trigger`) so the UI follows its light/dark theme. Those tokens only work inside `.excalidraw`, so render our UI inside it: pass it as `<Excalidraw>` children or slots, not as siblings.
- **`<Footer>` is desktop-only.** Excalidraw doesn't render it on mobile, so every footer action also needs a `MainMenu` item.
- **`<Footer>` spacing.** Excalidraw exports its `FooterCenter` component as `Footer`. It has no leading margin, so our content needs its own `0.6em` gap from the undo/redo buttons.

## TypeScript: named types

Declare object and tuple types as named module-level `type`s or `interface`s, not inline in signatures, casts, generics or function bodies. `pnpm lint` enforces this with `local/no-inline-types` (`lint/types-plugin.ts`, loaded as an oxlint JS plugin).

## File names

Use kebab-case for source file names, including React components (for example, `copy-row.tsx`). `pnpm lint` enforces this with `unicorn/filename-case`. Component exports stay PascalCase. Unused lint suppression comments are errors.
