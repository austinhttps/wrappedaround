import os
import sys
import sqlite3
import argparse
from pathlib import Path
from typing import Any
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent))
from init_db import get_connection, is_postgres_url, get_pg_schema_sql

def sync_sqlite_to_pg(
    sqlite_db_path: Path | str,
    pg_url: str,
    batch_size: int = 500,
) -> dict[str, int]:
    """
    Idempotently syncs SQLite tables (artists, albums, tracks, track_artists, plays)
    into a PostgreSQL database.
    """
    sqlite_path = Path(sqlite_db_path)
    if not sqlite_path.exists():
        raise FileNotFoundError(f"Source SQLite database not found at: {sqlite_path}")

    if not is_postgres_url(pg_url):
        raise ValueError(f"Target URL must be a valid PostgreSQL URL (postgres:// or postgresql://): {pg_url}")

    print(f"Connecting to source SQLite: {sqlite_path}")
    src_conn = sqlite3.connect(sqlite_path)
    src_conn.row_factory = sqlite3.Row

    print("Connecting to target PostgreSQL...")
    target_conn = get_connection(pg_url)

    # 1. Initialize Postgres schema if needed
    print("Ensuring target PostgreSQL schema exists...")
    with target_conn.raw_conn.cursor() as cur:
        cur.execute(get_pg_schema_sql())
    target_conn.commit()

    stats = {
        "artists": 0,
        "albums": 0,
        "tracks": 0,
        "track_artists": 0,
        "plays": 0,
    }

    try:
        src_cur = src_conn.cursor()
        tgt_cur = target_conn.cursor()

        # 2. Sync Artists
        print("Syncing artists...")
        src_cur.execute("SELECT id, name FROM artists")
        artists = src_cur.fetchall()
        if artists:
            artist_params = [(r["id"], r["name"]) for r in artists]
            tgt_cur.executemany(
                """
                INSERT INTO artists (id, name)
                VALUES (?, ?)
                ON CONFLICT(id) DO UPDATE SET name = excluded.name
                """,
                artist_params,
            )
            target_conn.commit()
            stats["artists"] = len(artists)
        print(f"  Synced {stats['artists']} artists.")

        # 3. Sync Albums
        print("Syncing albums...")
        src_cur.execute("SELECT id, name, release_date, image_url FROM albums")
        albums = src_cur.fetchall()
        if albums:
            album_params = [(r["id"], r["name"], r["release_date"], r["image_url"]) for r in albums]
            tgt_cur.executemany(
                """
                INSERT INTO albums (id, name, release_date, image_url)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    release_date = COALESCE(excluded.release_date, albums.release_date),
                    image_url = COALESCE(excluded.image_url, albums.image_url)
                """,
                album_params,
            )
            target_conn.commit()
            stats["albums"] = len(albums)
        print(f"  Synced {stats['albums']} albums.")

        # 4. Sync Tracks
        print("Syncing tracks...")
        src_cur.execute("SELECT id, name, album_id, duration_ms, spotify_uri FROM tracks")
        tracks = src_cur.fetchall()
        if tracks:
            track_params = [(r["id"], r["name"], r["album_id"], r["duration_ms"], r["spotify_uri"]) for r in tracks]
            tgt_cur.executemany(
                """
                INSERT INTO tracks (id, name, album_id, duration_ms, spotify_uri)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    album_id = excluded.album_id,
                    duration_ms = COALESCE(excluded.duration_ms, tracks.duration_ms),
                    spotify_uri = COALESCE(tracks.spotify_uri, excluded.spotify_uri)
                """,
                track_params,
            )
            target_conn.commit()
            stats["tracks"] = len(tracks)
        print(f"  Synced {stats['tracks']} tracks.")

        # 5. Sync Track Artists
        print("Syncing track_artists...")
        src_cur.execute("SELECT track_id, artist_id FROM track_artists")
        track_artists = src_cur.fetchall()
        if track_artists:
            ta_params = [(r["track_id"], r["artist_id"]) for r in track_artists]
            tgt_cur.executemany(
                """
                INSERT INTO track_artists (track_id, artist_id)
                VALUES (?, ?)
                ON CONFLICT (track_id, artist_id) DO NOTHING
                """,
                ta_params,
            )
            target_conn.commit()
            stats["track_artists"] = len(track_artists)
        print(f"  Synced {stats['track_artists']} track_artists associations.")

        # 6. Sync Plays in Batches
        print("Syncing plays in batches...")
        src_cur.execute(
            """
            SELECT track_id, played_at, ms_played, source, platform,
                   reason_start, reason_end, shuffle, skipped
            FROM plays
            ORDER BY id ASC
            """
        )
        total_plays = 0
        while True:
            batch = src_cur.fetchmany(batch_size)
            if not batch:
                break
            play_params = [
                (
                    r["track_id"],
                    r["played_at"],
                    r["ms_played"],
                    r["source"],
                    r["platform"],
                    r["reason_start"],
                    r["reason_end"],
                    bool(r["shuffle"]) if r["shuffle"] is not None else None,
                    bool(r["skipped"]) if r["skipped"] is not None else None,
                )
                for r in batch
            ]
            tgt_cur.executemany(
                """
                INSERT INTO plays (
                    track_id, played_at, ms_played, source, platform,
                    reason_start, reason_end, shuffle, skipped
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (track_id, played_at) DO NOTHING
                """,
                play_params,
            )
            target_conn.commit()
            total_plays += len(batch)
            print(f"  Processed {total_plays} plays...")

        stats["plays"] = total_plays
        print(f"Sync complete! Total plays processed: {total_plays}")

    finally:
        src_conn.close()
        target_conn.close()

    return stats

def main():
    load_dotenv()
    parser = argparse.ArgumentParser(
        description="One-time idempotent migration/sync from local SQLite to PostgreSQL."
    )
    parser.add_argument(
        "--sqlite",
        default="data/spotify.db",
        help="Path to source SQLite database (default: data/spotify.db)",
    )
    parser.add_argument(
        "--postgres",
        default=None,
        help="PostgreSQL connection URL (defaults to DATABASE_URL if postgres)",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=500,
        help="Batch size for transferring plays (default: 500)",
    )
    args = parser.parse_args()

    pg_url = args.postgres or os.getenv("DATABASE_URL")
    if not pg_url or not is_postgres_url(pg_url):
        print(
            "ERROR: Target must be a PostgreSQL connection URL (e.g. postgresql://user:pass@host:5432/dbname).",
            file=sys.stderr,
        )
        print("Provide via --postgres or set DATABASE_URL in your environment.", file=sys.stderr)
        sys.exit(1)

    sync_sqlite_to_pg(args.sqlite, pg_url, batch_size=args.batch_size)

if __name__ == "__main__":
    main()
