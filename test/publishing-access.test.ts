import { promiseResult } from "@/shared/promise-result.ts";
import { requiredTestValue } from "@test/helpers/required-test-value.ts";
import { createdSchema, librarySchema } from "@test/helpers/response-schemas.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "@/worker/index.ts";
import { createDiagram, listTemplates, saveAsTemplate, sha256, verifyKey } from "@/worker/store.ts";
import { readBounded, takeBudget } from "@/worker/request-limits.ts";
import { makeEnv, testCtx, type TestEnv } from "@test/helpers/fakes.ts";

type Created = { id: string; key: string };

type Library = { items: Created[] };

function request(env: TestEnv, path: string, token?: string, init: RequestInit = {}) {
  return promiseResult(() => {
    const headers = new Headers(init.headers);
    headers.set("Origin", "https://design.example");

    if (token) {
      headers.set("Cookie", `__Host-sdc-session=${token}`);
    }

    return worker.fetch(
      new Request(`https://design.example${path}`, { ...init, headers }),
      env.env,
      testCtx(),
    );
  });
}

async function session(env: TestEnv, userId: string) {
  const token = crypto.randomUUID();
  await env.kv.put(
    `browser-session:${await sha256(token)}`,
    JSON.stringify({ userId, expiresAt: Date.now() + 60_000 }),
  );

  return token;
}

afterEach(() => vi.unstubAllGlobals());

describe("public service access boundaries", () => {
  it("requires sign-in for creation and listing and isolates users' libraries", async () => {
    const env = makeEnv();
    const alice = await session(env, "github%3A1");
    const bob = await session(env, "github%3A2");
    expect((await request(env, "/api/diagrams")).status).toBe(401);
    expect(
      (
        await request(env, "/api/diagrams", undefined, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Anonymous" }),
        })
      ).status,
    ).toBe(401);

    const created = await request(env, "/api/diagrams", alice, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Private" }),
    });

    const board = createdSchema.parse(await created.json()) satisfies Created;
    expect(created.status).toBe(200);

    const aliceLibrary = librarySchema.parse(
      await (await request(env, "/api/diagrams", alice)).json(),
    ) satisfies Library;

    const bobLibrary = librarySchema.parse(
      await (await request(env, "/api/diagrams", bob)).json(),
    ) satisfies Library;

    expect(aliceLibrary.items.map((item) => item.id)).toEqual([board.id]);
    expect(bobLibrary.items).toEqual([]);
    // Explicit collaboration remains possible without sign-in.
    expect((await request(env, `/api/d/${board.id}?k=${board.key}`)).status).toBe(200);
    expect((await request(env, `/api/d/${board.id}?k=wrong`, bob)).status).toBe(403);
    expect(
      (await request(env, `/api/d/${board.id}?k=${board.key}`, bob, { method: "DELETE" })).status,
    ).toBe(403);
    expect(await verifyKey(env.env, board.id, board.key)).not.toBeNull();
  });

  it("keeps unowned legacy boards out of every authenticated library", async () => {
    const env = makeEnv();
    const legacy = await createDiagram(env.env, "Legacy");
    const token = await session(env, "github%3A1");

    const library = librarySchema.parse(
      await (await request(env, "/api/diagrams", token)).json(),
    ) satisfies Library;

    expect(library.items).toEqual([]);
    expect(env.db.library.has(legacy.id)).toBe(false);
    expect(await verifyKey(env.env, legacy.id, legacy.key)).not.toBeNull();
  });

  it("permanently erases board content and permits an owner to retry cleanup", async () => {
    const env = makeEnv();
    const token = await session(env, "github%3A1");
    const board = await createDiagram(env.env, "Erase", "builtin:web-baseline", "github%3A1");
    await requiredTestValue(env.rooms.get(board.id)).snapshot("Private version");
    await env.bucket.put(`files/${board.id}/picture`, "private image");
    await env.bucket.put("files/other-board/picture", "keep");
    const deleted = await request(env, `/api/diagrams/${board.id}`, token, { method: "DELETE" });
    expect(deleted.status).toBe(204);
    expect(await verifyKey(env.env, board.id, board.key)).toBeNull();
    expect(env.db.diagrams.has(board.id)).toBe(false);
    expect(env.db.snapshots.some((row) => row.diagram_id === board.id)).toBe(false);
    expect([...env.bucket.objects.keys()].some((key) => key.includes(`/${board.id}/`))).toBe(false);
    expect(env.bucket.objects.has("files/other-board/picture")).toBe(true);
    expect(await requiredTestValue(env.rooms.get(board.id)).getRaw()).toEqual([]);
    expect(
      (await request(env, `/api/diagrams/${board.id}`, token, { method: "DELETE" })).status,
    ).toBe(204);
    await expect(
      requiredTestValue(env.rooms.get(board.id)).applyPatch([{ op: "add_node", label: "Revived" }]),
    ).rejects.toThrow("deleted");
  });

  it("does not disclose or clone another user's template and leaves no failed board", async () => {
    const env = makeEnv();
    const board = await createDiagram(env.env, "Source", undefined, "github%3A1");

    const template = await saveAsTemplate(
      env.env,
      board.id,
      "Private template",
      undefined,
      "github%3A1",
    );

    expect(
      (await listTemplates(env.env, "github%3A1")).some((item) => item.id === template.id),
    ).toBe(true);
    expect(
      (await listTemplates(env.env, "github%3A2")).some((item) => item.id === template.id),
    ).toBe(false);
    const before = env.db.diagrams.size;
    await expect(createDiagram(env.env, "Stolen", template.id, "github%3A2")).rejects.toThrow(
      "Template is not available",
    );
    await expect(
      saveAsTemplate(env.env, board.id, "Stolen", undefined, "github%3A2"),
    ).rejects.toThrow("Only the diagram owner");
    expect(env.db.diagrams.size).toBe(before);
  });

  it("rejects cross-origin cookie mutations and expires browser sessions", async () => {
    const env = makeEnv();
    const token = await session(env, "github%3A1");

    const crossOrigin = new Request("https://design.example/api/diagrams", {
      method: "POST",
      headers: {
        Origin: "https://evil.example",
        Cookie: `__Host-sdc-session=${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "CSRF" }),
    });

    expect((await worker.fetch(crossOrigin, env.env, testCtx())).status).toBe(403);
    await env.kv.put(
      `browser-session:${await sha256(token)}`,
      JSON.stringify({ userId: "github%3A1", expiresAt: Date.now() - 1 }),
    );
    expect((await request(env, "/api/diagrams", token)).status).toBe(401);
    expect(env.db.diagrams.size).toBe(0);
  });

  it("serves the exact verification token and fails closed when it is unset", async () => {
    const env = makeEnv();
    expect((await request(env, "/.well-known/openai-apps-challenge")).status).toBe(404);
    env.env.OPENAI_APPS_CHALLENGE = "review-token";
    const response = await request(env, "/.well-known/openai-apps-challenge");
    expect(response.headers.get("Content-Type")).toContain("text/plain");
    expect(await response.text()).toBe("review-token");
  });
});

describe("bounded requests", () => {
  it("cancels chunked input as soon as it exceeds its allowance", async () => {
    const cancel = vi.fn();

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(5));
        controller.enqueue(new Uint8Array(5));
      },
      cancel,
    });

    await expect(readBounded(body, 8)).rejects.toThrow("too large");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects oversized HTTP bodies before creating artifacts", async () => {
    const env = makeEnv();
    const token = await session(env, "github%3A1");

    const response = await request(env, "/api/diagrams", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "x".repeat(1024 * 1024 + 1),
    });

    expect(response.status).toBe(413);
    expect(env.db.diagrams.size).toBe(0);
  });

  it("enforces per-key budgets and resets them in the next window", async () => {
    const env = makeEnv();
    const now = vi.spyOn(Date, "now").mockReturnValue(120_000);

    try {
      await takeBudget(env.env, "alice", 1);
      await expect(takeBudget(env.env, "alice", 1)).rejects.toThrow("Too many requests");
      await takeBudget(env.env, "bob", 1);
      now.mockReturnValue(180_000);
      await takeBudget(env.env, "alice", 1);
    } finally {
      now.mockRestore();
    }
  });
});
