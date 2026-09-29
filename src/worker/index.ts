import { zValidator } from "@hono/zod-validator";
import { Hono, type Handler, type MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  browserUser,
  requireBrowserUser,
  requireSameOrigin,
  browserLogin,
  browserCallback,
  browserLogout,
  isBrowserCallback,
} from "./browser-auth.ts";
import { readBounded, MAX_JSON_BYTES, takeBudget } from "./request-limits.ts";
import { AUTHORIZE_ENDPOINT, CALLBACK_PATH, isOAuthPath } from "./oauth-paths.ts";
import {
  createBody,
  paginationQuery,
  renameBody,
  restoreBody,
  snapshotBody,
  templateBody,
  tidyBody,
} from "./request-schemas.ts";
import {
  createDiagram,
  deleteDiagram,
  getFile,
  listDiagrams,
  putFile,
  listTemplates,
  room,
  saveAsTemplate,
  shareLink,
  verifyKey,
  requireOwner,
  MAX_FILE_BYTES,
  type DiagramRow,
} from "./store.ts";

export { DiagramRoom } from "./room.ts";

type DiagramVariables = { diagram: DiagramRow; room: ReturnType<typeof room> };
type WorkerEnv = { Bindings: Env; Variables: DiagramVariables };

const app = new Hono<WorkerEnv>();

app.onError((error, c) => {
  if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
  console.error(JSON.stringify({ event: "worker_error", name: error.name }));
  return c.json({ error: "Unexpected server error. Please try again." }, 500);
});
app.notFound((c) => c.json({ error: "not found" }, 404));

app.get("/api/auth/session", async (c) => {
  c.header("Cache-Control", "no-store");
  return c.json({ signedIn: Boolean(await browserUser(c.req.raw, c.env)) });
});
app.get("/api/auth/login", (c) => browserLogin(c.req.raw, c.env));
app.post("/api/auth/logout", (c) => browserLogout(c.req.raw, c.env));
app.get("/.well-known/openai-apps-challenge", (c) => {
  c.header("Cache-Control", "no-store");
  return c.env.OPENAI_APPS_CHALLENGE
    ? c.text(c.env.OPENAI_APPS_CHALLENGE)
    : c.text("Verification is not configured.", 404);
});
app.get("/api/templates", async (c) => {
  c.header("Cache-Control", "no-store");
  return c.json(await listTemplates(c.env, (await browserUser(c.req.raw, c.env)) ?? undefined));
});

app.use("/api/*", async (c, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) requireSameOrigin(c.req.raw);
  await next();
});

app.get("/api/diagrams", zValidator("query", paginationQuery), async (c) => {
  const { limit, cursor } = c.req.valid("query");
  const userId = await requireBrowserUser(c.req.raw, c.env);
  c.header("Cache-Control", "no-store");
  return c.json(await listDiagrams(c.env, limit, cursor, userId));
});

app.post("/api/diagrams", zValidator("json", createBody), async (c) => {
  const { name, template } = c.req.valid("json");
  const userId = await requireBrowserUser(c.req.raw, c.env);
  const d = await createDiagram(c.env, name, template || undefined, userId);
  return c.json({ ...d, link: shareLink(new URL(c.req.url).origin, d.id, d.key) });
});

// Owner-authenticated route also permits retrying interrupted erasure after links revoke.
app.delete("/api/diagrams/:id{[A-Za-z0-9_-]+}", async (c) => {
  const id = c.req.param("id");
  await requireOwner(c.env, id, await requireBrowserUser(c.req.raw, c.env));
  await deleteDiagram(c.env, id);
  return c.body(null, 204);
});

// Both route groups require a capability key, including requests to unknown subpaths.
const authorizeDiagram: MiddlewareHandler<WorkerEnv> = async (c, next) => {
  const id = c.req.param("id")!;
  const diagram = await verifyKey(c.env, id, c.req.query("k"));
  if (!diagram) return c.json({ error: "invalid link" }, 403);
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method))
    await takeBudget(c.env, `board-write:${id}`, 120);
  c.set("diagram", diagram);
  c.set("room", room(c.env, id));
  await next();
  return c.res;
};

const deleteAuthorizedDiagram: Handler<WorkerEnv> = async (c) => {
  if (c.var.diagram.is_template) return c.json({ error: "Templates cannot be deleted here" }, 400);
  requireSameOrigin(c.req.raw);
  await requireOwner(c.env, c.var.diagram.id, await requireBrowserUser(c.req.raw, c.env));
  await deleteDiagram(c.env, c.var.diagram.id);
  return c.body(null, 204);
};

const diagrams = new Hono<WorkerEnv>();
diagrams.use("*", authorizeDiagram);
diagrams.get("/", (c) => c.json({ id: c.var.diagram.id, name: c.var.diagram.name }));
diagrams.delete("/", deleteAuthorizedDiagram);

diagrams.put("/files/:file{[A-Za-z0-9_-]{1,128}}", (c) =>
  putFile(c.env, c.var.diagram.id, c.req.param("file"), c.req.raw),
);
diagrams.get("/files/:file{[A-Za-z0-9_-]{1,128}}", (c) =>
  getFile(c.env, c.var.diagram.id, c.req.param("file")),
);

diagrams.post("/rename", zValidator("json", renameBody), async (c) => {
  const { name } = c.req.valid("json");
  await c.env.DB.prepare("UPDATE diagrams SET name = ?, updated_at = ? WHERE id = ?")
    .bind(name, Date.now(), c.var.diagram.id)
    .run();
  await c.var.room.rename(name);
  return c.json({ ok: true, name });
});

diagrams.get("/snapshots", async (c) => c.json(await c.var.room.listSnapshots()));
diagrams.post("/snapshots", zValidator("json", snapshotBody), async (c) => {
  const { name } = c.req.valid("json");
  return c.json(await c.var.room.snapshot(name, "named"));
});
diagrams.post("/restore", zValidator("json", restoreBody), async (c) => {
  const { snapshotId } = c.req.valid("json");
  return c.json(await c.var.room.restore(snapshotId));
});
diagrams.post("/tidy", zValidator("json", tidyBody), async (c) => {
  // Optional { frames: [id | null] }; null is the top level. Default: whole diagram.
  const { frames } = c.req.valid("json");
  return c.json(await c.var.room.tidy(frames?.length ? frames : undefined, "system"));
});
diagrams.post("/template", zValidator("json", templateBody), async (c) => {
  const { name, description } = c.req.valid("json");
  const userId = await requireBrowserUser(c.req.raw, c.env);
  return c.json(await saveAsTemplate(c.env, c.var.diagram.id, name, description, userId));
});
app.route("/api/d/:id{[A-Za-z0-9_-]+}", diagrams);

const sockets = new Hono<WorkerEnv>();
sockets.use("*", authorizeDiagram);
sockets.delete("/", deleteAuthorizedDiagram);
// Preserve the Durable Object's upgrade response and WebSocket; Hono only routes the request.
sockets.all("*", (c) => c.var.room.fetch(c.req.raw));
app.route("/ws/:id{[A-Za-z0-9_-]+}", sockets);

// The provider owns the OAuth protocol endpoints but forwards /authorize and
// /github/callback here, so they are Hono routes that load the provider lazily.
const interactive: Handler<WorkerEnv> = async (c) => {
  if (c.req.path === CALLBACK_PATH && isBrowserCallback(c.req.raw))
    return browserCallback(c.req.raw, c.env);
  const { oauthRoutes } = await import("./oauth.ts");
  return oauthRoutes(c.req.raw, c.env);
};
app.all(AUTHORIZE_ENDPOINT, interactive);
app.all(CALLBACK_PATH, interactive);

// The OAuth provider fronts /mcp and owns its own discovery, token, registration,
// authorize and callback endpoints. Canvas traffic never touches it: the path
// check runs first so the provider is only loaded for requests that need it.
export default {
  fetch: async (request: Request, env: Env, ctx: ExecutionContext) => {
    if (request.body && !["GET", "HEAD"].includes(request.method)) {
      const maxBytes = new URL(request.url).pathname.includes("/files/")
        ? MAX_FILE_BYTES
        : MAX_JSON_BYTES;
      try {
        if (Number(request.headers.get("Content-Length") ?? 0) > maxBytes)
          return Response.json({ error: "Request body is too large." }, { status: 413 });
        const body = await readBounded(request.body, maxBytes);
        request = new Request(request, { method: request.method, body });
      } catch (error) {
        if (error instanceof HTTPException)
          return Response.json({ error: error.message }, { status: error.status });
        throw error;
      }
    }
    if (!isOAuthPath(new URL(request.url).pathname)) return app.fetch(request, env, ctx);
    const { oauthProvider } = await import("./oauth.ts");
    return oauthProvider(new URL(request.url).origin, app).fetch(request, env, ctx);
  },
};
