const schemas = new WeakMap<D1Database, Promise<unknown>>();

export function ensureSchema(env: Env) {
  const cached = schemas.get(env.DB);

  if (cached) {
    return cached;
  }

  const ready = env.DB.batch([
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS chatgpt_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER NOT NULL)",
    ),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS chatgpt_state_expiry ON chatgpt_state (expires_at)"),
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
