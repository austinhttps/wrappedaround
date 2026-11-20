"use client";

import { useState } from "react";
import Image from "next/image";
import { RankedArtist, RankedTrack, RankedAlbum, RankMetric } from "@/lib/queries";
import { User, Music, Disc3 } from "lucide-react";

interface TopSectionsProps {
  artists: RankedArtist[];
  tracks: RankedTrack[];
  albums: RankedAlbum[];
}

export function TopSections({ artists, tracks, albums }: TopSectionsProps) {
  const [metric, setMetric] = useState<RankMetric>("streams");

  const getMetricDisplay = (streams: number, minutes: number) => {
    return metric === "streams" ? `${streams} streams` : `${minutes} min`;
  };

  return (
    <div className="space-y-4">
      {/* Metric Selector toggle */}
      <div className="flex items-center justify-between border-b border-[#242424] pb-3">
        <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
          Rankings Breakdown
        </h2>
        <div className="flex items-center bg-[#181818] border border-[#2c2c2c] p-1 rounded-xl text-xs">
          <button
            onClick={() => setMetric("streams")}
            className={`px-3 py-1 rounded-lg font-semibold transition-all ${
              metric === "streams"
                ? "bg-[#1ed760] text-black shadow-md shadow-[#1ed760]/20"
                : "text-[#a7a7a7] hover:text-white"
            }`}
          >
            By Streams
          </button>
          <button
            onClick={() => setMetric("minutes")}
            className={`px-3 py-1 rounded-lg font-semibold transition-all ${
              metric === "minutes"
                ? "bg-[#1ed760] text-black shadow-md shadow-[#1ed760]/20"
                : "text-[#a7a7a7] hover:text-white"
            }`}
          >
            By Minutes
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Top Artists */}
        <div className="bg-[#121212] border border-[#242424] rounded-2xl p-4.5 flex flex-col">
          <div className="flex items-center gap-2 mb-4 pb-2 border-b border-[#202020]">
            <User className="w-4 h-4 text-[#1ed760]" />
            <h3 className="font-bold text-white text-sm">Top Artists</h3>
          </div>
          {artists.length === 0 ? (
            <p className="text-xs text-[#707070] italic py-8 text-center">No artist plays recorded.</p>
          ) : (
            <div className="space-y-3 flex-1 overflow-y-auto max-h-[460px] pr-1">
              {artists.map((artist, idx) => (
                <div
                  key={artist.id}
                  className="flex items-center gap-3 p-2 rounded-xl hover:bg-[#1a1a1a] transition-colors group"
                >
                  <span className="w-5 text-center text-xs font-bold text-[#6a6a6a] group-hover:text-[#1ed760]">
                    {idx + 1}
                  </span>
                  <div className="relative w-10 h-10 rounded-full overflow-hidden bg-[#262626] flex-shrink-0 border border-[#333]">
                    {artist.imageUrl ? (
                      <Image
                        src={artist.imageUrl}
                        alt={artist.name}
                        width={40}
                        height={40}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[#555]">
                        <User className="w-4 h-4" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-white truncate group-hover:text-[#1ed760] transition-colors">
                      {artist.name}
                    </p>
                    <p className="text-[11px] text-[#888]">
                      {getMetricDisplay(artist.countedStreams, artist.totalMinutes)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top Tracks */}
        <div className="bg-[#121212] border border-[#242424] rounded-2xl p-4.5 flex flex-col">
          <div className="flex items-center gap-2 mb-4 pb-2 border-b border-[#202020]">
            <Music className="w-4 h-4 text-[#1ed760]" />
            <h3 className="font-bold text-white text-sm">Top Tracks</h3>
          </div>
          {tracks.length === 0 ? (
            <p className="text-xs text-[#707070] italic py-8 text-center">No track plays recorded.</p>
          ) : (
            <div className="space-y-3 flex-1 overflow-y-auto max-h-[460px] pr-1">
              {tracks.map((track, idx) => (
                <div
                  key={track.id}
                  className="flex items-center gap-3 p-2 rounded-xl hover:bg-[#1a1a1a] transition-colors group"
                >
                  <span className="w-5 text-center text-xs font-bold text-[#6a6a6a] group-hover:text-[#1ed760]">
                    {idx + 1}
                  </span>
                  <div className="relative w-10 h-10 rounded-lg overflow-hidden bg-[#262626] flex-shrink-0 border border-[#333]">
                    {track.albumImageUrl ? (
                      <Image
                        src={track.albumImageUrl}
                        alt={track.name}
                        width={40}
                        height={40}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[#555]">
                        <Music className="w-4 h-4" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-white truncate group-hover:text-[#1ed760] transition-colors">
                      {track.name}
                    </p>
                    <p className="text-[11px] text-[#888] truncate">
                      {track.artistNames}
                    </p>
                  </div>
                  <div className="text-[11px] font-medium text-[#aaa] text-right flex-shrink-0">
                    {getMetricDisplay(track.countedStreams, track.totalMinutes)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top Albums */}
        <div className="bg-[#121212] border border-[#242424] rounded-2xl p-4.5 flex flex-col">
          <div className="flex items-center gap-2 mb-4 pb-2 border-b border-[#202020]">
            <Disc3 className="w-4 h-4 text-[#1ed760]" />
            <h3 className="font-bold text-white text-sm">Top Albums</h3>
          </div>
          {albums.length === 0 ? (
            <p className="text-xs text-[#707070] italic py-8 text-center">No album plays recorded.</p>
          ) : (
            <div className="space-y-3 flex-1 overflow-y-auto max-h-[460px] pr-1">
              {albums.map((album, idx) => (
                <div
                  key={album.id}
                  className="flex items-center gap-3 p-2 rounded-xl hover:bg-[#1a1a1a] transition-colors group"
                >
                  <span className="w-5 text-center text-xs font-bold text-[#6a6a6a] group-hover:text-[#1ed760]">
                    {idx + 1}
                  </span>
                  <div className="relative w-10 h-10 rounded-lg overflow-hidden bg-[#262626] flex-shrink-0 border border-[#333]">
                    {album.albumImageUrl ? (
                      <Image
                        src={album.albumImageUrl}
                        alt={album.name}
                        width={40}
                        height={40}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[#555]">
                        <Disc3 className="w-4 h-4" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-white truncate group-hover:text-[#1ed760] transition-colors">
                      {album.name}
                    </p>
                    <p className="text-[11px] text-[#888] truncate">
                      {album.artistNames}
                    </p>
                  </div>
                  <div className="text-[11px] font-medium text-[#aaa] text-right flex-shrink-0">
                    {getMetricDisplay(album.countedStreams, album.totalMinutes)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
