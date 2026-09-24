import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  Excalidraw,
  exportToBlob,
  reconcileElements,
  restoreElements,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, El, MermaidParams, ScreenshotParams, ServerMessage } from "../shared/protocol.ts";
import { linkFor, mcpAddCommand, remember } from "./local.ts";

interface Snapshot {
  id: string;
  name: string;
  kind: "auto" | "named";
  createdAt: number;
  elements: number;
}

const blobToBase64 = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(b);
  });

export function Canvas({ id, k }: { id: string; k: string }) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [name, setName] = useState("…");
  const [peers, setPeers] = useState(1);
  const [status, setStatus] = useState<"connecting" | "live" | "offline">("connecting");
  const [panel, setPanel] = useState<null | "versions" | "share">(null);
  const [toast, setToast] = useState<string | null>(null);

  const ws = useRef<WebSocket | null>(null);
  const synced = useRef(new Map<string, number>()); // element id → last version exchanged with the room
  const pendingSend = useRef<number | null>(null);
  const lastPresence = useRef("");
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  apiRef.current = api;
  (window as any).excalidrawAPI = api; // handy for debugging from the console

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const send = (m: ClientMessage) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(m));
  };

  const sendPresence = useCallback((force = false) => {
    const a = apiRef.current;
    if (!a) return;
    const st = a.getAppState();
    const selection = Object.keys(st.selectedElementIds).filter((k) => st.selectedElementIds[k]);
    const viewport = {
      x: Math.round(-st.scrollX),
      y: Math.round(-st.scrollY),
      width: Math.round(st.width / st.zoom.value),
      height: Math.round(st.height / st.zoom.value),
      zoom: st.zoom.value,
    };
    const focused = document.hasFocus();
    const sig = JSON.stringify([selection, focused]);
    if (!force && sig === lastPresence.current) return;
    lastPresence.current = sig;
    send({ type: "presence", selection, viewport, focused });
  }, []);

  // ---------- tab RPC (screenshot, mermaid) ----------

  const handleRpc = useCallback(async (msg: Extract<ServerMessage, { type: "rpc" }>) => {
    const a = apiRef.current;
    try {
      if (!a) throw new Error("canvas not ready");
      if (msg.method === "screenshot") {
        const { elementIds } = msg.params as ScreenshotParams;
        let elements = a.getSceneElements();
        if (elementIds?.length) {
          const want = new Set(elementIds);
          elements = elements.filter(
            (e) => want.has(e.id) || (e.frameId && want.has(e.frameId)) || ("containerId" in e && e.containerId && want.has(e.containerId)),
          );
        }
        if (!elements.length) throw new Error("nothing to render");
        const blob = await exportToBlob({
          elements,
          appState: { ...a.getAppState(), exportBackground: true, exportWithDarkMode: false, viewBackgroundColor: "#ffffff" },
          files: a.getFiles(),
          mimeType: "image/png",
          maxWidthOrHeight: 1600,
          exportPadding: 24,
        });
        send({ type: "rpc_result", reqId: msg.reqId, ok: true, data: { base64: await blobToBase64(blob), mimeType: "image/png" } });
      } else if (msg.method === "mermaid") {
        const { source } = msg.params as MermaidParams;
        const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
        const { elements } = await parseMermaidToExcalidraw(source);
        const converted = convertToExcalidrawElements(elements, { regenerateIds: true });
        send({ type: "rpc_result", reqId: msg.reqId, ok: true, data: { elements: converted } });
      }
    } catch (e) {
      send({ type: "rpc_result", reqId: msg.reqId, ok: false, error: (e as Error).message });
    }
  }, []);

  // ---------- connection ----------

  useEffect(() => {
    if (!api) return;
    let closed = false;
    let retry: number | undefined;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const sock = new WebSocket(`${proto}//${location.host}/ws/${id}?k=${encodeURIComponent(k)}`);
      ws.current = sock;
      sock.onopen = () => {
        setStatus("live");
        sendPresence(true);
      };
      sock.onclose = () => {
        setStatus("offline");
        if (!closed) retry = window.setTimeout(connect, 1500);
      };
      sock.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as ServerMessage;
        if (msg.type === "init") {
          setName(msg.name);
          document.title = `${msg.name} · System Design Canvas`;
          remember({ id, key: k, name: msg.name });
          const remote = restoreElements(msg.elements as any, null);
          const local = api.getSceneElementsIncludingDeleted();
          const merged = local.length ? reconcileElements(local, remote as any, api.getAppState()) : remote;
          for (const e of msg.elements) synced.current.set(e.id, e.version);
          api.updateScene({ elements: merged, captureUpdate: CaptureUpdateAction.NEVER });
          if (!local.length) api.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.8 });
          // Push anything drawn while offline.
          scheduleSend();
        } else if (msg.type === "update") {
          const merged = reconcileElements(api.getSceneElementsIncludingDeleted(), msg.elements as any, api.getAppState());
          for (const e of msg.elements) synced.current.set(e.id, Math.max(e.version, synced.current.get(e.id) ?? 0));
          api.updateScene({ elements: merged, captureUpdate: CaptureUpdateAction.NEVER });
          if (msg.origin === "agent") flash(`Claude updated ${msg.elements.length} element${msg.elements.length === 1 ? "" : "s"}`);
        } else if (msg.type === "rpc") {
          void handleRpc(msg);
        } else if (msg.type === "peers") {
          setPeers(msg.count);
        }
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws.current?.close();
    };
  }, [api, id, k]);

  // ---------- local changes → room ----------

  const flush = () => {
    pendingSend.current = null;
    const a = apiRef.current;
    if (!a || ws.current?.readyState !== WebSocket.OPEN) return;
    const changed: El[] = [];
    for (const e of a.getSceneElementsIncludingDeleted()) {
      if (e.version > (synced.current.get(e.id) ?? 0)) {
        changed.push(e as unknown as El);
        synced.current.set(e.id, e.version);
      }
    }
    if (changed.length) send({ type: "update", elements: changed });
  };
  const scheduleSend = () => {
    if (pendingSend.current === null) pendingSend.current = window.setTimeout(flush, 60);
  };

  useEffect(() => {
    const onFocus = () => sendPresence(true);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [sendPresence]);

  // ---------- chrome ----------

  const shareLink = linkFor(id, k);
  const copy = (text: string, what: string) => {
    navigator.clipboard.writeText(text);
    flash(`${what} copied`);
  };

  return (
    <div className="canvas-wrap">
      <Excalidraw
        excalidrawAPI={setApi}
        isCollaborating={peers > 1}
        onChange={() => {
          scheduleSend();
          sendPresence();
        }}
        onPointerDown={() => sendPresence()}
        renderTopRightUI={() => (
          <div className="topbar">
            <span className="title" title={name}>
              {name}
            </span>
            <span className={`dot ${status}`} title={status} />
            <span className="muted">{peers} here</span>
            <button onClick={() => setPanel(panel === "versions" ? null : "versions")}>Versions</button>
            <button onClick={() => setPanel(panel === "share" ? null : "share")}>Share / Agent</button>
          </div>
        )}
      />
      {panel === "versions" && <VersionsPanel id={id} k={k} onClose={() => setPanel(null)} flash={flash} />}
      {panel === "share" && (
        <div className="panel">
          <header>
            <b>Share &amp; connect</b>
            <button className="link" onClick={() => setPanel(null)}>
              ✕
            </button>
          </header>
          <p className="muted">Edit link: anyone with it can edit (give it to your interviewer).</p>
          <div className="row">
            <code className="cmd">{shareLink}</code>
            <button onClick={() => copy(shareLink, "Link")}>Copy</button>
          </div>
          <p className="muted">Claude Code, one-time setup:</p>
          <div className="row">
            <code className="cmd">{mcpAddCommand()}</code>
            <button onClick={() => copy(mcpAddCommand(), "Command")}>Copy</button>
          </div>
          <p className="muted">Then tell Claude:</p>
          <div className="row">
            <code className="cmd">join {shareLink}</code>
            <button onClick={() => copy(`Join my system design canvas: ${shareLink}`, "Prompt")}>Copy</button>
          </div>
          <p className="muted">
            <a href="/">All diagrams →</a>
          </p>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function VersionsPanel({ id, k, onClose, flash }: { id: string; k: string; onClose: () => void; flash: (m: string) => void }) {
  const [snaps, setSnaps] = useState<Snapshot[] | null>(null);
  const [label, setLabel] = useState("");
  const q = `?k=${encodeURIComponent(k)}`;

  const load = () =>
    fetch(`/api/d/${id}/snapshots${q}`)
      .then((r) => r.json())
      .then(setSnaps);
  useEffect(() => {
    void load();
  }, []);

  const post = (path: string, body: unknown) =>
    fetch(`/api/d/${id}${path}${q}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) =>
      r.json(),
    );

  return (
    <div className="panel">
      <header>
        <b>Versions</b>
        <button className="link" onClick={onClose}>
          ✕
        </button>
      </header>
      <form
        className="row"
        onSubmit={async (e) => {
          e.preventDefault();
          await post("/snapshots", { name: label || "checkpoint" });
          setLabel("");
          flash("Saved version");
          void load();
        }}
      >
        <input placeholder="Name this version" value={label} onChange={(e) => setLabel(e.target.value)} />
        <button>Save</button>
      </form>
      <form
        className="row"
        onSubmit={async (e) => {
          e.preventDefault();
          const input = (e.currentTarget.elements.namedItem("tpl") as HTMLInputElement).value.trim();
          if (!input) return;
          await post("/template", { name: input });
          flash("Saved as template");
          (e.currentTarget.elements.namedItem("tpl") as HTMLInputElement).value = "";
        }}
      >
        <input name="tpl" placeholder="Save as template…" />
        <button>Save</button>
      </form>
      <ul className="list snaps">
        {snaps === null && <li className="muted">Loading…</li>}
        {snaps?.length === 0 && <li className="muted">No versions yet. Claude's edits are auto-saved here first.</li>}
        {snaps?.map((s) => (
          <li key={s.id}>
            <span>
              <span className={`tag ${s.kind}`}>{s.kind}</span> {s.name}
              <br />
              <span className="muted">
                {new Date(s.createdAt).toLocaleTimeString()} · {s.elements} el
              </span>
            </span>
            <button
              onClick={async () => {
                await post("/restore", { snapshotId: s.id });
                flash(`Restored "${s.name}"`);
                void load();
              }}
            >
              Restore
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
