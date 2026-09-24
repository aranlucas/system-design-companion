import { DurableObject } from "cloudflare:workers";
import type {
  ClientMessage,
  El,
  MermaidResult,
  ScreenshotResult,
  ServerMessage,
  TabRpcMethod,
  Viewport,
} from "../shared/protocol.ts";
import { Scene, graphView, type Author, type Op } from "./scene.ts";

interface TabState {
  selection: string[];
  viewport?: Viewport;
  focusedAt: number;
}

export interface SnapshotMeta {
  id: string;
  name: string;
  kind: "auto" | "named";
  createdAt: number;
  elements: number;
}

const RPC_TIMEOUT_MS = 20_000;

/** One diagram: live scene, tab sync, and the ops layer MCP (and later an in-room agent) calls. */
export class DiagramRoom extends DurableObject<Env> {
  private els = new Map<string, El>();
  private diagramId = "";
  private name = "Untitled";
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private lastFocusAt = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const sql = ctx.storage.sql;
      sql.exec("CREATE TABLE IF NOT EXISTS elements (id TEXT PRIMARY KEY, json TEXT NOT NULL)");
      sql.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
      for (const row of sql.exec<{ json: string }>("SELECT json FROM elements")) {
        const el = JSON.parse(row.json) as El;
        this.els.set(el.id, el);
      }
      for (const row of sql.exec<{ k: string; v: string }>("SELECT k, v FROM meta")) {
        if (row.k === "id") this.diagramId = row.v;
        if (row.k === "name") this.name = row.v;
        if (row.k === "focusAt") this.lastFocusAt = Number(row.v);
      }
    });
  }

  // ---------- persistence ----------

  private setMeta(k: string, v: string) {
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)", k, v);
  }

  private persist(changed: El[]) {
    for (const el of changed) {
      this.els.set(el.id, el);
      this.ctx.storage.sql.exec("INSERT OR REPLACE INTO elements (id, json) VALUES (?, ?)", el.id, JSON.stringify(el));
    }
  }

  private broadcast(msg: ServerMessage, except?: WebSocket) {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try {
        ws.send(data);
      } catch {
        /* socket closing */
      }
    }
  }

  private commit(scene: Scene, origin: "agent" | "system") {
    const changed = scene.changedElements();
    if (!changed.length) return 0;
    this.persist(changed);
    this.broadcast({ type: "update", elements: changed, origin });
    return changed.length;
  }

  // ---------- lifecycle ----------

  async init(id: string, name: string) {
    this.diagramId = id;
    this.name = name;
    this.setMeta("id", id);
    this.setMeta("name", name);
  }

  async rename(name: string) {
    this.name = name;
    this.setMeta("name", name);
  }

  /** All elements (incl. tombstones) in z-order; Excalidraw re-indexes anything out of order. */
  private ordered(): El[] {
    return [...this.els.values()].sort((a, b) => ((a.index ?? "") < (b.index ?? "") ? -1 : (a.index ?? "") > (b.index ?? "") ? 1 : 0));
  }

  // ---------- WebSocket (tabs) ----------

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ selection: [], focusedAt: 0 } satisfies TabState);
    server.send(JSON.stringify({ type: "init", elements: this.ordered(), name: this.name } satisfies ServerMessage));
    this.broadcast({ type: "peers", count: this.ctx.getWebSockets().length });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)) as ClientMessage;
    switch (msg.type) {
      case "update": {
        const accepted: El[] = [];
        for (const el of msg.elements) {
          const cur = this.els.get(el.id);
          if (!cur || el.version > cur.version || (el.version === cur.version && el.versionNonce < cur.versionNonce)) {
            accepted.push(el);
          }
        }
        if (accepted.length) {
          this.persist(accepted);
          this.broadcast({ type: "update", elements: accepted, origin: "human" }, ws);
        }
        break;
      }
      case "presence": {
        const prev = ws.deserializeAttachment() as TabState;
        const focusedAt = msg.focused ? Date.now() : prev.focusedAt;
        ws.serializeAttachment({ selection: msg.selection, viewport: msg.viewport, focusedAt } satisfies TabState);
        if (msg.focused && focusedAt - this.lastFocusAt > 1000) {
          this.lastFocusAt = focusedAt;
          this.setMeta("focusAt", String(focusedAt));
        }
        break;
      }
      case "rpc_result": {
        const p = this.pending.get(msg.reqId);
        if (!p) break;
        this.pending.delete(msg.reqId);
        if (msg.ok) p.resolve(msg.data);
        else p.reject(new Error(msg.error));
        break;
      }
    }
  }

  async webSocketClose(ws: WebSocket) {
    ws.close();
    this.broadcast({ type: "peers", count: this.ctx.getWebSockets().length - 1 });
  }

  /** Most recently focused open tab — the "human's" tab. */
  private primaryTab(): { ws: WebSocket; state: TabState } | null {
    let best: { ws: WebSocket; state: TabState } | null = null;
    for (const ws of this.ctx.getWebSockets()) {
      const state = ws.deserializeAttachment() as TabState;
      if (!best || state.focusedAt > best.state.focusedAt) best = { ws, state };
    }
    return best;
  }

  private callTab<T>(method: TabRpcMethod, params: unknown): Promise<T> {
    const tab = this.primaryTab();
    if (!tab) return Promise.reject(new Error("No canvas tab is open for this diagram. Ask the user to open the share link."));
    const reqId = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error(`canvas tab did not answer ${method} within ${RPC_TIMEOUT_MS / 1000}s`));
      }, RPC_TIMEOUT_MS);
      this.pending.set(reqId, {
        resolve: (v) => (clearTimeout(timer), resolve(v as T)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      tab.ws.send(JSON.stringify({ type: "rpc", reqId, method, params } satisfies ServerMessage));
    });
  }

  // ---------- ops layer (RPC) ----------

  async info() {
    const live = [...this.els.values()].filter((e) => !e.isDeleted).length;
    return { id: this.diagramId, name: this.name, elements: live, tabs: this.ctx.getWebSockets().length, focusedAt: this.lastFocusAt };
  }

  async getGraph() {
    const tab = this.primaryTab();
    const scene = new Scene(this.els.values());
    return { diagram: this.name, ...graphView(scene, new Set(tab?.state.selection ?? [])) };
  }

  async getRaw() {
    return [...this.els.values()].filter((e) => !e.isDeleted);
  }

  async getSelection() {
    const tab = this.primaryTab();
    if (!tab) return { tabOpen: false, selection: [] as string[] };
    const sel = new Set(tab.state.selection);
    const g = graphView(new Scene(this.els.values()), sel) as Record<string, any[]>;
    const pick = (k: string) => (g[k] ?? []).filter((x) => sel.has(x.id));
    return {
      tabOpen: true,
      viewport: tab.state.viewport,
      nodes: pick("nodes"),
      edges: pick("edges"),
      notes: pick("notes"),
      frames: pick("frames"),
      sketches: pick("sketches"),
    };
  }

  async applyPatch(ops: Op[], author: Author = "agent") {
    const snap = author === "agent" ? await this.snapshot("before agent patch", "auto") : undefined;
    const scene = new Scene(this.els.values());
    const results = scene.apply(ops, author);
    const changed = this.commit(scene, author === "agent" ? "agent" : "system");
    return { snapshotId: snap?.id, changed, results };
  }

  async layout(direction: "LR" | "TB", frame?: string) {
    const snap = await this.snapshot("before layout", "auto");
    const scene = new Scene(this.els.values());
    const moved = scene.layout(direction, frame);
    this.commit(scene, "agent");
    return { snapshotId: snap.id, moved };
  }

  async importMermaid(source: string) {
    const { elements } = await this.callTab<MermaidResult>("mermaid", { source });
    const snap = await this.snapshot("before mermaid import", "auto");
    const scene = new Scene(this.els.values());
    const added = scene.addForeign(elements, "agent");
    this.commit(scene, "agent");
    return { snapshotId: snap.id, added };
  }

  async screenshot(elementIds?: string[]) {
    return this.callTab<ScreenshotResult>("screenshot", { elementIds });
  }

  // ---------- snapshots & templates ----------

  async snapshot(name: string, kind: "auto" | "named" = "named"): Promise<SnapshotMeta> {
    const elements = await this.getRaw();
    const meta: SnapshotMeta = { id: crypto.randomUUID(), name, kind, createdAt: Date.now(), elements: elements.length };
    await this.env.BUCKET.put(`snapshots/${this.diagramId}/${meta.id}.json`, JSON.stringify(elements));
    await this.env.DB.prepare(
      "INSERT INTO snapshots (id, diagram_id, name, kind, created_at, element_count) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(meta.id, this.diagramId, name, kind, meta.createdAt, meta.elements)
      .run();
    return meta;
  }

  async listSnapshots(limit = 30): Promise<SnapshotMeta[]> {
    const { results } = await this.env.DB.prepare(
      "SELECT id, name, kind, created_at AS createdAt, element_count AS elements FROM snapshots WHERE diagram_id = ? ORDER BY created_at DESC LIMIT ?",
    )
      .bind(this.diagramId, limit)
      .all<SnapshotMeta>();
    return results;
  }

  async restore(snapshotId: string) {
    const obj = await this.env.BUCKET.get(`snapshots/${this.diagramId}/${snapshotId}.json`);
    if (!obj) throw new Error(`snapshot ${snapshotId} not found`);
    const target = (await obj.json()) as El[];
    const safety = await this.snapshot("before restore", "auto");
    const scene = new Scene(this.els.values());
    scene.restoreTo(target);
    this.commit(scene, "system");
    return { restored: snapshotId, undoSnapshotId: safety.id };
  }

  /** Seed a brand-new diagram from elements (saved template) — no snapshot needed. */
  async seed(elements: El[]) {
    const scene = new Scene(this.els.values());
    scene.addForeign(elements, "template");
    this.commit(scene, "system");
  }
}
