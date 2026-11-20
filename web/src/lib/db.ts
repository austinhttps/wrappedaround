import Database from "better-sqlite3";
import { Pool } from "pg";
import path from "node:path";
import fs from "node:fs";

let sqliteInstance: Database.Database | null = null;
let pgPoolInstance: Pool | null = null;

export function isPostgres(): boolean {
  const envUrl = process.env.DATABASE_URL;
  if (!envUrl) return false;
  const lower = envUrl.toLowerCase();
  return lower.startsWith("postgres://") || lower.startsWith("postgresql://");
}

/**
 * Returns a PostgreSQL connection Pool if DATABASE_URL starts with postgres:// or postgresql://
 */
export function getPgPool(): Pool | null {
  if (pgPoolInstance) {
    return pgPoolInstance;
  }

  const envUrl = process.env.DATABASE_URL;
  if (!envUrl || !isPostgres()) {
    return null;
  }

  try {
    pgPoolInstance = new Pool({
      connectionString: envUrl,
      ssl: envUrl.includes("sslmode=disable")
        ? false
        : {
            rejectUnauthorized: false,
          },
      max: 10,
    });

    pgPoolInstance.on("error", (err) => {
      console.error("[db] Unexpected error on idle Postgres client", err);
    });

    return pgPoolInstance;
  } catch (err) {
    console.error("[db] Failed to initialize PostgreSQL pool:", err);
    return null;
  }
}

/**
 * Returns a strictly read-only SQLite database instance for local development.
 */
export function getSqliteDb(): Database.Database | null {
  if (sqliteInstance) {
    return sqliteInstance;
  }

  const envPath = process.env.DATABASE_URL;
  let dbPath: string;

  if (envPath && !isPostgres()) {
    const cleanPath = envPath.replace(/^sqlite:\/\/\/?/, "");
    dbPath = path.isAbsolute(cleanPath)
      ? cleanPath
      : /*turbopackIgnore: true*/ path.resolve(process.cwd(), cleanPath);
  } else {
    const candidatePaths = [
      path.resolve(process.cwd(), "../data/spotify.db"),
      path.resolve(process.cwd(), "data/spotify.db"),
      path.resolve(process.cwd(), "../../data/spotify.db"),
    ];
    const found = candidatePaths.find((p) => /*turbopackIgnore: true*/ fs.existsSync(p));
    dbPath = found || candidatePaths[0];
  }

  if (!/*turbopackIgnore: true*/ fs.existsSync(dbPath)) {
    console.warn(`[db] SQLite database not found at ${dbPath}. Returning null.`);
    return null;
  }

  try {
    sqliteInstance = new Database(dbPath, {
      readonly: true,
      fileMustExist: true,
    });
    sqliteInstance.pragma("query_only = ON");
    return sqliteInstance;
  } catch (err) {
    console.error(`[db] Failed to open SQLite database at ${dbPath} in read-only mode:`, err);
    return null;
  }
}

/**
 * Executes a read-only query against Postgres or SQLite.
 * Translates ? placeholders to $1, $2, ... for PostgreSQL.
 */
export async function query<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  if (isPostgres()) {
    const pool = getPgPool();
    if (!pool) {
      throw new Error("PostgreSQL pool not available");
    }

    // Convert ? to $1, $2, ...
    let paramIndex = 1;
    const pgSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
    const res = await pool.query(pgSql, params);
    return res.rows as T[];
  }

  const sqlite = getSqliteDb();
  if (!sqlite) {
    throw new Error("SQLite database not available");
  }

  const stmt = sqlite.prepare(sql);
  return stmt.all(...params) as T[];
}

export async function queryOne<T = any>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows.length > 0 ? rows[0] : null;
}
