import type { ServerAdapter } from "./types";
import { endpointUrl } from "./types";
import { extractRippleScores, normalizeRippleScore } from "./ripple-shared";

export const rippleAdapter: ServerAdapter = {
  id: "ripple",
  label: "Ripple",
  defaultEndpoint: (domain) => `https://${domain}/api/v1`,
  avatarUrl: (domain, userId) => `https://a.${domain}/${userId}`,
  buildScoreUrl(endpoint, request) {
    const url = endpointUrl(endpoint, "scores");
    url.search = new URLSearchParams({
      b: String(request.beatmapId),
      mode: String(request.mode),
      relax: "0",
      sort: "score",
      l: String(request.limit),
    }).toString();
    return url;
  },
  extractScores: extractRippleScores,
  normalizeRawScore: normalizeRippleScore,
};
