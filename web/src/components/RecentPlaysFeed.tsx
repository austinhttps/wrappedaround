import Image from "next/image";
import { RecentPlay } from "@/lib/queries";
import { Radio, Music2 } from "lucide-react";

interface RecentPlaysFeedProps {
  plays: RecentPlay[];
}

function formatRelativeTime(dateString: string): string {
  try {
    const playTime = new Date(dateString).getTime();
    const now = Date.now();
    const diffSecs = Math.floor((now - playTime) / 1000);

    if (diffSecs < 60) return "Just now";
    if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)}m ago`;
    if (diffSecs < 86400) return `${Math.floor(diffSecs / 3600)}h ago`;
    if (diffSecs < 86400 * 7) return `${Math.floor(diffSecs / 86400)}d ago`;

    return new Date(dateString).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateString;
  }
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function RecentPlaysFeed({ plays }: RecentPlaysFeedProps) {
  return (
    <div className="bg-[#121212] border border-[#242424] rounded-2xl p-5 shadow-xl">
      <div className="flex items-center justify-between pb-3 border-b border-[#202020] mb-4">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-[#1ed760] animate-pulse" />
          <h3 className="font-bold text-white text-sm">Recent Plays Feed</h3>
        </div>
        <span className="text-[11px] text-[#707070]">Latest {plays.length} tracks</span>
      </div>

      {plays.length === 0 ? (
        <div className="text-center py-12 text-xs text-[#707070] italic">
          No playback activity found in selected date range.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[#202020] text-[#707070] text-[11px] uppercase tracking-wider font-semibold">
                <th className="pb-2.5 font-medium">Track</th>
                <th className="pb-2.5 font-medium hidden md:table-cell">Album</th>
                <th className="pb-2.5 font-medium">Duration</th>
                <th className="pb-2.5 font-medium">Source</th>
                <th className="pb-2.5 font-medium text-right">Played</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1a1a1a]">
              {plays.map((play) => (
                <tr key={`${play.id}-${play.playedAt}`} className="hover:bg-[#181818] transition-colors group">
                  <td className="py-2.5 pr-3">
                    <div className="flex items-center gap-3">
                      <div className="relative w-9 h-9 rounded-md overflow-hidden bg-[#242424] flex-shrink-0 border border-[#303030]">
                        {play.albumImageUrl ? (
                          <Image
                            src={play.albumImageUrl}
                            alt={play.trackName}
                            width={36}
                            height={36}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[#555]">
                            <Music2 className="w-4 h-4" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 max-w-[200px] sm:max-w-[320px]">
                        <p className="font-semibold text-white truncate group-hover:text-[#1ed760] transition-colors">
                          {play.trackName}
                        </p>
                        <p className="text-[11px] text-[#808080] truncate">
                          {play.artistNames}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5 pr-3 text-[#909090] hidden md:table-cell max-w-[180px] truncate">
                    {play.albumName}
                  </td>
                  <td className="py-2.5 pr-3 text-[#999] whitespace-nowrap">
                    {formatDuration(play.msPlayed)}
                  </td>
                  <td className="py-2.5 pr-3 whitespace-nowrap">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                        play.source === "poller"
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                      }`}
                    >
                      {play.source}
                    </span>
                  </td>
                  <td className="py-2.5 text-right text-[#808080] whitespace-nowrap font-medium text-[11px]">
                    {formatRelativeTime(play.playedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
