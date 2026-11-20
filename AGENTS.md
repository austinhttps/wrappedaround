# AGENTS.md - Personal Spotify Stats Tracker

## Project Overview
Single-user personal listening analytics platform modeled after stats.fm.
- **Ingestion (`scripts/`):** Python 3.12+ CLI scripts for one-time OAuth setup, historical JSON backfill, and scheduled `recently-played` polling.
- **Database (`db/`):** SQLite for local development (`data/spotify.db`) or Postgres via `DATABASE_URL`. Schema defined in `db/schema.sql`.
- **Dashboard (`web/`):** Read-only web UI and query layer for top artists/tracks/albums, listening heatmaps, and date-range stats.

## Hard Guardrails & Security
1. **Never touch or commit secrets:** Never read, log, or hardcode `.env`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN`, or `DATABASE_URL`. Always read credentials from environment variables and document new ones in `.env.example`.
2. **Keep `data/` out of git:** Never stage `.db` files or raw Spotify privacy export JSONs. Use synthetic/anonymized payloads in `tests/fixtures/` for tests.
3. **Frontend stays read-only:** `web/` must never store Spotify OAuth tokens or write to `plays`. All mutations happen in `scripts/`.

## Data & Ingestion Rules
1. **Idempotency is mandatory:** All play inserts must deduplicate on `(track_id, played_at)` (`ON CONFLICT DO NOTHING` / `INSERT OR IGNORE`). Re-running backfill or polling must never inflate play counts.
2. **Preserve raw `ms_played`:** Store all plays regardless of duration. Apply "counted stream" thresholds (e.g., `ms_played >= 30000`) at query time in `web/src/lib/queries.ts`, never by dropping short plays at ingestion.
3. **Avoid deprecated Spotify fields:** Do not depend on Spotify Audio Features or legacy popularity/follower fields. Rely on `played_at`, Spotify IDs, track duration, and `ms_played`.
4. **Resilient polling:** `poll_recent.py` must query `MAX(played_at)` as its cursor, handle HTTP `429` using the `Retry-After` header, and exit non-zero with a clear log message on `invalid_grant` (expired refresh token).

## Workflow & Verification Expectations
1. **Plan before multi-file edits:** Generate an implementation plan before modifying `db/schema.sql` or changing ingestion logic.
2. **Verify ingestion with tests:** Any change to `backfill_export.py` or `poll_recent.py` must pass `pytest` against `tests/fixtures/`, including duplicate-run checks.
3. **Verify UI in browser:** After modifying `web/` components or queries, start the dev server and verify rendered charts, empty states, and console logs in the browser before finishing.

spotify-stats/
ÃÄÄ AGENTS.md                  # Global rules and architectural guardrails for Antigravity
ÃÄÄ .env.example               # Template for required env vars (committed)
ÃÄÄ .gitignore                 # Excludes .env, local SQLite DBs, and raw Spotify ZIP exports
ÃÄÄ db/
³   ÃÄÄ schema.sql             # Single source of truth for tables and indexes
³   ÀÄÄ migrations/            # Incremental SQL migrations if schema evolves
ÃÄÄ scripts/
³   ÃÄÄ auth_bootstrap.py      # One-time local OAuth flow to generate SPOTIFY_REFRESH_TOKEN
³   ÃÄÄ backfill_export.py     # Idempotent importer for Spotify Extended Streaming History JSONs
³   ÀÄÄ poll_recent.py         # Scheduled poller for GET /v1/me/player/recently-played
ÃÄÄ web/                       # Frontend + read-only stats API (e.g., Next.js or FastAPI + React)
³   ÃÄÄ src/
³   ³   ÃÄÄ lib/
³   ³   ³   ÃÄÄ db.ts          # Read-only DB connection & typed query helpers
³   ³   ³   ÀÄÄ queries.ts     # SQL aggregations (top artists/tracks, listening clock, streaks)
³   ³   ÃÄÄ app/               # Dashboard pages & JSON API endpoints
³   ³   ÀÄÄ components/        # Charts, date-range pickers, top-item cards
³   ÀÄÄ package.json
ÃÄÄ tests/
³   ÃÄÄ fixtures/              # Sample anonymized Extended History & recently-played JSONs
³   ÀÄÄ test_ingestion.py      # Tests for deduplication, cursor logic, and 429 retry handling
ÀÄÄ data/                      # Ignored by git: local spotify.db and unzipped export JSONs
