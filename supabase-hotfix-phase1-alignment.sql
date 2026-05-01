-- Phase1確定書への準拠調整
-- 実行対象: 既に supabase-setup.sql を適用済みの環境

-- 深夜時間を分単位で記録する列を追加
ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS night_minutes INTEGER DEFAULT 0;

-- 既存データを初期化
UPDATE attendance
SET night_minutes = COALESCE(night_minutes, 0)
WHERE night_minutes IS NULL;

-- Phase1は休憩差し引きなしのため、旧休憩実績列は未使用扱いにする
UPDATE attendance
SET break_minutes = 0
WHERE break_minutes IS DISTINCT FROM 0;

UPDATE attendance
SET break_started_at = NULL
WHERE break_started_at IS NOT NULL;
