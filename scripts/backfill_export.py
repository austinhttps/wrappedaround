import os
import sys
import json
import argparse
import hashlib
from pathlib import Path
from typing import Any
from dotenv import load_dotenv

# Ensure parent directory is in sys.path if running as script
sys.path.insert(0, str(Path(__file__).resolve().parent))
from init_db import get_connection, is_postgres_url, get_database_url

def parse_track_id_from_uri(uri: str | None, artist_name: str, track_name: str) -> str:
    if uri and uri.startswith("spotify:track:"):
        return uri.split(":")[-1]
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

def generate_local_track_id(artist_name: str, track_name: str) -> str:
    """Generates local:<sha256[:16]> deterministic ID for tracks without Spotify URIs."""
    key = f"{(artist_name or '').strip().lower()}:{(track_name or '').strip().lower()}".encode("utf-8")
    digest = hashlib.sha256(key).hexdigest()[:16]
    return f"local:{digest}"

def normalize_end_time_to_iso(end_time: str) -> str:
    """
    Normalizes 'YYYY-MM-DD HH:MM' to ISO-8601 UTC string 'YYYY-MM-DDTHH:MM:00Z'.
    If already in ISO-8601 format, returns as is.
    """
    s = end_time.strip()
    if "T" in s:
        return s
    # e.g., '2023-10-15 10:00' -> '2023-10-15T10:00:00Z'
    parts = s.split(" ")
    if len(parts) == 2:
        date_part, time_part = parts
        time_tokens = time_part.split(":")
        if len(time_tokens) == 2:
            return f"{date_part}T{time_part}:00Z"
        elif len(time_tokens) == 3:
            return f"{date_part}T{time_part}Z"
    return s

def detect_format(record: dict) -> str:
    """
    Detects whether record is from Extended Streaming History or 1-Year Account Data.
    Returns: 'extended', 'account_data', or 'unknown'
    """
    if "master_metadata_track_name" in record or "spotify_track_uri" in record or "ts" in record:
        return "extended"
    if "endTime" in record and "trackName" in record:
        return "account_data"
    return "unknown"

def find_existing_track_by_title_and_artist(cur: Any, title: str, artist: str) -> str | None:
    """Case-insensitive match on (track title, artist name) in tracks & artists tables."""
    cur.execute(
        """
        SELECT t.id
        FROM tracks t
        JOIN track_artists ta ON t.id = ta.track_id
        JOIN artists a ON ta.artist_id = a.id
        WHERE LOWER(t.name) = LOWER(?) AND LOWER(a.name) = LOWER(?)
        LIMIT 1
        """,
        (title.strip(), artist.strip()),
    )
    row = cur.fetchone()
    return row[0] if row else None

def purge_account_data(conn: Any) -> int:
    """Purges all plays where source='account_data'."""
    cur = conn.cursor()
    cur.execute("DELETE FROM plays WHERE source = 'account_data'")
    deleted = cur.rowcount
    conn.commit()
    return deleted

def backfill_stream_records(
    conn: Any,
    records: list[dict],
    replace_account_data: bool = False,
) -> tuple[int, int]:
    """
    Ingests raw Spotify stream records idempotently.
    Supports:
      1. Extended Streaming History (Streaming_History_Audio_*.json)
      2. 1-Year Account Data (StreamingHistory_music_*.json)
    Returns: (total_valid_records, inserted_plays_count)
    """
    cur = conn.cursor()

    if replace_account_data:
        deleted = purge_account_data(conn)
        if deleted > 0:
            print(f"Purged {deleted} existing 'account_data' plays (--replace-account-data enabled).")

    total_valid = 0
    cur.execute("SELECT COUNT(*) FROM plays")
    initial_plays_count = cur.fetchone()[0]

    for item in records:
        fmt = detect_format(item)

        if fmt == "extended":
            ts = item.get("ts")
            track_name = item.get("master_metadata_track_name")
            artist_name = item.get("master_metadata_album_artist_name")
            album_name = item.get("master_metadata_album_album_name")
            spotify_track_uri = item.get("spotify_track_uri")
            ms_played = item.get("ms_played")

            # Guardrail: Skip non-music rows where spotify_track_uri or master_metadata_track_name is null
            if not spotify_track_uri or not track_name:
                continue

            if not ts or ms_played is None:
                continue

            total_valid += 1
            track_id = parse_track_id_from_uri(spotify_track_uri, artist_name or "Unknown Artist", track_name)
            artist_id = parse_artist_id(artist_name or "Unknown Artist")
            album_id = parse_album_id(album_name or "Unknown Album", artist_name or "Unknown Artist")

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
                (track_id, track_name, album_id, spotify_track_uri),
            )

            # 4. Upsert Track Artist relation
            cur.execute(
                """
                INSERT INTO track_artists (track_id, artist_id)
                VALUES (?, ?)
                ON CONFLICT (track_id, artist_id) DO NOTHING
                """,
                (track_id, artist_id),
            )

            # 5. Insert Play (Idempotent: UNIQUE(track_id, played_at))
            cur.execute(
                """
                INSERT INTO plays (
                    track_id, played_at, ms_played, source, platform,
                    reason_start, reason_end, shuffle, skipped
                ) VALUES (?, ?, ?, 'export', ?, ?, ?, ?, ?)
                ON CONFLICT (track_id, played_at) DO NOTHING
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

        elif fmt == "account_data":
            end_time = item.get("endTime")
            track_name = item.get("trackName")
            artist_name = item.get("artistName")
            ms_played = item.get("msPlayed")

            if not end_time or not track_name or not artist_name or ms_played is None:
                continue

            total_valid += 1
            played_at = normalize_end_time_to_iso(end_time)

            # Check if track exists by case-insensitive (title, artist)
            matched_track_id = find_existing_track_by_title_and_artist(cur, track_name, artist_name)
            artist_id = parse_artist_id(artist_name)

            if matched_track_id:
                track_id = matched_track_id
            else:
                track_id = generate_local_track_id(artist_name, track_name)
                # Ensure artist exists
                cur.execute(
                    """
                    INSERT INTO artists (id, name)
                    VALUES (?, ?)
                    ON CONFLICT(id) DO UPDATE SET name=excluded.name
                    """,
                    (artist_id, artist_name),
                )
                # Ensure track exists
                cur.execute(
                    """
                    INSERT INTO tracks (id, name, album_id, duration_ms, spotify_uri)
                    VALUES (?, ?, NULL, NULL, NULL)
                    ON CONFLICT(id) DO UPDATE SET name=excluded.name
                    """,
                    (track_id, track_name),
                )
                # Ensure track_artists link
                cur.execute(
                    """
                    INSERT INTO track_artists (track_id, artist_id)
                    VALUES (?, ?)
                    ON CONFLICT (track_id, artist_id) DO NOTHING
                    """,
                    (track_id, artist_id),
                )

            # Insert Play with source='account_data'
            cur.execute(
                """
                INSERT INTO plays (
                    track_id, played_at, ms_played, source
                ) VALUES (?, ?, ?, 'account_data')
                ON CONFLICT (track_id, played_at) DO NOTHING
                """,
                (
                    track_id,
                    played_at,
                    int(ms_played),
                ),
            )

    conn.commit()
    cur.execute("SELECT COUNT(*) FROM plays")
    final_plays_count = cur.fetchone()[0]
    inserted_plays = final_plays_count - initial_plays_count
    return total_valid, inserted_plays

def process_file_or_dir(
    target_path: Path,
    db_target: str | Path | None = None,
    replace_account_data: bool = False,
) -> tuple[int, int]:
    target_url = str(db_target) if db_target else get_database_url()

    json_files = []
    if target_path.is_file():
        json_files.append(target_path)
    elif target_path.is_dir():
        # Match Spotify naming conventions: Streaming_History_Audio_*.json and StreamingHistory_music_*.json
        history_files = sorted(
            list(target_path.glob("Streaming_History_Audio_*.json"))
            + list(target_path.glob("StreamingHistory_music_*.json"))
        )
        if history_files:
            json_files = history_files
        else:
            json_files = sorted(list(target_path.glob("*.json")))

    if not json_files:
        print(f"No JSON files found in {target_path}")
        return 0, 0

    conn = get_connection(target_url)
    total_valid = 0
    total_inserted = 0

    try:
        if replace_account_data:
            purge_account_data(conn)

        for file in json_files:
            print(f"Processing: {file.name}...")
            with open(file, "r", encoding="utf-8") as f:
                data = json.load(f)
                if not isinstance(data, list):
                    print(f"Warning: File {file.name} does not contain a JSON list, skipping.")
                    continue
                valid, inserted = backfill_stream_records(conn, data, replace_account_data=False)
                total_valid += valid
                total_inserted += inserted
                print(f"  Processed {valid} records, inserted {inserted} new plays.")
    finally:
        conn.close()

    return total_valid, total_inserted

def main():
    load_dotenv()
    parser = argparse.ArgumentParser(
        description="Backfill Spotify Extended Streaming History or 1-Year Account Data JSON files."
    )
    parser.add_argument(
        "paths",
        nargs="*",
        default=["data"],
        help="Path(s) to JSON files or directories containing Spotify streaming history JSONs",
    )
    parser.add_argument("--db", default=None, help="Database path or PostgreSQL connection URL")
    parser.add_argument(
        "--replace-account-data",
        action="store_true",
        help="Purge existing plays with source='account_data' before importing",
    )
    args = parser.parse_args()

    total_valid_all = 0
    total_inserted_all = 0
    for p_str in args.paths:
        p = Path(p_str)
        if not p.exists():
            print(f"Path does not exist: {p}", file=sys.stderr)
            continue
        valid, inserted = process_file_or_dir(
            p,
            args.db,
            replace_account_data=args.replace_account_data,
        )
        total_valid_all += valid
        total_inserted_all += inserted

    print(f"\nBackfill Complete: {total_valid_all} records inspected, {total_inserted_all} plays inserted.")

if __name__ == "__main__":
    main()
