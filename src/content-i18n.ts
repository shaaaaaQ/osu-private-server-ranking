export type Translations = {
  privateServer: string;
  server: string;
  allPrivateServers: string;
  loadingServerList: string;
  loadedServers: (loaded: number, total: number) => string;
  loaded: string;
  loading: string;
  unavailable: string;
  configErrorSuffix: string;
  rank: string;
  score: string;
  accuracy: string;
  player: string;
  maxCombo: string;
  time: string;
  mods: string;
  achieved: string;
  totalScore: string;
  loadingScores: string;
  noScoresFound: string;
  noServersConfigured: string;
};

// Add another language here using its <html lang> base code. Unknown languages use English.
const TRANSLATIONS: Record<string, Translations> = {
  en: {
    privateServer: "Private Server", server: "Server", allPrivateServers: "All Private Servers",
    loadingServerList: "Loading server list…", loadedServers: (loaded, total) => `Loaded ${loaded} / ${total} servers`,
    loaded: "Loaded", loading: "Loading", unavailable: "Unavailable",
    configErrorSuffix: "Check the extension settings.", rank: "Rank", score: "Score", accuracy: "Accuracy",
    player: "Player", maxCombo: "Max Combo",
    time: "Time", mods: "Mods", achieved: "achieved", totalScore: "Total Score",
    loadingScores: "Loading Private Server scores…", noScoresFound: "No scores found",
    noServersConfigured: "No Private Servers configured",
  },
  ja: {
    privateServer: "プライベートサーバー", server: "サーバー", allPrivateServers: "すべてのプライベートサーバー",
    loadingServerList: "サーバー一覧を読み込み中…", loadedServers: (loaded, total) => `読み込み済み ${loaded} / ${total} サーバー`,
    loaded: "読み込み済み", loading: "読み込み中", unavailable: "利用不可",
    configErrorSuffix: "拡張機能の設定を確認してください。", rank: "順位", score: "スコア", accuracy: "精度",
    player: "プレイヤー", maxCombo: "最大コンボ",
    time: "時間", mods: "Mods", achieved: "達成日", totalScore: "合計スコア",
    loadingScores: "プライベートサーバーのスコアを読み込み中…", noScoresFound: "スコアがありません",
    noServersConfigured: "Private Serverが設定されていません",
  },
};

export function translationForLocale(locale: string): Translations {
  return TRANSLATIONS[locale.toLowerCase().split("-")[0]] ?? TRANSLATIONS.en;
}

export function supportsLocale(locale: string): boolean {
  return locale.toLowerCase().split("-")[0] in TRANSLATIONS;
}
