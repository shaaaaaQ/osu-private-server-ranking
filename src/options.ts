export {};

type ServerSetting = {
  id: string;
  domain: string;
  name: string;
  timezone: string;
  myUserId?: string;
};

const webext = (globalThis as typeof globalThis & { browser?: typeof chrome }).browser ?? chrome;
const addForm = document.querySelector<HTMLFormElement>("#add-server-form")!;
const serverList = document.querySelector<HTMLDivElement>("#server-list")!;
const status = document.querySelector<HTMLParagraphElement>("#status")!;
const lazyLoadInput = document.querySelector<HTMLInputElement>("#lazy-load")!;
let servers: ServerSetting[] = [];

async function init(): Promise<void> {
  const stored = await webext.storage.sync.get(["servers", "lazyLoad"]) as { servers?: ServerSetting[]; lazyLoad?: boolean };
  servers = stored.servers ?? [];
  lazyLoadInput.checked = stored.lazyLoad ?? true;
  render();
}

lazyLoadInput.addEventListener("change", async () => {
  await webext.storage.sync.set({ lazyLoad: lazyLoadInput.checked });
  status.textContent = lazyLoadInput.checked
    ? "タブを開いたときに取得します。"
    : "osu!ページの表示時に取得します。";
});

function render(): void {
  serverList.replaceChildren(...servers.map(serverCard));
  status.textContent = servers.length
    ? `${servers.length}件のサーバーを登録済み`
    : "サーバーが登録されていません。";
}

function serverCard(server: ServerSetting): HTMLElement {
  const form = document.createElement("form");
  form.className = "server-card";
  form.dataset.serverId = server.id;
  form.innerHTML = `
    ${field("domain", "ドメイン", server.domain, "example.test", "text", true)}
    ${field("name", "表示名", server.name, "Server A", "text", true)}
    ${field("timezone", "タイムゾーン", server.timezone, "Asia/Tokyo", "text", true)}
    ${field("myUserId", "自分のユーザーID", server.myUserId ?? "", "任意", "number", false)}
    <div class="server-actions">
      <button class="save" type="submit">変更を保存</button>
      <button class="danger" type="button" data-remove>削除</button>
      <output aria-live="polite"></output>
    </div>`;
  return form;
}

function field(
  name: keyof Omit<ServerSetting, "id">,
  label: string,
  value: string,
  placeholder: string,
  type: string,
  required: boolean,
): string {
  const minimum = type === "number" ? ' min="1" step="1"' : "";
  return `<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${escapeHtml(value)}" placeholder="${placeholder}"${minimum}${required ? " required" : ""}></label>`;
}

addForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const output = addForm.querySelector<HTMLOutputElement>("output")!;
  output.textContent = "";
  try {
    const candidate = settingFromForm(addForm, crypto.randomUUID());
    if (servers.some((server) => server.domain === candidate.domain)) throw new Error("そのドメインは登録済みです。");
    if (!await requestApiAccess(candidate.domain)) throw new Error("APIへのアクセスが許可されませんでした。");
    servers.push(candidate);
    await saveServers();
    addForm.reset();
    addForm.querySelector<HTMLInputElement>('[name="timezone"]')!.value = "UTC";
    render();
    status.textContent = `${candidate.name}を追加しました。`;
  } catch (error) {
    output.textContent = errorMessage(error);
  }
});

serverList.addEventListener("submit", async (event) => {
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
    if (!await requestApiAccess(candidate.domain)) {
      throw new Error("APIへのアクセスが許可されませんでした。");
    }
    servers[index] = candidate;
    await saveServers();
    if (candidate.domain !== previous.domain) await releaseUnusedAccess(previous.domain);
    render();
    status.textContent = `${candidate.name}の変更を保存しました。`;
  } catch (error) {
    output.textContent = errorMessage(error);
  }
});

serverList.addEventListener("click", async (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>("[data-remove]");
  if (!button) return;
  const form = button.closest<HTMLFormElement>(".server-card")!;
  const index = servers.findIndex((server) => server.id === form.dataset.serverId);
  if (index < 0) return;
  const [removed] = servers.splice(index, 1);
  await saveServers();
  await releaseUnusedAccess(removed.domain);
  render();
  status.textContent = `${removed.name}を削除しました。`;
});

function settingFromForm(form: HTMLFormElement, id: string): ServerSetting {
  const data = new FormData(form);
  const domain = normalizeDomain(String(data.get("domain") ?? ""));
  const name = String(data.get("name") ?? "").trim();
  const timezone = String(data.get("timezone") ?? "").trim();
  const myUserId = String(data.get("myUserId") ?? "").trim();
  if (!/^(?=.{3,253}$)(?!-)(?:[a-z0-9-]+\.)+[a-z0-9-]+$/.test(domain)) {
    throw new Error("ドメインは example.test の形式で入力してください。");
  }
  if (!name) throw new Error("表示名は必須です。");
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); }
  catch { throw new Error("タイムゾーンには有効なIANAタイムゾーンを入力してください。"); }
  if (myUserId && (!/^\d+$/.test(myUserId) || myUserId === "0")) throw new Error("ユーザーIDは正の整数で入力してください。");
  return { id, domain, name, timezone, ...(myUserId ? { myUserId } : {}) };
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "").replace(/^api\./, "");
}
function permissionOrigin(domain: string): string { return `https://api.${domain}/*`; }
function requestApiAccess(domain: string): Promise<boolean> {
  return webext.permissions.request({ origins: [permissionOrigin(domain)] });
}
async function releaseUnusedAccess(domain: string): Promise<void> {
  if (!servers.some((server) => server.domain === domain)) {
    await webext.permissions.remove({ origins: [permissionOrigin(domain)] });
  }
}
function saveServers(): Promise<void> { return webext.storage.sync.set({ servers }); }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
}

void init();
