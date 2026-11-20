import os
import sys
import json
import sqlite3
import pytest
from unittest.mock import patch, MagicMock
from pathlib import Path

# Add project root and scripts directory to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))

from init_db import init_db
from backfill_export import (
    backfill_stream_records,
    process_file_or_dir,
    normalize_end_time_to_iso,
    generate_local_track_id,
    purge_account_data,
)
from poll_recent import (
    parse_iso_to_epoch_ms,
    get_latest_played_at,
    ingest_recently_played_items,
    fetch_recently_played,
    refresh_access_token,
)

FIXTURES_DIR = PROJECT_ROOT / "tests" / "fixtures"

@pytest.fixture
def test_db(tmp_path):
    """Initializes a temporary SQLite database using db/schema.sql."""
    db_file = tmp_path / "test_spotify.db"
    init_db(db_path=db_file)
    conn = sqlite3.connect(db_file)
    yield conn, db_file
    conn.close()

def test_schema_initialization(test_db):
    conn, _ = test_db
    cur = conn.cursor()
    tables = cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';"
    ).fetchall()
    table_names = {t[0] for t in tables}
    assert {"artists", "albums", "tracks", "track_artists", "plays"}.issubset(table_names)

def test_backfill_idempotency_and_preservation(test_db):
    conn, db_path = test_db
    sample_file = FIXTURES_DIR / "Streaming_History_Audio_2023_0.json"
    with open(sample_file, "r", encoding="utf-8") as f:
        records = json.load(f)

    # First backfill run
    valid, inserted = backfill_stream_records(conn, records)
    assert valid == 3
    assert inserted == 3

    cur = conn.cursor()
    plays_count_1 = cur.execute("SELECT COUNT(*) FROM plays").fetchone()[0]
    assert plays_count_1 == 3

    # Check raw ms_played was preserved even for short play (< 30s)
    short_play = cur.execute(
        "SELECT ms_played, source FROM plays WHERE ms_played = 12400"
    ).fetchone()
    assert short_play is not None
    assert short_play[0] == 12400
    assert short_play[1] == "export"

    # Second backfill run (re-running backfill)
    valid_2, inserted_2 = backfill_stream_records(conn, records)
    assert valid_2 == 3
    assert inserted_2 == 0  # No new plays inserted

    plays_count_2 = cur.execute("SELECT COUNT(*) FROM plays").fetchone()[0]
    assert plays_count_2 == 3

def test_extended_skips_non_music(test_db):
    conn, _ = test_db
    non_music_records = [
        {
            "ts": "2023-10-15T10:00:00Z",
            "ms_played": 50000,
            "master_metadata_track_name": None,
            "spotify_track_uri": None,
            "episode_name": "Podcast Ep 1",
        },
        {
            "ts": "2023-10-15T10:01:00Z",
            "ms_played": 40000,
            "master_metadata_track_name": "Music Track",
            "spotify_track_uri": None, # missing URI
        },
        {
            "ts": "2023-10-15T10:02:00Z",
            "ms_played": 35000,
            "master_metadata_track_name": "Legit Song",
            "master_metadata_album_artist_name": "Legit Artist",
            "spotify_track_uri": "spotify:track:legit123",
        },
    ]
    valid, inserted = backfill_stream_records(conn, non_music_records)
    assert valid == 1
    assert inserted == 1

def test_account_data_import_and_normalization(test_db):
    conn, _ = test_db
    account_data_file = FIXTURES_DIR / "StreamingHistory_music_0.json"
    with open(account_data_file, "r", encoding="utf-8") as f:
        records = json.load(f)

    valid, inserted = backfill_stream_records(conn, records)
    assert valid == 3
    assert inserted == 3

    cur = conn.cursor()
    # Check normalized timestamp
    play = cur.execute(
        "SELECT played_at, source, track_id FROM plays WHERE ms_played = 185000"
    ).fetchone()
    assert play is not None
    assert play[0] == "2023-10-16T14:22:00Z"
    assert play[1] == "account_data"
    assert play[2].startswith("local:")

def test_account_data_matches_existing_track(test_db):
    conn, _ = test_db
    # Pre-populate track via Extended History
    extended_file = FIXTURES_DIR / "Streaming_History_Audio_2023_0.json"
    with open(extended_file, "r", encoding="utf-8") as f:
        ext_records = json.load(f)
    backfill_stream_records(conn, ext_records)

    cur = conn.cursor()
    orig_track_id = cur.execute(
        "SELECT id FROM tracks WHERE name = 'Midnight Echoes'"
    ).fetchone()[0]
    assert orig_track_id == "4cOdK2wGLETKBW3PvgPWqT"

    # Now import account data with case-insensitive matching track name & artist
    acc_record = [
        {
            "endTime": "2023-11-01 12:00",
            "artistName": "the synthwaves", # lower-case
            "trackName": "MIDNIGHT ECHOES", # upper-case
            "msPlayed": 195430,
        }
    ]
    valid, inserted = backfill_stream_records(conn, acc_record)
    assert valid == 1
    assert inserted == 1

    play = cur.execute(
        "SELECT track_id, source FROM plays WHERE played_at = '2023-11-01T12:00:00Z'"
    ).fetchone()
    assert play is not None
    assert play[0] == orig_track_id  # Reused existing track ID!
    assert play[1] == "account_data"

def test_replace_account_data_flag(test_db):
    conn, _ = test_db
    # First, import account data
    account_data_file = FIXTURES_DIR / "StreamingHistory_music_0.json"
    with open(account_data_file, "r", encoding="utf-8") as f:
        acc_records = json.load(f)
    backfill_stream_records(conn, acc_records)

    cur = conn.cursor()
    assert cur.execute("SELECT COUNT(*) FROM plays WHERE source = 'account_data'").fetchone()[0] == 3

    # Next, import extended streaming history with replace_account_data=True
    extended_file = FIXTURES_DIR / "Streaming_History_Audio_2023_0.json"
    with open(extended_file, "r", encoding="utf-8") as f:
        ext_records = json.load(f)

    valid, inserted = backfill_stream_records(conn, ext_records, replace_account_data=True)
    assert valid == 3
    assert inserted == 3

    # Verify that account_data rows were purged
    acc_plays_after = cur.execute("SELECT COUNT(*) FROM plays WHERE source = 'account_data'").fetchone()[0]
    assert acc_plays_after == 0

    # Verify only export plays remain
    export_plays_after = cur.execute("SELECT COUNT(*) FROM plays WHERE source = 'export'").fetchone()[0]
    assert export_plays_after == 3

def test_poll_idempotency(test_db):
    conn, db_path = test_db
    sample_file = FIXTURES_DIR / "recently_played_sample.json"
    with open(sample_file, "r", encoding="utf-8") as f:
        data = json.load(f)
    items = data["items"]

    # First poll run
    total, inserted = ingest_recently_played_items(conn, items)
    assert total == 2
    assert inserted == 2

    cur = conn.cursor()
    poll_plays = cur.execute("SELECT COUNT(*) FROM plays WHERE source = 'poller'").fetchone()[0]
    assert poll_plays == 2

    # Second poll run with same items
    total_2, inserted_2 = ingest_recently_played_items(conn, items)
    assert total_2 == 2
    assert inserted_2 == 0

    poll_plays_after = cur.execute("SELECT COUNT(*) FROM plays WHERE source = 'poller'").fetchone()[0]
    assert poll_plays_after == 2

def test_cross_source_deduplication(test_db):
    conn, _ = test_db
    cur = conn.cursor()

    # Pre-insert a play via export
    cur.execute(
        "INSERT INTO artists (id, name) VALUES ('artist_1', 'Artist One')"
    )
    cur.execute(
        "INSERT INTO albums (id, name) VALUES ('album_1', 'Album One')"
    )
    cur.execute(
        "INSERT INTO tracks (id, name, album_id) VALUES ('track_abc', 'Song Alpha', 'album_1')"
    )
    cur.execute(
        """
        INSERT INTO plays (track_id, played_at, ms_played, source)
        VALUES ('track_abc', '2024-03-01T12:00:00Z', 180000, 'export')
        """
    )
    conn.commit()

    # Attempt to insert identical (track_id, played_at) via poller
    poller_item = [
        {
            "track": {
                "id": "track_abc",
                "name": "Song Alpha",
                "duration_ms": 180000,
                "album": {"id": "album_1", "name": "Album One"},
                "artists": [{"id": "artist_1", "name": "Artist One"}]
            },
            "played_at": "2024-03-01T12:00:00Z"
        }
    ]

    total, inserted = ingest_recently_played_items(conn, poller_item)
    assert total == 1
    assert inserted == 0  # Deduplicated on UNIQUE(track_id, played_at)

    total_plays = cur.execute("SELECT COUNT(*) FROM plays").fetchone()[0]
    assert total_plays == 1

def test_cursor_calculation(test_db):
    conn, _ = test_db
    cur = conn.cursor()

    # With empty DB
    assert get_latest_played_at(conn) is None

    # Insert play
    cur.execute("INSERT INTO artists (id, name) VALUES ('a1', 'Artist')")
    cur.execute("INSERT INTO tracks (id, name) VALUES ('t1', 'Track')")
    cur.execute(
        "INSERT INTO plays (track_id, played_at, ms_played, source) VALUES ('t1', '2024-02-01T16:00:00.000Z', 195430, 'poller')"
    )
    conn.commit()

    latest = get_latest_played_at(conn)
    assert latest == "2024-02-01T16:00:00.000Z"
    cursor_ms = parse_iso_to_epoch_ms(latest)
    # 2024-02-01T16:00:00.000Z in epoch ms is 1706803200000
    assert cursor_ms == 1706803200000

def test_fetch_recently_played_429_backoff():
    mock_resp_429 = MagicMock()
    mock_resp_429.status_code = 429
    mock_resp_429.headers = {"Retry-After": "2"}

    mock_resp_200 = MagicMock()
    mock_resp_200.status_code = 200
    mock_resp_200.json.return_value = {"items": [], "limit": 50}

    with patch("requests.get", side_effect=[mock_resp_429, mock_resp_200]) as mock_get:
        with patch("time.sleep") as mock_sleep:
            res = fetch_recently_played("dummy_token", after_cursor_ms=1706803200000)
            assert res == {"items": [], "limit": 50}
            assert mock_get.call_count == 2
            mock_sleep.assert_called_once_with(2)

def test_refresh_token_invalid_grant_exits():
    mock_resp = MagicMock()
    mock_resp.status_code = 400
    mock_resp.json.return_value = {
        "error": "invalid_grant",
        "error_description": "Refresh token revoked"
    }

    with patch("requests.post", return_value=mock_resp):
        with pytest.raises(SystemExit) as exc_info:
            refresh_access_token("fake_client_id", "fake_client_secret", "expired_token")
        assert exc_info.value.code != 0
