# Personal Spotify Stats Tracker

Single-user personal listening analytics platform modeled after stats.fm.
- **Ingestion (`scripts/`):** Python CLI tools for one-time OAuth setup, historical backfill, and scheduled polling.
- **Database (`db/`):** SQLite (`data/spotify.db`) or PostgreSQL via `DATABASE_URL`.
- **Dashboard (`web/`):** Next.js (App Router + TypeScript + Tailwind CSS) read-only analytics dashboard.

---

## Phase 2: Read-Only Analytics Dashboard (`web/`)

The dashboard is strictly read-only: it connects directly to `data/spotify.db` or `DATABASE_URL` and never initiates Spotify API mutations or writes to the database.

### Features
- **Configurable Counted Stream Threshold:** Default `30s` threshold matching standard streaming metrics, alongside raw listening time in minutes and hours.
- **Date Presets & Custom Filter:** Quick-select `7d`, `30d`, `6m`, `1y`, `All Time`, plus custom start/end date range inputs.
- **KPI Summary Cards:** Total Minutes/Hours Streamed, Counted Streams, Unique Tracks, Unique Artists, and Current & Longest Daily Listening Streak.
- **Top Rankings:** Top 10 Artists, Tracks, and Albums with album artwork, sortable by stream count or total minutes played.
- **Listening Visualizations:**
  - Daily Listening Volume over time.
  - 7 × 24 Hour-of-Day × Day-of-Week Listening Clock Heatmap with interactive stream count tooltips.
- **Live Recent Plays Feed:** Feed of latest playback items showing track, artist, album, duration, played timestamp, and source tag (`export` vs `poller`).
- **Resilient Empty State:** Graceful fallback UI when `data/spotify.db` is empty or still backfilling.

### Running the Dashboard

```bash
cd web
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

#### Environment Variables (Optional)
By default, the dashboard looks for `../data/spotify.db` or `./data/spotify.db`. You can optionally specify a custom path or PostgreSQL URL:
```bash
DATABASE_URL=../data/spotify.db npm run dev
```
