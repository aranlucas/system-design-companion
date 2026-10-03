import { safeParse, type $ZodType } from "zod/v4/core";
import {
  storedElementSchema,
  serverMessageSchema,
  storedElementsSchema,
  screenshotResultSchema,
  mermaidResultSchema,
  focusResultSchema,
} from "../shared/schemas.ts";
import { DurableObject } from "cloudflare:workers";
import type {
  ClientMessage,
  El,
  MermaidResult,
  ScreenshotResult,
  ServerMessage,
  TabRpcMethod,
  Viewport,
  ScreenshotParams,
  MermaidParams,
  FocusViewParams,
} from "../shared/protocol.ts";
import { Scene, graphView, type Author, type Op } from "./scene.ts";
import { deliverDiagramEvent, type DiagramEventData } from "./events.ts";
import { patchSnapshotName } from "./patch-name.ts";
import { copyFiles } from "./store.ts";
import { MAX_JSON_BYTES, MAX_SCENE_ELEMENTS, MAX_PATCH_OPS, takeBudget } from "./request-limits.ts";
import { socketMessageSchema } from "./socket-schema.ts";

/** A tab RPC waiting for its reply. */
type RpcSuccess = Extract<ClientMessage, { type: "rpc_result"; ok: true }>;

type RpcParams = ScreenshotParams | MermaidParams | FocusViewParams;

type PendingCall = { resolve: (message: RpcSuccess) => void; reject: (e: Error) => void };

/** An open tab and what it last told us. */
type Tab = { ws: WebSocket; state: TabState };

type ElementRow = { json: string };

type TombstoneRow = { id: string; deleted_at: number };

type MetaRow = { k: string; v: string };

type FocusResult = { mode: string; visible: boolean; elementIds: string[] };

interface TabState {
  /** Stable per-socket id, used as the Excalidraw collaborator id. */
  sid: string;
  username?: string;
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

function tabState(socket: WebSocket): TabState {
  // SAFETY: Only this room writes socket attachments, using TabState-checked objects in fetch and presence handling. Clients cannot write Cloudflare's server-side attachment storage.
  return socket.deserializeAttachment() as TabState;
}

function isTextFrame(value: string | ArrayBuffer): value is string {
  return typeof value === "string";
}

const RPC_TIMEOUT_MS = 20_000;

/**
 * How long a deleted element is kept before it is dropped from storage and `init`.
 * Tabs that were already connected need the tombstone to see the delete, so this
 * has to be longer than any realistic offline gap.
 */
export const TOMBSTONE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const collaborator = (tab: TabState): ServerMessage => ({
  type: "collaborator",
  id: tab.sid,
  username: tab.username,
  selection: tab.selection,
});

/** One diagram: live scene, tab sync, and the ops layer MCP (and later an in-room agent) calls. */
export class DiagramRoom extends DurableObject<Env> {
  private els = new Map<string, El>();
  /** Bumped on every write, so a long operation can tell whether edits landed meanwhile. */
  private edits = 0;
  /** Tombstoned element id → when it was deleted. */
  private deletedAt = new Map<string, number>();
  private diagramId = "";
  private name = "Untitled";
  private pending = new Map<string, PendingCall>();
  private lastFocusAt = 0;
  private deleted = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      const sql = ctx.storage.sql;
      sql.exec("CREATE TABLE IF NOT EXISTS elements (id TEXT PRIMARY KEY, json TEXT NOT NULL)");
      sql.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
      sql.exec(
        "CREATE TABLE IF NOT EXISTS tombstones (id TEXT PRIMARY KEY, deleted_at INTEGER NOT NULL)",
      );

      for (const row of sql.exec<ElementRow>("SELECT json FROM elements")) {
        const el = storedElementSchema.parse(JSON.parse(row.json));
        this.els.set(el.id, el);
      }

      for (const row of sql.exec<TombstoneRow>("SELECT id, deleted_at FROM tombstones"))
        this.deletedAt.set(row.id, row.deleted_at);

      // Tombstones written before this table existed start their TTL now.
      const untracked = [...this.els.values()].filter(
        (e) => e.isDeleted && !this.deletedAt.has(e.id),
      );

      if (untracked.length) this.trackTombstones(untracked);

      for (const row of sql.exec<MetaRow>("SELECT k, v FROM meta")) {
        if (row.k === "deleted") this.deleted = row.v === "true";

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
    const now = Date.now();
    const tombstoned = changed.filter((el) => el.isDeleted && !this.deletedAt.has(el.id));
    const revived = changed.filter((el) => !el.isDeleted && this.deletedAt.has(el.id));
    this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql;

      for (const el of changed) {
        sql.exec(
          "INSERT OR REPLACE INTO elements (id, json) VALUES (?, ?)",
          el.id,
          JSON.stringify(el),
        );
      }

      for (const el of tombstoned)
        sql.exec("INSERT OR REPLACE INTO tombstones (id, deleted_at) VALUES (?, ?)", el.id, now);

      for (const el of revived) sql.exec("DELETE FROM tombstones WHERE id = ?", el.id);
    });
    // Publish in memory only after every write succeeds.
    this.edits++;

    for (const el of changed) this.els.set(el.id, el);

    for (const el of tombstoned) this.deletedAt.set(el.id, now);

    for (const el of revived) this.deletedAt.delete(el.id);
  }

  private trackTombstones(els: El[], now = Date.now()) {
    this.ctx.storage.transactionSync(() => {
      for (const el of els)
        this.ctx.storage.sql.exec(
          "INSERT OR REPLACE INTO tombstones (id, deleted_at) VALUES (?, ?)",
          el.id,
          now,
        );
    });

    for (const el of els) this.deletedAt.set(el.id, now);
  }

  /**
   * Drop tombstones older than TOMBSTONE_TTL_MS. Only runs while no tab is connected: an
   * open tab may still hold a purged tombstone, and a later restore that brings the element
   * back at a lower version would then stay hidden in that tab.
   */
  private collectTombstones(now = Date.now()) {
    if (this.ctx.getWebSockets().length) return 0;

    const expired = [...this.deletedAt].flatMap(([id, at]) =>
      now - at >= TOMBSTONE_TTL_MS ? [id] : [],
    );

    if (!expired.length) return 0;
    this.ctx.storage.transactionSync(() => {
      for (const id of expired) {
        this.ctx.storage.sql.exec("DELETE FROM elements WHERE id = ?", id);
        this.ctx.storage.sql.exec("DELETE FROM tombstones WHERE id = ?", id);
      }
    });

    for (const id of expired) {
      this.els.delete(id);
      this.deletedAt.delete(id);
    }

    return expired.length;
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
    if (this.deleted) throw new Error("Diagram deleted.");

    if (scene.els.size > MAX_SCENE_ELEMENTS) throw new Error("Diagram element limit reached.");
    const changed = scene.changedElements();

    if (!changed.length) return 0;
    this.persist(changed);
    this.broadcast({ type: "update", elements: changed, origin });
    this.emit("diagram.changed", {
      diagram_id: this.diagramId,
      origin,
      changed_count: changed.length,
    });

    return changed.length;
  }

  /**
   * Fire an MCP event at whoever subscribed to this diagram. Delivery is
   * best-effort and off the critical path: a webhook that hangs or fails must
   * never delay or fail the edit that triggered it.
   */
  private emit(name: string, data: DiagramEventData) {
    this.ctx.waitUntil(
      deliverDiagramEvent(this.env, this.diagramId, name, data).catch((e) =>
        console.error("mcp events:", e),
      ),
    );
  }

  // ---------- lifecycle ----------

  async init(id: string, name: string) {
    this.diagramId = id;
    this.name = name;
    this.setMeta("id", id);
    this.setMeta("name", name);
  }

  async deactivate() {
    this.setMeta("deleted", "true");
    this.deleted = true;

    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(1008, "Diagram deleted");
      } catch {
        /* already closed */
      }
    }

    for (const pending of this.pending.values()) pending.reject(new Error("Diagram deleted"));
    this.pending.clear();
  }

  /** Retain only a deletion marker, so late sockets and RPCs cannot revive this room. */
  async erase() {
    await this.deactivate();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM elements");
      this.ctx.storage.sql.exec("DELETE FROM tombstones");
      this.ctx.storage.sql.exec("DELETE FROM meta");
      this.ctx.storage.sql.exec(
        "INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)",
        "deleted",
        "true",
      );
    });
    this.els.clear();
    this.deletedAt.clear();
    this.name = "Deleted";
    this.diagramId = "";
  }

  async rename(name: string) {
    this.name = name;
    this.setMeta("name", name);
    this.broadcast({ type: "rename", name });
    this.emit("diagram.renamed", { diagram_id: this.diagramId, name });
  }

  /** All elements (incl. tombstones) in z-order; Excalidraw re-indexes anything out of order. */
  private ordered(): El[] {
    return [...this.els.values()].toSorted((a, b) =>
      (a.index ?? "") < (b.index ?? "") ? -1 : (a.index ?? "") > (b.index ?? "") ? 1 : 0,
    );
  }

  // ---------- WebSocket (tabs) ----------

  async fetch(request: Request): Promise<Response> {
    if (this.deleted) return new Response("Diagram deleted", { status: 410 });

    if (request.headers.get("Upgrade") !== "websocket")
      return new Response("expected websocket", { status: 426 });
    // Before this tab joins, so its init never carries expired tombstones.
    this.collectTombstones();
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const others = this.ctx.getWebSockets().filter((ws) => ws !== server);
    server.serializeAttachment({
      sid: crypto.randomUUID(),
      selection: [],
      focusedAt: 0,
    } satisfies TabState);
    server.send(
      JSON.stringify({
        type: "init",
        elements: this.ordered(),
        name: this.name,
      } satisfies ServerMessage),
    );

    for (const ws of others) {
      const tab = tabState(ws);
      server.send(JSON.stringify(collaborator(tab)));
    }

    this.broadcast({ type: "peers", count: this.ctx.getWebSockets().length });

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (this.deleted) return;
    const text = isTextFrame(raw) ? raw : new TextDecoder().decode(raw);

    if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) {
      ws.close(1009, "Message is too large");

      return;
    }

    let msg: ClientMessage;

    try {
      const parsed = socketMessageSchema.parse(JSON.parse(text));

      if (parsed.type !== "rpc_result") msg = parsed;
      else if (parsed.ok) msg = { ...parsed, ok: true, data: parsed.data };
      else {
        if (parsed.error === undefined) throw new Error("Missing RPC error");
        msg = { ...parsed, ok: false, error: parsed.error };
      }
    } catch {
      ws.close(1008, "Invalid canvas message");

      return;
    }

    switch (msg.type) {
      case "update": {
        try {
          await takeBudget(this.env, `board-update:${this.diagramId}`, 240);
        } catch {
          ws.close(1013, "Too many canvas updates");

          return;
        }

        if (this.deleted) return;

        const newIds = new Set(
          msg.elements.filter((el) => !this.els.has(el.id)).map((el) => el.id),
        );

        if (this.els.size + newIds.size > MAX_SCENE_ELEMENTS) {
          ws.close(1008, "Diagram element limit reached");

          return;
        }

        const accepted: El[] = [];

        for (const el of msg.elements) {
          const cur = this.els.get(el.id);

          if (
            !cur ||
            el.version > cur.version ||
            (el.version === cur.version && el.versionNonce < cur.versionNonce)
          ) {
            accepted.push(el);
          }
        }

        if (accepted.length) {
          this.persist(accepted);
          this.broadcast({ type: "update", elements: accepted, origin: "human" }, ws);
          this.emit("diagram.changed", {
            diagram_id: this.diagramId,
            origin: "human",
            changed_count: accepted.length,
          });
        }

        break;
      }

      case "presence": {
        const prev = tabState(ws);
        const focusedAt = msg.focused ? Date.now() : prev.focusedAt;

        const next: TabState = {
          sid: prev.sid,
          username: msg.username?.slice(0, 40) || undefined,
          selection: msg.selection,
          viewport: msg.viewport,
          focusedAt,
        };

        ws.serializeAttachment(next);
        this.broadcast(collaborator(next), ws);

        if (msg.focused && focusedAt - this.lastFocusAt > 1000) {
          this.lastFocusAt = focusedAt;
          this.setMeta("focusAt", String(focusedAt));
        }

        break;
      }

      case "pointer": {
        const { sid } = tabState(ws);
        this.broadcast(
          { type: "collaborator", id: sid, pointer: msg.pointer, button: msg.button },
          ws,
        );
        break;
      }

      case "rpc_result": {
        const p = this.pending.get(msg.reqId);

        if (!p) break;
        this.pending.delete(msg.reqId);

        if (msg.ok) p.resolve(msg);
        else p.reject(new Error(msg.error));
        break;
      }
    }
  }

  async webSocketClose(ws: WebSocket) {
    ws.close();
    const { sid } = tabState(ws);
    this.broadcast({ type: "collaborator_left", id: sid }, ws);
    // workerd may or may not still list the closing socket here; exclude it either way.
    const count = this.ctx.getWebSockets().filter((other) => other !== ws).length;
    this.broadcast({ type: "peers", count }, ws);
  }

  /** Most recently focused open tab — the "human's" tab. */
  private primaryTab(): Tab | null {
    let best: Tab | null = null;

    for (const ws of this.ctx.getWebSockets()) {
      const state = tabState(ws);

      if (!best || state.focusedAt > best.state.focusedAt) best = { ws, state };
    }

    return best;
  }

  private async callTab<T>(
    method: TabRpcMethod,
    params: RpcParams,
    schema: $ZodType<T>,
  ): Promise<T> {
    // Tabs auto-reconnect after a blip (~1.5s); give them a moment before giving up.
    let tab = this.primaryTab();

    for (let i = 0; !tab && i < 12; i++) {
      // Sequential by design: poll until a tab reconnects.
      // oxlint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 250));
      tab = this.primaryTab();
    }

    if (!tab)
      throw new Error(
        "No canvas tab is open for this diagram. Ask the user to open the share link.",
      );
    const open = tab;
    const reqId = crypto.randomUUID();

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error(`canvas tab did not answer ${method} within ${RPC_TIMEOUT_MS / 1000}s`));
      }, RPC_TIMEOUT_MS);

      this.pending.set(reqId, {
        resolve: (message) => {
          clearTimeout(timer);
          const result = safeParse(schema, message.data);

          if (result.success) resolve(result.data);
          else reject(new Error(`Canvas tab returned invalid ${method} data`));
        },
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      open.ws.send(
        JSON.stringify(serverMessageSchema.parse({ type: "rpc", reqId, method, params })),
      );
    });
  }

  // ---------- ops layer (RPC) ----------

  async info() {
    const live = [...this.els.values()].filter((e) => !e.isDeleted).length;

    return {
      id: this.diagramId,
      name: this.name,
      elements: live,
      tabs: this.ctx.getWebSockets().length,
      focusedAt: this.lastFocusAt,
    };
  }

  async getGraph() {
    const tab = this.primaryTab();
    const scene = new Scene(this.els.values());

    return { diagram: this.name, ...graphView(scene, new Set(tab?.state.selection ?? [])) };
  }

  /** Live elements in z-order. */
  async getRaw() {
    return this.ordered().filter((e) => !e.isDeleted);
  }

  async getSelection() {
    const tab = this.primaryTab();

    if (!tab) return { tabOpen: false, selection: [] };
    const sel = new Set(tab.state.selection);
    const g = graphView(new Scene(this.els.values()), sel);

    return {
      tabOpen: true,
      viewport: tab.state.viewport,
      nodes: (g.nodes ?? []).filter((entry) => sel.has(entry.id)),
      edges: (g.edges ?? []).filter((entry) => sel.has(entry.id)),
      notes: (g.notes ?? []).filter((entry) => sel.has(entry.id)),
      frames: (g.frames ?? []).filter((entry) => sel.has(entry.id)),
      sketches: (g.sketches ?? []).filter((entry) => sel.has(entry.id)),
    };
  }

  async applyPatch(ops: Op[], author: Author = "agent", summary?: string) {
    if (ops.length > MAX_PATCH_OPS) throw new Error("Too many operations in one patch.");

    const snap =
      author === "agent"
        ? await this.snapshot(patchSnapshotName(ops, new Scene(this.els.values()), summary), "auto")
        : undefined;

    const scene = new Scene(this.els.values());
    const results = scene.apply(ops, author);
    const tidied = scene.tidy(scene.touchedFrames());
    const changed = this.commit(scene, author === "agent" ? "agent" : "system");

    return { snapshotId: snap?.id, changed, results, tidied };
  }

  /**
   * Non-destructive cleanup of the whole diagram, or of some frames (null = top level).
   * Snapshotted first, unless there is nothing to change.
   */
  async tidy(frames?: string | (string | null)[], origin: "agent" | "system" = "agent") {
    const run = () => {
      const scene = new Scene(this.els.values());
      const list = frames === undefined ? undefined : [frames].flat();
      const scope = list && new Set(list.map((f) => (f === null ? null : scene.resolve(f).id)));

      return { scene, stats: scene.tidy(scope) };
    };

    const edits = this.edits;
    const first = run();

    if (!first.scene.changedElements().length)
      return { snapshotId: undefined, changed: 0, ...first.stats };
    const snap = await this.snapshot("before tidy", "auto");
    // Edits can land while the snapshot is written; only then tidy again from the current state.
    const { scene, stats } = this.edits === edits ? first : run();
    const changed = this.commit(scene, origin);

    return { snapshotId: snap.id, changed, ...stats };
  }

  async layout(direction: "LR" | "TB", frame?: string) {
    const snap = await this.snapshot("before layout", "auto");
    const scene = new Scene(this.els.values());
    const moved = scene.layout(direction, frame);
    this.commit(scene, "agent");

    return { snapshotId: snap.id, moved };
  }

  async importMermaid(source: string) {
    const { elements } = await this.callTab<MermaidResult>(
      "mermaid",
      { source },
      mermaidResultSchema,
    );

    const snap = await this.snapshot("before mermaid import", "auto");
    const scene = new Scene(this.els.values());
    const added = scene.addForeign(elements, "agent");
    this.commit(scene, "agent");

    return { snapshotId: snap.id, added };
  }

  async screenshot(elementIds?: string[]) {
    return this.callTab<ScreenshotResult>("screenshot", { elementIds }, screenshotResultSchema);
  }

  async focusView(
    targets: string[],
    mode: "focus" | "point" = "focus",
    gesture: "dot" | "heart" = "dot",
  ) {
    const scene = new Scene(this.els.values());
    const elementIds = targets.map((target) => scene.resolve(target).id);

    return this.callTab<FocusResult>(
      "focus_view",
      {
        elementIds,
        mode,
        gesture,
      },
      focusResultSchema,
    );
  }

  // ---------- snapshots & templates ----------

  async snapshot(name: string, kind: "auto" | "named" = "named"): Promise<SnapshotMeta> {
    if (this.deleted) throw new Error("Diagram deleted.");
    const diagramId = this.diagramId;
    const elements = await this.getRaw();

    const meta: SnapshotMeta = {
      id: crypto.randomUUID(),
      name,
      kind,
      createdAt: Date.now(),
      elements: elements.length,
    };

    await this.env.BUCKET.put(`snapshots/${diagramId}/${meta.id}.json`, JSON.stringify(elements));
    await this.env.DB.prepare(
      "INSERT INTO snapshots (id, diagram_id, name, kind, created_at, element_count) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(meta.id, diagramId, name, kind, meta.createdAt, meta.elements)
      .run();

    if (this.deleted) {
      await this.env.BUCKET.delete(`snapshots/${diagramId}/${meta.id}.json`);
      await this.env.DB.prepare("DELETE FROM snapshots WHERE id = ?").bind(meta.id).run();
      throw new Error("Diagram deleted.");
    }

    // Only checkpoints the user asked for. Every agent edit auto-snapshots, and
    // reporting those would bury the ones a person deliberately took.
    if (kind === "named")
      this.emit("diagram.checkpointed", {
        diagram_id: this.diagramId,
        snapshot_id: meta.id,
        name,
      });

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
    const target = storedElementsSchema.parse(await obj.json());
    const safety = await this.snapshot("before restore", "auto");
    const scene = new Scene(this.els.values());
    scene.restoreTo(target);
    this.commit(scene, "system");

    return { restored: snapshotId, undoSnapshotId: safety.id };
  }

  /**
   * Save this diagram as template `templateId`: its elements and the image files they use.
   * Done here rather than in the caller so the elements never cross RPC: the stub's type for
   * El recurses forever on its `[key: string]: any` (TS2589).
   */
  async saveAsTemplate(templateId: string) {
    const elements = await this.getRaw();
    await copyFiles(this.env, this.diagramId, templateId, elements);
    await this.env.BUCKET.put(`templates/${templateId}.json`, JSON.stringify(elements));
  }

  /** Seed a brand-new diagram from elements (saved template) — no snapshot needed. */
  async seed(elements: El[]) {
    const scene = new Scene(this.els.values());
    scene.addForeign(elements, "template");
    this.commit(scene, "system");
  }
}
