-- 月次締めワークフロー追加
-- 実行対象: 既に supabase-setup.sql を適用済みの環境

CREATE TABLE IF NOT EXISTS monthly_closings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  month DATE NOT NULL,
  is_closed BOOLEAN NOT NULL DEFAULT FALSE,
  closed_at TIMESTAMPTZ,
  closed_by UUID REFERENCES auth.users(id),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(store_id, month)
);

ALTER TABLE monthly_closings ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_month_closed(target_store_id UUID, target_date DATE)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN target_store_id IS NULL OR target_date IS NULL THEN FALSE
    ELSE EXISTS (
      SELECT 1
      FROM public.monthly_closings mc
      WHERE mc.store_id = target_store_id
        AND mc.month = date_trunc('month', target_date)::date
        AND mc.is_closed = TRUE
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.is_month_closed(UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_month_closed(UUID, DATE) TO authenticated;

DROP POLICY IF EXISTS "月次締め参照ルール" ON monthly_closings;
CREATE POLICY "月次締め参照ルール" ON monthly_closings
  FOR SELECT
  USING (
    public.current_role() IN ('owner', 'labor_consultant')
    OR (
      public.current_role() = 'manager'
      AND public.can_access_store(store_id)
    )
  );

DROP POLICY IF EXISTS "月次締め登録更新ルール" ON monthly_closings;
CREATE POLICY "月次締め登録更新ルール" ON monthly_closings
  FOR INSERT
  WITH CHECK (
    public.current_role() IN ('owner', 'manager')
    AND public.can_access_store(store_id)
  );

DROP POLICY IF EXISTS "月次締め更新ルール" ON monthly_closings;
CREATE POLICY "月次締め更新ルール" ON monthly_closings
  FOR UPDATE
  USING (
    public.current_role() IN ('owner', 'manager')
    AND public.can_access_store(store_id)
  )
  WITH CHECK (
    public.current_role() IN ('owner', 'manager')
    AND public.can_access_store(store_id)
  );

CREATE OR REPLACE FUNCTION public.block_write_on_closed_month()
RETURNS TRIGGER AS $$
DECLARE
  target_store UUID;
  target_date DATE;
BEGIN
  target_store := COALESCE(NEW.store_id, OLD.store_id);
  target_date := COALESCE(NEW.date, OLD.date);

  IF public.is_month_closed(target_store, target_date) THEN
    RAISE EXCEPTION 'この月は締め済みのため更新できません';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS attendance_monthly_close_block_trigger ON attendance;
CREATE TRIGGER attendance_monthly_close_block_trigger
BEFORE INSERT OR UPDATE ON attendance
FOR EACH ROW EXECUTE FUNCTION public.block_write_on_closed_month();

DROP TRIGGER IF EXISTS daily_reports_monthly_close_block_trigger ON daily_reports;
CREATE TRIGGER daily_reports_monthly_close_block_trigger
BEFORE INSERT OR UPDATE ON daily_reports
FOR EACH ROW EXECUTE FUNCTION public.block_write_on_closed_month();
