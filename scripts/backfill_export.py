import os
import sys
import json
import sqlite3
import argparse
from pathlib import Path
from dotenv import load_dotenv

# Ensure parent directory is in sys.path if running as script
sys.path.insert(0, str(Path(__file__).resolve().parent))
from init_db import get_db_path_from_url

def parse_track_id_from_uri(uri: str | None, artist_name: str, track_name: str) -> str:
    if uri and uri.startswith("spotify:track:"):
        return uri.split(":")[-1]
    # Fallback synthetic ID for podcasts or tracks without URI
    clean_artist = (artist_name or "unknown").strip().lower()
    clean_track = (track_name or "unknown").strip().lower()
    return f"ext:{clean_artist}:{clean_track}"

def parse_album_id(album_name: str, artist_name: str) -> str:
    clean_artist = (artist_name or "unknown").strip().lower()
    clean_album = (album_name or "unknown").strip().lower()
    return f"ext_album:{clean_artist}:{clean_album}"

def parse_artist_id(artist_name: str) -> str:
    clean_artist = (artist_name or "unknown").strip().lower()
    return f"ext_artist:{clean_artist}"

def backfill_stream_records(conn: sqlite3.Connection, records: list[dict]) -> tuple[int, int]:
    """
    Ingests raw Spotify extended streaming history records idempotently.
    Returns: (total_valid_records, inserted_plays_count)
    """
    cur = conn.cursor()
    total_valid = 0
    initial_plays_count = cur.execute("SELECT COUNT(*) FROM plays").fetchone()[0]

    for item in records:
        ts = item.get("ts")
        track_name = item.get("master_metadata_track_name")
        artist_name = item.get("master_metadata_album_artist_name")
        album_name = item.get("master_metadata_album_album_name")
        spotify_track_uri = item.get("spotify_track_uri")
        ms_played = item.get("ms_played")

        # Skip entries that have no timestamp or played duration
        if not ts or ms_played is None:
            continue

        total_valid += 1
        track_id = parse_track_id_from_uri(spotify_track_uri, artist_name, track_name)
        artist_id = parse_artist_id(artist_name)
        album_id = parse_album_id(album_name, artist_name)

        # 1. Upsert Artist
        cur.execute(
            """
            INSERT INTO artists (id, name)
            VALUES (?, ?)
            ON CONFLICT(id) DO UPDATE SET name=excluded.name
            """,
            (artist_id, artist_name or "Unknown Artist"),
        )

        # 2. Upsert Album
        cur.execute(
            """
            INSERT INTO albums (id, name, release_date, image_url)
            VALUES (?, ?, NULL, NULL)
            ON CONFLICT(id) DO UPDATE SET name=excluded.name
            """,
            (album_id, album_name or "Unknown Album"),
        )

        # 3. Upsert Track
        cur.execute(
            """
            INSERT INTO tracks (id, name, album_id, duration_ms, spotify_uri)
            VALUES (?, ?, ?, NULL, ?)
            ON CONFLICT(id) DO UPDATE SET
                name=excluded.name,
                album_id=excluded.album_id,
                spotify_uri=COALESCE(tracks.spotify_uri, excluded.spotify_uri)
            """,
            (track_id, track_name or "Unknown Track", album_id, spotify_track_uri),
        )

        # 4. Upsert Track Artist relation
        cur.execute(
            """
            INSERT OR IGNORE INTO track_artists (track_id, artist_id)
            VALUES (?, ?)
            """,
            (track_id, artist_id),
        )

        # 5. Insert Play (Idempotent: UNIQUE(track_id, played_at))
        cur.execute(
            """
            INSERT OR IGNORE INTO plays (
                track_id, played_at, ms_played, source, platform,
                reason_start, reason_end, shuffle, skipped
            ) VALUES (?, ?, ?, 'export', ?, ?, ?, ?, ?)
            """,
            (
                track_id,
                ts,
                int(ms_played),
                item.get("platform"),
                item.get("reason_start"),
                item.get("reason_end"),
                item.get("shuffle"),
                item.get("skipped"),
            ),
        )

    conn.commit()
    final_plays_count = cur.execute("SELECT COUNT(*) FROM plays").fetchone()[0]
    inserted_plays = final_plays_count - initial_plays_count
    return total_valid, inserted_plays

def process_file_or_dir(target_path: Path, db_path: Path | None = None) -> tuple[int, int]:
    if db_path is None:
        db_path = get_db_path_from_url()

    json_files = []
    if target_path.is_file():
        json_files.append(target_path)
    elif target_path.is_dir():
        # Match Spotify naming convention Streaming_History_Audio_*.json or any json
        audio_files = sorted(list(target_path.glob("Streaming_History_Audio_*.json")))
        if audio_files:
            json_files = audio_files
        else:
            json_files = sorted(list(target_path.glob("*.json")))

    if not json_files:
        print(f"No JSON files found in {target_path}")
        return 0, 0

    conn = sqlite3.connect(db_path)
    total_valid = 0
    total_inserted = 0

    try:
        for file in json_files:
            print(f"Processing: {file.name}...")
            with open(file, "r", encoding="utf-8") as f:
                data = json.load(f)
                if not isinstance(data, list):
                    print(f"Warning: File {file.name} does not contain a JSON list, skipping.")
                    continue
                valid, inserted = backfill_stream_records(conn, data)
                total_valid += valid
                total_inserted += inserted
                print(f"  Processed {valid} records, inserted {inserted} new plays.")
    finally:
        conn.close()

    return total_valid, total_inserted

def main():
    load_dotenv()
    parser = argparse.ArgumentParser(description="Backfill Spotify Extended Streaming History JSON files.")
    parser.add_argument(
        "paths",
        nargs="*",
        default=["data"],
        help="Path(s) to JSON files or directories containing Streaming_History_Audio_*.json",
    )
    parser.add_argument("--db", default=None, help="Path to sqlite database file")
    args = parser.parse_args()

    db_target = Path(args.db) if args.db else get_db_path_from_url()

    total_valid_all = 0
    total_inserted_all = 0
    for p_str in args.paths:
        p = Path(p_str)
        if not p.exists():
            print(f"Path does not exist: {p}", file=sys.stderr)
            continue
        valid, inserted = process_file_or_dir(p, db_target)
        total_valid_all += valid
        total_inserted_all += inserted

    print(f"\nBackfill Complete: {total_valid_all} records inspected, {total_inserted_all} plays inserted.")

if __name__ == "__main__":
    main()
