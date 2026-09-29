// Worker HTTP routes with real DiagramRooms on fake D1/R2.
import { describe, expect, it, vi } from "vitest";
import { apiErrorMessage, type ApiFailure } from "../src/app/api-error.ts";
import worker from "../src/worker/index.ts";
import { createDiagram, parseLink } from "../src/worker/store.ts";
import type { Author } from "../src/worker/scene.ts";
import { makeEnv, testCtx, type TestEnv } from "./helpers/fakes.ts";

function req(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost${path}`, init);
}

/** The Worker's default export, with the execution context the runtime always passes. */
function call(env: TestEnv, request: Request) {
  return worker.fetch(request, env.env, testCtx());
}

async function post(env: TestEnv, path: string, payload: unknown) {
  return call(
    env,
    req(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

/** Response bodies the API returns. */
type Created = { id: string; key: string; name: string; link: string };
type ListedDiagram = { id: string; key: string; name: string };
type DiagramPage = { items: ListedDiagram[]; nextCursor: string | null };
type WithId = { id: string };
type ErrorBody = { error: string };
type TemplateInfo = { id: string; name: string };
type SnapshotInfo = { id: string; name: string };
type InvalidBodyCase = [route: string, payload: unknown];
/** The RFC 9728 document the OAuth provider serves for the MCP endpoint. */
type ProtectedResource = { resource: string; authorization_servers: string[] };

const invalidBodies: InvalidBodyCase[] = [
  ["/api/diagrams", { name: 42 }],
  ["/api/diagrams", { name: "x".repeat(121) }],
  ["/api/diagrams", { template: 42 }],
  ["/api/diagrams", null],
  ["/api/diagrams", []],
  ["/snapshots", { name: [] }],
  ["/restore", {}],
  ["/restore", { snapshotId: "" }],
  ["/restore", { snapshotId: 42 }],
  ["/tidy", { frames: "frame1" }],
  ["/tidy", { frames: [42] }],
  ["/tidy", { frames: [""] }],
  ["/template", {}],
  ["/template", { name: "  " }],
  ["/template", { name: "Valid", description: 42 }],
];

async function body(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

async function create(env: TestEnv, name: string, template?: string) {
  const res = await post(env, "/api/diagrams", template ? { name, template } : { name });
  expect(res.status).toBe(200);
  return (await body(res)) as Created;
}

const put = (env: TestEnv, path: string, bytes: BodyInit, type = "image/png") =>
  call(env, req(path, { method: "PUT", headers: { "Content-Type": type }, body: bytes }));

describe("diagrams API", () => {
  it("lists existing and agent-created diagrams without browser history, preserving old links", async () => {
    const env = makeEnv();
    const old = await create(env, "Existing board");
    env.db.diagrams.get(old.id)!.created_at = 1;
    // MCP uses the same createDiagram function, without any browser registration.
    const agent = await createDiagram(env.env, "Agent board");
    await post(env, `/api/d/${old.id}/template?k=${old.key}`, { name: "Template" });
    const response = await call(env, req("/api/diagrams"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const page = (await response.json()) as DiagramPage;
    const listed = page.items;
    expect(listed.map((d) => d.id)).toEqual([agent.id, old.id]);
    const opened = await Promise.all(
      listed.map(async (d) => call(env, req(`/api/d/${d.id}?k=${d.key}`))),
    );
    expect(opened.map((result) => result.status)).toEqual([200, 200]);
    expect((await call(env, req(`/api/d/${old.id}?k=${old.key}`))).status).toBe(200);
    expect((await call(env, req(`/api/d/${old.id}?k=${listed[0].key}`))).status).toBe(403);
    const again = await call(env, req("/api/diagrams"));
    expect(await again.json()).toEqual(page);
    await post(env, `/api/d/${agent.id}/rename?k=${listed[0].key}`, { name: "Renamed" });
    const updated = await call(env, req("/api/diagrams"));
    expect(await updated.json()).toEqual(
      expect.objectContaining({
        items: expect.arrayContaining([expect.objectContaining({ name: "Renamed" })]),
      }),
    );
  });

  it("returns an empty server library before any boards exist", async () => {
    const env = makeEnv();
    expect(await (await call(env, req("/api/diagrams"))).json()).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it("paginates tied timestamps without duplicates, even after insertion and cursor-row deletion", async () => {
    const env = makeEnv();
    const created = await Promise.all(
      Array.from({ length: 5 }, (_, i) => create(env, `Board ${i}`)),
    );
    for (const d of created) env.db.diagrams.get(d.id)!.created_at = 100;
    const expected = created
      .map((d) => d.id)
      .toSorted()
      .toReversed();
    const first = (await (await call(env, req("/api/diagrams?limit=2"))).json()) as DiagramPage;
    expect(first.items.map((d) => d.id)).toEqual(expected.slice(0, 2));
    expect(env.db.library.size).toBe(2); // Backfill is bounded to the requested page.
    await create(env, "Newer during pagination");
    const last = first.items[1];
    const removed = await call(env, req(`/api/d/${last.id}?k=${last.key}`, { method: "DELETE" }));
    expect(removed.status).toBe(204);
    const second = (await (
      await call(env, req(`/api/diagrams?limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`))
    ).json()) as typeof first;
    expect(second.items.map((d) => d.id)).toEqual(expected.slice(2, 4));
    const third = (await (
      await call(env, req(`/api/diagrams?limit=2&cursor=${encodeURIComponent(second.nextCursor!)}`))
    ).json()) as typeof first;
    expect(third.items.map((d) => d.id)).toEqual(expected.slice(4));
    expect(third.nextCursor).toBeNull();
  });

  it("rejects invalid pagination parameters", async () => {
    const env = makeEnv();
    const params = [
      "limit=0",
      "limit=101",
      "limit=-1",
      "limit=1.5",
      "limit=all",
      "limit=",
      "cursor=bad",
      "cursor=",
      `cursor=${btoa(JSON.stringify({ createdAt: -1, id: "abcdefgh" }))}`,
    ];
    const results = await Promise.all(
      params.map(async (param) => call(env, req(`/api/diagrams?${param}`))),
    );
    expect(results.every((res) => res.status === 400)).toBe(true);
  });

  it("deletes only an authorized board and disables old and library links", async () => {
    const env = makeEnv();
    const [target, keep] = await Promise.all([create(env, "Prod smoke"), create(env, "Keep")]);
    const page = (await (await call(env, req("/api/diagrams"))).json()) as DiagramPage;
    const libraryKey = page.items.find((d) => d.id === target.id)!.key;
    expect((await call(env, req(`/api/d/${target.id}?k=wrong`, { method: "DELETE" }))).status).toBe(
      403,
    );
    expect(
      (await call(env, req(`/api/d/${target.id}?k=${libraryKey}`, { method: "DELETE" }))).status,
    ).toBe(204);
    const result = (await (await call(env, req("/api/diagrams"))).json()) as typeof page;
    expect(result.items.map((d) => d.id)).toEqual([keep.id]);
    const blocked = await Promise.all(
      [target.key, libraryKey].map(async (key) => call(env, req(`/api/d/${target.id}?k=${key}`))),
    );
    expect(blocked.map((res) => res.status)).toEqual([403, 403]);
    expect((await call(env, req(`/api/d/${keep.id}?k=${keep.key}`))).status).toBe(200);
  });

  it("creates a diagram and serves its capability link", async () => {
    const env = makeEnv();
    const d = await create(env, "HLD");
    expect(d.name).toBe("HLD");
    expect(parseLink(d.link)).toEqual({ id: d.id, key: d.key });

    const ok = await call(env, req(`/api/d/${d.id}?k=${d.key}`));
    expect(ok.status).toBe(200);
    expect(await body(ok)).toMatchObject({ id: d.id, name: "HLD" });
  });

  it("rejects missing or wrong keys with 403", async () => {
    const env = makeEnv();
    const d = await create(env, "HLD");
    const paths = [`/api/d/${d.id}`, `/api/d/${d.id}?k=wrong`, `/api/d/unknown-id?k=${d.key}`];
    const results = await Promise.all(paths.map(async (path) => call(env, req(path))));
    for (const res of results) expect(res.status).toBe(403);
  });

  it("renames through D1 and the room together", async () => {
    const env = makeEnv();
    const d = await create(env, "Old");
    const res = await post(env, `/api/d/${d.id}/rename?k=${d.key}`, { name: "  New  " });
    expect(res.status).toBe(200);
    const got = await call(env, req(`/api/d/${d.id}?k=${d.key}`));
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
    const response = await call(env, req(`/api/d/${d.id}?k=${d.key}`));
    expect(await body(response)).toMatchObject({ name: "Original" });
  });

  it("creates from a builtin template into the live room", async () => {
    const env = makeEnv();
    const d = await create(env, "Web", "builtin:web-baseline");
    const g = await env.rooms.get(d.id)!.getGraph();
    expect(g.nodes).toHaveLength(9);
    expect(g.edges).toHaveLength(8);
  });

  it("creates from a saved template via the seed path", async () => {
    const env = makeEnv();
    const src = await create(env, "Src", "builtin:read-heavy");
    const tpl = await post(env, `/api/d/${src.id}/template?k=${src.key}`, { name: "Saved" });
    expect(tpl.status).toBe(200);
    const tplId = ((await body(tpl)) as WithId).id;
    const copy = await create(env, "Copy", tplId);
    const g = await env.rooms.get(copy.id)!.getGraph();
    expect(g.nodes).toHaveLength(6);
  });

  it("fails loudly on unknown templates", async () => {
    const env = makeEnv();
    const res = await post(env, "/api/diagrams", { name: "X", template: "nope" });
    expect(res.status).toBe(500);
    expect(((await body(res)) as ErrorBody).error).toMatch("unknown template");
  });

  it("lists builtin and saved templates", async () => {
    const env = makeEnv();
    const before = (await (await call(env, req("/api/templates"))).json()) as TemplateInfo[];
    expect(before.some((t) => t.id === "builtin:interview")).toBe(true);
    const src = await create(env, "Src");
    await post(env, `/api/d/${src.id}/template?k=${src.key}`, { name: "Mine" });
    const after = (await (await call(env, req("/api/templates"))).json()) as TemplateInfo[];
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
    const meta = (await body(snap)) as SnapshotInfo;
    expect(meta.name).toBe("v1");

    await room.applyPatch([{ op: "add_node", label: "B" }], "system" as Author);
    const list = await call(env, req(`/api/d/${d.id}/snapshots?k=${d.key}`));
    expect(await list.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: meta.id })]),
    );

    const restore = await post(env, `/api/d/${d.id}/restore?k=${d.key}`, { snapshotId: meta.id });
    expect(restore.status).toBe(200);
    const g = await room.getGraph();
    expect(g.nodes!.map((n) => n.label)).toEqual(["A"]);
  });

  it("tidies through HTTP as the system origin", async () => {
    const env = makeEnv();
    const d = await create(env, "T");
    await env.rooms.get(d.id)!.applyPatch([{ op: "add_node", label: "A" }], "system" as Author);
    const res = await post(env, `/api/d/${d.id}/tidy?k=${d.key}`, {});
    expect(res.status).toBe(200);
    // apply_patch already tidied it: nothing to change, so no snapshot.
    expect(await body(res)).toMatchObject({ changed: 0 });
    const scoped = await post(env, `/api/d/${d.id}/tidy?k=${d.key}`, { frames: [null] });
    expect(scoped.status).toBe(200);
  });
});

describe("files API", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

  it("stores an image in R2 and serves it back to key holders only", async () => {
    const env = makeEnv();
    const d = await create(env, "F");
    expect((await put(env, `/api/d/${d.id}/files/abc123?k=${d.key}`, png)).status).toBe(204);
    // Content-addressed: a second upload of the same id is a no-op.
    expect((await put(env, `/api/d/${d.id}/files/abc123?k=${d.key}`, png)).status).toBe(204);

    const res = await call(env, req(`/api/d/${d.id}/files/abc123?k=${d.key}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Content-Security-Policy")).toBe("sandbox");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(png);

    expect((await call(env, req(`/api/d/${d.id}/files/abc123?k=wrong`))).status).toBe(403);
    expect((await call(env, req(`/api/d/${d.id}/files/nope?k=${d.key}`))).status).toBe(404);
  });

  it("rejects non-images and files over 4 MB", async () => {
    const env = makeEnv();
    const d = await create(env, "F");
    const path = `/api/d/${d.id}/files/x?k=${d.key}`;
    expect((await put(env, path, "<html>", "text/html")).status).toBe(415);
    expect((await put(env, path, new Uint8Array(4 * 1024 * 1024 + 1))).status).toBe(413);
    expect(env.bucket.objects.has(`files/${d.id}/x`)).toBe(false);
  });

  it("copies referenced images into templates and diagrams made from them", async () => {
    const env = makeEnv();
    const d = await create(env, "Source");
    await env.rooms.get(d.id)!.seed([
      {
        id: "img",
        type: "image",
        fileId: "file1",
        status: "saved",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        version: 1,
        versionNonce: 1,
        isDeleted: false,
      },
    ]);
    await put(env, `/api/d/${d.id}/files/file1?k=${d.key}`, png);
    const tpl = (await body(
      await post(env, `/api/d/${d.id}/template?k=${d.key}`, { name: "With image" }),
    )) as WithId;
    const copy = await create(env, "Copy", tpl.id);
    const res = await call(env, req(`/api/d/${copy.id}/files/file1?k=${copy.key}`));
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(png);
  });
});

describe("request validation", () => {
  it.each(invalidBodies)("rejects invalid JSON fields on %s: %j", async (route, payload) => {
    const env = makeEnv();
    const d = await create(env, "Validation");
    const path = route.startsWith("/api/") ? route : `/api/d/${d.id}${route}?k=${d.key}`;
    const response = await post(env, path, payload);
    expect(response.status).toBe(400);
    const failure = (await response.json()) as ApiFailure;
    expect(failure).toMatchObject({
      success: false,
      error: { name: "ZodError", message: expect.any(String) },
    });
    expect(apiErrorMessage(failure, "fallback")).not.toBe("fallback");
    expect(env.db.diagrams.size).toBe(1);
    expect(env.db.snapshots).toHaveLength(0);
  });

  it("rejects malformed JSON instead of treating it as an empty tidy request", async () => {
    const env = makeEnv();
    const d = await create(env, "Validation");
    const response = await call(
      env,
      req(`/api/d/${d.id}/tidy?k=${d.key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Malformed JSON in request body" });
    expect(env.db.snapshots).toHaveLength(0);
  });

  it("keeps name defaults, trims names, and accepts JSON media types", async () => {
    const env = makeEnv();
    const response = await post(env, "/api/diagrams", {});
    expect(response.status).toBe(200);
    const d = (await response.json()) as Created;
    expect(d.name).toBe("Untitled");
    const renamed = await call(
      env,
      req(`/api/d/${d.id}/rename?k=${d.key}`, {
        method: "POST",
        headers: { "Content-Type": "application/vnd.example+json; charset=utf-8" },
        body: JSON.stringify({ name: "  Trimmed  " }),
      }),
    );
    expect(await renamed.json()).toEqual({ ok: true, name: "Trimmed" });
    const snapshot = await post(env, `/api/d/${d.id}/snapshots?k=${d.key}`, {});
    expect(snapshot.status).toBe(200);
    expect(await snapshot.json()).toMatchObject({ name: "manual" });
    const tidy = await call(env, req(`/api/d/${d.id}/tidy?k=${d.key}`, { method: "POST" }));
    expect(tidy.status).toBe(200);
  });

  it("checks authorization before parsing protected request bodies", async () => {
    const env = makeEnv();
    const d = await create(env, "Validation");
    const response = await post(env, `/api/d/${d.id}/rename?k=wrong`, { name: 42 });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "invalid link" });
  });
});

describe("routing", () => {
  it("authorizes diagram and WebSocket subpaths before dispatching", async () => {
    const env = makeEnv();
    const d = await create(env, "Protected");
    const paths = [
      `/api/d/${d.id}/rename`,
      `/api/d/${d.id}/files/file1`,
      `/api/d/${d.id}/unknown`,
      `/ws/${d.id}`,
      `/ws/${d.id}/extra`,
    ];
    const responses = await Promise.all(
      paths.map(async (path) => call(env, req(`${path}?k=wrong`))),
    );
    expect(responses.map((response) => response.status)).toEqual(paths.map(() => 403));
    expect(await Promise.all(responses.map((response) => response.json()))).toEqual(
      paths.map(() => ({ error: "invalid link" })),
    );
    const unknown = await call(env, req(`/api/d/${d.id}/unknown?k=${d.key}`));
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "not found" });
  });

  it("forwards the original WebSocket request and response to the authorized room", async () => {
    const env = makeEnv();
    const d = await create(env, "Socket");
    const response = new Response("room response", { headers: { "X-Room": d.id } });
    const fetch = vi.spyOn(env.rooms.get(d.id)!, "fetch").mockResolvedValue(response);
    const request = req(`/ws/${d.id}?k=${d.key}`, { headers: { Upgrade: "websocket" } });
    expect(await call(env, request)).toBe(response);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(request);
  });

  it("keeps file ID restrictions and strict paths", async () => {
    const env = makeEnv();
    const d = await create(env, "Paths");
    const paths = [
      `/api/d/${d.id}/files/bad.id?k=${d.key}`,
      `/api/d/${d.id}/files/${"x".repeat(129)}?k=${d.key}`,
      `/api/d/${d.id}/?k=${d.key}`,
      "/api/d/bad.id?k=wrong",
      "/api/diagrams/",
    ];
    const responses = await Promise.all(paths.map(async (path) => call(env, req(path))));
    expect(responses.map((response) => response.status)).toEqual(paths.map(() => 404));
  });

  it("answers an unauthenticated MCP request with an OAuth challenge", async () => {
    const env = makeEnv();
    const response = await post(env, "/mcp", {});
    expect(response.status).toBe(401);
    const challenge = response.headers.get("WWW-Authenticate") ?? "";
    // The client follows this to the RFC 9728 document, which names the issuer.
    expect(challenge).toContain("Bearer");
    expect(challenge).toContain(
      'resource_metadata="http://localhost/.well-known/oauth-protected-resource/mcp"',
    );
    expect(challenge).toContain('scope="mcp:read"');
  });

  it("publishes protected resource metadata naming this deployment as the issuer", async () => {
    const env = makeEnv();
    const response = await call(env, req("/.well-known/oauth-protected-resource/mcp"));
    expect(response.status).toBe(200);
    const doc = (await response.json()) as ProtectedResource;
    expect(doc.resource).toBe("http://localhost/mcp");
    expect(doc.authorization_servers).toEqual(["http://localhost"]);
  });

  it("reports that sign-in is unavailable until GitHub secrets are set", async () => {
    const env = makeEnv();
    const response = await call(env, req("/authorize?response_type=code&client_id=x"));
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("GITHUB_CLIENT_ID");
  });
});
