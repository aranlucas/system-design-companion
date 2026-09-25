// D1 metadata, capability keys, and diagram creation.
import type { El } from "../shared/protocol.ts";
import { BUILTIN_TEMPLATES } from "./templates.ts";
import { newId } from "./scene.ts";

let schemaReady: Promise<unknown> | null = null;

export function ensureSchema(env: Env) {
  schemaReady ??= env.DB.batch([
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
  ]).catch((e) => {
    schemaReady = null;
    throw e;
  });
  return schemaReady;
}

async function sha256(s: string) {
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
type LinkedLibraryRow = LibraryRow & { key: string };
/** A share link's parts. */
export type DiagramLink = { id: string; key: string };

export interface DiagramRow {
  id: string;
  name: string;
  is_template: number;
  description: string | null;
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

export async function listTemplates(env: Env) {
  await ensureSchema(env);
  const { results } = await env.DB.prepare(
    "SELECT id, name, description FROM diagrams WHERE is_template = 1 ORDER BY created_at DESC",
  ).all<TemplateRow>();
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

export function parseDiagramCursor(value: string): DiagramCursor | null {
  if (value.length > 256) return null;
  try {
    const cursor = JSON.parse(atob(value)) as DiagramCursor;
    if (
      !cursor ||
      !Number.isSafeInteger(cursor.createdAt) ||
      cursor.createdAt < 0 ||
      typeof cursor.id !== "string" ||
      !/^[A-Za-z0-9_-]{8,64}$/.test(cursor.id)
    )
      return null;
    return { createdAt: cursor.createdAt, id: cursor.id };
  } catch {
    return null;
  }
}

export async function listDiagrams(env: Env, limit = 50, cursor?: DiagramCursor) {
  await ensureSchema(env);
  const boundary = cursor ? "AND (d.created_at, d.id) < (?, ?)" : "";
  const params = cursor ? [cursor.createdAt, cursor.id, limit + 1] : [limit + 1];
  const { results } = await env.DB.prepare(
    `SELECT d.id, d.name, l.access_key AS key, d.created_at AS createdAt
     FROM diagrams d LEFT JOIN diagram_library l ON l.diagram_id = d.id
     WHERE d.is_template = 0
       AND NOT EXISTS (SELECT 1 FROM deleted_diagrams WHERE diagram_id = d.id) ${boundary}
     ORDER BY d.created_at DESC, d.id DESC LIMIT ?`,
  )
    .bind(...params)
    .all<LibraryRow>();
  const items = await Promise.all(
    results.slice(0, limit).map(async (item) => {
      if (item.key) return item as LinkedLibraryRow;
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

/** Logical deletion keeps snapshots available for administrative recovery. */
export async function deleteDiagram(env: Env, id: string) {
  await ensureSchema(env);
  // Disable active sockets first; retrying the delete safely completes the tombstone.
  await room(env, id).deactivate();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO deleted_diagrams (diagram_id, deleted_at) VALUES (?, ?)",
  )
    .bind(id, Date.now())
    .run();
}

export async function createDiagram(env: Env, name: string, template?: string) {
  await ensureSchema(env);
  const id = newId().replace(/[_-]/g, "x");
  const key = newId() + newId();
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO diagrams (id, name, key_hash, is_template, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)",
  )
    .bind(id, name, await sha256(key), now, now)
    .run();
  const stub = room(env, id);
  await stub.init(id, name);
  if (template) {
    const builtin = BUILTIN_TEMPLATES.find((t) => t.id === template);
    if (builtin) {
      await stub.applyPatch(builtin.ops, "template");
    } else {
      const obj = await env.BUCKET.get(`templates/${template}.json`);
      if (!obj) throw new Error(`unknown template "${template}"`);
      const elements = (await obj.json()) as El[];
      await copyFiles(env, template, id, elements);
      await stub.seed(elements);
    }
  }
  return { id, key, name };
}

export async function saveAsTemplate(
  env: Env,
  sourceId: string,
  name: string,
  description?: string,
) {
  await ensureSchema(env);
  const id = "tpl" + newId().replace(/[_-]/g, "x");
  await room(env, sourceId).saveAsTemplate(id);
  const now = Date.now();
  // Templates are public starting points: the key hash is random and never handed out.
  await env.DB.prepare(
    "INSERT INTO diagrams (id, name, key_hash, is_template, description, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)",
  )
    .bind(id, name, await sha256(newId()), description ?? null, now, now)
    .run();
  return { id, name };
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
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_FILE_BYTES)
    return Response.json({ error: "file too large" }, { status: 413 });
  await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: type } });
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
    elements.filter((e) => e.type === "image" && e.fileId).map((e) => e.fileId as string),
  );
  await Promise.all(
    [...ids].map(async (fileId) => {
      const obj = await env.BUCKET.get(fileKey(from, fileId));
      if (obj)
        await env.BUCKET.put(fileKey(to, fileId), obj.body, { httpMetadata: obj.httpMetadata });
    }),
  );
}
