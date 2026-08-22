export {};

type ServerSetting = {
  id: string;
  domain: string;
  name: string;
  timezone: string;
  myUserId?: string;
};

type Score = {
  serverId: string;
  serverName: string;
  originalServerRank: number;
  combinedRank: null;
  scoreId: number | null;
  user: {
    id: number;
    username: string;
    avatarUrl: string;
    countryCode: string | null;
  };
  beatmapId: number;
  mode: string;
  score: number;
  accuracy: number | null;
  maxCombo: number | null;
  countPerfect: number | null;
  countGreat: number | null;
  countGood: number | null;
  countOk: number | null;
  countMeh: number | null;
  countMiss: number | null;
  pp: number | null;
  grade: string | null;
  mods: string[];
  playedAt: string | null;
  perfect: boolean | null;
};

type GetScoresMessage = {
  type: "getScores";
  serverId: string;
  beatmapId: number;
  mode: string;
};

const REQUEST_TIMEOUT_MS = 6_000;
const RESPONSE_LIMIT_BYTES = 2 * 1024 * 1024;
const SCORE_LIMIT = 100;
const webext = (globalThis as typeof globalThis & { browser?: typeof chrome }).browser ?? chrome;

webext.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isGetScoresMessage(message) || !isOsuPage(sender.url)) return false;
  void getScores(message)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
  return true;
});

async function getScores(message: GetScoresMessage) {
  const stored = await webext.storage.sync.get("servers") as { servers?: ServerSetting[] };
  const server = stored.servers?.find((candidate) => candidate.id === message.serverId);
  if (!server) throw new Error("Unknown Private Server");

  const origin = apiOrigin(server.domain);
  const allowed = await webext.permissions.contains({ origins: [`${origin}/*`] });
  if (!allowed) throw new Error(`${server.name}: API access is not permitted`);

  const mode = modeNumber(message.mode);
  if (mode == null) throw new Error("Mode must be osu, taiko, fruits, or mania");
  const url = new URL("/v1/get_map_scores", origin);
  url.search = new URLSearchParams({
    id: String(message.beatmapId),
    scope: "best",
    mode: String(mode),
    limit: String(SCORE_LIMIT),
  }).toString();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: "omit" });
    if (!response.ok) throw new Error(`${server.name}: HTTP ${response.status}`);
    const declaredSize = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredSize) && declaredSize > RESPONSE_LIMIT_BYTES) {
      throw new Error(`${server.name}: response is too large`);
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > RESPONSE_LIMIT_BYTES) {
      throw new Error(`${server.name}: response is too large`);
    }
    const payload = JSON.parse(text) as Record<string, unknown>;
    if (typeof payload.status === "string" && payload.status !== "success") {
      throw new Error(`${server.name}: score request was rejected`);
    }
    if (!Array.isArray(payload.scores)) throw new Error(`${server.name}: response has no scores array`);

    const scores = payload.scores
      .map((raw, index) => normalizeScore(server, asObject(raw), message.beatmapId, message.mode, index + 1))
      .filter((score): score is Score => score !== null)
      .sort((left, right) => right.score - left.score || (right.pp ?? -1) - (left.pp ?? -1));
    scores.forEach((score, index) => { score.originalServerRank = index + 1; });
    const myScore = server.myUserId
      ? scores.filter((score) => String(score.user.id) === server.myUserId).sort((a, b) => b.score - a.score)[0] ?? null
      : null;
    return { server: { id: server.id, name: server.name }, scores, myScore };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeScore(
  server: ServerSetting,
  raw: Record<string, unknown> | null,
  beatmapId: number,
  mode: string,
  rank: number,
): Score | null {
  if (!raw) return null;
  const userId = numberField(raw, ["userid", "user_id"]);
  const score = numberField(raw, ["score", "total_score"]);
  if (userId == null || score == null) return null;
  return {
    serverId: server.id,
    serverName: server.name,
    originalServerRank: rank,
    combinedRank: null,
    scoreId: numberField(raw, ["id", "score_id"]),
    user: {
      id: userId,
      username: stringField(raw, ["player_name", "username", "name"]) ?? `User ${userId}`,
      avatarUrl: `https://a.${server.domain}/${userId}`,
      countryCode: stringField(raw, ["player_country", "country", "country_code"])?.toUpperCase() ?? null,
    },
    beatmapId,
    mode,
    score,
    accuracy: numberField(raw, ["acc", "accuracy"]),
    maxCombo: numberField(raw, ["max_combo", "maxCombo"]),
    countPerfect: numberField(raw, ["ngeki", "count_geki", "countPerfect"]),
    countGreat: numberField(raw, ["n300", "count_300", "countGreat"]),
    countGood: numberField(raw, ["nkatu", "count_katu", "countGood"]),
    countOk: numberField(raw, ["n100", "count_100", "countOk"]),
    countMeh: numberField(raw, ["n50", "count_50", "countMeh"]),
    countMiss: numberField(raw, ["nmiss", "count_miss", "countMiss"]),
    pp: numberField(raw, ["pp"]),
    grade: stringField(raw, ["grade", "rank"]),
    mods: normalizeMods(raw.mods),
    playedAt: normalizeTime(stringField(raw, ["play_time", "played_at", "ended_at"]), server.timezone),
    perfect: booleanField(raw, ["perfect"]),
  };
}

function normalizeTime(value: string | null, timeZone: string): string | null {
  if (!value) return null;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
  }
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const desired = match.slice(1).map(Number);
  let timestamp = Date.UTC(desired[0], desired[1] - 1, desired[2], desired[3], desired[4], desired[5]);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(timestamp).map((part) => [part.type, part.value]));
    const represented = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    const target = Date.UTC(desired[0], desired[1] - 1, desired[2], desired[3], desired[4], desired[5]);
    timestamp += target - represented;
  }
  return new Date(timestamp).toISOString();
}

function normalizeMods(value: unknown): string[] {
  if (typeof value === "number") return modsFromBits(value);
  if (typeof value === "string") {
    if (!value || value.toUpperCase() === "NM") return [];
    return value.match(/.{1,2}/g)?.map((item) => item.toUpperCase()) ?? [];
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") return [item.toUpperCase()];
    const acronym = asObject(item)?.acronym;
    return typeof acronym === "string" ? [acronym.toUpperCase()] : [];
  });
}

function modsFromBits(bits: number): string[] {
  const definitions: [number, string][] = [
    [1, "NF"], [2, "EZ"], [8, "HD"], [16, "HR"], [32, "SD"], [64, "DT"],
    [128, "RX"], [256, "HT"], [512, "NC"], [1024, "FL"], [2048, "AT"],
    [4096, "SO"], [8192, "AP"], [16384, "PF"], [2 ** 29, "V2"], [2 ** 30, "MR"],
  ];
  let result = definitions.filter(([flag]) => (bits & flag) !== 0).map(([, name]) => name);
  if (result.includes("NC")) result = result.filter((item) => item !== "DT");
  if (result.includes("PF")) result = result.filter((item) => item !== "SD");
  return result;
}

function apiOrigin(domain: string): string { return `https://api.${domain}`; }
function modeNumber(mode: string): number | null {
  return ({ osu: 0, taiko: 1, fruits: 2, catch: 2, mania: 3 } as Record<string, number>)[mode] ?? null;
}
function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function valueField(raw: Record<string, unknown>, names: string[]): unknown {
  return names.map((name) => raw[name]).find((value) => value != null);
}
function stringField(raw: Record<string, unknown>, names: string[]): string | null {
  const value = valueField(raw, names);
  return typeof value === "string" ? value : null;
}
function numberField(raw: Record<string, unknown>, names: string[]): number | null {
  const value = valueField(raw, names);
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}
function booleanField(raw: Record<string, unknown>, names: string[]): boolean | null {
  const value = valueField(raw, names);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return null;
}
function isGetScoresMessage(value: unknown): value is GetScoresMessage {
  const message = asObject(value);
  return message?.type === "getScores"
    && typeof message.serverId === "string"
    && Number.isSafeInteger(message.beatmapId) && Number(message.beatmapId) > 0
    && typeof message.mode === "string";
}
function isOsuPage(url?: string): boolean {
  return !!url && /^https:\/\/osu\.ppy\.sh\/(beatmapsets|beatmaps)\//.test(url);
}
function errorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") return "Request timed out";
  return error instanceof Error ? error.message : String(error);
}
