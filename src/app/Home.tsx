import { useEffect, useRef, useState } from "react";
import { CopyRow } from "./CopyRow.tsx";
import { linkFor, remember, setupCommands } from "./local.ts";

/** What POST /api/diagrams answers. */
type CreatedDiagram = { id: string; key: string; name: string; error?: string };

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
  const [items, setItems] = useState<Diagram[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageCount, setPageCount] = useState(1);
  const [revision, setRevision] = useState(0);
  const [deleting, setDeleting] = useState<string | null>(null);
  const deletedIds = useRef(new Set<string>());
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [name, setName] = useState("");
  const [template, setTemplate] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    async function refresh() {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const diagrams: Diagram[] = [];
        let cursor: string | null = null;
        for (let page = 0; page < pageCount; page++) {
          const params = new URLSearchParams({ limit: "50" });
          if (cursor) params.set("cursor", cursor);
          // Each page depends on the previous response's cursor.
          // oxlint-disable-next-line no-await-in-loop
          const response = await fetch(`/api/diagrams?${params}`, {
            cache: "no-store",
            signal: controller.signal,
          });
          if (!response.ok) throw new Error("Could not load diagrams. Retrying automatically.");
          // oxlint-disable-next-line no-await-in-loop
          const result = (await response.json()) as DiagramPage;
          diagrams.push(...result.items);
          cursor = result.nextCursor;
          if (!cursor) break;
        }
        if (!controller.signal.aborted) {
          setItems(diagrams.filter((d) => !deletedIds.current.has(d.id)));
          setNextCursor(cursor);
          setError("");
        }
      } catch (err) {
        if (!controller.signal.aborted) setError((err as Error).message);
      } finally {
        pending = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void refresh();
    const timer = window.setInterval(refresh, 10000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [pageCount, revision]);

  useEffect(() => {
    fetch("/api/templates")
      .then((r) => r.json())
      .then(setTemplates)
      .catch(() => {});
  }, []);

  async function removeDiagram(diagram: Diagram) {
    if (
      !window.confirm(
        `Delete “${diagram.name}”? This removes it for everyone and disables its share links.`,
      )
    )
      return;
    setDeleting(diagram.id);
    try {
      const response = await fetch(`/api/d/${diagram.id}?k=${encodeURIComponent(diagram.key)}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Could not delete diagram. Please try again.");
      deletedIds.current.add(diagram.id);
      setItems((current) => current.filter((d) => d.id !== diagram.id));
      setError("");
      setRevision((current) => current + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeleting(null);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/diagrams", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name || "Untitled", template }),
      });
      const d = (await res.json()) as CreatedDiagram;
      if (!res.ok) throw new Error(d.error);
      remember({ id: d.id, key: d.key, name: d.name });
      location.href = linkFor(d.id, d.key);
    } catch (err) {
      alert((err as Error).message);
      setBusy(false);
    }
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
        <h2>New diagram</h2>
        <form onSubmit={create} className="row">
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
          <button disabled={busy}>{busy ? "Creating…" : "Create"}</button>
        </form>
      </section>

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
        <h2>All diagrams</h2>
        {loading && <p className="muted">Loading diagrams…</p>}
        {error && <p role="alert">{error}</p>}
        {!loading && !error && items.length === 0 && (
          <p className="muted">No diagrams yet. Create one here or through your agent.</p>
        )}
        <ul className="list">
          {items.map((d) => (
            <li key={d.id}>
              <a href={linkFor(d.id, d.key)}>{d.name}</a>
              <span className="muted">{new Date(d.createdAt).toLocaleString()}</span>
              <button
                className="link"
                disabled={deleting !== null}
                aria-label={`Delete ${d.name}`}
                onClick={() => void removeDiagram(d)}
              >
                {deleting === d.id ? "Deleting…" : "Delete"}
              </button>
            </li>
          ))}
        </ul>
        {nextCursor && (
          <button
            disabled={loading}
            onClick={() => {
              setLoading(true);
              setPageCount((count) => count + 1);
            }}
          >
            {loading ? "Loading…" : "Load more diagrams"}
          </button>
        )}
      </section>
    </main>
  );
}
