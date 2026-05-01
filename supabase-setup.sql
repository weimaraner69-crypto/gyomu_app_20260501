-- ユーザープロフィール（スタッフ情報）
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  department TEXT,
  role TEXT DEFAULT 'staff' CHECK (role IN ('owner', 'manager', 'labor_consultant', 'staff')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 店舗マスタ
CREATE TABLE stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 従業員の店舗所属（兼務対応）
CREATE TABLE user_store_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, store_id)
);

-- 出退勤記録
CREATE TABLE attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  store_id UUID REFERENCES stores(id),
  date DATE NOT NULL,
  clock_in TIMESTAMPTZ,
  clock_out TIMESTAMPTZ,
  work_minutes INTEGER,
  night_minutes INTEGER DEFAULT 0,
  status TEXT DEFAULT 'present' CHECK (
    status IN ('present', 'absent', 'late', 'early_leave', 'holiday')
  ),
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, store_id, date)
);

-- 日報
CREATE TABLE daily_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  store_id UUID REFERENCES stores(id),
  date DATE NOT NULL,
  attendance_id UUID REFERENCES attendance(id),
  tasks_done TEXT NOT NULL,
  achievements TEXT,
  issues TEXT,
  tomorrow_plan TEXT,
  submitted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, store_id, date)
);

-- 月次締め
CREATE TABLE monthly_closings (
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

-- 監査ログ（勤務修正履歴）
CREATE TABLE audit_logs (
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

-- RLS有効化
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_store_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_closings ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- ロール取得（SECURITY DEFINERでRLS再帰を回避）
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

-- 管理ロール判定
CREATE OR REPLACE FUNCTION public.is_management_role()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_role() IN ('owner', 'manager', 'labor_consultant');
$$;

-- 店舗アクセス可否判定
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

-- 月次締め判定
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

REVOKE ALL ON FUNCTION public.current_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_management_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_store(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_month_closed(UUID, DATE) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.current_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_management_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_store(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_month_closed(UUID, DATE) TO authenticated;

-- profiles: 自分のデータ更新は許可
CREATE POLICY "自分のプロフィール更新" ON profiles
  FOR ALL
  USING (auth.uid() = id);

-- profiles: 管理ロールの閲覧制御
CREATE POLICY "管理ロールのプロフィール閲覧" ON profiles
  FOR SELECT
  USING (
    public.current_role() IN ('owner', 'labor_consultant')
    OR (
      public.current_role() = 'manager'
      AND EXISTS (
        SELECT 1
        FROM public.user_store_memberships me
        JOIN public.user_store_memberships target
          ON me.store_id = target.store_id
        WHERE me.user_id = auth.uid()
          AND target.user_id = profiles.id
      )
    )
  );

-- stores: 自分がアクセス可能な店舗のみ参照
CREATE POLICY "自分が参照可能な店舗" ON stores
  FOR SELECT
  TO authenticated
  USING (public.can_access_store(stores.id));

-- 所属情報: 自分の所属は参照可能
CREATE POLICY "自分の所属店舗のみ" ON user_store_memberships
  FOR SELECT
  USING (auth.uid() = user_id);

-- 所属情報: 管理ロールは店舗範囲で参照可能
CREATE POLICY "管理ロールの所属閲覧" ON user_store_memberships
  FOR SELECT
  USING (
    public.current_role() IN ('owner', 'labor_consultant')
    OR (
      public.current_role() = 'manager'
      AND public.can_access_store(store_id)
    )
  );

-- attendance: 参照は店舗スコープ + ロール制御
CREATE POLICY "勤怠参照ルール" ON attendance
  FOR SELECT
  USING (
    (auth.uid() = user_id AND (store_id IS NULL OR public.can_access_store(store_id)))
    OR (
      public.is_management_role()
      AND public.can_access_store(store_id)
    )
  );

-- attendance: 登録は本人、またはオーナー/店長
CREATE POLICY "勤怠登録ルール" ON attendance
  FOR INSERT
  WITH CHECK (
    (
      auth.uid() = user_id
      AND (store_id IS NULL OR public.can_access_store(store_id))
    )
    OR (
      public.current_role() IN ('owner', 'manager')
      AND (store_id IS NULL OR public.can_access_store(store_id))
    )
  );

-- attendance: 更新は本人、またはオーナー/店長
CREATE POLICY "勤怠更新ルール" ON attendance
  FOR UPDATE
  USING (
    (
      auth.uid() = user_id
      AND (store_id IS NULL OR public.can_access_store(store_id))
    )
    OR (
      public.current_role() IN ('owner', 'manager')
      AND (store_id IS NULL OR public.can_access_store(store_id))
    )
  )
  WITH CHECK (
    (
      auth.uid() = user_id
      AND (store_id IS NULL OR public.can_access_store(store_id))
    )
    OR (
      public.current_role() IN ('owner', 'manager')
      AND (store_id IS NULL OR public.can_access_store(store_id))
    )
  );

-- daily_reports: 参照は店舗スコープ + ロール制御
CREATE POLICY "日報参照ルール" ON daily_reports
  FOR SELECT
  USING (
    (auth.uid() = user_id AND (store_id IS NULL OR public.can_access_store(store_id)))
    OR (
      public.is_management_role()
      AND public.can_access_store(store_id)
    )
  );

-- daily_reports: 登録は本人、またはオーナー/店長
CREATE POLICY "日報登録ルール" ON daily_reports
  FOR INSERT
  WITH CHECK (
    (
      auth.uid() = user_id
      AND (store_id IS NULL OR public.can_access_store(store_id))
    )
    OR (
      public.current_role() IN ('owner', 'manager')
      AND (store_id IS NULL OR public.can_access_store(store_id))
    )
  );

-- daily_reports: 更新は本人、またはオーナー/店長
CREATE POLICY "日報更新ルール" ON daily_reports
  FOR UPDATE
  USING (
    (
      auth.uid() = user_id
      AND (store_id IS NULL OR public.can_access_store(store_id))
    )
    OR (
      public.current_role() IN ('owner', 'manager')
      AND (store_id IS NULL OR public.can_access_store(store_id))
    )
  )
  WITH CHECK (
    (
      auth.uid() = user_id
      AND (store_id IS NULL OR public.can_access_store(store_id))
    )
    OR (
      public.current_role() IN ('owner', 'manager')
      AND (store_id IS NULL OR public.can_access_store(store_id))
    )
  );

-- monthly_closings: 管理ロール参照
CREATE POLICY "月次締め参照ルール" ON monthly_closings
  FOR SELECT
  USING (
    public.current_role() IN ('owner', 'labor_consultant')
    OR (
      public.current_role() = 'manager'
      AND public.can_access_store(store_id)
    )
  );

-- monthly_closings: 締め/解除はowner/managerのみ
CREATE POLICY "月次締め登録更新ルール" ON monthly_closings
  FOR INSERT
  WITH CHECK (
    public.current_role() IN ('owner', 'manager')
    AND public.can_access_store(store_id)
  );

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

-- 締め済み月への書き込みを禁止
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

-- audit_logs: 管理ロールは店舗スコープで閲覧可能
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

-- 監査ログ作成トリガー関数
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

-- ユーザー登録時にprofilesレコードを自動作成するトリガー
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
