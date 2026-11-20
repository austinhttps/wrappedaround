import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

let dbInstance: Database.Database | null = null;

/**
 * Returns a strictly read-only SQLite database instance.
 * Web frontend never touches Spotify OAuth tokens and NEVER writes to the database.
 */
export function getDb(): Database.Database | null {
  if (dbInstance) {
    return dbInstance;
  }

  // Check DATABASE_URL or fallback to relative data/spotify.db
  const envPath = process.env.DATABASE_URL;
  let dbPath: string;

  if (envPath && !envPath.startsWith("postgres://") && !envPath.startsWith("postgresql://")) {
    dbPath = path.isAbsolute(envPath) ? envPath : path.resolve(process.cwd(), envPath);
  } else {
    // Look for spotify.db in common locations relative to project root or web folder
    const candidatePaths = [
      path.resolve(process.cwd(), "../data/spotify.db"),
      path.resolve(process.cwd(), "data/spotify.db"),
      path.resolve(process.cwd(), "../../data/spotify.db"),
    ];

    const found = candidatePaths.find((p) => fs.existsSync(p));
    dbPath = found || candidatePaths[0];
  }

  if (!fs.existsSync(dbPath)) {
    console.warn(`[db] SQLite database not found at ${dbPath}. Returning null db connection.`);
    return null;
  }

  try {
    // Open in readonly mode. Note: pragma('journal_mode = WAL') attempts to write to header so it cannot be run on readonly db.
    dbInstance = new Database(dbPath, {
      readonly: true,
      fileMustExist: true,
    });
    dbInstance.pragma("query_only = ON");
    return dbInstance;
  } catch (err) {
    console.error(`[db] Failed to open SQLite database at ${dbPath} in read-only mode:`, err);
    return null;
  }
}
