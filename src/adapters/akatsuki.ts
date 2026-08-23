import type { ServerAdapter } from "./types";
import { endpointUrl } from "./types";
import { extractRippleScores, normalizeRippleScore } from "./ripple-shared";

export const akatsukiAdapter: ServerAdapter = {
  id: "akatsuki",
  label: "Akatsuki",
  defaultEndpoint: (domain) => `https://${domain}/api/v1`,
  avatarUrl: (domain, userId) => `https://a.${domain}/${userId}`,
  buildScoreUrl(endpoint, request) {
    const url = endpointUrl(endpoint, "scores");
    url.search = new URLSearchParams({
      sort: "score,desc",
      m: String(request.mode),
      relax: "0",
      b: String(request.beatmapId),
      p: "1",
      l: String(request.limit),
    }).toString();
    return url;
  },
  extractScores: extractRippleScores,
  normalizeRawScore: normalizeRippleScore,
};
