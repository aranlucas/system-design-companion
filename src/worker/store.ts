import { z } from "zod";
import { storedElementsSchema } from "../shared/schemas.ts";
// D1 metadata, capability keys, and diagram creation.
import type { El } from "../shared/protocol.ts";
import { BUILTIN_TEMPLATES } from "./templates.ts";
import { newId } from "./scene.ts";
import { HTTPException } from "hono/http-exception";
import { readBounded, takeBudget } from "./request-limits.ts";

const schemas = new WeakMap<D1Database, Promise<unknown>>();

export function ensureSchema(env: Env) {
  const cached = schemas.get(env.DB);

  if (cached) return cached;

  const ready = env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS diagrams (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, key_hash TEXT NOT NULL,
        is_template INTEGER NOT NULL DEFAULT 0, description TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
    ),
    env.DB.prepare(
      "CREATE INDEX IF NOT EXISTS diagrams_library_order ON diagrams (is_template, created_at DESC, id DESC)",
    ),
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS diagram_owners (diagram_id TEXT PRIMARY KEY, user_id TEXT NOT NULL)",
    ),
    env.DB.prepare(
      "CREATE INDEX IF NOT EXISTS diagram_owners_user ON diagram_owners (user_id, diagram_id)",
    ),
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS deleted_diagrams (diagram_id TEXT PRIMARY KEY, deleted_at INTEGER NOT NULL)",
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS diagram_library (
        diagram_id TEXT PRIMARY KEY, access_key TEXT NOT NULL)`,
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY, diagram_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
        created_at INTEGER NOT NULL, element_count INTEGER NOT NULL)`,
    ),
    env.DB.prepare(
      "CREATE INDEX IF NOT EXISTS snapshots_by_diagram ON snapshots (diagram_id, created_at)",
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS mcp_event_subscriptions (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, event_name TEXT NOT NULL,
        diagram_id TEXT NOT NULL, callback_url TEXT NOT NULL, secret TEXT NOT NULL,
        include_agent INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL,
        authorization_id TEXT NOT NULL, resource TEXT NOT NULL, key_hash TEXT NOT NULL,
        previous_secret TEXT, previous_secret_until INTEGER NOT NULL DEFAULT 0)`,
    ),
    env.DB.prepare(
      "CREATE INDEX IF NOT EXISTS mcp_event_subscriptions_diagram ON mcp_event_subscriptions (diagram_id, event_name, expires_at)",
    ),
  ]).catch((e) => {
    schemas.delete(env.DB);
    throw e;
  });

  schemas.set(env.DB, ready);

  return ready;
}

/** Hex SHA-256. Also the digest behind event subscription ids. */
export async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));

  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const room = (env: Env, id: string) => env.ROOM.get(env.ROOM.idFromName(id));

export const shareLink = (origin: string, id: string, key: string) => `${origin}/d/${id}?k=${key}`;

/** Row shapes read from D1. */
type KeyedDiagramRow = DiagramRow & { key_hash: string };

type AccessKeyRow = { access_key: string };

type TemplateRow = { id: string; name: string; description: string | null };

type LibraryRow = { id: string; name: string; key: string | null; createdAt: number };

/** A share link's parts. */
export type DiagramLink = { id: string; key: string };

export interface DiagramRow {
  id: string;
  name: string;
  is_template: number;
  description: string | null;
}

type OwnerRow = { user_id: string };

export async function ownsDiagram(env: Env, id: string, userId: string) {
  await ensureSchema(env);

  const owner = await env.DB.prepare("SELECT user_id FROM diagram_owners WHERE diagram_id = ?")
    .bind(id)
    .first<OwnerRow>();

  return owner?.user_id === userId;
}

export async function requireOwner(env: Env, id: string, userId: string) {
  if (!(await ownsDiagram(env, id, userId)))
    throw new HTTPException(403, { message: "Only the diagram owner can do this." });
}

export async function verifyKey(
  env: Env,
  id: string,
  key: string | null | undefined,
): Promise<DiagramRow | null> {
  if (!key) return null;
  await ensureSchema(env);

  const row = await env.DB.prepare(
    `SELECT id, name, is_template, description, key_hash FROM diagrams WHERE id = ?
     AND NOT EXISTS (SELECT 1 FROM deleted_diagrams WHERE diagram_id = diagrams.id)`,
  )
    .bind(id)
    .first<KeyedDiagramRow>();

  if (!row) return null;

  if (row.key_hash === (await sha256(key))) return row;

  if (row.is_template) return null;

  const entry = await env.DB.prepare("SELECT access_key FROM diagram_library WHERE diagram_id = ?")
    .bind(id)
    .first<AccessKeyRow>();

  return entry?.access_key === key ? row : null;
}

/** Parse a share link (full URL, path, or "id?k=key"). */
export function parseLink(link: string): DiagramLink | null {
  const m = link.match(/(?:\/d\/)?([A-Za-z0-9_-]{8,})\?(?:.*&)?k=([A-Za-z0-9_-]+)/);

  return m ? { id: m[1], key: m[2] } : null;
}

export async function listTemplates(env: Env, userId?: string) {
  await ensureSchema(env);

  const { results } = await env.DB.prepare(
    `SELECT id, name, description FROM diagrams WHERE is_template = 1
     AND id IN (SELECT diagram_id FROM diagram_owners WHERE user_id = ?)
     AND NOT EXISTS (SELECT 1 FROM deleted_diagrams WHERE diagram_id = diagrams.id)
     ORDER BY created_at DESC`,
  )
    .bind(userId ?? "")
    .all<TemplateRow>();

  return [
    ...BUILTIN_TEMPLATES.map(({ id, name, description }) => ({ id, name, description })),
    ...results.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description ?? "saved template",
    })),
  ];
}

/** Deployment-wide shared library, including boards created before this feature.
 * Library links are additional capabilities; original share links remain valid.
 */
export interface DiagramCursor {
  createdAt: number;
  id: string;
}

const diagramCursorSchema = z.object({
  createdAt: z.number().refine(Number.isSafeInteger).nonnegative(),
  id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
});

export function parseDiagramCursor(value: string): DiagramCursor | null {
  if (value.length > 256) return null;

  try {
    const parsed = diagramCursorSchema.safeParse(JSON.parse(atob(value)));

    if (!parsed.success) return null;
    const cursor = parsed.data;

    return { createdAt: cursor.createdAt, id: cursor.id };
  } catch {
    return null;
  }
}

export async function listDiagrams(env: Env, limit = 50, cursor?: DiagramCursor, userId?: string) {
  if (!userId) return { items: [], nextCursor: null };
  await ensureSchema(env);
  const boundary = cursor ? "AND (d.created_at, d.id) < (?, ?)" : "";
  const params = cursor ? [userId, cursor.createdAt, cursor.id, limit + 1] : [userId, limit + 1];

  const { results } = await env.DB.prepare(
    `SELECT d.id, d.name, l.access_key AS key, d.created_at AS createdAt
     FROM diagrams d LEFT JOIN diagram_library l ON l.diagram_id = d.id
     WHERE d.is_template = 0
       AND d.id IN (SELECT diagram_id FROM diagram_owners WHERE user_id = ?)
       AND NOT EXISTS (SELECT 1 FROM deleted_diagrams WHERE diagram_id = d.id) ${boundary}
     ORDER BY d.created_at DESC, d.id DESC LIMIT ?`,
  )
    .bind(...params)
    .all<LibraryRow>();

  const items = await Promise.all(
    results.slice(0, limit).map(async (item) => {
      if (item.key) return { ...item, key: item.key };
      // Backfill only this page, preserving old share links and concurrent-reader safety.
      await env.DB.prepare(
        "INSERT OR IGNORE INTO diagram_library (diagram_id, access_key) VALUES (?, ?)",
      )
        .bind(item.id, newId() + newId())
        .run();

      const entry = await env.DB.prepare(
        "SELECT access_key FROM diagram_library WHERE diagram_id = ?",
      )
        .bind(item.id)
        .first<AccessKeyRow>();

      if (!entry) throw new Error("Could not create diagram library link");

      return { ...item, key: entry.access_key };
    }),
  );

  const last = items.at(-1);

  const nextCursor =
    results.length > limit && last
      ? btoa(JSON.stringify({ createdAt: last.createdAt, id: last.id }))
      : null;

  return { items, nextCursor };
}

/** Revoke access first, then erase scene, files, snapshots and subscription secrets. */
export async function deleteDiagram(env: Env, id: string) {
  await ensureSchema(env);
  await env.DB.prepare(
    "INSERT OR IGNORE INTO deleted_diagrams (diagram_id, deleted_at) VALUES (?, ?)",
  )
    .bind(id, Date.now())
    .run();
  await room(env, id).deactivate();
  await eraseObjects(env, `snapshots/${id}/`);
  await eraseObjects(env, `files/${id}/`);
  await env.BUCKET.delete(`templates/${id}.json`);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM snapshots WHERE diagram_id = ?").bind(id),
    env.DB.prepare("DELETE FROM mcp_event_subscriptions WHERE diagram_id = ?").bind(id),
    env.DB.prepare("DELETE FROM diagram_library WHERE diagram_id = ?").bind(id),
    env.DB.prepare("DELETE FROM diagrams WHERE id = ?").bind(id),
  ]);
  await room(env, id).erase();
  // Keep the owner and deletion marker so authenticated retries can finish cleanup.
}

async function eraseObjects(env: Env, prefix: string) {
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- delete one bounded page at a time
    const page = await env.BUCKET.list({ prefix, limit: 1000 });

    if (!page.objects.length) return;
    // oxlint-disable-next-line no-await-in-loop -- finish this page before listing again
    await env.BUCKET.delete(page.objects.map((item) => item.key));
  }
}

export async function createDiagram(env: Env, name: string, template?: string, userId?: string) {
  await ensureSchema(env);

  if (userId) await takeBudget(env, `create:${userId}`, 10);

  // Validate private template access before creating any persistent artifacts.
  if (template && !BUILTIN_TEMPLATES.some((item) => item.id === template)) {
    if (!userId || !(await ownsDiagram(env, template, userId)))
      throw new HTTPException(403, { message: "Template is not available to this account." });

    const row = await env.DB.prepare(
      `SELECT id, name, is_template, description FROM diagrams WHERE id = ?
       AND NOT EXISTS (SELECT 1 FROM deleted_diagrams WHERE diagram_id = diagrams.id)`,
    )
      .bind(template)
      .first<DiagramRow>();

    if (!row?.is_template || !(await env.BUCKET.head(`templates/${template}.json`)))
      throw new HTTPException(404, { message: "Template not found." });
  }

  const id = newId().replace(/[_-]/g, "x");
  const key = newId() + newId();
  const now = Date.now();

  const metadata = env.DB.prepare(
    "INSERT INTO diagrams (id, name, key_hash, is_template, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)",
  ).bind(id, name, await sha256(key), now, now);

  try {
    const stub = room(env, id);
    await stub.init(id, name);

    if (template) {
      const builtin = BUILTIN_TEMPLATES.find((t) => t.id === template);

      if (builtin) {
        await stub.applyPatch(builtin.ops, "template");
      } else {
        const obj = await env.BUCKET.get(`templates/${template}.json`);

        if (!obj) throw new Error(`unknown template "${template}"`);
        const elements = storedElementsSchema.parse(await obj.json());
        await copyFiles(env, template, id, elements);
        await stub.seed(elements);
      }
    }

    // Publish only a fully initialized room, together with its owner.
    await publishDiagram(env, metadata, id, userId);
  } catch (error) {
    await discardCreation(env, id, error);
  }

  return { id, key, name };
}

export async function saveAsTemplate(
  env: Env,
  sourceId: string,
  name: string,
  description?: string,
  userId?: string,
) {
  await ensureSchema(env);

  if (userId) await requireOwner(env, sourceId, userId);
  const id = "tpl" + newId().replace(/[_-]/g, "x");
  const now = Date.now();

  const metadata = env.DB.prepare(
    "INSERT INTO diagrams (id, name, key_hash, is_template, description, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)",
  ).bind(id, name, await sha256(newId()), description ?? null, now, now);

  try {
    await room(env, sourceId).saveAsTemplate(id);
    // Saved templates become discoverable only after every copied object exists.
    await publishDiagram(env, metadata, id, userId);
  } catch (error) {
    await discardCreation(env, id, error);
  }

  return { id, name };
}

/** D1 batches are transactions: an owner failure must not leave an ownerless row. */
async function publishDiagram(
  env: Env,
  metadata: D1PreparedStatement,
  id: string,
  userId?: string,
) {
  const statements = [metadata];

  if (userId)
    statements.push(
      env.DB.prepare("INSERT INTO diagram_owners (diagram_id, user_id) VALUES (?, ?)").bind(
        id,
        userId,
      ),
    );
  await env.DB.batch(statements);
}

/** Compensate only this new destination, never the source diagram/template.
 * Reuse deletion's revocation-first, idempotent cleanup if publication failed after committing.
 * This is not a cross-store transaction: an outage may leave revoked artifacts to clean later.
 */
async function discardCreation(env: Env, id: string, cause: unknown): Promise<never> {
  try {
    await deleteDiagram(env, id);
  } catch (cleanupError) {
    throw new AggregateError(
      [cause, cleanupError],
      `Creation failed; cleanup incomplete for ${id}`,
      { cause: cleanupError },
    );
  }

  throw cause;
}

// ---------- image files ----------
// Excalidraw keeps image bytes out of elements: an image element holds a `fileId` and each
// client needs the matching BinaryFileData. Files are content-addressed, so they never change.

export const MAX_FILE_BYTES = 4 * 1024 * 1024;

const fileKey = (diagramId: string, fileId: string) => `files/${diagramId}/${fileId}`;

export async function putFile(env: Env, diagramId: string, fileId: string, request: Request) {
  const type = request.headers.get("Content-Type") ?? "";

  if (!type.startsWith("image/")) return Response.json({ error: "images only" }, { status: 415 });

  if (Number(request.headers.get("Content-Length") ?? 0) > MAX_FILE_BYTES)
    return Response.json({ error: "file too large" }, { status: 413 });
  const key = fileKey(diagramId, fileId);

  if (await env.BUCKET.head(key)) return new Response(null, { status: 204 });
  const bytes = await readBounded(request.body, MAX_FILE_BYTES);
  await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: type } });

  const active = await env.DB.prepare(
    "SELECT id FROM diagrams WHERE id = ? AND NOT EXISTS (SELECT 1 FROM deleted_diagrams WHERE diagram_id = diagrams.id)",
  )
    .bind(diagramId)
    .first<DiagramRow>();

  if (!active) {
    await env.BUCKET.delete(key);

    return Response.json({ error: "Diagram deleted." }, { status: 410 });
  }

  return new Response(null, { status: 204 });
}

export async function getFile(env: Env, diagramId: string, fileId: string) {
  const obj = await env.BUCKET.get(fileKey(diagramId, fileId));

  if (!obj) return Response.json({ error: "not found" }, { status: 404 });

  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "private, max-age=31536000, immutable",
      // SVGs are served from our origin; never let one run as a document.
      "Content-Security-Policy": "sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Copy the files that `elements` reference, e.g. when a template is saved or used. */
export async function copyFiles(env: Env, from: string, to: string, elements: El[]) {
  const ids = new Set(
    elements.flatMap((e) => (e.type === "image" && e.fileId ? [z.string().parse(e.fileId)] : [])),
  );

  const copied = await Promise.allSettled(
    [...ids].map(async (fileId) => {
      const obj = await env.BUCKET.get(fileKey(from, fileId));

      if (obj)
        await env.BUCKET.put(fileKey(to, fileId), obj.body, { httpMetadata: obj.httpMetadata });
    }),
  );

  // A rejected copy must not race cleanup with another still-running destination write.
  const failure = copied.find((result) => result.status === "rejected");

  if (failure) throw failure.reason;
}
