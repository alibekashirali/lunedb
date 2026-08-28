import Database from "@tauri-apps/plugin-sql";
import { setConnectionPassword, deleteConnectionPassword, deleteSshPassword } from "@/lib/tauri-commands";

// Promise-based singleton — prevents race condition when two callers hit getDb() concurrently
let _dbPromise: Promise<Database> | null = null;

async function getDb(): Promise<Database> {
  if (!_dbPromise) _dbPromise = initDb();
  return _dbPromise;
}

async function initDb(): Promise<Database> {
  const db = await Database.load("sqlite:lunedb.db");

  await db.execute(`
    CREATE TABLE IF NOT EXISTS wiki_pages (
      table_key  TEXT    PRIMARY KEY,
      content    TEXT    NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS query_history (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      sql        TEXT    NOT NULL,
      row_count  INTEGER,
      exec_ms    INTEGER,
      error      TEXT,
      ran_at     INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS saved_queries (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      sql        TEXT    NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS connections (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT    NOT NULL,
      host         TEXT    NOT NULL,
      port         INTEGER NOT NULL DEFAULT 5432,
      username     TEXT    NOT NULL,
      password     TEXT    NOT NULL DEFAULT '',
      database     TEXT    NOT NULL,
      color        TEXT    NOT NULL DEFAULT '#6360FB',
      group_name   TEXT    NOT NULL DEFAULT 'Default',
      ssl_mode     TEXT    NOT NULL DEFAULT 'prefer',
      ssl_ca_cert  TEXT    NOT NULL DEFAULT '',
      ssh_enabled  INTEGER NOT NULL DEFAULT 0,
      ssh_host     TEXT    NOT NULL DEFAULT '',
      ssh_port     INTEGER NOT NULL DEFAULT 22,
      ssh_user     TEXT    NOT NULL DEFAULT '',
      ssh_auth     TEXT    NOT NULL DEFAULT 'password',
      ssh_key_path TEXT    NOT NULL DEFAULT '',
      created_at   INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      last_used_at INTEGER
    )
  `);
  // Additive migrations for existing databases
  try { await db.execute("ALTER TABLE connections ADD COLUMN last_used_at INTEGER"); } catch {}
  try { await db.execute("ALTER TABLE connections ADD COLUMN ssl_mode TEXT NOT NULL DEFAULT 'prefer'"); } catch {}
  try { await db.execute("ALTER TABLE connections ADD COLUMN ssl_ca_cert TEXT NOT NULL DEFAULT ''"); } catch {}
  try { await db.execute("ALTER TABLE connections ADD COLUMN group_name TEXT NOT NULL DEFAULT 'Default'"); } catch {}
  try { await db.execute("ALTER TABLE connections ADD COLUMN ssh_enabled INTEGER NOT NULL DEFAULT 0"); } catch {}
  try { await db.execute("ALTER TABLE connections ADD COLUMN ssh_host TEXT NOT NULL DEFAULT ''"); } catch {}
  try { await db.execute("ALTER TABLE connections ADD COLUMN ssh_port INTEGER NOT NULL DEFAULT 22"); } catch {}
  try { await db.execute("ALTER TABLE connections ADD COLUMN ssh_user TEXT NOT NULL DEFAULT ''"); } catch {}
  try { await db.execute("ALTER TABLE connections ADD COLUMN ssh_auth TEXT NOT NULL DEFAULT 'password'"); } catch {}
  try { await db.execute("ALTER TABLE connections ADD COLUMN ssh_key_path TEXT NOT NULL DEFAULT ''"); } catch {}

  // One-time migration: move any plaintext passwords from SQLite to OS keychain
  await migratePasswordsToKeychain(db);

  return db;
}

async function migratePasswordsToKeychain(db: Database): Promise<void> {
  try {
    const rows = await db.select<{ id: number; password: string }[]>(
      "SELECT id, password FROM connections WHERE password != ''"
    );
    for (const row of rows) {
      try {
        await setConnectionPassword(row.id, row.password);
      } catch {
        // best-effort per-row
      }
    }
    if (rows.length > 0) {
      await db.execute("UPDATE connections SET password = '' WHERE password != ''");
    }
  } catch {
    // Never fail startup due to migration errors
  }
}

// ── Wiki ──────────────────────────────────────────────────────────────────────

export async function getDocsPage(tableKey: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ content: string }[]>(
    "SELECT content FROM wiki_pages WHERE table_key = $1",
    [tableKey]
  );
  return rows[0]?.content ?? null;
}

export async function saveDocsPage(tableKey: string, content: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO wiki_pages (table_key, content, updated_at)
     VALUES ($1, $2, strftime('%s', 'now'))
     ON CONFLICT (table_key) DO UPDATE
     SET content = excluded.content,
         updated_at = excluded.updated_at`,
    [tableKey, content]
  );
}

// ── Connections ───────────────────────────────────────────────────────────────

export interface SavedConnection {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  database: string;
  color: string;
  group_name: string;
  ssl_mode: string;
  ssl_ca_cert: string;
  ssh_enabled: number;
  ssh_host: string;
  ssh_port: number;
  ssh_user: string;
  ssh_auth: string;
  ssh_key_path: string;
  created_at: number;
}

const CONNECTION_COLORS = [
  "#6360FB", "#22C55E", "#F59E0B", "#3B82F6",
  "#EF4444", "#EC4899", "#14B8A6", "#F97316",
];

export async function getSavedConnections(): Promise<SavedConnection[]> {
  const db = await getDb();
  return db.select<SavedConnection[]>(
    "SELECT id, name, host, port, username, database, color, group_name, ssl_mode, ssl_ca_cert, ssh_enabled, ssh_host, ssh_port, ssh_user, ssh_auth, ssh_key_path, created_at FROM connections ORDER BY group_name, COALESCE(last_used_at, created_at) DESC"
  );
}

export async function updateConnectionLastUsed(id: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE connections SET last_used_at = strftime('%s', 'now') WHERE id = $1",
    [id]
  );
}

export async function saveConnection(
  host: string,
  port: number,
  username: string,
  database: string,
  opts?: { name?: string; color?: string; group_name?: string; allowDuplicate?: boolean; ssl_mode?: string; ssl_ca_cert?: string; ssh_enabled?: number; ssh_host?: string; ssh_port?: number; ssh_user?: string; ssh_auth?: string; ssh_key_path?: string }
): Promise<SavedConnection> {
  const db = await getDb();

  if (!opts?.allowDuplicate) {
    const existing = await db.select<SavedConnection[]>(
      "SELECT id, name, host, port, username, database, color, group_name, ssl_mode, ssl_ca_cert, ssh_enabled, ssh_host, ssh_port, ssh_user, ssh_auth, ssh_key_path, created_at FROM connections WHERE host = $1 AND port = $2 AND username = $3 AND database = $4 LIMIT 1",
      [host, port, username, database]
    );
    if (existing[0]) return existing[0];
  }

  const countRows = await db.select<{ n: number }[]>(
    "SELECT COUNT(*) as n FROM connections"
  );
  const color = opts?.color ?? CONNECTION_COLORS[(countRows[0]?.n ?? 0) % CONNECTION_COLORS.length];
  const name = opts?.name || `${database}@${host}`;
  const group_name = opts?.group_name || "Default";
  const ssl_mode = opts?.ssl_mode ?? "prefer";
  const ssl_ca_cert = opts?.ssl_ca_cert ?? "";
  const ssh_enabled = opts?.ssh_enabled ?? 0;
  const ssh_host = opts?.ssh_host ?? "";
  const ssh_port = opts?.ssh_port ?? 22;
  const ssh_user = opts?.ssh_user ?? "";
  const ssh_auth = opts?.ssh_auth ?? "password";
  const ssh_key_path = opts?.ssh_key_path ?? "";

  await db.execute(
    "INSERT INTO connections (name, host, port, username, password, database, color, group_name, ssl_mode, ssl_ca_cert, ssh_enabled, ssh_host, ssh_port, ssh_user, ssh_auth, ssh_key_path) VALUES ($1, $2, $3, $4, '', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
    [name, host, port, username, database, color, group_name, ssl_mode, ssl_ca_cert, ssh_enabled, ssh_host, ssh_port, ssh_user, ssh_auth, ssh_key_path]
  );

  const created = await db.select<SavedConnection[]>(
    "SELECT id, name, host, port, username, database, color, group_name, ssl_mode, ssl_ca_cert, ssh_enabled, ssh_host, ssh_port, ssh_user, ssh_auth, ssh_key_path, created_at FROM connections WHERE host = $1 AND port = $2 AND username = $3 AND database = $4 ORDER BY created_at DESC LIMIT 1",
    [host, port, username, database]
  );
  return created[0];
}

export async function updateConnection(
  id: number,
  data: { name: string; host: string; port: number; username: string; database: string; color: string; group_name: string; ssl_mode: string; ssl_ca_cert: string; ssh_enabled: number; ssh_host: string; ssh_port: number; ssh_user: string; ssh_auth: string; ssh_key_path: string }
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE connections SET name=$1, host=$2, port=$3, username=$4, database=$5, color=$6, group_name=$7, ssl_mode=$8, ssl_ca_cert=$9, ssh_enabled=$10, ssh_host=$11, ssh_port=$12, ssh_user=$13, ssh_auth=$14, ssh_key_path=$15 WHERE id=$16",
    [data.name, data.host, data.port, data.username, data.database, data.color, data.group_name, data.ssl_mode, data.ssl_ca_cert, data.ssh_enabled, data.ssh_host, data.ssh_port, data.ssh_user, data.ssh_auth, data.ssh_key_path, id]
  );
}

export async function deleteConnection(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM connections WHERE id = $1", [id]);
  await deleteConnectionPassword(id).catch(() => {});
  await deleteSshPassword(id).catch(() => {});
}

export async function getAllDocsKeys(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select<{ table_key: string }[]>(
    "SELECT table_key FROM wiki_pages WHERE content != '' AND content IS NOT NULL"
  );
  return rows.map((r) => r.table_key);
}

// ── Query history ─────────────────────────────────────────────────────────────

export interface HistoryEntry {
  id: number;
  sql: string;
  row_count: number | null;
  exec_ms: number | null;
  error: string | null;
  ran_at: number;
}

export async function addHistoryEntry(
  sql: string,
  row_count: number | null,
  exec_ms: number | null,
  error: string | null
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO query_history (sql, row_count, exec_ms, error) VALUES ($1, $2, $3, $4)",
    [sql.trim(), row_count, exec_ms, error]
  );
  await db.execute(
    "DELETE FROM query_history WHERE id NOT IN (SELECT id FROM query_history ORDER BY ran_at DESC LIMIT 200)"
  );
}

export async function getQueryHistory(): Promise<HistoryEntry[]> {
  const db = await getDb();
  return db.select<HistoryEntry[]>(
    "SELECT * FROM query_history ORDER BY ran_at DESC LIMIT 100"
  );
}

export async function clearQueryHistory(): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM query_history");
}

// ── Saved queries ─────────────────────────────────────────────────────────────

export interface SavedQuery {
  id: number;
  name: string;
  sql: string;
  created_at: number;
}

export async function getSavedQueries(): Promise<SavedQuery[]> {
  const db = await getDb();
  return db.select<SavedQuery[]>("SELECT * FROM saved_queries ORDER BY created_at DESC");
}

export async function saveQuery(name: string, sql: string): Promise<void> {
  const db = await getDb();
  await db.execute("INSERT INTO saved_queries (name, sql) VALUES ($1, $2)", [name, sql]);
}

export async function deleteSavedQuery(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM saved_queries WHERE id = $1", [id]);
}
