// This Excalidraw release ships monorepo aliases in its public declaration entry.
// Resolve them to the same package's published declarations instead of inventing types.
declare module "@excalidraw/utils/export" {
  export * from "@excalidraw/excalidraw/utils/export";
}

declare module "@excalidraw/element/types" {
  export * from "@excalidraw/excalidraw/element/types";
}
