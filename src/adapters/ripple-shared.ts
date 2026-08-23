import { isRecord, scoresArray } from "./types";

export function extractRippleScores(payload: Record<string, unknown>): Record<string, unknown>[] {
  if (typeof payload.code === "number" && payload.code >= 400) {
    throw new Error(typeof payload.message === "string" ? payload.message : "score request was rejected");
  }
  if (payload.scores === null) return [];
  return scoresArray(payload);
}

export function normalizeRippleScore(raw: Record<string, unknown>): Record<string, unknown> {
  const user = isRecord(raw.user) ? raw.user : {};
  return {
    ...raw,
    userid: user.id ?? raw.userid ?? raw.user_id,
    player_name: user.username ?? raw.player_name ?? raw.username,
    player_country: user.country ?? raw.player_country ?? raw.country,
    play_time: raw.time ?? raw.play_time,
    perfect: raw.full_combo ?? raw.perfect,
  };
}
