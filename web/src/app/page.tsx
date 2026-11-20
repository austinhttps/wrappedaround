import { getDashboardData } from "@/lib/queries";
import { DashboardClient } from "@/components/DashboardClient";
import { Disc3 } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const initialData = await getDashboardData({
    preset: "all",
    minMsPlayed: 30000,
  });

  return (
    <div className="min-h-screen bg-[#090909] text-white selection:bg-[#1ed760] selection:text-black">
      {/* Header Bar */}
      <header className="sticky top-0 z-50 backdrop-blur-md bg-[#090909]/80 border-b border-[#202020]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-[#1ed760] flex items-center justify-center shadow-lg shadow-[#1ed760]/20">
              <Disc3 className="w-5 h-5 text-black animate-[spin_6s_linear_infinite]" />
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-black tracking-tight text-white flex items-center gap-2">
                Spotify Stats <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-[#202020] text-[#1ed760] border border-[#303030]">Phase 3</span>
              </h1>
              <p className="text-[11px] text-[#787878] -mt-0.5">Read-only personal listening analytics</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#181818] border border-[#2a2a2a] text-[#8e8e8e]">
              <span className="w-2 h-2 rounded-full bg-[#1ed760]" />
              Database Online
            </span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <DashboardClient initialData={initialData} />
      </main>
    </div>
  );
}
