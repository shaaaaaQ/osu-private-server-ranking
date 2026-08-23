import type { AdapterId } from "../server-settings";

export type ScoreRequest = {
  beatmapId: number;
  mode: number;
  limit: number;
};

export type ServerAdapter = {
  id: AdapterId;
  label: string;
  defaultEndpoint(domain: string): string;
  avatarUrl(domain: string, userId: number): string;
  buildScoreUrl(endpoint: string, request: ScoreRequest): URL;
  extractScores(payload: Record<string, unknown>): Record<string, unknown>[];
  normalizeRawScore(raw: Record<string, unknown>): Record<string, unknown>;
};

export function scoresArray(payload: Record<string, unknown>): Record<string, unknown>[] {
  if (!Array.isArray(payload.scores)) throw new Error("response has no scores array");
  return payload.scores.filter(isRecord);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function endpointUrl(endpoint: string, path: string): URL {
  const base = endpoint.endsWith("/") ? endpoint : `${endpoint}/`;
  return new URL(path.replace(/^\//, ""), base);
}
