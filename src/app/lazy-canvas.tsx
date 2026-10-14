import { lazy } from "react";

// Listing diagrams does not need the editor, its fonts, or its diagram parsers.
export const LazyCanvas = lazy(() =>
  import("./canvas.tsx").then((module) => ({ default: module.Canvas })),
);
