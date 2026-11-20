import os
import sqlite3
import sys
from pathlib import Path
from typing import Any
from dotenv import load_dotenv

def is_postgres_url(database_url: str | None) -> bool:
    if not database_url:
        return False
    url_lower = database_url.lower()
    return url_lower.startswith("postgres://") or url_lower.startswith("postgresql://")

def get_database_url() -> str:
    load_dotenv()
    return os.getenv("DATABASE_URL", "sqlite:///data/spotify.db")

def get_db_path_from_url(database_url: str | None = None) -> Path:
    if not database_url:
        database_url = get_database_url()

    if is_postgres_url(database_url):
        raise ValueError(f"Cannot convert PostgreSQL URL to file path: {database_url}")

    if database_url.startswith("sqlite:///"):
        rel_or_abs = database_url.replace("sqlite:///", "", 1)
        return Path(rel_or_abs)
    elif database_url.startswith("sqlite://"):
        rel_or_abs = database_url.replace("sqlite://", "", 1)
        return Path(rel_or_abs)
    else:
        return Path(database_url)

class DBConnection:
    """
    Unified database connection wrapper for SQLite and PostgreSQL.
    Provides dialect abstraction for parameter substitution (%s vs ?),
    conflict handling, and execution.
    """
    def __init__(self, raw_conn: Any, is_postgres: bool):
        self.raw_conn = raw_conn
        self.is_postgres = is_postgres

    def cursor(self):
        return DBCursor(self.raw_conn.cursor(), self.is_postgres)

    def commit(self):
        self.raw_conn.commit()

    def rollback(self):
        self.raw_conn.rollback()

    def close(self):
        self.raw_conn.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type:
            self.rollback()
        else:
            self.commit()
        self.close()

class DBCursor:
    def __init__(self, raw_cursor: Any, is_postgres: bool):
        self.raw_cursor = raw_cursor
        self.is_postgres = is_postgres

    def _convert_query(self, query: str) -> str:
        if self.is_postgres:
            # Replace SQLite-style '?' placeholders with Postgres '%s'
            # (Note: careful with string literals; in our queries all ? are parameter placeholders)
            return query.replace("?", "%s")
        return query

    def execute(self, query: str, params: tuple | list | None = None):
        formatted_query = self._convert_query(query)
        if params is not None:
            return self.raw_cursor.execute(formatted_query, params)
        return self.raw_cursor.execute(formatted_query)

    def executemany(self, query: str, seq_of_params: list | tuple):
        formatted_query = self._convert_query(query)
        return self.raw_cursor.executemany(formatted_query, seq_of_params)

    def fetchone(self):
        return self.raw_cursor.fetchone()

    def fetchall(self):
        return self.raw_cursor.fetchall()

    @property
    def rowcount(self):
        return self.raw_cursor.rowcount

def get_connection(database_url: str | None = None) -> DBConnection:
    if not database_url:
        database_url = get_database_url()

    if is_postgres_url(database_url):
        import psycopg
        # Convert postgres:// to postgresql:// if needed for psycopg
        conn_str = database_url
        if conn_str.startswith("postgres://"):
            conn_str = conn_str.replace("postgres://", "postgresql://", 1)
        raw_conn = psycopg.connect(conn_str)
        return DBConnection(raw_conn, is_postgres=True)
    else:
        db_path = get_db_path_from_url(database_url)
        db_path.parent.mkdir(parents=True, exist_ok=True)
        raw_conn = sqlite3.connect(db_path)
        return DBConnection(raw_conn, is_postgres=False)

def get_pg_schema_sql() -> str:
    """Returns PostgreSQL DDL matching db/schema.sql."""
    return """
    CREATE TABLE IF NOT EXISTS artists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS albums (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        release_date TEXT,
        image_url TEXT
    );

    CREATE TABLE IF NOT EXISTS tracks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        album_id TEXT REFERENCES albums(id),
        duration_ms INTEGER,
        spotify_uri TEXT
    );

    CREATE TABLE IF NOT EXISTS track_artists (
        track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        artist_id TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
        PRIMARY KEY (track_id, artist_id)
    );

    CREATE TABLE IF NOT EXISTS plays (
        id BIGSERIAL PRIMARY KEY,
        track_id TEXT NOT NULL REFERENCES tracks(id),
        played_at TEXT NOT NULL,
        ms_played INTEGER NOT NULL,
        source TEXT NOT NULL,
        platform TEXT,
        reason_start TEXT,
        reason_end TEXT,
        shuffle BOOLEAN,
        skipped BOOLEAN,
        UNIQUE (track_id, played_at)
    );

    CREATE INDEX IF NOT EXISTS idx_plays_played_at ON plays(played_at);
    CREATE INDEX IF NOT EXISTS idx_plays_track_id ON plays(track_id);
    CREATE INDEX IF NOT EXISTS idx_tracks_album_id ON tracks(album_id);
    CREATE INDEX IF NOT EXISTS idx_track_artists_artist_id ON track_artists(artist_id);
    """

def init_db(
    db_target: Path | str | None = None,
    schema_path: Path | str | None = None,
    db_path: Path | str | None = None,
) -> str:
    """
    Initializes database schema for SQLite or PostgreSQL.
    Supports either db_target or db_path keyword argument for backward compatibility.
    """
    if db_target is None and db_path is not None:
        db_target = db_path
    database_url = str(db_target) if db_target else get_database_url()

    if is_postgres_url(database_url):
        conn = get_connection(database_url)
        try:
            with conn.raw_conn.cursor() as cur:
                cur.execute(get_pg_schema_sql())
            conn.commit()
        finally:
            conn.close()
        return database_url
    else:
        # SQLite
        if db_target is None:
            target_path = get_db_path_from_url(database_url)
        elif isinstance(db_target, str) and not db_target.startswith("sqlite"):
            target_path = Path(db_target)
        else:
            target_path = get_db_path_from_url(str(db_target))

        if schema_path is None:
            schema_path = Path(__file__).resolve().parent.parent / "db" / "schema.sql"
        else:
            schema_path = Path(schema_path)

        if not schema_path.exists():
            raise FileNotFoundError(f"Schema file not found at: {schema_path}")

        target_path.parent.mkdir(parents=True, exist_ok=True)

        with open(schema_path, "r", encoding="utf-8") as f:
            schema_sql = f.read()

        conn = sqlite3.connect(target_path)
        try:
            conn.executescript(schema_sql)
            conn.commit()
        finally:
            conn.close()

        return str(target_path)

if __name__ == "__main__":
    target = init_db()
    print(f"Database initialized successfully at: {target}")
