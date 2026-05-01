# gyomu-app

社内向けの出退勤管理と日報提出を行う Web アプリです。

## 主な機能

- メールアドレスとパスワードでのログイン
- スタッフの出勤・退勤打刻
- 当日の日報提出
- 管理者向けの月間勤怠サマリーと打刻履歴表示
- 管理者向けの月次CSV出力

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
- `stores` テーブル
- `user_store_memberships` テーブル
- `attendance` テーブル
- `daily_reports` テーブル
- `audit_logs` テーブル（監査ログ）
- RLS ポリシー
- 新規ユーザー登録時の `profiles` 自動作成トリガー

### 既存環境アップデート

すでに `supabase-setup.sql` を実行済みの環境では、以下の順で追加 SQL を実行してください。

1. `supabase-hotfix-role-model.sql`
2. `supabase-hotfix-store-model.sql`
3. `supabase-hotfix-rls-recursion.sql`
4. `supabase-hotfix-store-scope-rls.sql`
5. `supabase-hotfix-audit-logs.sql`
6. `supabase-hotfix-monthly-closing.sql`
7. `supabase-hotfix-phase1-alignment.sql`

これにより、以下が反映されます。

- `profiles.role` を4ロールモデルへ移行（`owner` / `manager` / `labor_consultant` / `staff`）
- `stores` / `user_store_memberships` と `store_id`（attendance/daily_reports）を追加
- `profiles` ポリシーの再帰エラー修正
- 店舗スコープのRLS（owner/manager/labor_consultant/staff）を適用
- `audit_logs` テーブルと勤怠/日報の自動監査ログトリガーを追加
- `monthly_closings` テーブルと締め月の更新禁止トリガーを追加
- `attendance.night_minutes` 追加
- 休憩関連の旧列を未使用化（Phase1仕様に整合）

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

- 管理画面にアクセスできるロールは `owner` / `manager` / `labor_consultant` です。
- 勤務時間は「退勤時刻 - 出勤時刻」の分単位で計算します。
- 深夜時間（22:00〜翌05:00）は `night_minutes` として分単位で保存します。

## 管理者ユーザー設定手順

初回は全ユーザーが `staff` で作成されます。管理権限を付与したいユーザーを選び、Supabase SQL Editor で次を実行してください。

```sql
update profiles
set role = 'owner'
where id = '対象ユーザーのUUID';
```

`対象ユーザーのUUID` は Supabase の `auth.users` もしくは `profiles` テーブルから確認できます。
