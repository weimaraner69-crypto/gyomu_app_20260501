-- supabase-hotfix-wage-histories.sql
-- 時給履歴テーブルを追加

CREATE TABLE IF NOT EXISTS wage_histories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  hourly_wage   integer NOT NULL CHECK (hourly_wage >= 0),
  effective_from date NOT NULL,
  effective_to   date,
  note          text,
  created_by    uuid REFERENCES profiles(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wage_histories_date_order CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS idx_wage_histories_user_id ON wage_histories(user_id);
CREATE INDEX IF NOT EXISTS idx_wage_histories_effective_from ON wage_histories(effective_from);

COMMENT ON TABLE wage_histories IS '時給変更履歴。effective_to が NULL の行が現在有効な時給';

-- RLS
ALTER TABLE wage_histories ENABLE ROW LEVEL SECURITY;

-- owner/manager/labor_consultant: 全行閲覧可
CREATE POLICY "management_can_read_wages"
  ON wage_histories FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('owner', 'manager', 'labor_consultant')
    )
  );

-- owner/manager: 挿入・更新可
CREATE POLICY "management_can_write_wages"
  ON wage_histories FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "management_can_update_wages"
  ON wage_histories FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('owner', 'manager')
    )
  );
