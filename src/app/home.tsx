import { useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { getJson } from "./queries.ts";
import { apiErrorMessage, type ApiFailure } from "./api-error.ts";
import { CopyRow } from "./copy-row.tsx";
import { linkFor, remember, setupCommands } from "./local.ts";

/** What POST /api/diagrams answers. */
type CreatedDiagram = { id: string; key: string; name: string } & ApiFailure;
type BrowserSession = { signedIn: boolean };

interface Diagram {
  id: string;
  key: string;
  name: string;
  createdAt: number;
}

interface DiagramPage {
  items: Diagram[];
  nextCursor: string | null;
}

interface Template {
  id: string;
  name: string;
  description: string;
}

export function Home() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [template, setTemplate] = useState("");
  const session = useQuery({
    queryKey: ["session"],
    queryFn: ({ signal }) => getJson<BrowserSession>("/api/auth/session", signal),
  });
  const signedIn = session.data?.signedIn;
  const templatesQuery = useQuery({
    queryKey: ["templates", signedIn],
    queryFn: ({ signal }) => getJson<Template[]>("/api/templates", signal),
    enabled: signedIn !== undefined,
  });
  const diagrams = useInfiniteQuery({
    queryKey: ["diagrams"],
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: "50" });
      if (pageParam) params.set("cursor", pageParam);
      return getJson<DiagramPage>(`/api/diagrams?${params}`, signal);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: signedIn === true,
    refetchInterval: 10_000,
  });
  const items = signedIn ? (diagrams.data?.pages.flatMap((page) => page.items) ?? []) : [];
  const templates = templatesQuery.data ?? [];
  const remove = useMutation({
    mutationFn: async (diagram: Diagram) => {
      const response = await fetch(`/api/diagrams/${diagram.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not delete diagram. Please try again.");
      return diagram.id;
    },
    onSuccess: async (id) => {
      await queryClient.cancelQueries({ queryKey: ["diagrams"] });
      queryClient.setQueryData<InfiniteData<DiagramPage>>(
        ["diagrams"],
        (data) =>
          data && {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              items: page.items.filter((diagram) => diagram.id !== id),
            })),
          },
      );
      await queryClient.invalidateQueries({ queryKey: ["diagrams"] });
    },
  });
  const logout = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Could not sign out. Try again.");
    },
    onSuccess: async () => {
      await queryClient.cancelQueries();
      queryClient.removeQueries({ queryKey: ["diagrams"] });
      queryClient.removeQueries({ queryKey: ["templates"] });
      queryClient.setQueryData<BrowserSession>(["session"], { signedIn: false });
      setTemplate("");
    },
  });
  const creation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/diagrams", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name || "Untitled", template }),
      });
      const diagram = (await response.json()) as CreatedDiagram;
      if (!response.ok) throw new Error(apiErrorMessage(diagram, "Could not create the diagram."));
      return diagram;
    },
    onSuccess: (diagram) => {
      remember({ id: diagram.id, key: diagram.key, name: diagram.name });
      location.href = linkFor(diagram.id, diagram.key);
    },
  });
  const loading = session.isLoading || (signedIn === true && diagrams.isLoading);
  const error =
    session.error?.message ||
    logout.error?.message ||
    creation.error?.message ||
    remove.error?.message ||
    (signedIn && (diagrams.error?.message || templatesQuery.error?.message));

  function removeDiagram(diagram: Diagram) {
    if (
      window.confirm(
        `Delete “${diagram.name}”? This permanently removes its canvas, images and saved versions for everyone.`,
      )
    )
      remove.mutate(diagram);
  }

  return (
    <main className="home">
      <h1>
        <img src="/icons/system-design-128.png" width="40" height="40" alt="" />
        System Design
      </h1>
      <p className="muted">
        A shared Excalidraw canvas that you, your interviewer, and Claude edit together.
      </p>

      <section className="card">
        {session.isLoading && <p className="muted">Checking sign-in…</p>}
        {signedIn === false && (
          <p>
            <a href="/api/auth/login">Sign in with GitHub</a> to create diagrams and open your
            private library. Anyone with a diagram's share link can still collaborate.
          </p>
        )}
        {signedIn && (
          <button className="link" disabled={logout.isPending} onClick={() => logout.mutate()}>
            Sign out
          </button>
        )}
      </section>

      {signedIn && (
        <section className="card">
          <h2>New diagram</h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              creation.mutate();
            }}
            className="row"
          >
            <input
              placeholder="Name, e.g. Design Twitter"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <select value={template} onChange={(e) => setTemplate(e.target.value)}>
              <option value="">Blank</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id} title={t.description}>
                  {t.name}
                </option>
              ))}
            </select>
            <button disabled={creation.isPending}>
              {creation.isPending ? "Creating…" : "Create"}
            </button>
          </form>
        </section>
      )}

      <section className="card">
        <h2>Connect your agent</h2>
        <p className="muted">
          Run once in your terminal. Then paste a diagram's share link to the agent ("join
          &lt;link&gt;").
        </p>
        {setupCommands().map(({ client, cmd }) => (
          <CopyRow key={client} label={client} text={cmd} />
        ))}
      </section>

      <section className="card">
        <h2>Your diagrams</h2>
        {loading && <p className="muted">Loading diagrams…</p>}
        {error && <p role="alert">{error}</p>}
        {signedIn && !loading && !error && items.length === 0 && (
          <p className="muted">No diagrams yet. Create one here or through your agent.</p>
        )}
        <ul className="list">
          {items.map((d) => (
            <li key={d.id}>
              <a href={linkFor(d.id, d.key)}>{d.name}</a>
              <span className="muted">{new Date(d.createdAt).toLocaleString()}</span>
              <button
                className="link"
                disabled={remove.isPending}
                aria-label={`Delete ${d.name}`}
                onClick={() => removeDiagram(d)}
              >
                {remove.isPending && remove.variables.id === d.id ? "Deleting…" : "Delete"}
              </button>
            </li>
          ))}
        </ul>
        {signedIn && diagrams.hasNextPage && (
          <button disabled={diagrams.isFetching} onClick={() => void diagrams.fetchNextPage()}>
            {diagrams.isFetchingNextPage ? "Loading…" : "Load more diagrams"}
          </button>
        )}
      </section>
    </main>
  );
}
