-- supabase-hotfix-employee-master.sql
-- profiles テーブルに従業員マスタ項目を追加

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS name_kana        text,
  ADD COLUMN IF NOT EXISTS employment_type  text NOT NULL DEFAULT 'part_time'
    CHECK (employment_type IN ('full_time', 'part_time', 'contract')),
  ADD COLUMN IF NOT EXISTS hourly_wage      integer,
  ADD COLUMN IF NOT EXISTS is_active        boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN profiles.name_kana       IS 'よみがな（全角カタカナ）';
COMMENT ON COLUMN profiles.employment_type IS '雇用形態: full_time=正社員 / part_time=アルバイト / contract=契約社員';
COMMENT ON COLUMN profiles.hourly_wage     IS '現在の時給（円）。変更履歴は wage_histories で管理';
COMMENT ON COLUMN profiles.is_active       IS '在籍中フラグ。退職処理後 false にする';
