-- 店舗テーブルと所属設計の追加
-- 実行対象: 既に supabase-setup.sql を適用済みの環境

CREATE TABLE IF NOT EXISTS stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 既存環境で stores が存在する場合に列不足を補完
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS code TEXT,
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

ALTER TABLE stores
  ALTER COLUMN is_active SET DEFAULT TRUE,
  ALTER COLUMN created_at SET DEFAULT NOW();

UPDATE stores
SET is_active = TRUE
WHERE is_active IS NULL;

UPDATE stores
SET created_at = NOW()
WHERE created_at IS NULL;

-- code が未設定の既存レコードに一意コードを付与
UPDATE stores
SET code = CONCAT('store_', SUBSTRING(id::text, 1, 8))
WHERE code IS NULL OR btrim(code) = '';

ALTER TABLE stores
  ALTER COLUMN code SET NOT NULL,
  ALTER COLUMN name SET NOT NULL,
  ALTER COLUMN is_active SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL;

ALTER TABLE stores
  DROP CONSTRAINT IF EXISTS stores_code_key;

ALTER TABLE stores
  ADD CONSTRAINT stores_code_key UNIQUE (code);

CREATE TABLE IF NOT EXISTS user_store_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, store_id)
);

ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id);

ALTER TABLE daily_reports
  ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id);

ALTER TABLE attendance
  DROP CONSTRAINT IF EXISTS attendance_user_id_date_key;

ALTER TABLE attendance
  ADD CONSTRAINT attendance_user_id_store_id_date_key
  UNIQUE (user_id, store_id, date);

ALTER TABLE daily_reports
  DROP CONSTRAINT IF EXISTS daily_reports_user_id_date_key;

ALTER TABLE daily_reports
  ADD CONSTRAINT daily_reports_user_id_store_id_date_key
  UNIQUE (user_id, store_id, date);

ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_store_memberships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "認証済みは店舗を閲覧" ON stores;
CREATE POLICY "認証済みは店舗を閲覧"
  ON stores
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "自分の所属店舗のみ" ON user_store_memberships;
CREATE POLICY "自分の所属店舗のみ"
  ON user_store_memberships
  FOR ALL
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "管理者は全所属を閲覧" ON user_store_memberships;
CREATE POLICY "管理者は全所属を閲覧"
  ON user_store_memberships
  FOR SELECT
  USING (public.is_admin());

-- 初期店舗データ（必要に応じて編集）
INSERT INTO stores (code, name)
VALUES
  ('saketen', '酒店'),
  ('shokudo', '食堂'),
  ('dontsuki', 'どんつき')
ON CONFLICT (code) DO NOTHING;
