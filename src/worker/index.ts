import { createMcpHandler } from "@modelcontextprotocol/server";
import { buildServer } from "./mcp.ts";
import {
  createDiagram,
  deleteDiagram,
  getFile,
  listDiagrams,
  parseDiagramCursor,
  putFile,
  listTemplates,
  room,
  saveAsTemplate,
  shareLink,
  verifyKey,
} from "./store.ts";

export { DiagramRoom } from "./room.ts";

const json = (v: unknown, status = 200) => Response.json(v, { status });

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === "/mcp") {
        const handler = createMcpHandler((ctx) => buildServer(env, ctx));
        return await handler.fetch(request);
      }

      if (path === "/api/templates" && request.method === "GET")
        return json(await listTemplates(env));

      if (path === "/api/diagrams" && request.method === "GET") {
        const rawLimit = url.searchParams.get("limit") ?? "50";
        if (!/^[1-9][0-9]{0,2}$/.test(rawLimit) || Number(rawLimit) > 100)
          return json({ error: "limit must be an integer between 1 and 100" }, 400);
        const rawCursor = url.searchParams.get("cursor");
        const cursor = rawCursor === null ? undefined : parseDiagramCursor(rawCursor);
        if (cursor === null) return json({ error: "invalid cursor" }, 400);
        return Response.json(await listDiagrams(env, Number(rawLimit), cursor), {
          headers: { "Cache-Control": "no-store" },
        });
      }

      if (path === "/api/diagrams" && request.method === "POST") {
        const body = (await request.json()) as { name?: string; template?: string };
        const d = await createDiagram(
          env,
          body.name?.trim() || "Untitled",
          body.template || undefined,
        );
        return json({ ...d, link: shareLink(url.origin, d.id, d.key) });
      }

      // Capability-protected routes: /api/d/:id/... and /ws/:id, all require ?k=<key>
      const m = path.match(/^\/(?:api\/d|ws)\/([A-Za-z0-9_-]+)(\/.*)?$/);
      if (m) {
        const [, id, sub = ""] = m;
        const row = await verifyKey(env, id, url.searchParams.get("k"));
        if (!row) return json({ error: "invalid link" }, 403);
        const stub = room(env, id);
        if (sub === "" && request.method === "DELETE") {
          if (row.is_template) return json({ error: "Templates cannot be deleted here" }, 400);
          await deleteDiagram(env, id);
          return new Response(null, { status: 204 });
        }

        if (path.startsWith("/ws/")) return stub.fetch(request);
        if (sub === "" && request.method === "GET") return json({ id: row.id, name: row.name });
        const file = sub.match(/^\/files\/([A-Za-z0-9_-]{1,128})$/);
        if (file && request.method === "PUT") return await putFile(env, id, file[1], request);
        if (file && request.method === "GET") return await getFile(env, id, file[1]);
        if (sub === "/rename" && request.method === "POST") {
          const body = (await request.json()) as { name?: unknown };
          const name = typeof body.name === "string" ? body.name.trim() : "";
          if (!name || name.length > 120)
            return json({ error: "Use a name between 1 and 120 characters." }, 400);
          await env.DB.prepare("UPDATE diagrams SET name = ?, updated_at = ? WHERE id = ?")
            .bind(name, Date.now(), id)
            .run();
          await stub.rename(name);
          return json({ ok: true, name });
        }
        if (sub === "/snapshots" && request.method === "GET")
          return json(await stub.listSnapshots());
        if (sub === "/snapshots" && request.method === "POST") {
          const { name } = (await request.json()) as { name: string };
          return json(await stub.snapshot(name || "manual", "named"));
        }
        if (sub === "/restore" && request.method === "POST") {
          const { snapshotId } = (await request.json()) as { snapshotId: string };
          return json(await stub.restore(snapshotId));
        }
        if (sub === "/tidy" && request.method === "POST") {
          // Optional { frames: [id | null] }; null is the top level. Default: whole diagram.
          const { frames } = (await request.json().catch(() => ({}))) as {
            frames?: (string | null)[];
          };
          return json(await stub.tidy(frames?.length ? frames : undefined, "system"));
        }
        if (sub === "/template" && request.method === "POST") {
          const { name, description } = (await request.json()) as {
            name: string;
            description?: string;
          };
          return json(await saveAsTemplate(env, id, name, description));
        }
      }

      return json({ error: "not found" }, 404);
    } catch (e) {
      console.error(e);
      return json({ error: (e as Error).message }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
