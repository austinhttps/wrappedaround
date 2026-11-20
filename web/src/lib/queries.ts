import { getDb } from "./db";

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
      // Set end date to end of that day if user provided YYYY-MM-DD
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

export function getDashboardData(filter: AnalyticsFilter = {}): DashboardData {
  const db = getDb();
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

  if (!db) {
    return emptyResult;
  }

  try {
    const { sql: whereClause, params } = buildWhereClause(startIso, endIso, "p");

    // 1. KPI Summary
    const kpiRow = db.prepare(`
      SELECT 
        COALESCE(SUM(p.ms_played), 0) AS total_ms,
        COUNT(*) AS raw_plays,
        COALESCE(SUM(CASE WHEN p.ms_played >= ? THEN 1 ELSE 0 END), 0) AS counted_streams,
        COUNT(DISTINCT p.track_id) AS unique_tracks,
        COUNT(DISTINCT ta.artist_id) AS unique_artists
      FROM plays p
      LEFT JOIN track_artists ta ON p.track_id = ta.track_id
      ${whereClause}
    `).get(minMs, ...params) as {
      total_ms: number;
      raw_plays: number;
      counted_streams: number;
      unique_tracks: number;
      unique_artists: number;
    } | undefined;

    const rawPlaysCount = kpiRow?.raw_plays ?? 0;
    if (rawPlaysCount === 0) {
      return emptyResult;
    }

    const totalMsPlayed = kpiRow?.total_ms ?? 0;
    const totalMinutes = Math.round(totalMsPlayed / 60000);
    const totalHours = Math.round((totalMinutes / 60) * 10) / 10;
    const countedStreams = kpiRow?.counted_streams ?? 0;
    const uniqueTracks = kpiRow?.unique_tracks ?? 0;
    const uniqueArtists = kpiRow?.unique_artists ?? 0;

    // 2. Streaks calculation (across all days matching criteria, or all time plays)
    // We compute streaks based on distinct dates in UTC where plays occurred
    const activeDates = db.prepare(`
      SELECT DISTINCT substr(p.played_at, 1, 10) AS play_date
      FROM plays p
      ${whereClause}
      ORDER BY play_date ASC
    `).all(...params) as { play_date: string }[];

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

      // Check current streak from today or yesterday
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
    const topArtistsRaw = db.prepare(`
      SELECT 
        a.id,
        a.name,
        COUNT(p.id) AS raw_plays,
        SUM(CASE WHEN p.ms_played >= ? THEN 1 ELSE 0 END) AS counted_streams,
        COALESCE(SUM(p.ms_played), 0) AS total_ms,
        (
          SELECT al.image_url 
          FROM plays p2
          JOIN tracks t2 ON p2.track_id = t2.id
          JOIN albums al ON t2.album_id = al.id
          JOIN track_artists ta2 ON t2.id = ta2.track_id
          WHERE ta2.artist_id = a.id AND al.image_url IS NOT NULL
          ORDER BY p2.played_at DESC LIMIT 1
        ) AS image_url
      FROM plays p
      JOIN track_artists ta ON p.track_id = ta.track_id
      JOIN artists a ON ta.artist_id = a.id
      ${whereClause}
      GROUP BY a.id, a.name
      ORDER BY counted_streams DESC, total_ms DESC
      LIMIT 10
    `).all(minMs, ...params) as Array<{
      id: string;
      name: string;
      raw_plays: number;
      counted_streams: number;
      total_ms: number;
      image_url: string | null;
    }>;

    const topArtists: RankedArtist[] = topArtistsRaw.map((a) => ({
      id: a.id,
      name: a.name,
      countedStreams: a.counted_streams,
      totalMs: a.total_ms,
      totalMinutes: Math.round(a.total_ms / 60000),
      imageUrl: a.image_url,
    }));

    // 4. Top Tracks
    const topTracksRaw = db.prepare(`
      SELECT 
        t.id,
        t.name,
        COALESCE(GROUP_CONCAT(DISTINCT a.name), 'Unknown Artist') AS artist_names,
        COALESCE(al.name, 'Unknown Album') AS album_name,
        al.image_url AS album_image_url,
        t.duration_ms,
        COUNT(p.id) AS raw_plays,
        SUM(CASE WHEN p.ms_played >= ? THEN 1 ELSE 0 END) AS counted_streams,
        COALESCE(SUM(p.ms_played), 0) AS total_ms
      FROM plays p
      JOIN tracks t ON p.track_id = t.id
      LEFT JOIN albums al ON t.album_id = al.id
      LEFT JOIN track_artists ta ON t.id = ta.track_id
      LEFT JOIN artists a ON ta.artist_id = a.id
      ${whereClause}
      GROUP BY t.id, t.name, al.name, al.image_url, t.duration_ms
      ORDER BY counted_streams DESC, total_ms DESC
      LIMIT 10
    `).all(minMs, ...params) as Array<{
      id: string;
      name: string;
      artist_names: string;
      album_name: string;
      album_image_url: string | null;
      duration_ms: number | null;
      raw_plays: number;
      counted_streams: number;
      total_ms: number;
    }>;

    const topTracks: RankedTrack[] = topTracksRaw.map((t) => ({
      id: t.id,
      name: t.name,
      artistNames: t.artist_names,
      albumName: t.album_name,
      albumImageUrl: t.album_image_url,
      countedStreams: t.counted_streams,
      totalMs: t.total_ms,
      totalMinutes: Math.round(t.total_ms / 60000),
      durationMs: t.duration_ms,
    }));

    // 5. Top Albums
    const topAlbumsRaw = db.prepare(`
      SELECT 
        al.id,
        al.name,
        al.image_url AS album_image_url,
        COALESCE(GROUP_CONCAT(DISTINCT a.name), 'Unknown Artist') AS artist_names,
        COUNT(p.id) AS raw_plays,
        SUM(CASE WHEN p.ms_played >= ? THEN 1 ELSE 0 END) AS counted_streams,
        COALESCE(SUM(p.ms_played), 0) AS total_ms
      FROM plays p
      JOIN tracks t ON p.track_id = t.id
      JOIN albums al ON t.album_id = al.id
      LEFT JOIN track_artists ta ON t.id = ta.track_id
      LEFT JOIN artists a ON ta.artist_id = a.id
      ${whereClause}
      GROUP BY al.id, al.name, al.image_url
      ORDER BY counted_streams DESC, total_ms DESC
      LIMIT 10
    `).all(minMs, ...params) as Array<{
      id: string;
      name: string;
      album_image_url: string | null;
      artist_names: string;
      raw_plays: number;
      counted_streams: number;
      total_ms: number;
    }>;

    const topAlbums: RankedAlbum[] = topAlbumsRaw.map((al) => ({
      id: al.id,
      name: al.name,
      artistNames: al.artist_names,
      albumImageUrl: al.album_image_url,
      countedStreams: al.counted_streams,
      totalMs: al.total_ms,
      totalMinutes: Math.round(al.total_ms / 60000),
    }));

    // 6. Daily Listening Volume Over Time
    const dailyListeningRaw = db.prepare(`
      SELECT 
        substr(p.played_at, 1, 10) AS date_str,
        COALESCE(SUM(p.ms_played), 0) AS day_ms,
        SUM(CASE WHEN p.ms_played >= ? THEN 1 ELSE 0 END) AS day_streams
      FROM plays p
      ${whereClause}
      GROUP BY date_str
      ORDER BY date_str ASC
    `).all(minMs, ...params) as Array<{
      date_str: string;
      day_ms: number;
      day_streams: number;
    }>;

    const dailyListening: DailyListening[] = dailyListeningRaw.map((d) => ({
      date: d.date_str,
      minutes: Math.round(d.day_ms / 60000),
      countedStreams: d.day_streams,
    }));

    // 7. Listening Clock Heatmap (Hour of Day 0-23 x Day of Week 0-6)
    // SQLite strftime('%w', played_at) returns 0 (Sunday) to 6 (Saturday)
    // strftime('%H', played_at) returns '00' to '23'
    const heatmapRaw = db.prepare(`
      SELECT 
        CAST(strftime('%w', p.played_at) AS INTEGER) AS day_of_week,
        CAST(strftime('%H', p.played_at) AS INTEGER) AS hour_of_day,
        COUNT(*) AS stream_count,
        COALESCE(SUM(p.ms_played), 0) AS total_ms
      FROM plays p
      ${whereClause}
      GROUP BY day_of_week, hour_of_day
    `).all(...params) as Array<{
      day_of_week: number;
      hour_of_day: number;
      stream_count: number;
      total_ms: number;
    }>;

    // Fill a complete 7 x 24 matrix so the UI heatmap is regular
    const heatmapGrid: HeatmapCell[] = [];
    const heatmapLookup = new Map<string, { streamCount: number; minutes: number }>();
    for (const h of heatmapRaw) {
      heatmapLookup.set(`${h.day_of_week}-${h.hour_of_day}`, {
        streamCount: h.stream_count,
        minutes: Math.round(h.total_ms / 60000),
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
    const recentPlaysRaw = db.prepare(`
      SELECT 
        p.id,
        p.track_id,
        t.name AS track_name,
        COALESCE(GROUP_CONCAT(DISTINCT a.name), 'Unknown Artist') AS artist_names,
        COALESCE(al.name, 'Unknown Album') AS album_name,
        al.image_url AS album_image_url,
        p.played_at,
        p.ms_played,
        t.duration_ms,
        p.source
      FROM plays p
      JOIN tracks t ON p.track_id = t.id
      LEFT JOIN albums al ON t.album_id = al.id
      LEFT JOIN track_artists ta ON t.id = ta.track_id
      LEFT JOIN artists a ON ta.artist_id = a.id
      ${whereClause}
      GROUP BY p.id, p.track_id, t.name, al.name, al.image_url, p.played_at, p.ms_played, t.duration_ms, p.source
      ORDER BY p.played_at DESC
      LIMIT 25
    `).all(...params) as Array<{
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
    }>;

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
