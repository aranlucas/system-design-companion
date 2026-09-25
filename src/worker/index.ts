import { zValidator } from "@hono/zod-validator";
import { Hono, type Handler, type MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
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
  type DiagramRow,
} from "./store.ts";

export { DiagramRoom } from "./room.ts";

type DiagramVariables = { diagram: DiagramRow; room: ReturnType<typeof room> };
type WorkerEnv = { Bindings: Env; Variables: DiagramVariables };

const app = new Hono<WorkerEnv>();

app.onError((error, c) => {
  if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
  console.error(error);
  return c.json({ error: error.message }, 500);
});
app.notFound((c) => c.json({ error: "not found" }, 404));

app.all("/mcp", async (c) => {
  // HTTP and Durable Object requests do not need to initialize the MCP SDK or its schemas.
  const { handleMcp } = await import("./mcp.ts");
  return handleMcp(c.req.raw, c.env);
});

app.get("/api/templates", async (c) => c.json(await listTemplates(c.env)));

app.get("/api/diagrams", zValidator("query", paginationQuery), async (c) => {
  const { limit, cursor } = c.req.valid("query");
  c.header("Cache-Control", "no-store");
  return c.json(await listDiagrams(c.env, limit, cursor));
});

app.post("/api/diagrams", zValidator("json", createBody), async (c) => {
  const { name, template } = c.req.valid("json");
  const d = await createDiagram(c.env, name, template || undefined);
  return c.json({ ...d, link: shareLink(new URL(c.req.url).origin, d.id, d.key) });
});

// Both route groups require a capability key, including requests to unknown subpaths.
const authorizeDiagram: MiddlewareHandler<WorkerEnv> = async (c, next) => {
  const id = c.req.param("id")!;
  const diagram = await verifyKey(c.env, id, c.req.query("k"));
  if (!diagram) return c.json({ error: "invalid link" }, 403);
  c.set("diagram", diagram);
  c.set("room", room(c.env, id));
  await next();
  return c.res;
};

const deleteAuthorizedDiagram: Handler<WorkerEnv> = async (c) => {
  if (c.var.diagram.is_template) return c.json({ error: "Templates cannot be deleted here" }, 400);
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
  return c.json(await saveAsTemplate(c.env, c.var.diagram.id, name, description));
});
app.route("/api/d/:id{[A-Za-z0-9_-]+}", diagrams);

const sockets = new Hono<WorkerEnv>();
sockets.use("*", authorizeDiagram);
sockets.delete("/", deleteAuthorizedDiagram);
// Preserve the Durable Object's upgrade response and WebSocket; Hono only routes the request.
sockets.all("*", (c) => c.var.room.fetch(c.req.raw));
app.route("/ws/:id{[A-Za-z0-9_-]+}", sockets);

export default app;
