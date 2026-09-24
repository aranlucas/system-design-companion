// DiagramRoom on fake storage: ops layer, snapshots, merge rule, presence.
import { describe, expect, it, vi } from "vitest";
import { AGENT_STROKE, type El } from "../src/shared/protocol.ts";
import { DiagramRoom } from "../src/worker/room.ts";
import type { Author, Op } from "../src/worker/scene.ts";
import { makeEnv, makeRoom, makeRoomCtx, makeWs } from "./helpers/fakes.ts";

function graphOf(room: { getGraph: () => Promise<unknown> }) {
  return room.getGraph() as Promise<{
    diagram: string;
    nodes?: Array<{ id: string; label: string; [k: string]: unknown }>;
    edges?: Array<{ id: string; from?: string; to?: string }>;
    frames?: Array<{ id: string; name: string }>;
    notes?: Array<{ id: string; text: string }>;
  }>;
}

describe("DiagramRoom ops layer", () => {
  it("inits with a name and reports info", async () => {
    const { env } = makeEnv();
    const room = await makeRoom(env, "d1", "HLD");
    const info = await room.info();
    expect(info).toMatchObject({ id: "d1", name: "HLD", elements: 0, tabs: 0 });
  });

  it("applyPatch draws, auto-snapshots and tints violet", async () => {
    const { env } = makeEnv();
    const room = await makeRoom(env);
    const out = await room.applyPatch(
      [
        { op: "add_node", ref: "a", label: "API" },
        { op: "add_node", ref: "b", label: "DB" },
        { op: "connect", from: "a", to: "b" },
      ],
      "agent",
    );
    expect(out.results.every((r) => r.ok)).toBe(true);
    expect(out.snapshotId).toBeDefined();
    expect(out.changed).toBeGreaterThan(0);
    const snaps = await room.listSnapshots();
    expect(snaps.some((s) => s.id === out.snapshotId && s.kind === "auto")).toBe(true);

    const g = await graphOf(room);
    expect(g.diagram).toBe("Test");
    expect(g.nodes!.map((n) => n.label).sort()).toEqual(["API", "DB"]);
    expect(g.edges).toHaveLength(1);
    const raw = await room.getRaw();
    expect(raw.filter((e) => e.type !== "text").every((e) => e.strokeColor === AGENT_STROKE)).toBe(
      true,
    );
  });

  it("system patches skip the auto-snapshot", async () => {
    const { env } = makeEnv();
    const room = await makeRoom(env);
    const out = await room.applyPatch([{ op: "add_node", label: "A" }], "system" as Author);
    expect(out.snapshotId).toBeUndefined();
    expect(await room.listSnapshots()).toHaveLength(0);
  });

  it("names the pre-edit version from user feedback and restores the previous state", async () => {
    const { env } = makeEnv();
    const room = await makeRoom(env);
    const out = await room.applyPatch(
      [{ op: "add_node", kind: "device" }],
      "agent",
      "  Model devices separately from users  ",
    );
    expect((await room.listSnapshots())[0].name).toBe(
      "Before: Model devices separately from users",
    );
    expect((await graphOf(room)).nodes).toHaveLength(1);
    await room.restore(out.snapshotId!);
    expect((await graphOf(room)).nodes ?? []).toHaveLength(0);
  });

  it("falls back to component and existing node labels for version names", async () => {
    const { env } = makeEnv();
    const room = await makeRoom(env);
    await room.applyPatch([{ op: "add_node", kind: "database" }]);
    expect((await room.listSnapshots())[0].name).toBe("Before: Add Database");
    const node = (await graphOf(room)).nodes![0];
    const out = await room.applyPatch([{ op: "update", target: node.id, label: "Events DB" }]);
    const snap = (await room.listSnapshots()).find((s) => s.id === out.snapshotId);
    expect(snap?.name).toBe("Before: Rename Database to Events DB");
  });

  it("tidy and layout wrap edits in snapshots", async () => {
    const { env } = makeEnv();
    const room = await makeRoom(env);
    await room.applyPatch(
      [
        { op: "add_node", ref: "a", label: "A" },
        { op: "add_node", ref: "b", label: "B" },
      ],
      "system" as Author,
    );
    const tidy = await room.tidy();
    expect(tidy.snapshotId).toBeDefined();
    expect(typeof tidy.changed).toBe("number");
    const layout = await room.layout("LR");
    expect(layout.moved).toBe(2);
    expect(layout.snapshotId).toBeDefined();
  });

  it("snapshots restore and undo", async () => {
    const { env } = makeEnv();
    const room = await makeRoom(env);
    await room.applyPatch([{ op: "add_node", label: "Keep" }], "system" as Author);
    const v1 = await room.snapshot("v1", "named");
    await room.applyPatch([{ op: "add_node", label: "Later" }], "system" as Author);
    const labels = async () => ((await graphOf(room)).nodes ?? []).map((n) => n.label).sort();
    expect(await labels()).toEqual(["Keep", "Later"]);

    const restored = await room.restore(v1.id);
    expect(restored.restored).toBe(v1.id);
    expect(await labels()).toEqual(["Keep"]);

    await room.restore(restored.undoSnapshotId);
    expect(await labels()).toEqual(["Keep", "Later"]);
  });

  it("restore of a missing snapshot throws", async () => {
    const { env } = makeEnv();
    const room = await makeRoom(env);
    await expect(room.restore("missing")).rejects.toThrow("not found");
  });

  it("seeds template elements without a snapshot", async () => {
    const { env } = makeEnv();
    const room = await makeRoom(env);
    const donor = await makeRoom(env, "donor");
    await donor.applyPatch([{ op: "add_node", label: "T" }], "template");
    await room.seed(await donor.getRaw());
    const raw = await room.getRaw();
    expect(raw.some((e) => e.customData?.author === "template")).toBe(true);
    expect(await room.listSnapshots()).toHaveLength(0);
  });

  it("getRaw hides tombstones", async () => {
    const { env } = makeEnv();
    const room = await makeRoom(env);
    await room.applyPatch(
      [
        { op: "add_node", ref: "a", label: "A" },
        { op: "add_node", ref: "b", label: "B" },
        { op: "remove", target: "a" },
      ],
      "system" as Author,
    );
    expect((await room.getRaw()).every((e) => !e.isDeleted)).toBe(true);
    expect(((await graphOf(room)).nodes ?? []).map((n) => n.label)).toEqual(["B"]);
  });
});

describe("failed batch persistence", () => {
  it.each(["agent", "human"] as const)(
    "%s edits leave storage, memory and peers unchanged on failure, then can retry",
    async (author) => {
      const { env } = makeEnv();
      const { ctx, sql, addWs } = makeRoomCtx();
      const room = new DiagramRoom(ctx as unknown as DurableObjectState, env);
      await room.init("d", "D");
      await room.applyPatch(
        [
          { op: "add_node", ref: "a", label: "API" },
          { op: "add_node", ref: "b", label: "DB" },
          { op: "connect", from: "a", to: "b" },
        ],
        "template",
      );
      const before = structuredClone(await room.getRaw());
      const storedBefore = new Map(sql.elements);
      const ws = makeWs();
      addWs(ws);
      const edit = () =>
        author === "agent"
          ? room.applyPatch([
              { op: "update", target: "API", label: "Gateway" },
              { op: "remove", target: "DB" },
            ])
          : room.webSocketMessage(
              ws as unknown as WebSocket,
              JSON.stringify({
                type: "update",
                elements: before.map((el) => ({ ...el, x: el.x + 100, version: el.version + 1 })),
              }),
            );
      const exec = sql.exec.bind(sql);
      let writes = 0;
      const spy = vi.spyOn(sql, "exec").mockImplementation((query, ...params) => {
        if (query.startsWith("INSERT OR REPLACE INTO elements") && ++writes === 2)
          throw new Error("injected write failure");
        return exec(query, ...params);
      });
      try {
        await expect(edit()).rejects.toThrow("injected write failure");
        expect(writes).toBe(2);
        expect(sql.elements).toEqual(storedBefore);
        expect(await room.getRaw()).toEqual(before);
        expect(ws.sent).toEqual([]);
        const reloaded = new DiagramRoom(ctx as unknown as DurableObjectState, env);
        expect(await reloaded.getRaw()).toEqual(before);
      } finally {
        spy.mockRestore();
      }
      const peer = makeWs();
      addWs(peer);
      await edit();
      expect(await room.getRaw()).not.toEqual(before);
      expect(peer.sent).toHaveLength(1);
      expect(JSON.parse(peer.sent[0])).toMatchObject({ type: "update", origin: author });
      const reloaded = new DiagramRoom(ctx as unknown as DurableObjectState, env);
      expect(await reloaded.getRaw()).toEqual(await room.getRaw());
    },
  );
});

describe("concurrent-edit merge rule", () => {
  async function roomWithNode() {
    const { env } = makeEnv();
    const room = await makeRoom(env);
    const [r] = (await room.applyPatch([{ op: "add_node", label: "X" }], "system" as Author))
      .results;
    const cur = (await room.getRaw()).find((e) => e.id === r.id)!;
    const send = (el: El) =>
      (
        room as unknown as { webSocketMessage: (ws: null, raw: string) => Promise<void> }
      ).webSocketMessage(null, JSON.stringify({ type: "update", elements: [el] }));
    const versionOf = async () => (await room.getRaw()).find((e) => e.id === r.id)!;
    return { room, cur, send, versionOf };
  }

  it("higher version wins; stale versions are ignored", async () => {
    const { cur, send, versionOf } = await roomWithNode();
    await send({ ...structuredClone(cur), version: 0, versionNonce: 0 });
    expect((await versionOf()).version).toBe(cur.version);
    await send({ ...structuredClone(cur), version: cur.version + 5, versionNonce: 1 });
    expect((await versionOf()).version).toBe(cur.version + 5);
  });

  it("on version ties the lower nonce wins", async () => {
    const { cur, send, versionOf } = await roomWithNode();
    const v = cur.version + 1;
    await send({ ...structuredClone(cur), version: v, versionNonce: 500 });
    expect((await versionOf()).versionNonce).toBe(500);
    await send({ ...structuredClone(cur), version: v, versionNonce: 100 });
    expect((await versionOf()).versionNonce).toBe(100);
    await send({ ...structuredClone(cur), version: v, versionNonce: 900 });
    expect((await versionOf()).versionNonce).toBe(100);
  });

  it("broadcasts human updates to the other tabs", async () => {
    const { env } = makeEnv();
    const { ctx, addWs } = makeRoomCtx();
    const room = new DiagramRoom(ctx as unknown as DurableObjectState, env);
    await room.init("d", "D");
    const ws1 = makeWs();
    const ws2 = makeWs();
    addWs(ws1);
    addWs(ws2);
    const el = { id: "ext", type: "rectangle", version: 1, versionNonce: 7 } as El;
    await (
      room as unknown as { webSocketMessage: (ws: unknown, raw: string) => Promise<void> }
    ).webSocketMessage(ws1, JSON.stringify({ type: "update", elements: [el] }));
    expect(ws1.sent).toHaveLength(0);
    expect(ws2.sent).toHaveLength(1);
    expect(JSON.parse(ws2.sent[0])).toMatchObject({ type: "update", origin: "human" });
  });
});

describe("presence and tab RPC", () => {
  it("broadcasts room name changes to connected tabs", async () => {
    const { env } = makeEnv();
    const { ctx, addWs } = makeRoomCtx();
    const room = new DiagramRoom(ctx as unknown as DurableObjectState, env);
    await room.init("rename-test", "Before");
    const a = makeWs(),
      b = makeWs();
    addWs(a);
    addWs(b);
    await room.rename("Route history design");
    expect(JSON.parse(a.sent[0])).toEqual({ type: "rename", name: "Route history design" });
    expect(b.sent).toEqual(a.sent);
  });
  it("focuses only the active subscriber without editing or snapshotting the diagram", async () => {
    const { env } = makeEnv();
    const { ctx, addWs } = makeRoomCtx();
    const room = new DiagramRoom(ctx as unknown as DurableObjectState, env);
    await room.init("focus-test", "Focus test");
    await room.applyPatch([{ op: "add_node", kind: "database" }], "human");
    const before = await room.getRaw();
    const passive = makeWs();
    const active = makeWs();
    passive.serializeAttachment({ selection: [], focusedAt: 1 });
    active.serializeAttachment({ selection: [], focusedAt: 2 });
    addWs(passive);
    addWs(active);
    const result = room.focusView(["Database"], "point");
    const message = JSON.parse(active.sent[0]);
    expect(message).toMatchObject({ method: "focus_view", params: { mode: "point" } });
    expect(passive.sent).toHaveLength(0);
    await room.webSocketMessage(
      active as unknown as WebSocket,
      JSON.stringify({
        type: "rpc_result",
        reqId: message.reqId,
        ok: true,
        data: { mode: "point", visible: true, elementIds: message.params.elementIds },
      }),
    );
    expect(await result).toMatchObject({ mode: "point", visible: true });
    expect(await room.getRaw()).toEqual(before);
    expect(await room.listSnapshots()).toHaveLength(0);
  });

  it("reports no open tab until a socket attaches", async () => {
    const { env } = makeEnv();
    const room = await makeRoom(env);
    expect(await room.getSelection()).toMatchObject({ tabOpen: false });
  });

  it("echoes the attached tab's selection and viewport", async () => {
    const { env } = makeEnv();
    const { ctx, addWs } = makeRoomCtx();
    const room = new DiagramRoom(ctx as unknown as DurableObjectState, env);
    await room.init("d", "D");
    const out = await room.applyPatch(
      [
        { op: "add_node", ref: "a", label: "A" },
        { op: "add_node", label: "B" },
      ],
      "system" as Author,
    );
    const idA = out.results[0].id!;
    const ws = makeWs();
    addWs(ws);
    const send = (
      room as unknown as { webSocketMessage: (ws: unknown, raw: string) => Promise<void> }
    ).webSocketMessage.bind(room);
    await send(
      ws,
      JSON.stringify({
        type: "presence",
        selection: [idA, "unknown-id"],
        viewport: { x: 1, y: 2, width: 3, height: 4, zoom: 1 },
        focused: true,
      }),
    );
    const sel = (await room.getSelection()) as {
      tabOpen: boolean;
      viewport: unknown;
      nodes: Array<{ id: string }>;
    };
    expect(sel.tabOpen).toBe(true);
    expect(sel.viewport).toMatchObject({ x: 1, y: 2 });
    expect(sel.nodes.map((n) => n.id)).toEqual([idA]);
  });

  it("rejects plain HTTP on the WS route", async () => {
    const { env } = makeEnv();
    const room = await makeRoom(env);
    const res = await room.fetch(new Request("http://x/"));
    expect(res.status).toBe(426);
  });

  it("screenshot without an open tab fails with guidance", { timeout: 15000 }, async () => {
    const { env } = makeEnv();
    const room = await makeRoom(env);
    await expect(room.screenshot()).rejects.toThrow("No canvas tab is open");
  });
});

describe("room-level interview flow", () => {
  it("draws, tidies, checkpoints and reads back a design", async () => {
    const { env } = makeEnv();
    const room = await makeRoom(env, "flow", "URL shortener");
    const ops: Op[] = [
      { op: "add_frame", ref: "hld", name: "High-level design" },
      { op: "add_node", ref: "c", label: "Client", shape: "ellipse", frame: "hld" },
      { op: "add_node", ref: "api", label: "API", place: { right_of: "c" } },
      { op: "add_node", ref: "db", label: "DB", shape: "ellipse", place: { right_of: "api" } },
      { op: "connect", from: "c", to: "api" },
      { op: "connect", from: "api", to: "db" },
      { op: "add_note", text: "QPS ~ 10k", place: { near: "api" } },
    ];
    const applied = await room.applyPatch(ops, "agent");
    expect(applied.results.every((r) => r.ok)).toBe(true);
    const tidied = await room.tidy();
    expect(tidied.changed).toBeGreaterThanOrEqual(0);
    await room.snapshot("checkpoint", "named");
    const g = await graphOf(room);
    expect(g.nodes!.map((n) => n.label).sort()).toEqual(["API", "Client", "DB"]);
    expect(g.edges).toHaveLength(2);
    expect(g.frames!.map((f) => f.name)).toEqual(["High-level design"]);
    expect((await room.listSnapshots()).some((s) => s.name === "checkpoint")).toBe(true);
  });
});
