# osu! Private Server Ranking

このプロジェクトには、OpenAI Codexを使用して生成したコードが含まれています。

## ビルド

```sh
pnpm install --frozen-lockfile
pnpm build
```

ビルド結果は `dist/chrome` と `dist/firefox` に出力されます。

## ブラウザーに追加

### Chrome

1. `chrome://extensions` を開く
2. 「デベロッパー モード」をオンにする
3. 「パッケージ化されていない拡張機能を読み込む」から `dist/chrome` を選ぶ

### Firefox

1. `about:debugging#/runtime/this-firefox` を開く
2. 「一時的なアドオンを読み込む」を選ぶ
3. `dist/firefox/manifest.json` を選ぶ

## 設定

拡張機能の設定画面を開き、プライベートサーバーごとに次の項目を入力します。

- ドメイン
- 表示名
- タイムゾーン（[IANA Time Zone Database](https://www.iana.org/time-zones) の名称。例: `Asia/Tokyo`）
- 自分のユーザーID（任意）

サーバーを追加すると、APIへのアクセス許可を求められます。

「タブを開いたときに取得する」はデフォルトでオンです。オンの場合、登録したサーバーのタブを開くまでAPIへ通信しません。
