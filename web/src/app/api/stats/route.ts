import { NextRequest, NextResponse } from "next/server";
import { getDashboardData, DatePreset } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const preset = (searchParams.get("preset") as DatePreset) || "all";
  const startDate = searchParams.get("startDate") || undefined;
  const endDate = searchParams.get("endDate") || undefined;
  const minMsPlayedParam = searchParams.get("minMsPlayed");
  const minMsPlayed = minMsPlayedParam ? parseInt(minMsPlayedParam, 10) : 30000;

  try {
    const data = await getDashboardData({
      preset,
      startDate,
      endDate,
      minMsPlayed,
    });
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
        Pragma: "no-cache",
        Expires: "0",
      },
    });
  } catch (error) {
    console.error("[api/stats] Failed to fetch stats:", error);
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
  }
}
