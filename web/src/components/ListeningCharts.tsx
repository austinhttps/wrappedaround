"use client";

import { DailyListening, HeatmapCell } from "@/lib/queries";
import { BarChart3, Clock3 } from "lucide-react";

interface ListeningChartsProps {
  daily: DailyListening[];
  heatmap: HeatmapCell[];
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function ListeningCharts({ daily, heatmap }: ListeningChartsProps) {
  // Compute max for scaling daily chart
  const maxDailyMinutes = Math.max(...daily.map((d) => d.minutes), 1);
  const maxHeatmapStreams = Math.max(...heatmap.map((h) => h.streamCount), 1);

  const getHeatmapColor = (streams: number) => {
    if (streams === 0) return "bg-[#181818] border border-[#222]";
    const ratio = streams / maxHeatmapStreams;
    if (ratio <= 0.25) return "bg-[#1ed760]/20 border border-[#1ed760]/30";
    if (ratio <= 0.5) return "bg-[#1ed760]/45 border border-[#1ed760]/55";
    if (ratio <= 0.75) return "bg-[#1ed760]/75 border border-[#1ed760]/85";
    return "bg-[#1ed760] text-black font-semibold";
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Daily Listening Volume */}
      <div className="bg-[#121212] border border-[#242424] rounded-2xl p-5 flex flex-col justify-between">
        <div className="flex items-center justify-between pb-3 border-b border-[#202020] mb-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-[#1ed760]" />
            <h3 className="font-bold text-white text-sm">Listening Volume Over Time</h3>
          </div>
          <span className="text-[11px] text-[#707070]">Minutes listened</span>
        </div>

        {daily.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-xs text-[#707070] italic">
            No daily volume data available.
          </div>
        ) : (
          <div className="space-y-2">
            <div className="h-48 flex items-end gap-1.5 pt-4 pb-1 overflow-x-auto">
              {daily.map((d) => {
                const heightPct = Math.max(Math.round((d.minutes / maxDailyMinutes) * 100), 4);
                return (
                  <div
                    key={d.date}
                    className="flex-1 min-w-[20px] max-w-[42px] flex flex-col items-center gap-1 group relative cursor-pointer"
                  >
                    {/* Tooltip on hover */}
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-10 bg-[#252525] text-white text-[10px] px-2 py-1 rounded shadow-lg pointer-events-none whitespace-nowrap z-20 border border-[#404040]">
                      {d.date}: {d.minutes}m ({d.countedStreams} streams)
                    </div>
                    <div className="w-full bg-[#1e1e1e] rounded-t-md h-full flex items-end overflow-hidden">
                      <div
                        style={{ height: `${heightPct}%` }}
                        className="w-full bg-gradient-to-t from-[#169c46] to-[#1ed760] rounded-t-sm group-hover:brightness-125 transition-all"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Axis labels */}
            <div className="flex justify-between text-[10px] text-[#606060] px-1 border-t border-[#1e1e1e] pt-1">
              <span>{daily[0]?.date}</span>
              <span>{daily[daily.length - 1]?.date}</span>
            </div>
          </div>
        )}
      </div>

      {/* Listening Clock Heatmap (Day × Hour) */}
      <div className="bg-[#121212] border border-[#242424] rounded-2xl p-5 flex flex-col justify-between">
        <div className="flex items-center justify-between pb-3 border-b border-[#202020] mb-4">
          <div className="flex items-center gap-2">
            <Clock3 className="w-4 h-4 text-[#1ed760]" />
            <h3 className="font-bold text-white text-sm">Listening Clock (Day × Hour)</h3>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-[#707070]">
            <span>Less</span>
            <span className="w-2.5 h-2.5 rounded-sm bg-[#181818] border border-[#333]" />
            <span className="w-2.5 h-2.5 rounded-sm bg-[#1ed760]/30" />
            <span className="w-2.5 h-2.5 rounded-sm bg-[#1ed760]/70" />
            <span className="w-2.5 h-2.5 rounded-sm bg-[#1ed760]" />
            <span>More</span>
          </div>
        </div>

        <div className="overflow-x-auto pb-1">
          <div className="min-w-[420px]">
            {/* Hour header (sample every 3 hours) */}
            <div className="grid grid-cols-[36px_repeat(24,1fr)] gap-1 mb-1 text-[9px] text-[#555] text-center">
              <span />
              {Array.from({ length: 24 }).map((_, h) => (
                <span key={h} className="truncate">
                  {h % 3 === 0 ? `${h}h` : ""}
                </span>
              ))}
            </div>

            {/* Matrix rows */}
            {DAYS.map((dayName, dayIndex) => {
              const rowCells = heatmap.filter((h) => h.dayOfWeek === dayIndex);
              return (
                <div key={dayName} className="grid grid-cols-[36px_repeat(24,1fr)] gap-1 mb-1 items-center">
                  <span className="text-[10px] font-semibold text-[#888] pr-1">{dayName}</span>
                  {rowCells.map((cell) => {
                    const colorClass = getHeatmapColor(cell.streamCount);
                    return (
                      <div
                        key={cell.hourOfDay}
                        className={`h-5 rounded-sm transition-transform hover:scale-125 relative group cursor-pointer ${colorClass}`}
                      >
                        {/* Tooltip */}
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-8 left-1/2 -translate-x-1/2 bg-[#252525] text-white text-[10px] px-2 py-0.5 rounded shadow pointer-events-none whitespace-nowrap z-30 border border-[#444]">
                          {dayName} {cell.hourOfDay}:00 — {cell.streamCount} streams ({cell.minutes}m)
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
