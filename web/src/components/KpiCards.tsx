import { KpiSummary } from "@/lib/queries";
import { Headphones, Flame, Disc, Users, Clock, Radio } from "lucide-react";

interface KpiCardsProps {
  kpis: KpiSummary;
  minSeconds: number;
}

export function KpiCards({ kpis, minSeconds }: KpiCardsProps) {
  const formatTime = (minutes: number, hours: number) => {
    if (hours >= 10) {
      return `${hours.toLocaleString()} hrs`;
    }
    return `${minutes.toLocaleString()} min`;
  };

  const cards = [
    {
      label: "Total Listening Time",
      value: formatTime(kpis.totalMinutes, kpis.totalHours),
      subtext: `${kpis.totalHours.toLocaleString()} total hours`,
      icon: Clock,
      color: "from-emerald-500/20 to-teal-500/5",
      accent: "text-emerald-400",
    },
    {
      label: "Counted Streams",
      value: kpis.countedStreams.toLocaleString(),
      subtext: `${minSeconds}s+ threshold (${kpis.rawPlaysCount.toLocaleString()} total plays)`,
      icon: Headphones,
      color: "from-green-500/20 to-emerald-500/5",
      accent: "text-[#1ed760]",
    },
    {
      label: "Unique Tracks",
      value: kpis.uniqueTracks.toLocaleString(),
      subtext: "Distinct songs heard",
      icon: Disc,
      color: "from-cyan-500/20 to-blue-500/5",
      accent: "text-cyan-400",
    },
    {
      label: "Unique Artists",
      value: kpis.uniqueArtists.toLocaleString(),
      subtext: "Artists explored",
      icon: Users,
      color: "from-purple-500/20 to-indigo-500/5",
      accent: "text-purple-400",
    },
    {
      label: "Daily Streak",
      value: `${kpis.currentStreakDays} ${kpis.currentStreakDays === 1 ? "day" : "days"}`,
      subtext: `Longest streak: ${kpis.longestStreakDays} ${kpis.longestStreakDays === 1 ? "day" : "days"}`,
      icon: Flame,
      color: "from-orange-500/20 to-amber-500/5",
      accent: "text-amber-400",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
      {cards.map((c, i) => {
        const Icon = c.icon;
        return (
          <div
            key={i}
            className={`relative overflow-hidden rounded-2xl bg-gradient-to-b ${c.color} bg-[#181818] border border-[#282828] p-4.5 hover:border-[#383838] transition-all flex flex-col justify-between`}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-[#a7a7a7] uppercase tracking-wider">
                {c.label}
              </span>
              <Icon className={`w-4.5 h-4.5 ${c.accent}`} />
            </div>
            <div>
              <div className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                {c.value}
              </div>
              <p className="text-[11px] text-[#787878] mt-1 font-medium truncate">
                {c.subtext}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
