-- 監査ログ（勤務修正履歴）を追加

-- 依存関数（未作成環境向け）
CREATE OR REPLACE FUNCTION public.current_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.profiles
  WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.can_access_store(target_store_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.current_role() IN ('owner', 'labor_consultant') THEN TRUE
    WHEN target_store_id IS NULL THEN FALSE
    ELSE EXISTS (
      SELECT 1
      FROM public.user_store_memberships m
      WHERE m.user_id = auth.uid()
        AND m.store_id = target_store_id
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.current_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_store(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_store(UUID) TO authenticated;

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL CHECK (table_name IN ('attendance', 'daily_reports')),
  record_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  actor_user_id UUID REFERENCES auth.users(id),
  target_user_id UUID REFERENCES auth.users(id),
  store_id UUID REFERENCES stores(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  before_data JSONB,
  after_data JSONB
);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "監査ログ参照ルール" ON audit_logs;
CREATE POLICY "監査ログ参照ルール" ON audit_logs
  FOR SELECT
  USING (
    public.current_role() IN ('owner', 'labor_consultant')
    OR (
      public.current_role() = 'manager'
      AND store_id IS NOT NULL
      AND public.can_access_store(store_id)
    )
    OR (
      target_user_id = auth.uid()
      AND (
        store_id IS NULL
        OR public.can_access_store(store_id)
      )
    )
  );

CREATE OR REPLACE FUNCTION public.log_audit_event()
RETURNS TRIGGER AS $$
DECLARE
  target_uid UUID;
  target_store UUID;
BEGIN
  target_uid := COALESCE(NEW.user_id, OLD.user_id);
  target_store := COALESCE(NEW.store_id, OLD.store_id);

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_logs (
      table_name,
      record_id,
      action,
      actor_user_id,
      target_user_id,
      store_id,
      before_data,
      after_data
    ) VALUES (
      TG_TABLE_NAME,
      NEW.id,
      'insert',
      auth.uid(),
      target_uid,
      target_store,
      NULL,
      to_jsonb(NEW)
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.audit_logs (
      table_name,
      record_id,
      action,
      actor_user_id,
      target_user_id,
      store_id,
      before_data,
      after_data
    ) VALUES (
      TG_TABLE_NAME,
      NEW.id,
      'update',
      auth.uid(),
      target_uid,
      target_store,
      to_jsonb(OLD),
      to_jsonb(NEW)
    );
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_logs (
      table_name,
      record_id,
      action,
      actor_user_id,
      target_user_id,
      store_id,
      before_data,
      after_data
    ) VALUES (
      TG_TABLE_NAME,
      OLD.id,
      'delete',
      auth.uid(),
      target_uid,
      target_store,
      to_jsonb(OLD),
      NULL
    );
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS attendance_audit_trigger ON attendance;
CREATE TRIGGER attendance_audit_trigger
AFTER INSERT OR UPDATE OR DELETE ON attendance
FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

DROP TRIGGER IF EXISTS daily_reports_audit_trigger ON daily_reports;
CREATE TRIGGER daily_reports_audit_trigger
AFTER INSERT OR UPDATE OR DELETE ON daily_reports
FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();
