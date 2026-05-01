-- GPS記録機能: attendanceテーブルに打刻時位置情報カラムを追加
-- Supabase SQL Editorで実行してください

ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS clock_in_latitude  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS clock_in_longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS clock_out_latitude  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS clock_out_longitude DOUBLE PRECISION;

COMMENT ON COLUMN attendance.clock_in_latitude  IS '出勤打刻時の緯度（任意）';
COMMENT ON COLUMN attendance.clock_in_longitude IS '出勤打刻時の経度（任意）';
COMMENT ON COLUMN attendance.clock_out_latitude  IS '退勤打刻時の緯度（任意）';
COMMENT ON COLUMN attendance.clock_out_longitude IS '退勤打刻時の経度（任意）';
