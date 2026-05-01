-- supabase-hotfix-transport-costs.sql
-- 月次交通費テーブルを追加

CREATE TABLE IF NOT EXISTS monthly_transport_costs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  store_id    uuid REFERENCES stores(id) ON DELETE SET NULL,
  month       date NOT NULL,  -- 月初日（例: 2026-05-01）
  amount      integer NOT NULL DEFAULT 0 CHECK (amount >= 0),
  note        text,
  updated_by  uuid REFERENCES profiles(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, month)
);

CREATE INDEX IF NOT EXISTS idx_monthly_transport_costs_month ON monthly_transport_costs(month);
CREATE INDEX IF NOT EXISTS idx_monthly_transport_costs_user_id ON monthly_transport_costs(user_id);

COMMENT ON TABLE monthly_transport_costs IS '月次交通費。month は月初日（YYYY-MM-01）で統一';

-- RLS
ALTER TABLE monthly_transport_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "management_can_read_transport"
  ON monthly_transport_costs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('owner', 'manager', 'labor_consultant')
    )
  );

CREATE POLICY "management_can_write_transport"
  ON monthly_transport_costs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "management_can_update_transport"
  ON monthly_transport_costs FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('owner', 'manager')
    )
  );
