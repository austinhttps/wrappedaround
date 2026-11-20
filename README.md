# Personal Spotify Stats Tracker

Single-user personal listening analytics platform modeled after stats.fm.
- **Ingestion (`scripts/`):** Python CLI tools for one-time OAuth setup, historical backfill, scheduled polling, and SQLite-to-PostgreSQL migration.
- **Database (`db/`):** SQLite (`data/spotify.db`) for local development or hosted PostgreSQL via `DATABASE_URL`.
- **Dashboard (`web/`):** Next.js (App Router + TypeScript + Tailwind CSS) read-only analytics dashboard deployable to Vercel.
- **Automation (`.github/workflows/`):** Scheduled GitHub Actions cron poller to capture listening streams automatically every 10 minutes.

---

## Architecture & Phases

- **Phase 1 (Complete):** Core Data Model & Local Ingestion Pipeline (OAuth bootstrap, historical JSON backfills with deduplication, and recently-played poller).
- **Phase 2 (Complete):** Read-Only Analytics Dashboard (`web/`) with KPI metrics, listening clock heatmap, daily trends, and recent plays feed.
- **Phase 3 (Complete):** Scheduled GitHub Actions Polling, Hosted PostgreSQL Support, and Public Web Deployment.

---

## Phase 3: Cloud Deployment & Scheduled Polling Guide

### 1. Hosted PostgreSQL Provisioning

Create a PostgreSQL database using any cloud provider (e.g., [Neon](https://neon.tech), [Supabase](https://supabase.com), [Railway](https://railway.app), or AWS RDS).

Obtain your connection string. It will look like:
```bash
postgresql://<user>:<password>@<host>:<port>/<dbname>?sslmode=require
```

### 2. One-Time SQLite to PostgreSQL Migration

If you have already backfilled historical streaming data into a local SQLite database (`data/spotify.db`), run the sync helper script to transfer all records to Postgres cleanly without duplicates:

```bash
python scripts/sync_sqlite_to_pg.py --sqlite data/spotify.db --postgres "postgresql://<user>:<password>@<host>:5432/<dbname>?sslmode=require"
```

The script:
1. Automatically applies the PostgreSQL DDL schema (`artists`, `albums`, `tracks`, `track_artists`, `plays`).
2. Copies entities in relational dependency order (`artists` -> `albums` -> `tracks` -> `track_artists` -> `plays`).
3. Uses `ON CONFLICT DO NOTHING` / `ON CONFLICT DO UPDATE` so you can safely re-run it at any time.

### 3. GitHub Actions Polling Setup

The workflow at `.github/workflows/poll-spotify.yml` runs every 10 minutes (and supports manual triggers via `workflow_dispatch`). It fetches recent plays and writes them directly to your hosted Postgres database.

#### Configure GitHub Secrets
In your GitHub repository, navigate to **Settings** > **Secrets and variables** > **Actions** and add the following repository secrets:

| Secret Name | Value Description |
| ----------- | ----------------- |
| `SPOTIFY_CLIENT_ID` | Your Spotify Developer App Client ID |
| `SPOTIFY_CLIENT_SECRET` | Your Spotify Developer App Client Secret |
| `SPOTIFY_REFRESH_TOKEN` | Refresh token generated via `python scripts/auth_bootstrap.py` |
| `DATABASE_URL` | Your hosted PostgreSQL connection URL |

> **Security Guardrail:** GitHub Actions workflows never print or expose secrets in build logs. The poller runs securely in isolated Ubuntu runners.

### 4. Deploying the Dashboard to Vercel

The Next.js application in `web/` is strictly read-only and requires **zero Spotify OAuth credentials** in production:

1. Import your GitHub repository into [Vercel](https://vercel.com).
2. Set the **Root Directory** to `web`.
3. In **Environment Variables**, add:
   - `DATABASE_URL`: Your hosted PostgreSQL connection string (`postgresql://...`).
4. Click **Deploy**.

Vercel will build and deploy the Next.js application. Dynamic server rendering queries your hosted Postgres directly using connection pooling with SSL encryption.

---

## Local Development Quickstart

### Python Environment & Ingestion
```bash
python -m venv .venv
source .venv/bin/activate  # Or on Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
```

### Initializing the Database
```bash
# SQLite (default):
python scripts/init_db.py

# Or target PostgreSQL:
DATABASE_URL="postgresql://user:pass@host:5432/db" python scripts/init_db.py
```

### Historical Backfill
```bash
# Backfill Extended History or Account Data JSON files
python scripts/backfill_export.py data/
```

### Manual Poller Run
```bash
python scripts/poll_recent.py
```

### Running the Web Dashboard Locally
```bash
cd web
npm install
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000).

---

## Testing

Run the test suite:
```bash
pytest
```
