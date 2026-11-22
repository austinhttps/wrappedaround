import { query, queryOne, isPostgres } from "./db";

export type DatePreset = "7d" | "30d" | "6m" | "1y" | "all" | "custom";
export type RankMetric = "streams" | "minutes";

export interface AnalyticsFilter {
  preset?: DatePreset;
  startDate?: string; // YYYY-MM-DD or ISO
  endDate?: string;   // YYYY-MM-DD or ISO
  minMsPlayed?: number; // default 30000 ms for counted streams
}

export interface KpiSummary {
  totalMsPlayed: number;
  totalMinutes: number;
  totalHours: number;
  countedStreams: number;
  rawPlaysCount: number;
  uniqueTracks: number;
  uniqueArtists: number;
  currentStreakDays: number;
  longestStreakDays: number;
}

export interface RankedArtist {
  id: string;
  name: string;
  countedStreams: number;
  totalMs: number;
  totalMinutes: number;
  imageUrl?: string | null;
}

export interface RankedTrack {
  id: string;
  name: string;
  artistNames: string;
  albumName: string;
  albumImageUrl: string | null;
  countedStreams: number;
  totalMs: number;
  totalMinutes: number;
  durationMs: number | null;
}

export interface RankedAlbum {
  id: string;
  name: string;
  artistNames: string;
  albumImageUrl: string | null;
  countedStreams: number;
  totalMs: number;
  totalMinutes: number;
}

export interface DailyListening {
  date: string; // YYYY-MM-DD
  minutes: number;
  countedStreams: number;
}

export interface HeatmapCell {
  dayOfWeek: number; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  hourOfDay: number; // 0 to 23
  streamCount: number;
  minutes: number;
}

export interface RecentPlay {
  id: number;
  trackId: string;
  trackName: string;
  artistNames: string;
  albumName: string;
  albumImageUrl: string | null;
  playedAt: string;
  msPlayed: number;
  durationMs: number | null;
  source: string; // 'poller' or 'export'
}

export interface DashboardData {
  filter: AnalyticsFilter;
  kpis: KpiSummary;
  topArtists: RankedArtist[];
  topTracks: RankedTrack[];
  topAlbums: RankedAlbum[];
  dailyListening: DailyListening[];
  heatmap: HeatmapCell[];
  recentPlays: RecentPlay[];
  hasData: boolean;
}

function resolveDateRange(filter: AnalyticsFilter): { startIso: string | null; endIso: string | null } {
  const preset = filter.preset || "all";
  if (preset === "all") {
    return { startIso: null, endIso: null };
  }

  const now = new Date();
  let start: Date | null = null;
  let end: Date | null = new Date(now.getTime());

  if (preset === "7d") {
    start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (preset === "30d") {
    start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  } else if (preset === "6m") {
    start = new Date(now.getTime() - 182 * 24 * 60 * 60 * 1000);
  } else if (preset === "1y") {
    start = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  } else if (preset === "custom") {
    if (filter.startDate) {
      start = new Date(filter.startDate);
    }
    if (filter.endDate) {
      const parsedEnd = new Date(filter.endDate);
      if (filter.endDate.length <= 10) {
        parsedEnd.setHours(23, 59, 59, 999);
      }
      end = parsedEnd;
    }
  }

  return {
    startIso: start ? start.toISOString() : null,
    endIso: end ? end.toISOString() : null,
  };
}

function buildWhereClause(startIso: string | null, endIso: string | null, tablePrefix = "p"): { sql: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (startIso) {
    conditions.push(`${tablePrefix}.played_at >= ?`);
    params.push(startIso);
  }
  if (endIso) {
    conditions.push(`${tablePrefix}.played_at <= ?`);
    params.push(endIso);
  }

  const sql = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
  return { sql, params };
}

export async function getDashboardData(filter: AnalyticsFilter = {}): Promise<DashboardData> {
  const minMs = filter.minMsPlayed ?? 30000;
  const { startIso, endIso } = resolveDateRange(filter);

  const emptyResult: DashboardData = {
    filter,
    kpis: {
      totalMsPlayed: 0,
      totalMinutes: 0,
      totalHours: 0,
      countedStreams: 0,
      rawPlaysCount: 0,
      uniqueTracks: 0,
      uniqueArtists: 0,
      currentStreakDays: 0,
      longestStreakDays: 0,
    },
    topArtists: [],
    topTracks: [],
    topAlbums: [],
    dailyListening: [],
    heatmap: [],
    recentPlays: [],
    hasData: false,
  };

  try {
    const { sql: whereClause, params } = buildWhereClause(startIso, endIso, "p");
    const { sql: subWhereClause } = buildWhereClause(startIso, endIso, "p_sub");
    const usePostgres = isPostgres();

    // 1. KPI Summary
    // Avoid JOINing track_artists before aggregating ms_played and counts to prevent cartesian explosion
    const kpiRow = await queryOne<{
      total_ms: number | string;
      raw_plays: number | string;
      counted_streams: number | string;
      unique_tracks: number | string;
      unique_artists: number | string;
    }>(
      `
      SELECT 
        COALESCE(SUM(p.ms_played), 0) AS total_ms,
        COUNT(*) AS raw_plays,
        COALESCE(SUM(CASE WHEN p.ms_played >= ? THEN 1 ELSE 0 END), 0) AS counted_streams,
        COUNT(DISTINCT p.track_id) AS unique_tracks,
        (
          SELECT COUNT(DISTINCT ta.artist_id)
          FROM track_artists ta
          WHERE ta.track_id IN (
            SELECT p_sub.track_id FROM plays p_sub ${subWhereClause}
          )
        ) AS unique_artists
      FROM plays p
      ${whereClause}
      `,
      [minMs, ...params, ...params]
    );

    const rawPlaysCount = Number(kpiRow?.raw_plays ?? 0);
    if (!kpiRow || rawPlaysCount === 0) {
      return emptyResult;
    }

    const totalMsPlayed = Number(kpiRow.total_ms || 0);
    const totalMinutes = Math.round(totalMsPlayed / 60000);
    const totalHours = Math.round((totalMsPlayed / 3600000) * 10) / 10;
    const countedStreams = Number(kpiRow.counted_streams || 0);
    const uniqueTracks = Number(kpiRow.unique_tracks || 0);
    const uniqueArtists = Number(kpiRow.unique_artists || 0);

    // 2. Streaks calculation
    const activeDates = await query<{ play_date: string }>(
      `
      SELECT DISTINCT substr(p.played_at, 1, 10) AS play_date
      FROM plays p
      ${whereClause}
      ORDER BY play_date ASC
      `,
      params
    );

    let currentStreakDays = 0;
    let longestStreakDays = 0;

    if (activeDates.length > 0) {
      const dateSet = new Set(activeDates.map((r) => r.play_date));
      let currentSeq = 0;
      let prevDate: Date | null = null;

      for (const row of activeDates) {
        const d = new Date(row.play_date + "T00:00:00Z");
        if (prevDate) {
          const diffDays = Math.round((d.getTime() - prevDate.getTime()) / (1000 * 3600 * 24));
          if (diffDays === 1) {
            currentSeq++;
          } else {
            currentSeq = 1;
          }
        } else {
          currentSeq = 1;
        }
        prevDate = d;
        if (currentSeq > longestStreakDays) {
          longestStreakDays = currentSeq;
        }
      }

      const todayIso = new Date().toISOString().substring(0, 10);
      const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString().substring(0, 10);

      let checkDateStr = dateSet.has(todayIso) ? todayIso : dateSet.has(yesterday) ? yesterday : null;
      if (checkDateStr) {
        let cursor = new Date(checkDateStr + "T00:00:00Z");
        while (dateSet.has(cursor.toISOString().substring(0, 10))) {
          currentStreakDays++;
          cursor = new Date(cursor.getTime() - 24 * 3600 * 1000);
        }
      }
    }

    // 3. Top Artists (Ranked by counted streams, then ms_played)
    // Aggregated per normalized artist name (dap.artist_key) and deduplicating play IDs to avoid duplicate artist entries
    // (e.g. ext_artist:name vs spotify_id appearing at #1 and #2) and avoid cartesian duplication when a track links to multiple artist rows
    const topArtistsRaw = await query<{
      id: string;
      name: string;
      raw_plays: number | string;
      counted_streams: number | string;
      total_ms: number | string;
      image_url: string | null;
    }>(
      `
      WITH distinct_artist_plays AS (
        SELECT 
          LOWER(TRIM(a.name)) AS artist_key,
          p.id AS play_id,
          p.ms_played,
          p.played_at
        FROM plays p
        JOIN track_artists ta ON p.track_id = ta.track_id
        JOIN artists a ON ta.artist_id = a.id
        ${whereClause}
        GROUP BY LOWER(TRIM(a.name)), p.id, p.ms_played, p.played_at
      )
      SELECT 
        (
          SELECT a2.id FROM artists a2 
          WHERE LOWER(TRIM(a2.name)) = dap.artist_key 
          ORDER BY CASE WHEN a2.id NOT LIKE 'ext_artist:%' THEN 0 ELSE 1 END, a2.id LIMIT 1
        ) AS id,
        (
          SELECT a2.name FROM artists a2 
          WHERE LOWER(TRIM(a2.name)) = dap.artist_key 
          ORDER BY CASE WHEN a2.id NOT LIKE 'ext_artist:%' THEN 0 ELSE 1 END, a2.id LIMIT 1
        ) AS name,
        COUNT(dap.play_id) AS raw_plays,
        SUM(CASE WHEN dap.ms_played >= ? THEN 1 ELSE 0 END) AS counted_streams,
        COALESCE(SUM(dap.ms_played), 0) AS total_ms,
        (
          SELECT al.image_url 
          FROM plays p2
          JOIN tracks t2 ON p2.track_id = t2.id
          JOIN albums al ON t2.album_id = al.id
          JOIN track_artists ta2 ON t2.id = ta2.track_id
          JOIN artists a2 ON ta2.artist_id = a2.id
          WHERE LOWER(TRIM(a2.name)) = dap.artist_key AND al.image_url IS NOT NULL
          ORDER BY p2.played_at DESC LIMIT 1
        ) AS image_url
      FROM distinct_artist_plays dap
      GROUP BY dap.artist_key
      ORDER BY counted_streams DESC, total_ms DESC
      LIMIT 10
      `,
      [...params, minMs]
    );

    const topArtists: RankedArtist[] = topArtistsRaw.map((a) => {
      const ms = Number(a.total_ms || 0);
      return {
        id: a.id,
        name: a.name,
        countedStreams: Number(a.counted_streams || 0),
        totalMs: ms,
        totalMinutes: Math.round(ms / 60000),
        imageUrl: a.image_url,
      };
    });

    // 4. Top Tracks (Dialect distinction for string concatenation)
    // Group by track id and album to prevent duplicate plays, pulling distinct artist names cleanly
    const stringAggArtistNames = usePostgres
      ? "COALESCE((SELECT STRING_AGG(DISTINCT a_sub.name, ', ') FROM track_artists ta_sub JOIN artists a_sub ON ta_sub.artist_id = a_sub.id WHERE ta_sub.track_id = t.id), 'Unknown Artist')"
      : "COALESCE((SELECT GROUP_CONCAT(DISTINCT a_sub.name) FROM track_artists ta_sub JOIN artists a_sub ON ta_sub.artist_id = a_sub.id WHERE ta_sub.track_id = t.id), 'Unknown Artist')";

    const topTracksRaw = await query<{
      id: string;
      name: string;
      artist_names: string;
      album_name: string;
      album_image_url: string | null;
      duration_ms: number | null;
      raw_plays: number | string;
      counted_streams: number | string;
      total_ms: number | string;
    }>(
      `
      SELECT 
        t.id,
        t.name,
        ${stringAggArtistNames} AS artist_names,
        COALESCE(al.name, 'Unknown Album') AS album_name,
        al.image_url AS album_image_url,
        t.duration_ms,
        COUNT(p.id) AS raw_plays,
        SUM(CASE WHEN p.ms_played >= ? THEN 1 ELSE 0 END) AS counted_streams,
        COALESCE(SUM(p.ms_played), 0) AS total_ms
      FROM plays p
      JOIN tracks t ON p.track_id = t.id
      LEFT JOIN albums al ON t.album_id = al.id
      ${whereClause}
      GROUP BY t.id, t.name, al.name, al.image_url, t.duration_ms
      ORDER BY counted_streams DESC, total_ms DESC
      LIMIT 10
      `,
      [minMs, ...params]
    );

    const topTracks: RankedTrack[] = topTracksRaw.map((t) => {
      const ms = Number(t.total_ms || 0);
      return {
        id: t.id,
        name: t.name,
        artistNames: t.artist_names,
        albumName: t.album_name,
        albumImageUrl: t.album_image_url,
        countedStreams: Number(t.counted_streams || 0),
        totalMs: ms,
        totalMinutes: Math.round(ms / 60000),
        durationMs: t.duration_ms,
      };
    });

    // 5. Top Albums
    const albumArtistNames = usePostgres
      ? "COALESCE((SELECT STRING_AGG(DISTINCT a_sub.name, ', ') FROM tracks t_sub JOIN track_artists ta_sub ON t_sub.id = ta_sub.track_id JOIN artists a_sub ON ta_sub.artist_id = a_sub.id WHERE t_sub.album_id = al.id), 'Unknown Artist')"
      : "COALESCE((SELECT GROUP_CONCAT(DISTINCT a_sub.name) FROM tracks t_sub JOIN track_artists ta_sub ON t_sub.id = ta_sub.track_id JOIN artists a_sub ON ta_sub.artist_id = a_sub.id WHERE t_sub.album_id = al.id), 'Unknown Artist')";

    const topAlbumsRaw = await query<{
      id: string;
      name: string;
      album_image_url: string | null;
      artist_names: string;
      raw_plays: number | string;
      counted_streams: number | string;
      total_ms: number | string;
    }>(
      `
      SELECT 
        al.id,
        al.name,
        al.image_url AS album_image_url,
        ${albumArtistNames} AS artist_names,
        COUNT(p.id) AS raw_plays,
        SUM(CASE WHEN p.ms_played >= ? THEN 1 ELSE 0 END) AS counted_streams,
        COALESCE(SUM(p.ms_played), 0) AS total_ms
      FROM plays p
      JOIN tracks t ON p.track_id = t.id
      JOIN albums al ON t.album_id = al.id
      ${whereClause}
      GROUP BY al.id, al.name, al.image_url
      ORDER BY counted_streams DESC, total_ms DESC
      LIMIT 10
      `,
      [minMs, ...params]
    );

    const topAlbums: RankedAlbum[] = topAlbumsRaw.map((al) => {
      const ms = Number(al.total_ms || 0);
      return {
        id: al.id,
        name: al.name,
        artistNames: al.artist_names,
        albumImageUrl: al.album_image_url,
        countedStreams: Number(al.counted_streams || 0),
        totalMs: ms,
        totalMinutes: Math.round(ms / 60000),
      };
    });

    // 6. Daily Listening Volume Over Time
    const dailyListeningRaw = await query<{
      date_str: string;
      day_ms: number | string;
      day_streams: number | string;
    }>(
      `
      SELECT 
        substr(p.played_at, 1, 10) AS date_str,
        COALESCE(SUM(p.ms_played), 0) AS day_ms,
        SUM(CASE WHEN p.ms_played >= ? THEN 1 ELSE 0 END) AS day_streams
      FROM plays p
      ${whereClause}
      GROUP BY date_str
      ORDER BY date_str ASC
      `,
      [minMs, ...params]
    );

    const dailyListening: DailyListening[] = dailyListeningRaw.map((d) => ({
      date: d.date_str,
      minutes: Math.round(Number(d.day_ms || 0) / 60000),
      countedStreams: Number(d.day_streams || 0),
    }));

    // 7. Listening Clock Heatmap (Hour of Day 0-23 x Day of Week 0-6)
    // In SQLite: strftime('%w', p.played_at) is 0 (Sunday) to 6 (Saturday), strftime('%H', p.played_at) is 00-23
    // In PostgreSQL: EXTRACT(DOW FROM p.played_at::timestamptz) is 0 (Sunday) to 6 (Saturday), EXTRACT(HOUR FROM p.played_at::timestamptz) is 0-23
    const dowExpression = usePostgres
      ? "CAST(EXTRACT(DOW FROM p.played_at::timestamptz) AS INTEGER)"
      : "CAST(strftime('%w', p.played_at) AS INTEGER)";

    const hourExpression = usePostgres
      ? "CAST(EXTRACT(HOUR FROM p.played_at::timestamptz) AS INTEGER)"
      : "CAST(strftime('%H', p.played_at) AS INTEGER)";

    const heatmapRaw = await query<{
      day_of_week: number;
      hour_of_day: number;
      stream_count: number | string;
      total_ms: number | string;
    }>(
      `
      SELECT 
        ${dowExpression} AS day_of_week,
        ${hourExpression} AS hour_of_day,
        COUNT(*) AS stream_count,
        COALESCE(SUM(p.ms_played), 0) AS total_ms
      FROM plays p
      ${whereClause}
      GROUP BY day_of_week, hour_of_day
      `,
      params
    );

    const heatmapGrid: HeatmapCell[] = [];
    const heatmapLookup = new Map<string, { streamCount: number; minutes: number }>();
    for (const h of heatmapRaw) {
      heatmapLookup.set(`${h.day_of_week}-${h.hour_of_day}`, {
        streamCount: Number(h.stream_count || 0),
        minutes: Math.round(Number(h.total_ms || 0) / 60000),
      });
    }

    for (let day = 0; day < 7; day++) {
      for (let hour = 0; hour < 24; hour++) {
        const entry = heatmapLookup.get(`${day}-${hour}`);
        heatmapGrid.push({
          dayOfWeek: day,
          hourOfDay: hour,
          streamCount: entry ? entry.streamCount : 0,
          minutes: entry ? entry.minutes : 0,
        });
      }
    }

    // 8. Recent Plays Feed
    const recentPlaysRaw = await query<{
      id: number;
      track_id: string;
      track_name: string;
      artist_names: string;
      album_name: string;
      album_image_url: string | null;
      played_at: string;
      ms_played: number;
      duration_ms: number | null;
      source: string;
    }>(
      `
      SELECT 
        p.id,
        p.track_id,
        t.name AS track_name,
        ${stringAggArtistNames} AS artist_names,
        COALESCE(al.name, 'Unknown Album') AS album_name,
        al.image_url AS album_image_url,
        p.played_at,
        p.ms_played,
        t.duration_ms,
        p.source
      FROM plays p
      JOIN tracks t ON p.track_id = t.id
      LEFT JOIN albums al ON t.album_id = al.id
      ${whereClause}
      ORDER BY p.played_at DESC
      LIMIT 25
      `,
      params
    );

    const recentPlays: RecentPlay[] = recentPlaysRaw.map((rp) => ({
      id: rp.id,
      trackId: rp.track_id,
      trackName: rp.track_name,
      artistNames: rp.artist_names,
      albumName: rp.album_name,
      albumImageUrl: rp.album_image_url,
      playedAt: rp.played_at,
      msPlayed: rp.ms_played,
      durationMs: rp.duration_ms,
      source: rp.source,
    }));

    return {
      filter,
      kpis: {
        totalMsPlayed,
        totalMinutes,
        totalHours,
        countedStreams,
        rawPlaysCount,
        uniqueTracks,
        uniqueArtists,
        currentStreakDays,
        longestStreakDays,
      },
      topArtists,
      topTracks,
      topAlbums,
      dailyListening,
      heatmap: heatmapGrid,
      recentPlays,
      hasData: true,
    };
  } catch (err) {
    console.error("[queries] Error executing analytics query:", err);
    return emptyResult;
  }
}
