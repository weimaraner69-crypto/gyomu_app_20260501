-- 店舗スコープRLSへの移行
-- 実行対象: role/store モデル導入済み環境

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

CREATE OR REPLACE FUNCTION public.is_management_role()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_role() IN ('owner', 'manager', 'labor_consultant');
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
REVOKE ALL ON FUNCTION public.is_management_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_store(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.current_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_management_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_store(UUID) TO authenticated;

DROP POLICY IF EXISTS "自分のプロフィールのみ" ON profiles;
DROP POLICY IF EXISTS "自分のプロフィール更新" ON profiles;
DROP POLICY IF EXISTS "管理ロールのプロフィール閲覧" ON profiles;

CREATE POLICY "自分のプロフィール更新"
  ON profiles
  FOR ALL
  USING (auth.uid() = id);

CREATE POLICY "管理ロールのプロフィール閲覧"
  ON profiles
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

DROP POLICY IF EXISTS "認証済みは店舗を閲覧" ON stores;
DROP POLICY IF EXISTS "自分が参照可能な店舗" ON stores;

CREATE POLICY "自分が参照可能な店舗"
  ON stores
  FOR SELECT
  TO authenticated
  USING (public.can_access_store(stores.id));

DROP POLICY IF EXISTS "自分の所属店舗のみ" ON user_store_memberships;
DROP POLICY IF EXISTS "管理者は全所属を閲覧" ON user_store_memberships;
DROP POLICY IF EXISTS "管理ロールの所属閲覧" ON user_store_memberships;

CREATE POLICY "自分の所属店舗のみ"
  ON user_store_memberships
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "管理ロールの所属閲覧"
  ON user_store_memberships
  FOR SELECT
  USING (
    public.current_role() IN ('owner', 'labor_consultant')
    OR (
      public.current_role() = 'manager'
      AND public.can_access_store(store_id)
    )
  );

DROP POLICY IF EXISTS "自分の勤怠のみ" ON attendance;
DROP POLICY IF EXISTS "管理者は全員の勤怠を閲覧" ON attendance;
DROP POLICY IF EXISTS "勤怠参照ルール" ON attendance;
DROP POLICY IF EXISTS "勤怠登録ルール" ON attendance;
DROP POLICY IF EXISTS "勤怠更新ルール" ON attendance;

CREATE POLICY "勤怠参照ルール"
  ON attendance
  FOR SELECT
  USING (
    (auth.uid() = user_id AND (store_id IS NULL OR public.can_access_store(store_id)))
    OR (
      public.is_management_role()
      AND public.can_access_store(store_id)
    )
  );

CREATE POLICY "勤怠登録ルール"
  ON attendance
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

CREATE POLICY "勤怠更新ルール"
  ON attendance
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

DROP POLICY IF EXISTS "自分の日報のみ" ON daily_reports;
DROP POLICY IF EXISTS "日報参照ルール" ON daily_reports;
DROP POLICY IF EXISTS "日報登録ルール" ON daily_reports;
DROP POLICY IF EXISTS "日報更新ルール" ON daily_reports;

CREATE POLICY "日報参照ルール"
  ON daily_reports
  FOR SELECT
  USING (
    (auth.uid() = user_id AND (store_id IS NULL OR public.can_access_store(store_id)))
    OR (
      public.is_management_role()
      AND public.can_access_store(store_id)
    )
  );

CREATE POLICY "日報登録ルール"
  ON daily_reports
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

CREATE POLICY "日報更新ルール"
  ON daily_reports
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
