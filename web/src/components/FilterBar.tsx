"use client";

import { useState } from "react";
import { DatePreset } from "@/lib/queries";
import { Calendar, Filter, Clock } from "lucide-react";

interface FilterBarProps {
  currentPreset: DatePreset;
  startDate: string;
  endDate: string;
  minSeconds: number;
  onFilterChange: (filters: {
    preset: DatePreset;
    startDate: string;
    endDate: string;
    minSeconds: number;
  }) => void;
}

const PRESETS: { id: DatePreset; label: string }[] = [
  { id: "7d", label: "Last 7 Days" },
  { id: "30d", label: "Last 30 Days" },
  { id: "6m", label: "Last 6 Months" },
  { id: "1y", label: "Last Year" },
  { id: "all", label: "All Time" },
  { id: "custom", label: "Custom" },
];

export function FilterBar({
  currentPreset,
  startDate,
  endDate,
  minSeconds,
  onFilterChange,
}: FilterBarProps) {
  const [preset, setPreset] = useState<DatePreset>(currentPreset);
  const [customStart, setCustomStart] = useState(startDate);
  const [customEnd, setCustomEnd] = useState(endDate);
  const [seconds, setSeconds] = useState(minSeconds);

  const handlePresetClick = (p: DatePreset) => {
    setPreset(p);
    onFilterChange({
      preset: p,
      startDate: customStart,
      endDate: customEnd,
      minSeconds: seconds,
    });
  };

  const handleApplyCustom = (e: React.FormEvent) => {
    e.preventDefault();
    onFilterChange({
      preset: "custom",
      startDate: customStart,
      endDate: customEnd,
      minSeconds: seconds,
    });
  };

  const handleSecondsChange = (newSecs: number) => {
    setSeconds(newSecs);
    onFilterChange({
      preset,
      startDate: customStart,
      endDate: customEnd,
      minSeconds: newSecs,
    });
  };

  return (
    <div className="bg-[#121212] border border-[#282828] rounded-2xl p-4 md:p-5 shadow-xl space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Preset Pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs uppercase tracking-wider text-[#a7a7a7] font-semibold mr-1 flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5 text-[#1ed760]" /> Range:
          </span>
          {PRESETS.map((p) => {
            const isActive = preset === p.id;
            return (
              <button
                key={p.id}
                onClick={() => handlePresetClick(p.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                  isActive
                    ? "bg-[#1ed760] text-black shadow-lg shadow-[#1ed760]/20"
                    : "bg-[#222222] text-[#e0e0e0] hover:bg-[#333333] hover:text-white"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        {/* Counted Stream Threshold */}
        <div className="flex items-center gap-2 self-start lg:self-auto bg-[#1a1a1a] px-3.5 py-1.5 rounded-xl border border-[#2e2e2e]">
          <Clock className="w-4 h-4 text-[#1ed760]" />
          <span className="text-xs text-[#a7a7a7] whitespace-nowrap">Counted Stream Threshold:</span>
          <select
            value={seconds}
            onChange={(e) => handleSecondsChange(Number(e.target.value))}
            className="bg-[#262626] text-white text-xs font-medium rounded-lg px-2.5 py-1 border border-[#3e3e3e] focus:outline-none focus:border-[#1ed760] cursor-pointer"
          >
            <option value={0}>0s (All Plays)</option>
            <option value={15}>15s</option>
            <option value={30}>30s (Spotify Standard)</option>
            <option value={60}>60s</option>
          </select>
        </div>
      </div>

      {/* Custom Date Input row when custom is selected */}
      {preset === "custom" && (
        <form
          onSubmit={handleApplyCustom}
          className="pt-3 border-t border-[#242424] flex flex-wrap items-center gap-3"
        >
          <div className="flex items-center gap-2 text-xs text-[#a7a7a7]">
            <Filter className="w-3.5 h-3.5 text-[#1ed760]" />
            <span>From:</span>
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="bg-[#222] text-white px-2.5 py-1 rounded-lg border border-[#3a3a3a] text-xs focus:outline-none focus:border-[#1ed760]"
            />
          </div>
          <div className="flex items-center gap-2 text-xs text-[#a7a7a7]">
            <span>To:</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="bg-[#222] text-white px-2.5 py-1 rounded-lg border border-[#3a3a3a] text-xs focus:outline-none focus:border-[#1ed760]"
            />
          </div>
          <button
            type="submit"
            className="px-3.5 py-1 bg-[#1ed760] hover:bg-[#1fdf64] text-black text-xs font-semibold rounded-lg transition-colors cursor-pointer"
          >
            Apply Dates
          </button>
        </form>
      )}
    </div>
  );
}
