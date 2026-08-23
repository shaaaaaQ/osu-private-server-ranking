export type HitCountField = "countPerfect" | "countGreat" | "countGood" | "countOk" | "countMeh" | "countMiss";
export type HitColumn = { field: HitCountField; label: string; modifier: string };

export const HIT_COLUMNS: Record<string, readonly HitColumn[]> = {
  osu: [
    { field: "countGreat", label: "GREAT", modifier: "great" },
    { field: "countOk", label: "OK", modifier: "ok" },
    { field: "countMeh", label: "MEH", modifier: "meh" },
    { field: "countMiss", label: "MISS", modifier: "miss" },
  ],
  taiko: [
    { field: "countGreat", label: "GREAT", modifier: "great" },
    { field: "countOk", label: "OK", modifier: "ok" },
    { field: "countMiss", label: "MISS", modifier: "miss" },
  ],
  fruits: [
    { field: "countGreat", label: "GREAT", modifier: "great" },
    { field: "countOk", label: "L DRP", modifier: "large_tick_hit" },
    { field: "countGood", label: "S DRP MISS", modifier: "small_tick_miss" },
    { field: "countMiss", label: "MISS", modifier: "miss" },
  ],
  mania: [
    { field: "countPerfect", label: "PERFECT", modifier: "perfect" },
    { field: "countGreat", label: "GREAT", modifier: "great" },
    { field: "countGood", label: "GOOD", modifier: "good" },
    { field: "countOk", label: "OK", modifier: "ok" },
    { field: "countMeh", label: "MEH", modifier: "meh" },
    { field: "countMiss", label: "MISS", modifier: "miss" },
  ],
};
