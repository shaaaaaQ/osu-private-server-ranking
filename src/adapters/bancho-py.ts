import type { ServerAdapter } from "./types";
import { endpointUrl, scoresArray } from "./types";

export const banchoPyAdapter: ServerAdapter = {
  id: "bancho.py",
  label: "bancho.py",
  defaultEndpoint: (domain) => `https://api.${domain}/v1`,
  avatarUrl: (domain, userId) => `https://a.${domain}/${userId}`,
  buildScoreUrl(endpoint, request) {
    const url = endpointUrl(endpoint, "get_map_scores");
    url.search = new URLSearchParams({
      id: String(request.beatmapId),
      scope: "best",
      mode: String(request.mode),
      limit: String(request.limit),
    }).toString();
    return url;
  },
  extractScores(payload) {
    if (typeof payload.status === "string" && payload.status !== "success") {
      throw new Error("score request was rejected");
    }
    return scoresArray(payload);
  },
  normalizeRawScore: (raw) => raw,
};
