export {};

import { adapters, getAdapter } from "./adapters";
import { defaultUserProfileUrlTemplate } from "./server-settings";
import type { AdapterId, ServerSetting } from "./server-settings";

type ConfiguredServerSetting = ServerSetting & {
  adapter: AdapterId;
  apiEndpoint: string;
  enabled: boolean;
  userProfileUrlTemplate: string;
};

const webext = (globalThis as typeof globalThis & { browser?: typeof chrome }).browser ?? chrome;
const addForm = document.querySelector<HTMLFormElement>("#add-server-form")!;
const serverList = document.querySelector<HTMLDivElement>("#server-list")!;
const editDialog = document.querySelector<HTMLDialogElement>("#edit-server-dialog")!;
const editContent = document.querySelector<HTMLDivElement>("#edit-server-content")!;
const status = document.querySelector<HTMLParagraphElement>("#status")!;
const lazyLoadInput = document.querySelector<HTMLInputElement>("#lazy-load")!;
let servers: ConfiguredServerSetting[] = [];

async function init(): Promise<void> {
  const stored = await webext.storage.sync.get(["servers", "lazyLoad"]) as { servers?: ServerSetting[]; lazyLoad?: boolean };
  servers = (stored.servers ?? []).map(withAdapterDefaults);
  lazyLoadInput.checked = stored.lazyLoad ?? true;
  render();
  initializeEndpointControls(addForm);
}

lazyLoadInput.addEventListener("change", async () => {
  await webext.storage.sync.set({ lazyLoad: lazyLoadInput.checked });
  status.textContent = lazyLoadInput.checked
    ? "タブを開いたときに取得します。"
    : "osu!ページの表示時に取得します。";
});

function render(): void {
  serverList.replaceChildren(...servers.map(serverRow));
  status.textContent = servers.length
    ? `${servers.length}件のサーバーを登録済み（${servers.filter((server) => server.enabled).length}件有効）`
    : "サーバーが登録されていません。";
}

function serverRow(server: ConfiguredServerSetting): HTMLElement {
  const row = document.createElement("div");
  row.className = `server-row${server.enabled ? "" : " server-row--disabled"}`;
  row.dataset.serverId = server.id;
  row.innerHTML = `
    <div class="server-summary">
      <strong>${escapeHtml(server.name)}</strong>
      <span>${escapeHtml(server.domain)}</span>
    </div>
    <label class="toggle server-status">
      <input name="enabled" type="checkbox"${server.enabled ? " checked" : ""}>
      <span>${server.enabled ? "有効" : "無効"}</span>
    </label>
    <button type="button" data-edit>編集</button>`;
  return row;
}

function openEditDialog(server: ConfiguredServerSetting): void {
  const form = document.createElement("form");
  form.className = "server-card server-card--edit";
  form.dataset.serverId = server.id;
  form.innerHTML = `
    ${enabledField(server.enabled)}
    ${field("domain", "ドメイン", server.domain, "example.com", "text", true)}
    ${field("name", "表示名", server.name, "Server A", "text", true)}
    ${adapterField(server.adapter)}
    ${field("apiEndpoint", "API endpoint", server.apiEndpoint, "https://api.example.com/v1", "url", true)}
    ${field("timezone", "タイムゾーン", server.timezone, "Asia/Tokyo", "text", true)}
    ${field("myUserId", "自分のユーザーID", server.myUserId ?? "", "任意", "number", false)}
    ${field("userProfileUrlTemplate", "ユーザーページURL", server.userProfileUrlTemplate, "https://osu.example.com/users/{userId}", "text", true)}
    <div class="server-actions">
      <button class="save" type="submit">変更を保存</button>
      <button class="danger" type="button" data-remove>削除</button>
      <output aria-live="polite"></output>
    </div>`;
  initializeEndpointControls(form);
  editContent.replaceChildren(form);
  editDialog.showModal();
}

function field(
  name: keyof Omit<ServerSetting, "id">,
  label: string,
  value: string,
  placeholder: string,
  type: string,
  required: boolean,
  help?: string,
): string {
  const minimum = type === "number" ? ' min="1" step="1"' : "";
  return `<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${escapeHtml(value)}" placeholder="${placeholder}"${minimum}${required ? " required" : ""}>${help ? `<small>${help}</small>` : ""}</label>`;
}

function adapterField(selected: AdapterId): string {
  const options = adapters.map((adapter) => `<option value="${adapter.id}"${adapter.id === selected ? " selected" : ""}>${adapter.label}</option>`).join("");
  return `<label class="field"><span>Adapter</span><select name="adapter">${options}</select></label>`;
}

function enabledField(enabled: boolean): string {
  return `<label class="toggle server-enabled"><input name="enabled" type="checkbox"${enabled ? " checked" : ""}><span>有効</span></label>`;
}

addForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const output = addForm.querySelector<HTMLOutputElement>("output")!;
  output.textContent = "";
  try {
    const candidate = settingFromForm(addForm, crypto.randomUUID());
    if (servers.some((server) => server.domain === candidate.domain)) throw new Error("そのドメインは登録済みです。");
    if (!await requestApiAccess(candidate.apiEndpoint)) throw new Error("APIへのアクセスが許可されませんでした。");
    servers.push(candidate);
    await saveServers();
    addForm.reset();
    addForm.querySelector<HTMLInputElement>('[name="timezone"]')!.value = "UTC";
    initializeEndpointControls(addForm);
    render();
    status.textContent = `${candidate.name}を追加しました。`;
  } catch (error) {
    output.textContent = errorMessage(error);
  }
});

editContent.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target as HTMLFormElement;
  const output = form.querySelector<HTMLOutputElement>("output")!;
  output.textContent = "";
  const index = servers.findIndex((server) => server.id === form.dataset.serverId);
  if (index < 0) return;
  const previous = servers[index];
  try {
    const candidate = settingFromForm(form, previous.id);
    if (servers.some((server, otherIndex) => otherIndex !== index && server.domain === candidate.domain)) {
      throw new Error("そのドメインは登録済みです。");
    }
    if (!await requestApiAccess(candidate.apiEndpoint)) {
      throw new Error("APIへのアクセスが許可されませんでした。");
    }
    servers[index] = candidate;
    await saveServers();
    if (permissionOrigin(candidate.apiEndpoint) !== permissionOrigin(endpointFor(previous))) {
      await releaseUnusedAccess(endpointFor(previous));
    }
    editDialog.close();
    render();
    status.textContent = `${candidate.name}の変更を保存しました。`;
  } catch (error) {
    output.textContent = errorMessage(error);
  }
});

serverList.addEventListener("click", async (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>("[data-edit]");
  if (!button) return;
  const row = button.closest<HTMLElement>(".server-row");
  const server = servers.find((candidate) => candidate.id === row?.dataset.serverId);
  if (server) openEditDialog(server);
});

serverList.addEventListener("change", async (event) => {
  const input = event.target as HTMLInputElement;
  if (input.name !== "enabled") return;
  const row = input.closest<HTMLElement>(".server-row");
  const server = servers.find((candidate) => candidate.id === row?.dataset.serverId);
  if (!row || !server) return;
  const previous = server.enabled;
  server.enabled = input.checked;
  row.classList.toggle("server-row--disabled", !input.checked);
  row.querySelector<HTMLElement>(".server-status span")!.textContent = input.checked ? "有効" : "無効";
  try {
    await saveServers();
    status.textContent = `${server.name}を${input.checked ? "有効" : "無効"}にしました。`;
  } catch (error) {
    server.enabled = previous;
    input.checked = previous;
    row.classList.toggle("server-row--disabled", !previous);
    row.querySelector<HTMLElement>(".server-status span")!.textContent = previous ? "有効" : "無効";
    status.textContent = errorMessage(error);
  }
});

editContent.addEventListener("click", async (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>("[data-remove]");
  if (!button) return;
  const form = button.closest<HTMLFormElement>(".server-card")!;
  const index = servers.findIndex((server) => server.id === form.dataset.serverId);
  if (index < 0) return;
  const [removed] = servers.splice(index, 1);
  await saveServers();
  await releaseUnusedAccess(endpointFor(removed));
  editDialog.close();
  render();
  status.textContent = `${removed.name}を削除しました。`;
});

editDialog.addEventListener("click", (event) => {
  if ((event.target as Element).closest("[data-close-dialog]")) editDialog.close();
  if (event.target === editDialog) editDialog.close();
});

function settingFromForm(form: HTMLFormElement, id: string): ConfiguredServerSetting {
  const data = new FormData(form);
  const domain = normalizeDomain(String(data.get("domain") ?? ""));
  const name = String(data.get("name") ?? "").trim();
  const adapter = getAdapter(data.get("adapter"));
  const apiEndpoint = normalizeEndpoint(String(data.get("apiEndpoint") ?? ""));
  const timezone = String(data.get("timezone") ?? "").trim();
  const myUserId = String(data.get("myUserId") ?? "").trim();
  const userProfileUrlTemplate = normalizeUserProfileUrlTemplate(String(data.get("userProfileUrlTemplate") ?? ""));
  const enabled = data.has("enabled");
  if (!/^(?=.{3,253}$)(?!-)(?:[a-z0-9-]+\.)+[a-z0-9-]+$/.test(domain)) {
    throw new Error("ドメインは example.com の形式で入力してください。");
  }
  if (!name) throw new Error("表示名は必須です。");
  if (!apiEndpoint) throw new Error("API endpointは必須です。");
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); }
  catch { throw new Error("タイムゾーンには有効なIANAタイムゾーンを入力してください。"); }
  if (myUserId && (!/^\d+$/.test(myUserId) || myUserId === "0")) throw new Error("ユーザーIDは正の整数で入力してください。");
  return {
    id, domain, name, adapter: adapter.id, apiEndpoint, timezone, enabled, userProfileUrlTemplate,
    ...(myUserId ? { myUserId } : {}),
  };
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "").replace(/^api\./, "");
}
function normalizeEndpoint(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  let url: URL;
  try { url = new URL(trimmed); }
  catch { throw new Error("API endpointは完全なURLで入力してください。"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("API endpointにはクエリ等を含まないHTTPS URLを入力してください。");
  }
  return url.toString().replace(/\/$/, "");
}
function normalizeUserProfileUrlTemplate(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.match(/\{userId\}/g) ?? []).length !== 1) {
    throw new Error("ユーザーページURLには{userId}を1つ含めてください。");
  }
  let url: URL;
  try { url = new URL(trimmed.replace("{userId}", "1")); }
  catch { throw new Error("ユーザーページURLは完全なURLで入力してください。"); }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("ユーザーページURLには認証情報を含まないHTTPS URLを入力してください。");
  }
  return trimmed;
}
function endpointFor(server: ServerSetting): string {
  return server.apiEndpoint ?? getAdapter(server.adapter).defaultEndpoint(server.domain);
}
function permissionOrigin(endpoint: string): string { return `${new URL(endpoint).origin}/*`; }
function requestApiAccess(endpoint: string): Promise<boolean> {
  return webext.permissions.request({ origins: [permissionOrigin(endpoint)] });
}
async function releaseUnusedAccess(endpoint: string): Promise<void> {
  const origin = permissionOrigin(endpoint);
  if (!servers.some((server) => permissionOrigin(endpointFor(server)) === origin)) {
    await webext.permissions.remove({ origins: [origin] });
  }
}
function withAdapterDefaults(server: ServerSetting): ConfiguredServerSetting {
  const adapter = getAdapter(server.adapter);
  return {
    ...server,
    adapter: adapter.id,
    apiEndpoint: server.apiEndpoint ?? adapter.defaultEndpoint(server.domain),
    enabled: server.enabled !== false,
    userProfileUrlTemplate: server.userProfileUrlTemplate
      ?? defaultUserProfileUrlTemplate(server.domain),
  };
}

function initializeEndpointControls(form: HTMLFormElement): void {
  const endpoint = form.elements.namedItem("apiEndpoint") as HTMLInputElement | null;
  const domain = form.elements.namedItem("domain") as HTMLInputElement | null;
  const adapterSelect = form.elements.namedItem("adapter") as HTMLSelectElement | null;
  const profileUrl = form.elements.namedItem("userProfileUrlTemplate") as HTMLInputElement | null;
  if (!endpoint || !domain || !adapterSelect || !profileUrl) return;
  const expected = domain.value ? getAdapter(adapterSelect.value).defaultEndpoint(normalizeDomain(domain.value)) : "";
  endpoint.dataset.manual = String(!!endpoint.value && endpoint.value !== expected);
  const expectedProfile = domain.value
    ? defaultUserProfileUrlTemplate(normalizeDomain(domain.value))
    : "";
  profileUrl.dataset.manual = String(!!profileUrl.value && profileUrl.value !== expectedProfile);
}

document.addEventListener("input", (event) => {
  const input = event.target as HTMLInputElement;
  const form = input.closest<HTMLFormElement>(".server-card");
  if (!form) return;
  const endpoint = form.elements.namedItem("apiEndpoint") as HTMLInputElement;
  const profileUrl = form.elements.namedItem("userProfileUrlTemplate") as HTMLInputElement;
  if (input.name === "apiEndpoint") {
    endpoint.dataset.manual = "true";
  } else if (input.name === "userProfileUrlTemplate") {
    profileUrl.dataset.manual = "true";
  } else if (input.name === "domain" && endpoint.dataset.manual !== "true") {
    const domain = normalizeDomain(input.value);
    const adapter = getAdapter((form.elements.namedItem("adapter") as HTMLSelectElement).value);
    endpoint.value = domain ? adapter.defaultEndpoint(domain) : "";
  }
  if (input.name === "domain" && profileUrl.dataset.manual !== "true") {
    const domain = normalizeDomain(input.value);
    profileUrl.value = domain ? defaultUserProfileUrlTemplate(domain) : "";
  }
});

document.addEventListener("change", (event) => {
  const select = event.target as HTMLSelectElement;
  if (select.name !== "adapter") return;
  const form = select.closest<HTMLFormElement>(".server-card");
  if (!form) return;
  const domain = normalizeDomain((form.elements.namedItem("domain") as HTMLInputElement).value);
  const endpoint = form.elements.namedItem("apiEndpoint") as HTMLInputElement;
  endpoint.value = domain ? getAdapter(select.value).defaultEndpoint(domain) : "";
  endpoint.dataset.manual = "false";
});
function saveServers(): Promise<void> { return webext.storage.sync.set({ servers }); }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
}

void init();
