import {
  assertBoundary,
  isCreatedDiagram,
  isApiFailure,
  isBrowserSession,
  isTemplateList,
  isDiagramPage,
  type BrowserSession,
  type Template,
  type DiagramPage,
  type Diagram,
} from "./validation.ts";
import { useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { getJson } from "./queries.ts";
import { apiErrorMessage } from "./api-error.ts";
import { CopyRow } from "./copy-row.tsx";
import { linkFor, remember, setupCommands } from "./local.ts";

function initialCursor(): string | null {
  return null;
}

export function Home() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [template, setTemplate] = useState("");
  const [search, setSearch] = useState("");
  const [shareLink, setShareLink] = useState("");
  const [joinError, setJoinError] = useState("");

  const session = useQuery({
    queryKey: ["session"],
    queryFn: ({ signal }) => getJson<BrowserSession>("/api/auth/session", signal, isBrowserSession),
  });

  const signedIn = session.data?.signedIn;

  const templatesQuery = useQuery({
    queryKey: ["templates", signedIn],
    queryFn: ({ signal }) => getJson<Template[]>("/api/templates", signal, isTemplateList),
    enabled: signedIn !== undefined,
  });

  const diagrams = useInfiniteQuery({
    queryKey: ["diagrams"],
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: "50" });

      if (pageParam) params.set("cursor", pageParam);

      return getJson<DiagramPage>(`/api/diagrams?${params}`, signal, isDiagramPage);
    },
    initialPageParam: initialCursor(),
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

      const body: unknown = await response.json();

      if (!response.ok)
        throw new Error(
          apiErrorMessage(isApiFailure(body) ? body : {}, "Could not create the diagram."),
        );

      assertBoundary(body, isCreatedDiagram);

      return body;
    },
    onSuccess: (diagram) => {
      remember({ id: diagram.id, key: diagram.key, name: diagram.name });
      location.href = linkFor(diagram.id, diagram.key);
    },
  });

  const visibleItems = items.filter((item) =>
    item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase().trim()),
  );

  function removeDiagram(diagram: Diagram) {
    if (
      window.confirm(
        `Delete “${diagram.name}”? This permanently removes its canvas, images and saved versions for everyone.`,
      )
    )
      remove.mutate(diagram);
  }

  return (
    <main className="home" id="workspace">
      <header className="home-header">
        <div className="brand">
          <img src="/icons/system-design-128.png" width="44" height="44" alt="" />
          <div>
            <h1>System Design</h1>
            <p className="muted">
              A shared Excalidraw canvas for you, your interviewer, and your agent.
            </p>
          </div>
        </div>
        {signedIn && (
          <button className="quiet" disabled={logout.isPending} onClick={() => logout.mutate()}>
            {logout.isPending ? "Signing out…" : "Sign out"}
          </button>
        )}
      </header>
      {session.error && (
        <div role="alert" className="notice error">
          <p>Could not check your sign-in. {session.error.message}</p>
          <button onClick={() => void session.refetch()}>Retry sign-in check</button>
        </div>
      )}
      {logout.error && (
        <p role="alert" className="notice error">
          {logout.error.message}
        </p>
      )}
      <div className="home-workspace">
        <div className="workspace-main">
          {session.isLoading && (
            <section className="start-panel" aria-busy="true">
              <h2>Opening your workspace</h2>
              <output className="muted">Checking sign-in…</output>
              <div className="skeleton" />
              <div className="skeleton short" />
            </section>
          )}
          {signedIn === false && (
            <section className="start-panel">
              <h2>Start with a shared canvas.</h2>
              <p>
                Sketch the architecture, work through the tradeoffs, and bring your interviewer or
                agent onto the same canvas.
              </p>
              <a className="primary action" href="/api/auth/login">
                Sign in with GitHub <span aria-hidden="true">→</span>
              </a>
              <p className="muted">
                Sign in to create diagrams and open your private library. Anyone with a diagram’s
                share link can still collaborate.
              </p>
            </section>
          )}
          {signedIn && (
            <section className="start-panel" aria-labelledby="new-diagram-title">
              <h2 id="new-diagram-title">New diagram</h2>
              <p className="muted">Start from a blank canvas or give your design a framework.</p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();

                  if (!creation.isPending) creation.mutate();
                }}
                className="create-form"
              >
                <div className="field">
                  <label htmlFor="new-diagram-name">Diagram name</label>
                  <input
                    id="new-diagram-name"
                    maxLength={120}
                    placeholder="e.g. Design a fleet telemetry system"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={creation.isPending}
                  />
                </div>
                <div className="field">
                  <label htmlFor="diagram-template">Starting point</label>
                  <select
                    id="diagram-template"
                    value={template}
                    onChange={(e) => setTemplate(e.target.value)}
                    disabled={creation.isPending || templatesQuery.isLoading}
                  >
                    <option value="">Blank canvas</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id} title={t.description}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
                <button className="primary" disabled={creation.isPending}>
                  {creation.isPending ? "Creating…" : "Create diagram"}
                </button>
              </form>
              {template && (
                <p className="muted">
                  {templates.find((item) => item.id === template)?.description}
                </p>
              )}
              {templatesQuery.error && (
                <div role="alert" className="notice error">
                  <p>Starting points could not be loaded. You can still create a blank canvas.</p>
                  <button onClick={() => void templatesQuery.refetch()}>
                    Retry starting points
                  </button>
                </div>
              )}
              {creation.error && (
                <p role="alert" className="notice error">
                  {creation.error.message} Your name and starting point are preserved; try creating
                  again.
                </p>
              )}
            </section>
          )}
          {signedIn && (
            <section className="diagram-library" aria-labelledby="library-title">
              <div className="section-heading">
                <h2 id="library-title">Your diagrams</h2>
                <span className="muted">{items.length} loaded</span>
              </div>
              {items.length > 0 && (
                <div className="field search-field">
                  <label htmlFor="diagram-search">Find a loaded diagram</label>
                  <input
                    id="diagram-search"
                    type="search"
                    placeholder="Search by name"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              )}
              {diagrams.isLoading && (
                <div aria-busy="true">
                  <output className="muted">Loading your diagrams…</output>
                  <div className="skeleton" />
                  <div className="skeleton" />
                </div>
              )}
              {diagrams.error && (
                <div role="alert" className="notice error">
                  <p>{diagrams.error.message}</p>
                  <button onClick={() => void diagrams.refetch()}>Retry diagrams</button>
                </div>
              )}
              {remove.error && (
                <p role="alert" className="notice error">
                  {remove.error.message}
                </p>
              )}
              {!diagrams.isLoading && !diagrams.error && items.length === 0 && (
                <div className="empty-library">
                  <h3>Your first design starts above.</h3>
                  <p className="muted">
                    Create a diagram, or ask your agent to create one. Your shared canvases will
                    appear here.
                  </p>
                  <button
                    className="quiet"
                    onClick={() => document.getElementById("new-diagram-name")?.focus()}
                  >
                    Name your first diagram
                  </button>
                </div>
              )}
              {items.length > 0 && visibleItems.length === 0 && (
                <div className="empty-library">
                  <h3>No loaded diagrams match “{search}”.</h3>
                  <p className="muted">Try another name, or load more diagrams below.</p>
                  <button className="quiet" onClick={() => setSearch("")}>
                    Clear search
                  </button>
                </div>
              )}
              <ul className="list diagram-list">
                {visibleItems.map((d) => (
                  <li key={d.id}>
                    <a href={linkFor(d.id, d.key)}>
                      <span>{d.name}</span>
                      <span className="muted">
                        Created{" "}
                        {new Date(d.createdAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                    </a>
                    <button
                      className="quiet delete-diagram"
                      disabled={remove.isPending}
                      aria-label={`Delete ${d.name}`}
                      onClick={() => removeDiagram(d)}
                    >
                      {remove.isPending && remove.variables.id === d.id ? "Deleting…" : "Delete"}
                    </button>
                  </li>
                ))}
              </ul>
              {diagrams.hasNextPage && (
                <button
                  disabled={diagrams.isFetching}
                  onClick={() => void diagrams.fetchNextPage()}
                >
                  {diagrams.isFetchingNextPage ? "Loading…" : "Load more diagrams"}
                </button>
              )}
            </section>
          )}
          <section className="join-section" aria-labelledby="join-title">
            <h2 id="join-title">Have a share link?</h2>
            <p className="muted">
              Open the same canvas as your interviewer. You can join without signing in.
            </p>
            <form
              className="row"
              onSubmit={(event) => {
                event.preventDefault();

                try {
                  const url = new URL(shareLink.trim(), location.origin);

                  if (
                    url.origin !== location.origin ||
                    !/^\/d\/[A-Za-z0-9_-]+\/?$/.test(url.pathname) ||
                    !url.searchParams.get("k")
                  )
                    throw new Error("invalid");
                  location.assign(url.href);
                } catch {
                  setJoinError(
                    "Paste a full diagram share link from this System Design workspace, including its key.",
                  );
                }
              }}
            >
              <div className="field">
                <label htmlFor="join-link">Diagram share link</label>
                <input
                  id="join-link"
                  type="text"
                  placeholder="Paste the diagram’s edit link"
                  value={shareLink}
                  onChange={(event) => {
                    setShareLink(event.target.value);
                    setJoinError("");
                  }}
                  aria-invalid={Boolean(joinError)}
                  aria-describedby={joinError ? "join-error" : undefined}
                  required
                />
              </div>
              <button>Open canvas</button>
            </form>
            {joinError && (
              <p id="join-error" role="alert" className="notice error">
                {joinError}
              </p>
            )}
          </section>
        </div>
        <aside className="setup-panel" aria-labelledby="agent-title">
          <h2 id="agent-title">Bring your agent</h2>
          <p className="muted">One canvas. A shared conversation.</p>
          <ol className="setup-steps">
            <li>
              <strong>Connect once</strong>
              <p className="muted">Add System Design to Claude Code or Codex.</p>
            </li>
            <li>
              <strong>Share your canvas</strong>
              <p className="muted">Paste a diagram’s edit link and ask your agent to join.</p>
            </li>
            <li>
              <strong>Design together</strong>
              <p className="muted">Sketch, inspect the design, and save versions as you go.</p>
            </li>
          </ol>
          <details className="agent-commands">
            <summary>Agent setup commands</summary>
            <p className="muted">Run the command for your client in your terminal.</p>
            {setupCommands().map(({ client, cmd }) => (
              <CopyRow key={client} label={client} text={cmd} />
            ))}
          </details>
          <p className="muted setup-note">
            The canvas menu keeps sharing, versions, and the component library close at hand.
          </p>
        </aside>
      </div>
    </main>
  );
}
