-- 非推奨: このファイルは旧仕様（休憩打刻あり）向けです
-- Phase1確定書準拠の現行環境では実行しないでください
-- 代わりに supabase-hotfix-phase1-alignment.sql を使用してください

ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS break_started_at TIMESTAMPTZ;

ALTER TABLE attendance
  ALTER COLUMN break_minutes SET DEFAULT 0;

UPDATE attendance
SET break_minutes = 0
WHERE break_minutes IS NULL;
