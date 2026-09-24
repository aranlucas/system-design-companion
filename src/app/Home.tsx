import { useEffect, useState } from "react";
import { forget, library, linkFor, mcpAddCommand, remember, type LibraryEntry } from "./local.ts";

interface Template {
  id: string;
  name: string;
  description: string;
}

export function Home() {
  const [items, setItems] = useState<LibraryEntry[]>(library());
  const [templates, setTemplates] = useState<Template[]>([]);
  const [name, setName] = useState("");
  const [template, setTemplate] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/templates")
      .then((r) => r.json())
      .then(setTemplates)
      .catch(() => {});
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/diagrams", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name || "Untitled", template }),
      });
      const d = (await res.json()) as { id: string; key: string; name: string; error?: string };
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
      <h1>System Design Canvas</h1>
      <p className="muted">A shared Excalidraw canvas that you, your interviewer, and Claude edit together.</p>

      <section className="card">
        <h2>New diagram</h2>
        <form onSubmit={create} className="row">
          <input placeholder="Name, e.g. Design Twitter" value={name} onChange={(e) => setName(e.target.value)} />
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
        <h2>Connect Claude Code</h2>
        <p className="muted">Run once in your terminal. Then say "join &lt;share link&gt;" to Claude.</p>
        <div className="row">
          <code className="cmd">{mcpAddCommand()}</code>
          <button
            onClick={() => {
              navigator.clipboard.writeText(mcpAddCommand());
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Your diagrams</h2>
        {items.length === 0 && <p className="muted">Nothing yet. Diagrams you create or open appear here.</p>}
        <ul className="list">
          {items.map((d) => (
            <li key={d.id}>
              <a href={linkFor(d.id, d.key)}>{d.name}</a>
              <span className="muted">{new Date(d.openedAt).toLocaleString()}</span>
              <button
                className="link"
                onClick={() => {
                  forget(d.id);
                  setItems(library());
                }}
              >
                Forget
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
