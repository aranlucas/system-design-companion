// Worker HTTP routes with real DiagramRooms on fake D1/R2.
import { describe, expect, it } from "vitest";
import worker from "../src/worker/index.ts";
import { createDiagram, parseLink } from "../src/worker/store.ts";
import type { Author } from "../src/worker/scene.ts";
import { makeEnv, type TestEnv } from "./helpers/fakes.ts";

type WorkerRequest = Parameters<typeof worker.fetch>[0];

function req(path: string, init?: RequestInit): WorkerRequest {
  return new Request(`http://localhost${path}`, init) as unknown as WorkerRequest;
}

function post(env: TestEnv, path: string, payload: unknown) {
  return worker.fetch(
    req(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
    env.env,
  );
}

async function body(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

async function create(env: TestEnv, name: string, template?: string) {
  const res = await post(env, "/api/diagrams", template ? { name, template } : { name });
  expect(res.status).toBe(200);
  return (await body(res)) as { id: string; key: string; name: string; link: string };
}

describe("diagrams API", () => {
  it("lists existing and agent-created diagrams without browser history, preserving old links", async () => {
    const env = makeEnv();
    const old = await create(env, "Existing board");
    env.db.diagrams.get(old.id)!.created_at = 1;
    // MCP uses the same createDiagram function, without any browser registration.
    const agent = await createDiagram(env.env, "Agent board");
    await post(env, `/api/d/${old.id}/template?k=${old.key}`, { name: "Template" });
    const response = await worker.fetch(req("/api/diagrams"), env.env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const listed = (await response.json()) as Array<{ id: string; key: string; name: string }>;
    expect(listed.map((d) => d.id)).toEqual([agent.id, old.id]);
    const opened = await Promise.all(
      listed.map((d) => worker.fetch(req(`/api/d/${d.id}?k=${d.key}`), env.env)),
    );
    expect(opened.map((result) => result.status)).toEqual([200, 200]);
    expect((await worker.fetch(req(`/api/d/${old.id}?k=${old.key}`), env.env)).status).toBe(200);
    expect((await worker.fetch(req(`/api/d/${old.id}?k=${listed[0].key}`), env.env)).status).toBe(
      403,
    );
    const again = await worker.fetch(req("/api/diagrams"), env.env);
    expect(await again.json()).toEqual(listed);
    await post(env, `/api/d/${agent.id}/rename?k=${listed[0].key}`, { name: "Renamed" });
    const updated = await worker.fetch(req("/api/diagrams"), env.env);
    expect(await updated.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Renamed" })]),
    );
  });

  it("returns an empty server library before any boards exist", async () => {
    const env = makeEnv();
    expect(await (await worker.fetch(req("/api/diagrams"), env.env)).json()).toEqual([]);
  });

  it("creates a diagram and serves its capability link", async () => {
    const env = makeEnv();
    const d = await create(env, "HLD");
    expect(d.name).toBe("HLD");
    expect(parseLink(d.link)).toEqual({ id: d.id, key: d.key });

    const ok = await worker.fetch(req(`/api/d/${d.id}?k=${d.key}`), env.env);
    expect(ok.status).toBe(200);
    expect(await body(ok)).toMatchObject({ id: d.id, name: "HLD" });
  });

  it("rejects missing or wrong keys with 403", async () => {
    const env = makeEnv();
    const d = await create(env, "HLD");
    const paths = [`/api/d/${d.id}`, `/api/d/${d.id}?k=wrong`, `/api/d/unknown-id?k=${d.key}`];
    const results = await Promise.all(paths.map((path) => worker.fetch(req(path), env.env)));
    for (const res of results) expect(res.status).toBe(403);
  });

  it("renames through D1 and the room together", async () => {
    const env = makeEnv();
    const d = await create(env, "Old");
    const res = await post(env, `/api/d/${d.id}/rename?k=${d.key}`, { name: "  New  " });
    expect(res.status).toBe(200);
    const got = await worker.fetch(req(`/api/d/${d.id}?k=${d.key}`), env.env);
    expect(await body(got)).toMatchObject({ name: "New" });
    expect((await env.rooms.get(d.id)!.info()).name).toBe("New");
  });

  it("rejects invalid room names without changing the saved name", async () => {
    const env = makeEnv();
    const d = await create(env, "Original");
    const responses = await Promise.all(
      ["  ", 42, "x".repeat(121)].map((name) =>
        post(env, `/api/d/${d.id}/rename?k=${d.key}`, { name }),
      ),
    );
    for (const response of responses) expect(response.status).toBe(400);
    const response = await worker.fetch(req(`/api/d/${d.id}?k=${d.key}`), env.env);
    expect(await body(response)).toMatchObject({ name: "Original" });
  });

  it("creates from a builtin template into the live room", async () => {
    const env = makeEnv();
    const d = await create(env, "Web", "builtin:web-baseline");
    const g = (await env.rooms.get(d.id)!.getGraph()) as { nodes?: unknown[]; edges?: unknown[] };
    expect(g.nodes).toHaveLength(9);
    expect(g.edges).toHaveLength(8);
  });

  it("creates from a saved template via the seed path", async () => {
    const env = makeEnv();
    const src = await create(env, "Src", "builtin:read-heavy");
    const tpl = await post(env, `/api/d/${src.id}/template?k=${src.key}`, { name: "Saved" });
    expect(tpl.status).toBe(200);
    const tplId = ((await body(tpl)) as { id: string }).id;
    const copy = await create(env, "Copy", tplId);
    const g = (await env.rooms.get(copy.id)!.getGraph()) as { nodes?: unknown[] };
    expect(g.nodes).toHaveLength(6);
  });

  it("fails loudly on unknown templates", async () => {
    const env = makeEnv();
    const res = await post(env, "/api/diagrams", { name: "X", template: "nope" });
    expect(res.status).toBe(500);
    expect(((await body(res)) as { error: string }).error).toMatch("unknown template");
  });

  it("lists builtin and saved templates", async () => {
    const env = makeEnv();
    const before = (await (await worker.fetch(req("/api/templates"), env.env)).json()) as Array<{
      id: string;
    }>;
    expect(before.some((t) => t.id === "builtin:interview")).toBe(true);
    const src = await create(env, "Src");
    await post(env, `/api/d/${src.id}/template?k=${src.key}`, { name: "Mine" });
    const after = (await (await worker.fetch(req("/api/templates"), env.env)).json()) as Array<{
      id: string;
      name: string;
    }>;
    expect(after.some((t) => t.name === "Mine")).toBe(true);
  });
});

describe("snapshots API", () => {
  it("snapshots, lists and restores", async () => {
    const env = makeEnv();
    const d = await create(env, "V");
    const room = env.rooms.get(d.id)!;
    await room.applyPatch([{ op: "add_node", label: "A" }], "system" as Author);

    const snap = await post(env, `/api/d/${d.id}/snapshots?k=${d.key}`, { name: "v1" });
    expect(snap.status).toBe(200);
    const meta = (await body(snap)) as { id: string; name: string };
    expect(meta.name).toBe("v1");

    await room.applyPatch([{ op: "add_node", label: "B" }], "system" as Author);
    const list = await worker.fetch(req(`/api/d/${d.id}/snapshots?k=${d.key}`), env.env);
    expect(((await list.json()) as unknown as unknown[]).length).toBeGreaterThanOrEqual(1);

    const restore = await post(env, `/api/d/${d.id}/restore?k=${d.key}`, { snapshotId: meta.id });
    expect(restore.status).toBe(200);
    const g = (await room.getGraph()) as { nodes?: Array<{ label: string }> };
    expect(g.nodes!.map((n) => n.label)).toEqual(["A"]);
  });

  it("tidies through HTTP as the system origin", async () => {
    const env = makeEnv();
    const d = await create(env, "T");
    await env.rooms.get(d.id)!.applyPatch([{ op: "add_node", label: "A" }], "system" as Author);
    const res = await post(env, `/api/d/${d.id}/tidy?k=${d.key}`, {});
    expect(res.status).toBe(200);
    expect(await body(res)).toMatchObject({ snapshotId: expect.any(String) });
  });
});

describe("routing", () => {
  it("returns 404 for unknown routes and reaches the MCP handler", async () => {
    const env = makeEnv();
    const missing = await worker.fetch(req("/nope"), env.env);
    expect(missing.status).toBe(404);
    const mcp = await post(env, "/mcp", {});
    expect(mcp.status).not.toBe(404);
  });
});
