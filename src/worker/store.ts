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
    "SELECT id, name, is_template, description, key_hash FROM diagrams WHERE id = ?",
  )
    .bind(id)
    .first<DiagramRow & { key_hash: string }>();
  if (!row) return null;
  if (row.key_hash === (await sha256(key))) return row;
  if (row.is_template) return null;
  const entry = await env.DB.prepare("SELECT access_key FROM diagram_library WHERE diagram_id = ?")
    .bind(id)
    .first<{ access_key: string }>();
  return entry?.access_key === key ? row : null;
}

/** Parse a share link (full URL, path, or "id?k=key"). */
export function parseLink(link: string): { id: string; key: string } | null {
  const m = link.match(/(?:\/d\/)?([A-Za-z0-9_-]{8,})\?(?:.*&)?k=([A-Za-z0-9_-]+)/);
  return m ? { id: m[1], key: m[2] } : null;
}

export async function listTemplates(env: Env) {
  await ensureSchema(env);
  const { results } = await env.DB.prepare(
    "SELECT id, name, description FROM diagrams WHERE is_template = 1 ORDER BY created_at DESC",
  ).all<{ id: string; name: string; description: string | null }>();
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
export async function listDiagrams(env: Env) {
  await ensureSchema(env);
  // A single idempotent statement backfills old boards and handles concurrent readers.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO diagram_library (diagram_id, access_key)
     SELECT id, lower(hex(randomblob(32))) FROM diagrams
     WHERE is_template = 0 AND NOT EXISTS
       (SELECT 1 FROM diagram_library WHERE diagram_id = diagrams.id)`,
  ).run();
  const { results } = await env.DB.prepare(
    `SELECT d.id, d.name, l.access_key AS key, d.created_at AS createdAt
     FROM diagrams d JOIN diagram_library l ON l.diagram_id = d.id
     WHERE d.is_template = 0 ORDER BY d.created_at DESC, d.id ASC`,
  ).all<{ id: string; name: string; key: string; createdAt: number }>();
  return results;
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
      await stub.seed((await obj.json()) as El[]);
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
  const elements = await room(env, sourceId).getRaw();
  const id = "tpl" + newId().replace(/[_-]/g, "x");
  await env.BUCKET.put(`templates/${id}.json`, JSON.stringify(elements));
  const now = Date.now();
  // Templates are public starting points: the key hash is random and never handed out.
  await env.DB.prepare(
    "INSERT INTO diagrams (id, name, key_hash, is_template, description, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)",
  )
    .bind(id, name, await sha256(newId()), description ?? null, now, now)
    .run();
  return { id, name };
}
