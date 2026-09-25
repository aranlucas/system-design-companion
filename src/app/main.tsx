import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { Home } from "./home.tsx";
import "./styles.css";

// Listing diagrams does not need the editor, its fonts, or its diagram parsers.
const Canvas = lazy(() => import("./canvas.tsx").then((module) => ({ default: module.Canvas })));

const m = location.pathname.match(/^\/d\/([A-Za-z0-9_-]+)/);
const key = new URLSearchParams(location.search).get("k");

createRoot(document.getElementById("root")!).render(
  m && key ? (
    // Excalidraw cannot show its loading UI until the editor module has downloaded.
    <Suspense
      fallback={
        <main className="home">
          <output>Loading canvas…</output>
        </main>
      }
    >
      <Canvas id={m[1]} k={key} />
    </Suspense>
  ) : (
    <Home />
  ),
);
