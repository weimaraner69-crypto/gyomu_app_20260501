# gyomu-app

社内向けの出退勤管理と日報提出を行う Web アプリです。

## 主な機能

- メールアドレスとパスワードでのログイン
- スタッフの出勤・退勤打刻
- 当日の日報提出
- 管理者向けの月間勤怠サマリーと打刻履歴表示

## 技術スタック

- Next.js 16 (App Router)
- React 19
- TypeScript
- Supabase (Auth / Database / RLS)
- Tailwind CSS

## 事前準備

1. Node.js 20 以上をインストール
2. Supabase プロジェクトを作成
3. このリポジトリを取得後、依存パッケージをインストール

```bash
npm install
```

## 環境変数

プロジェクトルートの `.env.local` に以下を設定します。

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

## DB 初期化

`supabase-setup.sql` を Supabase SQL Editor で実行してください。

この SQL で以下を作成します。

- `profiles` テーブル
- `attendance` テーブル
- `daily_reports` テーブル
- RLS ポリシー
- 新規ユーザー登録時の `profiles` 自動作成トリガー

## 開発サーバー起動

```bash
npm run dev
```

ブラウザで `http://localhost:3000` を開いて確認します。

## 画面導線

- `/` : `/dashboard` へリダイレクト
- `/login` : ログイン画面
- `/dashboard` : スタッフ向け画面（打刻、日報）
- `/admin` : 管理者向け画面（月間サマリー、打刻履歴）

## 開発用コマンド

```bash
npm run dev
npm run lint
npm run build
npm run start
```

## 備考

- 管理者画面にアクセスするには、`profiles.role` を `admin` に設定してください。
- 勤務時間は「退勤時刻 - 出勤時刻 - 休憩時間」で計算します。
