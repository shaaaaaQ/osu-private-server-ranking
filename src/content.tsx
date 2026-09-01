export {};

import { render as renderPreact } from "preact";
import type { ComponentChildren } from "preact";
import { supportsLocale, translationForLocale } from "./content-i18n";
import type { Translations } from "./content-i18n";
import { HIT_COLUMNS } from "./score-columns";
import type { HitColumn } from "./score-columns";
import { userProfileUrl } from "./server-settings";
import type { RankingVariant } from "./adapters/types";

type ServerInfo = { id: string; name: string };
type ServerStatus = "loading" | "loaded" | "error";

type Score = {
  serverId: string;
  serverName: string;
  originalServerRank: number;
  combinedRank: number | null;
  scoreId: number | null;
  user: {
    id: number;
    username: string;
    avatarUrl: string | null;
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

type ScoresResponse = {
  server: ServerInfo;
  scores: Score[];
  myScore: Score | null;
};

type StoredSettings = {
  servers?: ServerSetting[];
  lazyLoad?: boolean;
};

type ServerSetting = ServerInfo & {
  domain: string;
  timezone: string;
  myUserId?: string;
  enabled?: boolean;
  userProfileUrlTemplate?: string;
};

type ScoresMessageResponse =
  | { ok: true; data: ScoresResponse }
  | { ok: false; error: string };

type LoadedServer = {
  status: ServerStatus;
  scores: Score[];
  myScore: Score | null;
  error?: string;
};

const ROOT_ID = "osu-private-ranking-root";
const number = new Intl.NumberFormat();
const webext = (globalThis as typeof globalThis & { browser?: typeof chrome }).browser ?? chrome;

let currentPageKey = "";
let loadGeneration = 0;
let selectedServerIds = new Set<string>();
let allSelected = true;
let servers: ServerInfo[] = [];
let loaded = new Map<string, LoadedServer>();
let settings: Required<StoredSettings> = { servers: [], lazyLoad: true };
let root: HTMLElement | null = null;
let privateTab: HTMLElement | null = null;
let privateActive = false;
let statusExpanded = false;
let officialTabs: HTMLElement[] = [];
let officialContent = new Map<HTMLElement, string>();
let officialActiveClasses = new Map<HTMLElement, string[]>();
let currentContext: NonNullable<ReturnType<typeof pageContext>> | null = null;
let settingsReady = false;
let scoresStarted = false;
let selectedVariant: RankingVariant = "vanilla";

function pageLocale(): string {
  return document.documentElement.lang || "en";
}

function activeLocale(): string {
  const locale = pageLocale().toLowerCase();
  return supportsLocale(locale) ? locale : "en";
}

function translations(): Translations {
  return translationForLocale(activeLocale());
}

function pageContext(): { beatmapId: number; mode: string; key: string } | null {
  const hashMatch = location.hash.match(/^#(osu|taiko|fruits|mania)\/(\d+)/);
  const pathMatch = location.pathname.match(/^\/beatmaps\/(\d+)/);
  const beatmapId = Number(hashMatch?.[2] ?? pathMatch?.[1]);
  if (!Number.isSafeInteger(beatmapId) || beatmapId <= 0) return null;
  const mode = hashMatch?.[1] ?? document.querySelector<HTMLMetaElement>('meta[name="osu-mode"]')?.content ?? "osu";
  return { beatmapId, mode, key: `${mode}:${beatmapId}` };
}

async function readSettings(): Promise<void> {
  const stored = (await webext.storage.sync.get(["servers", "lazyLoad"])) as StoredSettings;
  settings = { servers: stored.servers ?? [], lazyLoad: stored.lazyLoad ?? true };
}

async function beginLoad(context: NonNullable<ReturnType<typeof pageContext>>): Promise<void> {
  removeInjectedUi();
  currentPageKey = context.key;
  currentContext = context;
  loadGeneration += 1;
  const generation = loadGeneration;
  settingsReady = false;
  scoresStarted = false;
  if (!availableVariants(context.mode).includes(selectedVariant)) selectedVariant = "vanilla";
  loaded = new Map();
  servers = [];
  allSelected = true;
  statusExpanded = false;
  selectedServerIds = new Set();
  ensureRoot();
  root?.removeAttribute("data-fatal-error");
  render();

  try {
    await readSettings();
    servers = settings.servers.filter((server) => server.enabled !== false).map(({ id, name }) => ({ id, name }));
    if (generation !== loadGeneration) return;
    selectedServerIds = new Set(servers.map((server) => server.id));
    settingsReady = true;
    render();
    if (!settings.lazyLoad || privateActive) startScoreLoads(context, generation);
  } catch (error) {
    if (generation !== loadGeneration) return;
    root?.setAttribute("data-fatal-error", errorMessage(error));
    render();
  }
}

function startScoreLoads(
  context: NonNullable<ReturnType<typeof pageContext>>,
  generation: number,
): void {
  if (!settingsReady || scoresStarted || generation !== loadGeneration || context.key !== currentPageKey) return;
  scoresStarted = true;
  loaded = new Map(servers.map((server) => [server.id, { status: "loading", scores: [], myScore: null }]));
  render();
  for (const server of servers) void fetchServer(server, context, generation);
}

async function fetchServer(
  server: ServerInfo,
  context: NonNullable<ReturnType<typeof pageContext>>,
  generation: number,
): Promise<void> {
  try {
    const response = await webext.runtime.sendMessage({
      type: "getScores",
      serverId: server.id,
      beatmapId: context.beatmapId,
      mode: context.mode,
      variant: selectedVariant,
    }) as ScoresMessageResponse;
    if (!response?.ok) throw new Error(response?.error || "Background request failed");
    if (generation !== loadGeneration) return;
    loaded.set(server.id, { status: "loaded", scores: response.data.scores, myScore: response.data.myScore });
  } catch (error) {
    if (generation !== loadGeneration) return;
    loaded.set(server.id, { status: "error", scores: [], myScore: null, error: errorMessage(error) });
  }
  render();
}

function selectedScores(): Score[] {
  const scores = [...loaded.entries()]
    .filter(([serverId]) => selectedServerIds.has(serverId))
    .flatMap(([, result]) => result.scores);
  scores.sort((a, b) => b.score - a.score || (b.pp ?? -1) - (a.pp ?? -1) || a.serverName.localeCompare(b.serverName));
  return scores.map((score, index) => ({ ...score, combinedRank: index + 1 }));
}

function selectedMyScores(): Score[] {
  return [...loaded.entries()]
    .filter(([serverId]) => selectedServerIds.has(serverId))
    .flatMap(([, result]) => result.myScore ? [result.myScore] : [])
    .sort((a, b) => b.score - a.score || (b.pp ?? -1) - (a.pp ?? -1));
}

function ensureRoot(): void {
  const existing = document.getElementById(ROOT_ID);
  const existingTab = document.querySelector<HTMLElement>("[data-psr-private-tab]");
  if (existing && existingTab) {
    root = existing;
    privateTab = existingTab;
    return;
  }
  if (existing instanceof HTMLElement) renderPreact(null, existing);
  existing?.remove();
  existingTab?.remove();

  let scoreboard = document.querySelector<HTMLElement>(".beatmapset-scoreboard");
  let tabHost = scoreboard?.querySelector<HTMLElement>(":scope > .page-tabs") ?? null;
  if (!scoreboard || !tabHost) {
    const pageHost = document.querySelector<HTMLElement>(".user-profile-pages--no-tabs");
    if (!pageHost) return;

    const wrapper = document.createElement("div");
    wrapper.className = "page-extra";
    wrapper.setAttribute("data-psr-synthetic-wrapper", "");
    scoreboard = document.createElement("div");
    scoreboard.className = "beatmapset-scoreboard";
    tabHost = document.createElement("div");
    tabHost.className = "page-tabs";
    privateTab = document.createElement("div");
    privateTab.className = "page-tabs__tab page-tabs__tab--active";
    privateTab.setAttribute("data-psr-private-tab", "");
    privateTab.setAttribute("role", "tab");
    privateTab.setAttribute("aria-selected", "true");
    privateTab.tabIndex = 0;
    const privateLabel = translations().privateServer;
    const label = document.createElement("span");
    label.className = "fake-bold";
    label.dataset.content = privateLabel;
    label.textContent = privateLabel;
    privateTab.append(label);
    tabHost.append(privateTab);
    scoreboard.append(tabHost);
    wrapper.append(scoreboard);
    pageHost.prepend(wrapper);

    root = document.createElement("section");
    root.id = ROOT_ID;
    root.className = "psr";
    scoreboard.append(root);
    officialTabs = [];
    officialContent = new Map();
    privateActive = true;
    bindEvents();
    return;
  }

  officialTabs = [...tabHost.querySelectorAll<HTMLElement>(":scope > .page-tabs__tab")]
    .filter((tab) => !tab.hasAttribute("data-psr-private-tab"));
  const sourceTab = officialTabs[0];
  if (!sourceTab) return;

  privateTab = sourceTab.cloneNode(true) as HTMLElement;
  privateTab.setAttribute("data-psr-private-tab", "");
  privateTab.setAttribute("role", "tab");
  privateTab.setAttribute("aria-selected", "false");
  privateTab.tabIndex = 0;
  [privateTab, ...privateTab.querySelectorAll<HTMLElement>("*")].forEach((element) => {
    element.classList.remove(...[...element.classList].filter((name) => /active|selected/i.test(name)));
  });
  privateTab.removeAttribute("href");
  privateTab.querySelectorAll("[href]").forEach((element) => element.removeAttribute("href"));
  const sourceLabel = sourceTab.textContent?.replace(/\s+/g, " ").trim() ?? "";
  const privateLabel = translations().privateServer;
  const label = privateTab.querySelector<HTMLElement>(".fake-bold") ?? [...privateTab.querySelectorAll<HTMLElement>("*")]
    .reverse()
    .find((element) => element.children.length === 0 && element.textContent?.trim() === sourceLabel);
  if (label) {
    label.textContent = privateLabel;
    label.setAttribute("data-content", privateLabel);
  }
  else privateTab.textContent = privateLabel;
  tabHost.append(privateTab);

  root = document.createElement("section");
  root.id = ROOT_ID;
  root.className = "psr";
  root.hidden = true;
  scoreboard.append(root);
  const contentCandidates = new Set<HTMLElement>(
    [...scoreboard.children]
      .filter((child): child is HTMLElement => child instanceof HTMLElement && child !== root && !child.contains(tabHost)),
  );
  scoreboard
    .querySelectorAll<HTMLElement>(".beatmapset-scoreboard__main, .beatmapset-scoreboard__content, .scoreboard")
    .forEach((element) => {
      if (element !== root && !element.contains(tabHost) && !tabHost.contains(element)) contentCandidates.add(element);
    });
  officialContent = new Map([...contentCandidates].map((child) => [child, child.style.display]));
  bindEvents();
}

function bindEvents(): void {
  privateTab?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    activatePrivateTab();
  });
  privateTab?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activatePrivateTab();
    }
  });
  for (const tab of officialTabs) {
    tab.addEventListener("click", deactivatePrivateTab, { capture: true });
  }
  root?.addEventListener("change", (event) => {
    const variantSelect = (event.target as Element).closest<HTMLSelectElement>("[data-ranking-filter]");
    if (variantSelect && currentContext) {
      selectedVariant = variantSelect.value as RankingVariant;
      restartScoreLoads(currentContext);
      return;
    }
    const select = (event.target as Element).closest<HTMLSelectElement>("[data-server-filter]");
    if (!select) return;
    if (select.value === "__all__") {
      allSelected = true;
      selectedServerIds = new Set(servers.map((server) => server.id));
    } else {
      allSelected = false;
      selectedServerIds = new Set([select.value]);
    }
    render();
  });
  root?.addEventListener("click", (event) => {
    const toggle = (event.target as Element).closest<HTMLButtonElement>("[data-status-toggle]");
    if (!toggle) return;
    statusExpanded = !statusExpanded;
    toggle.setAttribute("aria-expanded", String(statusExpanded));
    const details = root?.querySelector<HTMLElement>("[data-status-details]");
    if (details) details.hidden = !statusExpanded;
  });
}

function restartScoreLoads(context: NonNullable<ReturnType<typeof pageContext>>): void {
  loadGeneration += 1;
  scoresStarted = false;
  loaded = new Map();
  startScoreLoads(context, loadGeneration);
}

function activatePrivateTab(): void {
  privateActive = true;
  for (const [element] of officialContent) element.style.setProperty("display", "none", "important");
  if (root) root.hidden = false;
  officialActiveClasses = new Map();
  for (const tab of officialTabs) {
    tab.setAttribute("aria-selected", "false");
    for (const element of [tab, ...tab.querySelectorAll<HTMLElement>("*")]) {
      const activeClasses = [...element.classList].filter((name) => /active|selected/i.test(name));
      if (activeClasses.length) {
        officialActiveClasses.set(element, activeClasses);
        element.classList.remove(...activeClasses);
      }
    }
  }
  privateTab?.setAttribute("aria-selected", "true");
  privateTab?.classList.add("page-tabs__tab--active");
  if (currentContext) startScoreLoads(currentContext, loadGeneration);
}

function deactivatePrivateTab(): void {
  if (!privateActive) return;
  privateActive = false;
  for (const [element, display] of officialContent) {
    element.style.removeProperty("display");
    if (display) element.style.display = display;
  }
  if (root) root.hidden = true;
  for (const [element, classes] of officialActiveClasses) {
    if (element.isConnected) element.classList.add(...classes);
  }
  officialActiveClasses.clear();
  privateTab?.setAttribute("aria-selected", "false");
  privateTab?.classList.remove("page-tabs__tab--active");
}

function render(): void {
  ensureRoot();
  if (!root) return;
  renderPreact(<RankingView />, root);
}

function RankingView() {
  const t = translations();
  const fatal = root?.getAttribute("data-fatal-error");
  const scores = selectedScores();
  const best = scores[0] ?? null;
  const myScores = selectedMyScores();
  const myBest = myScores[0] ?? null;
  const loadedCount = [...loaded.values()].filter((item) => item.status === "loaded").length;
  const loadingCount = [...loaded.values()].filter((item) => item.status === "loading").length;
  const selectedId = allSelected ? "__all__" : [...selectedServerIds][0] ?? "__all__";
  const hits = hitColumns(currentContext?.mode);

  return <>
    <div class="psr__toolbar">
      <button class="psr__status-toggle" type="button" data-status-toggle aria-expanded={statusExpanded} disabled={!servers.length}>
        {servers.length ? t.loadedServers(loadedCount, servers.length) : t.loadingServerList}
      </button>
      <div class="psr__filters">
        <label class="psr__filter">{t.ranking}
          <select data-ranking-filter value={selectedVariant}>
            {availableVariants(currentContext?.mode).map((variant) => <option key={variant} value={variant}>{variantLabel(variant)}</option>)}
          </select>
        </label>
        <label class="psr__filter">{t.server}
          <select data-server-filter value={selectedId} disabled={!servers.length}>
            <option value="__all__">{t.allPrivateServers}</option>
            {servers.map((server) => <option key={server.id} value={server.id}>{server.name}</option>)}
          </select>
        </label>
      </div>
    </div>
    <div class="psr__status-details" data-status-details hidden={!statusExpanded}><StatusChips /></div>
    {fatal ? <div class="psr__notice psr__notice--error">{fatal} — {t.configErrorSuffix}</div> : null}
    {best ? <div class="beatmap-scoreboard-top">
      <FeaturedScore score={best} position={1} />
      {myBest && !sameScore(best, myBest) ? <FeaturedScore score={myBest} position={combinedPosition(myBest)} /> : null}
    </div> : null}
    <div class="beatmap-scoreboard-table psr__table-wrap">
      <table class="beatmap-scoreboard-table__table">
        <thead><tr>
          <th class="beatmap-scoreboard-table__header beatmap-scoreboard-table__header--rank">{t.rank}</th>
          <th class="beatmap-scoreboard-table__header beatmap-scoreboard-table__header--grade"></th>
          <th class="beatmap-scoreboard-table__header beatmap-scoreboard-table__header--score">{t.score}</th>
          <th class="beatmap-scoreboard-table__header beatmap-scoreboard-table__header--accuracy">{t.accuracy}</th>
          <th class="beatmap-scoreboard-table__header beatmap-scoreboard-table__header--flag"></th>
          <th class="beatmap-scoreboard-table__header beatmap-scoreboard-table__header--player">{t.player}</th>
          <th class="beatmap-scoreboard-table__header beatmap-scoreboard-table__header--maxcombo">{t.maxCombo}</th>
          {hits.map((hit) => <th key={hit.field} class={`beatmap-scoreboard-table__header beatmap-scoreboard-table__header--hitstat beatmap-scoreboard-table__header--hit-${hit.modifier}`}>{hitLabel(hit)}</th>)}
          <th class="beatmap-scoreboard-table__header beatmap-scoreboard-table__header--pp">pp</th>
          <th class="beatmap-scoreboard-table__header beatmap-scoreboard-table__header--time">{t.time}</th>
          <th class="beatmap-scoreboard-table__header beatmap-scoreboard-table__header--mods">{t.mods}</th>
          <th class="beatmap-scoreboard-table__header beatmap-scoreboard-table__header--popup-menu"></th>
        </tr></thead>
        <tbody class="beatmap-scoreboard-table__body">
          {scores.length
            ? scores.map((score, index) => <ScoreRow key={`${score.serverId}:${score.scoreId ?? `${score.user.id}:${score.score}:${score.playedAt}`}`} score={score} first={index === 0} hits={hits} />)
            : <EmptyState loadingCount={loadingCount} selectedId={selectedId} hitColumnCount={hits.length} />}
        </tbody>
      </table>
    </div>
  </>;
}

function StatusChips() {
  if (!servers.length) return null;
  const t = translations();
  return <span class="psr__statuses">{servers.map((server) => {
    const result = loaded.get(server.id);
    const status = result?.status ?? "loading";
    const label = status === "loaded" ? t.loaded : status === "error" ? t.unavailable : t.loading;
    return <span key={server.id} class={`psr__status psr__status--${status}`} title={result?.error}>{server.name} · {label}</span>;
  })}</span>;
}

function FeaturedScore({ score, position }: { score: Score; position: number | string }) {
  const t = translations();
  const rankClass = normalizedGrade(score.grade);
  const hits = hitColumns(score.mode);
  return <div class="beatmap-score-top">
    <div class="beatmap-score-top__section">
      <div class="beatmap-score-top__wrapping-container beatmap-score-top__wrapping-container--left">
        <div class="beatmap-score-top__position"><div class="beatmap-score-top__position-number">#{position}</div>{rankClass ? <div class={`score-rank score-rank--tiny score-rank--${rankClass}`}></div> : null}</div>
        <div class="beatmap-score-top__avatar"><TopAvatar score={score} /></div>
        <div class="beatmap-score-top__user-box">
          <PlayerLink score={score} className="beatmap-score-top__username u-hover" />
          <div class="beatmap-score-top__achieved">{t.achieved} <FormattedTime value={score.playedAt} style="long" /></div>
          <div class="beatmap-score-top__flags"><Flag code={score.user.countryCode} /><ServerBadge score={score} /></div>
        </div>
      </div>
      <div class="beatmap-score-top__wrapping-container beatmap-score-top__wrapping-container--right">
        <div class="beatmap-score-top__stats"><div class="beatmap-score-top__stat"><div class="beatmap-score-top__stat-header beatmap-score-top__stat-header--wider">{t.totalScore}</div><div class="beatmap-score-top__stat-value beatmap-score-top__stat-value--score">{number.format(score.score)}</div></div></div>
        <div class="beatmap-score-top__stats">
          <TopStat label={t.accuracy} value={formatAccuracy(score.accuracy)} wider perfect={score.accuracy === 100} />
          <TopStat label={t.maxCombo} value={nullableNumber(score.maxCombo, "x")} wider perfect={score.perfect === true} />
        </div>
        <div class="beatmap-score-top__stats beatmap-score-top__stats--wrappable">
          {hits.map((hit) => <TopStat key={hit.field} label={hitLabel(hit)} value={nullableNumber(score[hit.field])} hitModifier={`hit-${hit.modifier}`} />)}
          <TopStat label="pp" value={score.pp == null ? "—" : number.format(Math.round(score.pp))} />
          <TopStat label={t.time} value={<FormattedTime value={score.playedAt} style="short" />} />
          <div class="beatmap-score-top__stat"><div class="beatmap-score-top__stat-header beatmap-score-top__stat-header--mods">{t.mods}</div><div class="beatmap-score-top__stat-value beatmap-score-top__stat-value--mods"><Mods items={score.mods} /></div></div>
        </div>
      </div>
    </div>
  </div>;
}

function TopStat({ label, value, hitModifier, wider = false, perfect = false }: { label: string; value: ComponentChildren; hitModifier?: string; wider?: boolean; perfect?: boolean }) {
  const headerClasses = ["beatmap-score-top__stat-header"];
  const valueClasses = ["beatmap-score-top__stat-value"];
  if (wider) headerClasses.push("beatmap-score-top__stat-header--wider");
  else valueClasses.push("beatmap-score-top__stat-value--smaller");
  if (perfect) valueClasses.push("beatmap-score-top__stat-value--perfect");
  if (hitModifier) {
    headerClasses.push(`beatmap-score-top__stat-header--${hitModifier}`);
    valueClasses.push(`beatmap-score-top__stat-value--${hitModifier}`);
  }
  return <div class="beatmap-score-top__stat"><div class={headerClasses.join(" ")}>{label}</div><div class={valueClasses.join(" ")}>{value}</div></div>;
}

function ScoreRow({ score, first, hits }: { score: Score; first: boolean; hits: readonly HitColumn[] }) {
  const rankClass = normalizedGrade(score.grade);
  const self = settings.servers.find((server) => server.id === score.serverId)?.myUserId === String(score.user.id);
  return <tr class={`beatmap-scoreboard-table__body-row beatmap-scoreboard-table__body-row--highlightable${first ? " beatmap-scoreboard-table__body-row--first" : ""}${self ? " beatmap-scoreboard-table__body-row--self" : ""}`}>
    <TableCell value={`#${score.combinedRank}`} modifier="rank" />
    <td class="beatmap-scoreboard-table__cell"><span class="beatmap-scoreboard-table__cell-content beatmap-scoreboard-table__cell-content--grade">{rankClass ? <span class={`score-rank score-rank--tiny score-rank--${rankClass}`}></span> : null}</span></td>
    <TableCell value={number.format(score.score)} modifier="score" />
    <TableCell value={formatAccuracy(score.accuracy)} />
    <TableCell value={<Flag code={score.user.countryCode} />} modifier="flag" />
    <td class="beatmap-scoreboard-table__cell beatmap-scoreboard-table__cell--player u-relative"><span class="beatmap-scoreboard-table__cell-content psr__player-cell"><PlayerLink score={score} className="beatmap-scoreboard-table__user-link" /><ServerBadge score={score} /></span></td>
    <TableCell value={nullableNumber(score.maxCombo, "x")} />
    {hits.map((hit) => <TableCell key={hit.field} value={nullableNumber(score[hit.field])} modifier={`hit-${hit.modifier}`} zero={score[hit.field] === 0} />)}
    <td class="beatmap-scoreboard-table__cell"><span class="beatmap-scoreboard-table__cell-content"><span class="pp-value" title={score.pp == null ? "" : String(score.pp)}>{score.pp == null ? "—" : number.format(Math.round(score.pp))}</span></span></td>
    <td class="beatmap-scoreboard-table__cell"><span class="beatmap-scoreboard-table__cell-content beatmap-scoreboard-table__cell-content--time"><FormattedTime value={score.playedAt} style="short" /></span></td>
    <td class="beatmap-scoreboard-table__cell beatmap-scoreboard-table__cell--player"><span class="beatmap-scoreboard-table__cell-content"><span class="beatmap-scoreboard-table__mods"><Mods items={score.mods} /></span></span></td>
    <td class="beatmap-scoreboard-table__cell"></td>
  </tr>;
}

function TableCell({ value, modifier, zero = false }: { value: ComponentChildren; modifier?: string; zero?: boolean }) {
  const suffix = modifier ? ` beatmap-scoreboard-table__cell-content--${modifier}` : "";
  const zeroClass = zero ? " beatmap-scoreboard-table__cell-content--zero" : "";
  return <td class="beatmap-scoreboard-table__cell"><span class={`beatmap-scoreboard-table__cell-content${suffix}${zeroClass}`}>{value}</span></td>;
}

function ServerBadge({ score }: { score: Score }) {
  return <span class="psr__server-badge">{score.serverName}</span>;
}

function PlayerLink({ score, className }: { score: Score; className: string }) {
  const href = playerProfileHref(score);
  if (!href) return <span class={className}>{score.user.username}</span>;
  return <a class={`${className} psr__player-link`} href={href} target="_blank" rel="noopener noreferrer">{score.user.username}</a>;
}

function playerProfileHref(score: Score): string | null {
  const server = settings.servers.find((candidate) => candidate.id === score.serverId);
  if (!server || !/^(?=.{3,253}$)(?!-)(?:[a-z0-9-]+\.)+[a-z0-9-]+$/i.test(server.domain)) return null;
  return userProfileUrl(server.domain, server.userProfileUrlTemplate, score.user.id);
}

function EmptyState({ loadingCount, selectedId, hitColumnCount }: { loadingCount: number; selectedId: string; hitColumnCount: number }) {
  const t = translations();
  if (selectedId !== "__all__") {
    const result = loaded.get(selectedId);
    if (result?.status === "loading") return <EmptyTableRow message={`${serverName(selectedId)} · ${t.loading}…`} hitColumnCount={hitColumnCount} />;
    if (result?.status === "error") return <EmptyTableRow message={`${serverName(selectedId)} · ${t.unavailable}`} hitColumnCount={hitColumnCount} />;
  }
  if (!servers.length) return <EmptyTableRow message={t.noServersConfigured} hitColumnCount={hitColumnCount} />;
  return <EmptyTableRow message={loadingCount ? t.loadingScores : t.noScoresFound} hitColumnCount={hitColumnCount} />;
}

function EmptyTableRow({ message, hitColumnCount }: { message: string; hitColumnCount: number }) {
  return <tr><td class="psr__empty" colSpan={11 + hitColumnCount}>{message}</td></tr>;
}

function TopAvatar({ score }: { score: Score }) {
  const avatarUrl = safeHttpsUrl(score.user.avatarUrl);
  const avatar = <span class="avatar avatar--guest" style={avatarUrl ? { backgroundImage: `url(${JSON.stringify(avatarUrl)})` } : undefined}></span>;
  const href = playerProfileHref(score);
  return href
    ? <a class="u-hover psr__player-link" href={href} target="_blank" rel="noopener noreferrer">{avatar}</a>
    : avatar;
}

function safeHttpsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function Mods({ items }: { items: string[] }) {
  return <span class="mods">{items.map((item, index) => {
    const acronym = item.toUpperCase().replace(/[^A-Z0-9]/g, "");
    return <span key={`${acronym}:${index}`} class={`mod mod--type-${modType(acronym)}`} title={item}><span class={`mod__icon mod__icon--${acronym}`} data-acronym={acronym}></span></span>;
  })}</span>;
}

function modType(acronym: string): string {
  if (["EZ", "NF", "HT", "DC"].includes(acronym)) return "DifficultyReduction";
  if (["HR", "SD", "PF", "DT", "NC", "HD", "FI", "FL", "BL"].includes(acronym)) return "DifficultyIncrease";
  if (["RX", "AP", "SO", "AT", "CN"].includes(acronym)) return "Automation";
  if (["MR", "RD", "CL", "TP"].includes(acronym)) return "Conversion";
  if (acronym === "NM") return "System";
  return "Fun";
}

function normalizedGrade(value: string | null): string {
  const grade = value?.toUpperCase().replace(/[^A-Z]/g, "") ?? "";
  return ["XH", "X", "SH", "S", "A", "B", "C", "D", "F"].includes(grade) ? grade : "";
}

function FormattedTime({ value, style }: { value: string | null; style: "long" | "short" }) {
  if (!value) return <>—</>;
  const time = new Date(value);
  if (Number.isNaN(time.valueOf())) return <>—</>;
  const elapsed = Date.now() - time.valueOf();
  const future = elapsed < 0;
  const absolute = Math.abs(elapsed);
  const averageMonth = 86_400_000 * 30.4375;
  const averageYear = 86_400_000 * 365.25;
  const units: [number, number, Intl.RelativeTimeFormatUnit, string][] = [
    [averageYear, averageYear, "year", "y"],
    [averageMonth, averageMonth, "month", "mo"],
    [86_400_000, 86_400_000, "day", "d"],
    [3_600_000, 3_600_000, "hour", "h"],
    [60_000, 60_000, "minute", "m"],
    [0, 1000, "second", "s"],
  ];
  const [, size, unit, suffix] = units.find(([threshold]) => absolute >= threshold) ?? units.at(-1)!;
  const amount = Math.max(1, Math.round(absolute / size)) * (future ? 1 : -1);
  const locale = activeLocale();
  const text = relativeTimeText(amount, unit, suffix, locale, style);
  const className = style === "short" ? "js-tooltip-time" : "js-timeago";
  return <time class={className} dateTime={style === "long" ? value : undefined} title={value}>{text}</time>;
}

function relativeTimeText(
  amount: number,
  unit: Intl.RelativeTimeFormatUnit,
  suffix: string,
  locale: string,
  style: "long" | "short",
): string {
  const absolute = Math.abs(amount);
  if (locale.startsWith("ja")) {
    const labels: Partial<Record<Intl.RelativeTimeFormatUnit, [string, string]>> = {
      year: ["年", "年"], quarter: ["四半期", "四半期"], month: ["ヶ月", "月"], week: ["週間", "週"],
      day: ["日", "日"], hour: ["時間", "時間"], minute: ["分", "分"], second: ["秒", "秒"],
    };
    const [longLabel, shortLabel] = labels[unit] ?? [unit, unit];
    return style === "short"
      ? `${absolute} ${shortLabel}`
      : `${absolute}${longLabel}${amount > 0 ? "後" : "前"}`;
  }
  if (style === "short") {
    return unit === "minute" || unit === "second" ? "now" : `${absolute}${suffix}`;
  }
  return new Intl.RelativeTimeFormat(locale, { numeric: "always", style: "long" }).format(amount, unit);
}

function formatAccuracy(value: number | null): string { return value == null ? "—" : `${value.toFixed(2)}%`; }
function nullableNumber(value: number | null, suffix = ""): string { return value == null ? "—" : `${number.format(value)}${suffix}`; }
function hitColumns(mode?: string): readonly HitColumn[] {
  return HIT_COLUMNS[mode === "catch" ? "fruits" : mode ?? "osu"] ?? HIT_COLUMNS.osu;
}
function availableVariants(mode?: string): RankingVariant[] {
  if (mode === "osu") return ["vanilla", "relax", "autopilot"];
  if (mode === "taiko" || mode === "fruits" || mode === "catch") return ["vanilla", "relax"];
  return ["vanilla"];
}
function variantLabel(variant: RankingVariant): string {
  const t = translations();
  return ({ vanilla: t.vanilla, relax: t.relax, autopilot: t.autopilot })[variant];
}
function hitLabel(hit: HitColumn): string {
  return activeLocale().startsWith("ja") && hit.modifier === "miss" ? "ミス" : hit.label;
}
function serverName(id: string): string { return servers.find((server) => server.id === id)?.name ?? id; }
function combinedPosition(score: Score): number { return selectedScores().find((item) => sameScore(item, score))?.combinedRank ?? score.originalServerRank; }
function sameScore(left: Score | null, right: Score): boolean {
  if (!left || left.serverId !== right.serverId) return false;
  if (left.scoreId != null && right.scoreId != null) return left.scoreId === right.scoreId;
  return left.user.id === right.user.id && left.score === right.score && left.playedAt === right.playedAt;
}
function Flag({ code }: { code: string | null }) {
  if (!code || !/^[A-Z]{2}$/i.test(code)) return null;
  const normalized = code.toUpperCase();
  const asset = [...normalized]
    .map((letter) => (127397 + letter.charCodeAt(0)).toString(16))
    .join("-");
  return <span class="flag-country flag-country--flat" title={normalized} style={{ backgroundImage: `url('/assets/images/flags/${asset}.svg')` }}></span>;
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function removeInjectedUi(): void {
  deactivatePrivateTab();
  if (root) renderPreact(null, root);
  document.querySelector("[data-psr-synthetic-wrapper]")?.remove();
  document.querySelector("[data-psr-private-tab]")?.remove();
  document.getElementById(ROOT_ID)?.remove();
  root = null;
  privateTab = null;
  officialTabs = [];
  officialContent.clear();
  officialActiveClasses.clear();
}

function checkPage(): void {
  const context = pageContext();
  if (!context) {
    removeInjectedUi();
    currentPageKey = "";
    currentContext = null;
    settingsReady = false;
    scoresStarted = false;
    return;
  }
  if (context.key !== currentPageKey) void beginLoad(context);
  else if (!document.getElementById(ROOT_ID) || !document.querySelector("[data-psr-private-tab]")) {
    removeInjectedUi();
    ensureRoot();
    render();
  }
}

window.addEventListener("hashchange", checkPage);
window.addEventListener("popstate", checkPage);
webext.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && (changes.servers || changes.lazyLoad) && currentContext) void beginLoad(currentContext);
});
new MutationObserver(checkPage).observe(document.documentElement, { childList: true, subtree: true });
setInterval(checkPage, 750);
checkPage();
