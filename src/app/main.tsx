import { requiredValue } from "../shared/required-value.ts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense } from "react";
import { LazyCanvas } from "./lazy-canvas.tsx";
import { createRoot } from "react-dom/client";
import { Home } from "./home.tsx";
import "./styles.css";

const queryClient = new QueryClient();

const m = location.pathname.match(/^\/d\/([A-Za-z0-9_-]+)/);

const key = new URLSearchParams(location.search).get("k");

createRoot(
  requiredValue(document.querySelector("#root"), 'document.querySelector("#root")'),
).render(
  <QueryClientProvider client={queryClient}>
    {m && key ? (
      // Excalidraw cannot show its loading UI until the editor module has downloaded.
      <Suspense
        fallback={
          <main className="home">
            <output>Loading canvas…</output>
          </main>
        }
      >
        <LazyCanvas id={m[1]} k={key} />
      </Suspense>
    ) : (
      <Home />
    )}
  </QueryClientProvider>,
);
