-- 休憩60分固定を廃止し、実績記録方式へ変更
-- 実行対象: 既に supabase-setup.sql を適用済みの環境

ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS break_started_at TIMESTAMPTZ;

ALTER TABLE attendance
  ALTER COLUMN break_minutes SET DEFAULT 0;

UPDATE attendance
SET break_minutes = 0
WHERE break_minutes IS NULL;
