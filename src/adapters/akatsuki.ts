import type { ServerAdapter } from "./types";
import { endpointUrl, relaxValue } from "./types";
import { extractRippleScores, normalizeRippleScore } from "./ripple-shared";

export const akatsukiAdapter: ServerAdapter = {
  id: "akatsuki",
  label: "Akatsuki",
  supportsVariant: () => true,
  defaultEndpoint: (domain) => `https://${domain}/api/v1`,
  avatarUrl: (domain, userId) => `https://a.${domain}/${userId}`,
  buildScoreUrl(endpoint, request) {
    const url = endpointUrl(endpoint, "scores");
    url.search = new URLSearchParams({
      sort: "score,desc",
      m: String(request.mode),
      relax: relaxValue(request.variant),
      b: String(request.beatmapId),
      p: "1",
      l: String(request.limit),
    }).toString();
    return url;
  },
  extractScores: extractRippleScores,
  normalizeRawScore: normalizeRippleScore,
};
