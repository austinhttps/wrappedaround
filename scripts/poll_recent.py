import os
import sys
import base64
import time
import sqlite3
import argparse
from datetime import datetime, timezone
from pathlib import Path
import requests
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent))
from init_db import get_db_path_from_url

SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"
SPOTIFY_RECENTLY_PLAYED_URL = "https://api.spotify.com/v1/me/player/recently-played"

def refresh_access_token(client_id: str, client_secret: str, refresh_token: str) -> str:
    """
    Exchanges refresh_token for a fresh access_token.
    Exits non-zero with clear log message on invalid_grant.
    """
    auth_header = base64.b64encode(f"{client_id}:{client_secret}".encode("utf-8")).decode("utf-8")
    headers = {
        "Authorization": f"Basic {auth_header}",
        "Content-Type": "application/x-www-form-urlencoded",
    }
    data = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
    }

    response = requests.post(SPOTIFY_TOKEN_URL, headers=headers, data=data)
    if response.status_code != 200:
        try:
            err_json = response.json()
            err_code = err_json.get("error")
            err_desc = err_json.get("error_description", "")
        except Exception:
            err_code = None
            err_desc = response.text

        if err_code == "invalid_grant" or "invalid_grant" in str(err_desc).lower():
            print("CRITICAL ERROR: 'invalid_grant' received from Spotify. Refresh token has expired or been revoked.", file=sys.stderr)
            print("Please re-run `python scripts/auth_bootstrap.py` to generate a new SPOTIFY_REFRESH_TOKEN.", file=sys.stderr)
            sys.exit(1)

        raise RuntimeError(f"Token refresh failed ({response.status_code}): {response.text}")

    res_data = response.json()
    access_token = res_data.get("access_token")
    if not access_token:
        raise RuntimeError("No access_token returned in refresh response.")
    return access_token

def parse_iso_to_epoch_ms(iso_str: str) -> int:
    """
    Converts ISO-8601 string to epoch milliseconds.
    Handles 'Z' and variations like '+00:00'.
    """
    clean_iso = iso_str.replace("Z", "+00:00")
    dt = datetime.fromisoformat(clean_iso)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)

def get_latest_played_at(conn: sqlite3.Connection) -> str | None:
    cur = conn.cursor()
    row = cur.execute("SELECT MAX(played_at) FROM plays").fetchone()
    if row and row[0]:
        return row[0]
    return None

def fetch_recently_played(access_token: str, after_cursor_ms: int | None = None, max_retries: int = 3) -> dict:
    headers = {
        "Authorization": f"Bearer {access_token}",
    }
    params = {
        "limit": 50,
    }
    if after_cursor_ms is not None:
        params["after"] = after_cursor_ms

    attempts = 0
    while attempts < max_retries:
        attempts += 1
        response = requests.get(SPOTIFY_RECENTLY_PLAYED_URL, headers=headers, params=params)
        
        if response.status_code == 200:
            return response.json()

        if response.status_code == 429:
            retry_after = int(response.headers.get("Retry-After", "5"))
            print(f"HTTP 429 Rate limited. Spotify requested Retry-After {retry_after}s. Waiting before retry {attempts}/{max_retries}...")
            time.sleep(retry_after)
            continue

        if response.status_code in (401, 403):
            raise PermissionError(f"Spotify API Auth Error ({response.status_code}): {response.text}")

        response.raise_for_status()

    raise RuntimeError(f"Exceeded max retries ({max_retries}) due to rate limiting (HTTP 429).")

def ingest_recently_played_items(conn: sqlite3.Connection, items: list[dict]) -> tuple[int, int]:
    """
    Ingests items from Spotify's GET /v1/me/player/recently-played response.
    Returns: (total_items, inserted_plays_count)
    """
    cur = conn.cursor()
    initial_count = cur.execute("SELECT COUNT(*) FROM plays").fetchone()[0]

    for item in items:
        played_at = item.get("played_at")
        track_obj = item.get("track")
        if not played_at or not track_obj:
            continue

        track_id = track_obj.get("id")
        track_name = track_obj.get("name", "Unknown Track")
        duration_ms = track_obj.get("duration_ms")
        spotify_uri = track_obj.get("uri")

        album_obj = track_obj.get("album") or {}
        album_id = album_obj.get("id") or f"ext_album:unknown:{track_id}"
        album_name = album_obj.get("name", "Unknown Album")
        release_date = album_obj.get("release_date")
        images = album_obj.get("images") or []
        image_url = images[0].get("url") if images else None

        # 1. Upsert Album
        cur.execute(
            """
            INSERT INTO albums (id, name, release_date, image_url)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name=excluded.name,
                release_date=COALESCE(excluded.release_date, albums.release_date),
                image_url=COALESCE(excluded.image_url, albums.image_url)
            """,
            (album_id, album_name, release_date, image_url),
        )

        # 2. Upsert Track
        cur.execute(
            """
            INSERT INTO tracks (id, name, album_id, duration_ms, spotify_uri)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name=excluded.name,
                album_id=excluded.album_id,
                duration_ms=COALESCE(excluded.duration_ms, tracks.duration_ms),
                spotify_uri=COALESCE(excluded.spotify_uri, tracks.spotify_uri)
            """,
            (track_id, track_name, album_id, duration_ms, spotify_uri),
        )

        # 3. Upsert Artists and Track-Artists relations
        artists = track_obj.get("artists") or []
        for artist in artists:
            artist_id = artist.get("id") or f"ext_artist:{artist.get('name', 'unknown')}"
            artist_name = artist.get("name", "Unknown Artist")

            cur.execute(
                """
                INSERT INTO artists (id, name)
                VALUES (?, ?)
                ON CONFLICT(id) DO UPDATE SET name=excluded.name
                """,
                (artist_id, artist_name),
            )

            cur.execute(
                """
                INSERT OR IGNORE INTO track_artists (track_id, artist_id)
                VALUES (?, ?)
                """,
                (track_id, artist_id),
            )

        # 4. Insert Play with source='poller' (idempotent: UNIQUE(track_id, played_at))
        # Note: Spotify recently-played endpoint does not provide play ms; default to duration_ms or 0
        ms_played = duration_ms or 0
        cur.execute(
            """
            INSERT OR IGNORE INTO plays (
                track_id, played_at, ms_played, source
            ) VALUES (?, ?, ?, 'poller')
            """,
            (track_id, played_at, ms_played),
        )

    conn.commit()
    final_count = cur.execute("SELECT COUNT(*) FROM plays").fetchone()[0]
    return len(items), final_count - initial_count

def poll_and_save(db_path: Path | None = None) -> tuple[int, int]:
    load_dotenv()
    client_id = os.getenv("SPOTIFY_CLIENT_ID")
    client_secret = os.getenv("SPOTIFY_CLIENT_SECRET")
    refresh_token = os.getenv("SPOTIFY_REFRESH_TOKEN")

    if not client_id or not client_secret or not refresh_token:
        print("ERROR: SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, and SPOTIFY_REFRESH_TOKEN must be set.", file=sys.stderr)
        sys.exit(1)

    if db_path is None:
        db_path = get_db_path_from_url()

    conn = sqlite3.connect(db_path)
    try:
        latest_played_at = get_latest_played_at(conn)
        after_cursor_ms = None
        if latest_played_at:
            after_cursor_ms = parse_iso_to_epoch_ms(latest_played_at)
            print(f"Found latest played_at: {latest_played_at} (cursor ms: {after_cursor_ms})")
        else:
            print("No previous plays found in database. Querying latest 50 plays.")

        access_token = refresh_access_token(client_id, client_secret, refresh_token)
        data = fetch_recently_played(access_token, after_cursor_ms)
        items = data.get("items", [])
        total, inserted = ingest_recently_played_items(conn, items)
        print(f"Poller run complete: received {total} items, inserted {inserted} new plays.")
        return total, inserted
    finally:
        conn.close()

def main():
    parser = argparse.ArgumentParser(description="Poll Spotify recently played tracks.")
    parser.add_argument("--db", default=None, help="Path to sqlite database file")
    args = parser.parse_args()

    db_target = Path(args.db) if args.db else None
    poll_and_save(db_target)

if __name__ == "__main__":
    main()
