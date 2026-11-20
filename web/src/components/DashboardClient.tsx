"use client";

import { useEffect, useState, useTransition } from "react";
import { DashboardData, DatePreset } from "@/lib/queries";
import { FilterBar } from "@/components/FilterBar";
import { KpiCards } from "@/components/KpiCards";
import { TopSections } from "@/components/TopSections";
import { ListeningCharts } from "@/components/ListeningCharts";
import { RecentPlaysFeed } from "@/components/RecentPlaysFeed";
import { Disc3, Loader2, Database } from "lucide-react";

interface DashboardClientProps {
  initialData: DashboardData;
}

export function DashboardClient({ initialData }: DashboardClientProps) {
  const [data, setData] = useState<DashboardData>(initialData);
  const [isPending, startTransition] = useTransition();
  const [currentPreset, setCurrentPreset] = useState<DatePreset>(initialData.filter.preset || "all");
  const [startDate, setStartDate] = useState<string>(initialData.filter.startDate || "");
  const [endDate, setEndDate] = useState<string>(initialData.filter.endDate || "");
  const [minSeconds, setMinSeconds] = useState<number>(
    initialData.filter.minMsPlayed ? Math.round(initialData.filter.minMsPlayed / 1000) : 30
  );

  const fetchUpdatedStats = (params: {
    preset: DatePreset;
    startDate: string;
    endDate: string;
    minSeconds: number;
  }) => {
    setCurrentPreset(params.preset);
    setStartDate(params.startDate);
    setEndDate(params.endDate);
    setMinSeconds(params.minSeconds);

    startTransition(async () => {
      try {
        const queryParams = new URLSearchParams({
          preset: params.preset,
          minMsPlayed: (params.minSeconds * 1000).toString(),
        });
        if (params.preset === "custom") {
          if (params.startDate) queryParams.set("startDate", params.startDate);
          if (params.endDate) queryParams.set("endDate", params.endDate);
        }

        const res = await fetch(`/api/stats?${queryParams.toString()}`);
        if (res.ok) {
          const freshData: DashboardData = await res.json();
          setData(freshData);
        }
      } catch (err) {
        console.error("Failed to load stats:", err);
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Top Filter Controls */}
      <FilterBar
        currentPreset={currentPreset}
        startDate={startDate}
        endDate={endDate}
        minSeconds={minSeconds}
        onFilterChange={fetchUpdatedStats}
      />

      {/* Loading overlay indicator */}
      {isPending && (
        <div className="flex items-center justify-center gap-2 py-2 text-xs text-[#1ed760] animate-pulse">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Updating metrics...</span>
        </div>
      )}

      {/* Empty State / Graceful degradation */}
      {!data.hasData || data.kpis.rawPlaysCount === 0 ? (
        <div className="bg-[#121212] border border-[#262626] rounded-3xl p-12 text-center max-w-lg mx-auto shadow-2xl my-8">
          <div className="w-16 h-16 rounded-full bg-[#1e1e1e] flex items-center justify-center mx-auto mb-4 border border-[#333]">
            <Database className="w-8 h-8 text-[#1ed760]" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">No Listening History Found</h2>
          <p className="text-sm text-[#8e8e8e] mb-6 leading-relaxed">
            The database currently has no recorded plays matching your selected criteria.
            Backfill your historical files or launch the poller to populate your dashboard!
          </p>
          <div className="bg-[#181818] border border-[#2b2b2b] rounded-xl p-3.5 text-xs font-mono text-[#a0a0a0] text-left">
            <span className="text-[#1ed760] font-bold"># Quick command:</span>
            <br />
            python scripts/poll_recent.py
          </div>
        </div>
      ) : (
        <>
          {/* KPI Summary Cards */}
          <KpiCards kpis={data.kpis} minSeconds={minSeconds} />

          {/* Listening Volume & Heatmap Matrix */}
          <ListeningCharts daily={data.dailyListening} heatmap={data.heatmap} />

          {/* Top Rankings: Artists, Tracks, Albums */}
          <TopSections
            artists={data.topArtists}
            tracks={data.topTracks}
            albums={data.topAlbums}
          />

          {/* Live Recent Plays Table */}
          <RecentPlaysFeed plays={data.recentPlays} />
        </>
      )}
    </div>
  );
}
