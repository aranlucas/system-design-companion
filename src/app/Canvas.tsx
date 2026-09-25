import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  DefaultSidebar,
  Excalidraw,
  exportToBlob,
  Footer,
  getCommonBounds,
  LiveCollaborationTrigger,
  MainMenu,
  Sidebar,
  reconcileElements,
  restoreElements,
  WelcomeScreen,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { Collaborator, ExcalidrawImperativeAPI, SocketId } from "@excalidraw/excalidraw/types";
import useWebSocket from "partysocket/use-ws";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AGENT_STROKE,
  type ClientMessage,
  type El,
  type FocusViewParams,
  type MermaidParams,
  type ScreenshotParams,
  type ServerMessage,
} from "../shared/protocol.ts";
import { CopyRow } from "./CopyRow.tsx";
import { componentLibrary } from "./library.ts";
import { displayName, linkFor, remember, setDisplayName, setupCommands } from "./local.ts";

interface Snapshot {
  id: string;
  name: string;
  kind: "auto" | "named";
  createdAt: number;
  elements: number;
}

/** Collaborator id for the agent's transient cursor and selection outline. */
const AGENT = "agent" as SocketId;

const icon = (d: string) => (
  <svg
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d={d} />
  </svg>
);
const historyIcon = icon("M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 3");
const shareIcon = icon(
  "M18 8a3 3 0 1 0-3-3M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm12 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4",
);
const libraryIcon = icon("M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z");

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
  const [loaded, setLoaded] = useState(false);
  // The heart has no Excalidraw equivalent; the plain "point" gesture is drawn as the
  // agent's collaborator cursor instead.
  const [heart, setHeart] = useState<{ x: number; y: number; startedAt: number } | null>(null);
  const gestureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (gestureTimer.current) clearTimeout(gestureTimer.current);
    },
    [],
  );

  const synced = useRef(new Map<string, number>()); // element id → last version exchanged with the room
  const pendingSend = useRef<number | null>(null);
  const lastPresence = useRef("");
  const lastPointer = useRef(0);
  const offline = useRef(false);
  const wsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws/${id}?k=${encodeURIComponent(k)}`;
  const collaborators = useRef(new Map<SocketId, Collaborator>());
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  apiRef.current = api;
  (window as any).excalidrawAPI = api; // handy for debugging from the console

  const flash = (message: string) => apiRef.current?.setToast({ message, duration: 2500 });
  // Share and Versions are tabs in Excalidraw's default sidebar, next to the library.
  const open = (tab: "share" | "versions" | "library") =>
    apiRef.current?.toggleSidebar({ name: "default", tab, force: true });
  const openRename = () => apiRef.current?.toggleSidebar({ name: "rename", force: true });

  /** Excalidraw draws each collaborator's cursor, selection outline and avatar. */
  const setCollaborator = (peer: SocketId, patch: Partial<Collaborator> | null) => {
    const map = collaborators.current;
    if (patch) map.set(peer, { ...map.get(peer), id: peer, socketId: peer, ...patch });
    else map.delete(peer);
    apiRef.current?.updateScene({ collaborators: new Map(map) });
  };

  const send = (m: ClientMessage) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(m));
  };

  const sendPresence = useCallback((force = false) => {
    const a = apiRef.current;
    if (!a) return;
    const st = a.getAppState();
    const selection = Object.keys(st.selectedElementIds).filter(
      (key) => st.selectedElementIds[key],
    );
    const viewport = {
      x: Math.round(-st.scrollX),
      y: Math.round(-st.scrollY),
      width: Math.round(st.width / st.zoom.value),
      height: Math.round(st.height / st.zoom.value),
      zoom: st.zoom.value,
    };
    const focused = document.hasFocus();
    const username = displayName() || undefined;
    const sig = JSON.stringify([selection, focused, username]);
    if (!force && sig === lastPresence.current) return;
    lastPresence.current = sig;
    send({ type: "presence", selection, viewport, focused, username });
  }, []);

  const showFocus = useCallback(
    async (
      targets: readonly ExcalidrawElement[],
      mode: "focus" | "point",
      gesture: "dot" | "heart" = "dot",
    ) => {
      const a = apiRef.current;
      if (!a || !targets.length) return false;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const groups = new Set(targets.flatMap((e) => e.groupIds));
      const ids = new Set(targets.map((e) => e.id));
      const elements = [
        ...targets,
        ...a
          .getSceneElements()
          .filter((e) => !ids.has(e.id) && e.groupIds.some((groupId) => groups.has(groupId))),
      ];
      if (mode === "focus")
        a.scrollToContent(elements, { fitToContent: true, animate: false, maxZoom: 1 });
      // Wait for the viewport change to be applied before positioning the temporary pointer.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const state = a.getAppState();
      const [left, top, right, bottom] = getCommonBounds(elements);
      const x = (left + right) / 2;
      const y = (top + bottom) / 2;
      const screen = {
        x: (x + state.scrollX) * state.zoom.value + state.offsetLeft,
        y: (y + state.scrollY) * state.zoom.value + state.offsetTop,
      };
      const visible =
        screen.x >= state.offsetLeft &&
        screen.x <= state.offsetLeft + state.width &&
        screen.y >= state.offsetTop &&
        screen.y <= state.offsetTop + state.height;
      if (gestureTimer.current) clearTimeout(gestureTimer.current);
      if (gesture === "heart") {
        setHeart(visible ? { ...screen, startedAt: performance.now() } : null);
        if (visible) gestureTimer.current = setTimeout(() => setHeart(null), 2400);
      } else {
        setCollaborator(AGENT, {
          username: "Agent",
          color: { background: AGENT_STROKE, stroke: AGENT_STROKE },
          pointer: { x, y, tool: "pointer" },
          selectedElementIds: Object.fromEntries(elements.map((e) => [e.id, true])),
        });
        gestureTimer.current = setTimeout(() => setCollaborator(AGENT, null), 2400);
      }
      return visible;
    },
    [],
  );

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
            (e) =>
              want.has(e.id) ||
              (e.frameId && want.has(e.frameId)) ||
              ("containerId" in e && e.containerId && want.has(e.containerId)),
          );
        }
        if (!elements.length) throw new Error("nothing to render");
        const blob = await exportToBlob({
          elements,
          appState: {
            ...a.getAppState(),
            exportBackground: true,
            exportWithDarkMode: false,
            viewBackgroundColor: "#ffffff",
          },
          files: a.getFiles(),
          mimeType: "image/png",
          maxWidthOrHeight: 1600,
          exportPadding: 24,
        });
        send({
          type: "rpc_result",
          reqId: msg.reqId,
          ok: true,
          data: { base64: await blobToBase64(blob), mimeType: "image/png" },
        });
      } else if (msg.method === "focus_view") {
        const { elementIds, mode, gesture } = msg.params as FocusViewParams;
        const ids = new Set(elementIds);
        const elements = a.getSceneElements().filter((e) => ids.has(e.id));
        if (!elements.length) throw new Error("Target no longer exists in this tab");
        const visible = await showFocus(elements, mode, gesture);
        send({
          type: "rpc_result",
          reqId: msg.reqId,
          ok: true,
          data: { mode, visible, elementIds: elements.map((e) => e.id) },
        });
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

  // partysocket reconnects with backoff; messages sent while offline are dropped (not
  // queued) because the room re-sends a full init and flush() re-diffs on reconnect.
  const socket = useWebSocket(wsUrl, undefined, {
    enabled: !!api,
    maxEnqueuedMessages: 0,
    shouldReconnectOnClose: (event) => event.code !== 1008, // 1008: diagram deleted
    onOpen: () => {
      if (offline.current) api?.setToast(null);
      offline.current = false;
      sendPresence(true);
    },
    onClose: (event) => {
      // Peers re-announce themselves on reconnect.
      collaborators.current.clear();
      api?.updateScene({ collaborators: new Map() });
      if (event.code === 1008 || offline.current) return;
      offline.current = true;
      api?.setToast({ message: "Offline, reconnecting…", duration: Infinity });
    },
    onMessage: (ev) => {
      if (!api) return;
      const msg = JSON.parse(ev.data) as ServerMessage;
      if (msg.type === "init") {
        setName(msg.name);
        document.title = `${msg.name} · System Design`;
        remember({ id, key: k, name: msg.name });
        const remote = restoreElements(msg.elements as any, null);
        const local = api.getSceneElementsIncludingDeleted();
        const merged = local.length
          ? reconcileElements(local, remote as any, api.getAppState())
          : remote;
        for (const e of msg.elements) synced.current.set(e.id, e.version);
        api.updateScene({ elements: merged, captureUpdate: CaptureUpdateAction.NEVER });
        // Fitting an empty board would zoom to Excalidraw's 3000% maximum.
        if (!local.length && msg.elements.some((e) => !e.isDeleted))
          api.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.8 });
        setLoaded(true);
        // Push anything drawn while offline.
        scheduleSend();
      } else if (msg.type === "rename") {
        setName(msg.name);
        document.title = `${msg.name} · System Design`;
        remember({ id, key: k, name: msg.name });
      } else if (msg.type === "update") {
        const merged = reconcileElements(
          api.getSceneElementsIncludingDeleted(),
          msg.elements as any,
          api.getAppState(),
        );
        for (const e of msg.elements)
          synced.current.set(e.id, Math.max(e.version, synced.current.get(e.id) ?? 0));
        api.updateScene({ elements: merged, captureUpdate: CaptureUpdateAction.NEVER });
        if (msg.origin === "agent") {
          flash(
            `Agent updated ${msg.elements.length} element${msg.elements.length === 1 ? "" : "s"}`,
          );
          const changedIds = new Set(msg.elements.map((e) => e.id));
          const changed = merged.filter(
            (e) =>
              changedIds.has(e.id) &&
              !e.isDeleted &&
              !e.customData?.componentPart &&
              !e.customData?.componentLabel,
          );
          const components = changed.filter(
            (e) =>
              !["frame", "arrow", "line"].includes(e.type) && !(e.type === "text" && e.containerId),
          );
          // Prefer actual components over an enlarged frame or a rerouted long connection.
          const targets = components.length ? components : changed;
          const removed = msg.elements.filter(
            (e) =>
              e.isDeleted &&
              !e.customData?.componentPart &&
              !e.customData?.componentLabel &&
              e.type !== "text",
          );
          void showFocus(
            targets.length
              ? targets
              : (removed.map((e) => ({ ...e, isDeleted: false })) as ExcalidrawElement[]),
            "focus",
          );
        }
      } else if (msg.type === "rpc") {
        void handleRpc(msg);
      } else if (msg.type === "peers") {
        setPeers(msg.count);
      } else if (msg.type === "collaborator") {
        const { id: peer, selection, username, pointer, button } = msg;
        setCollaborator(peer as SocketId, {
          ...(selection
            ? {
                username,
                selectedElementIds: Object.fromEntries(selection.map((e) => [e, true])),
              }
            : {}),
          ...(pointer ? { pointer, button } : {}),
        });
      } else if (msg.type === "collaborator_left") {
        setCollaborator(msg.id as SocketId, null);
      }
    },
  });
  const ws = useRef(socket);
  ws.current = socket;

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

  const tidy = async () => {
    const r = await fetch(`/api/d/${id}/tidy?k=${encodeURIComponent(k)}`, { method: "POST" });
    const d = (await r.json()) as { changed?: number; error?: string };
    flash(
      r.ok
        ? d.changed
          ? `Tidied (${d.changed} changes; undo in Versions)`
          : "Already tidy"
        : `Tidy failed: ${d.error}`,
    );
  };

  const shareLink = linkFor(id, k);
  const copy = (text: string, what: string) => {
    void navigator.clipboard.writeText(text);
    flash(`${what} copied`);
  };

  return (
    <div className="canvas-wrap">
      {heart && (
        <output
          key={heart.startedAt}
          className="agent-heart"
          aria-label="Agent is drawing a heart"
          style={{ left: heart.x, top: heart.y }}
        >
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <path
              pathLength="1"
              d="M60 98 C48 86 15 64 15 38 C15 10 47 8 60 32 C73 8 105 10 105 38 C105 64 72 86 60 98"
            />
          </svg>
        </output>
      )}
      <Excalidraw
        excalidrawAPI={setApi}
        initialData={{ libraryItems: componentLibrary() }}
        name={name}
        isCollaborating={peers > 1}
        UIOptions={{
          // The room is the source of truth; loading or clearing a local file would bypass it.
          canvasActions: { loadScene: false, saveToActiveFile: false, clearCanvas: false },
        }}
        onChange={() => {
          scheduleSend();
          sendPresence();
        }}
        onPointerDown={() => sendPresence()}
        onPointerUpdate={({ pointer, button }) => {
          const now = performance.now();
          if (now - lastPointer.current < 40) return;
          lastPointer.current = now;
          send({
            type: "pointer",
            pointer: { x: pointer.x, y: pointer.y, tool: pointer.tool },
            button,
          });
        }}
        renderTopRightUI={() => (
          <LiveCollaborationTrigger isCollaborating={peers > 1} onSelect={() => open("share")} />
        )}
      >
        <MainMenu>
          <MainMenu.Group title={name}>
            <MainMenu.Item onSelect={openRename}>Rename diagram</MainMenu.Item>
            <MainMenu.Item onSelect={tidy}>Tidy layout</MainMenu.Item>
            <MainMenu.Item onSelect={() => open("versions")}>Versions</MainMenu.Item>
            <MainMenu.Item onSelect={() => open("share")}>Share &amp; connect agent</MainMenu.Item>
            <MainMenu.ItemLink href="/">All diagrams</MainMenu.ItemLink>
          </MainMenu.Group>
          <MainMenu.Separator />
          <MainMenu.DefaultItems.CommandPalette />
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.Export />
          <MainMenu.DefaultItems.SearchMenu />
          <MainMenu.DefaultItems.Help />
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ToggleTheme />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
        </MainMenu>
        {/* Mounted after the room's first sync so it never flashes over a non-empty board. */}
        {loaded && (
          <WelcomeScreen>
            <WelcomeScreen.Hints.MenuHint />
            <WelcomeScreen.Hints.ToolbarHint />
            <WelcomeScreen.Hints.HelpHint />
            <WelcomeScreen.Center>
              <WelcomeScreen.Center.Logo>
                <img src="/icons/system-design-128.png" alt="" width="64" height="64" />
              </WelcomeScreen.Center.Logo>
              <WelcomeScreen.Center.Heading>
                Sketch your system, or ask your agent to.
              </WelcomeScreen.Center.Heading>
              <WelcomeScreen.Center.Menu>
                <WelcomeScreen.Center.MenuItem icon={shareIcon} onSelect={() => open("share")}>
                  Connect your agent
                </WelcomeScreen.Center.MenuItem>
                <WelcomeScreen.Center.MenuItem icon={libraryIcon} onSelect={() => open("library")}>
                  Component library
                </WelcomeScreen.Center.MenuItem>
                <WelcomeScreen.Center.MenuItemLink href="/">
                  All diagrams
                </WelcomeScreen.Center.MenuItemLink>
                <WelcomeScreen.Center.MenuItemHelp />
              </WelcomeScreen.Center.Menu>
            </WelcomeScreen.Center>
          </WelcomeScreen>
        )}
        {/* Excalidraw only renders <Footer> on desktop; the menu above covers mobile. */}
        <Footer>
          <div className="footbar">
            <Sidebar.Trigger name="rename" title="Rename diagram" className="title">
              {name} ✎
            </Sidebar.Trigger>
            <button
              className="sidebar-trigger"
              onClick={tidy}
              title="Fix overlaps, alignment and frames (undo via Versions)"
            >
              Tidy
            </button>
            <Sidebar.Trigger name="default" tab="versions" title="Versions">
              Versions
            </Sidebar.Trigger>
          </div>
        </Footer>
        <Sidebar name="rename">
          <Sidebar.Header>Rename diagram</Sidebar.Header>
          <RenamePanel
            name={name}
            id={id}
            diagramKey={k}
            onRenamed={(newName) => {
              setName(newName);
              document.title = `${newName} · System Design`;
              remember({ id, key: k, name: newName });
              api?.toggleSidebar({ name: "rename", force: false });
              flash("Diagram renamed");
            }}
          />
        </Sidebar>
        <DefaultSidebar>
          <DefaultSidebar.TabTriggers>
            <Sidebar.TabTrigger tab="versions" title="Versions">
              {historyIcon}
            </Sidebar.TabTrigger>
            <Sidebar.TabTrigger tab="share" title="Share & connect">
              {shareIcon}
            </Sidebar.TabTrigger>
          </DefaultSidebar.TabTriggers>
          <Sidebar.Tab tab="versions">
            <VersionsPanel id={id} k={k} flash={flash} />
          </Sidebar.Tab>
          <Sidebar.Tab tab="share">
            <SharePanel link={shareLink} copy={copy} onName={() => sendPresence(true)} />
          </Sidebar.Tab>
        </DefaultSidebar>
      </Excalidraw>
    </div>
  );
}

function SharePanel({
  link,
  copy,
  onName,
}: {
  link: string;
  copy: (text: string, what: string) => void;
  onName: () => void;
}) {
  const [me, setMe] = useState(displayName);
  return (
    <div className="sd-panel">
      <h3>Share &amp; connect</h3>
      <p className="muted">Edit link: anyone with it can edit (give it to your interviewer).</p>
      <div className="row">
        <code className="cmd">{link}</code>
        <button onClick={() => copy(link, "Link")}>Copy</button>
      </div>
      <label htmlFor="display-name">Your name (shown on your cursor)</label>
      <input
        id="display-name"
        value={me}
        maxLength={40}
        placeholder="e.g. Interviewer"
        onChange={(event) => {
          setMe(event.target.value);
          setDisplayName(event.target.value);
          onName();
        }}
      />
      <p className="muted">Agent, one-time setup:</p>
      {setupCommands().map(({ client, cmd }) => (
        <CopyRow key={client} label={client} text={cmd} />
      ))}
      <p className="muted">Then tell the agent:</p>
      <div className="row">
        <code className="cmd">join {link}</code>
        <button onClick={() => copy(`Join my system design canvas: ${link}`, "Prompt")}>
          Copy
        </button>
      </div>
      <p className="muted">
        <a href="/">All diagrams →</a>
      </p>
    </div>
  );
}

function RenamePanel({
  name,
  id,
  diagramKey,
  onRenamed,
}: {
  name: string;
  id: string;
  diagramKey: string;
  onRenamed: (name: string) => void;
}) {
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  return (
    <form
      className="sd-panel"
      aria-label="Rename diagram"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!draft.trim() || busy) return;
        setBusy(true);
        setError("");
        try {
          const response = await fetch(`/api/d/${id}/rename?k=${encodeURIComponent(diagramKey)}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: draft.trim() }),
          });
          const result = (await response.json()) as { name: string; error?: string };
          if (!response.ok) throw new Error(result.error || "Could not rename the diagram.");
          onRenamed(result.name);
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <label htmlFor="diagram-name">Diagram name</label>
      <input
        ref={input}
        id="diagram-name"
        value={draft}
        maxLength={120}
        required
        disabled={busy}
        onChange={(event) => setDraft(event.target.value)}
      />
      {error && <p aria-live="polite">{error}</p>}
      <button type="submit" disabled={busy || !draft.trim()}>
        {busy ? "Saving…" : "Save name"}
      </button>
    </form>
  );
}

function VersionsPanel({ id, k, flash }: { id: string; k: string; flash: (m: string) => void }) {
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
    fetch(`/api/d/${id}${path}${q}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json());

  return (
    <div className="sd-panel">
      <h3>Versions</h3>
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
        <input
          placeholder="Name this version"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button>Save</button>
      </form>
      <form
        className="row"
        onSubmit={async (e) => {
          e.preventDefault();
          const input = (
            e.currentTarget.elements.namedItem("tpl") as HTMLInputElement
          ).value.trim();
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
        {snaps?.length === 0 && (
          <li className="muted">No versions yet. Claude's edits are auto-saved here first.</li>
        )}
        {snaps?.map((s) => (
          <li key={s.id}>
            <span className="snap">
              <span className="snap-name">{s.name}</span>
              <span className="muted">
                <span className={`tag ${s.kind}`}>{s.kind}</span>{" "}
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
