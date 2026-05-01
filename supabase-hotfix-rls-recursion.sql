-- RLS再帰エラー（profilesポリシー自己参照）修正
-- 実行対象: 既に supabase-setup.sql を適用済みの環境

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

DROP POLICY IF EXISTS "管理者は全員の勤怠を閲覧" ON attendance;
CREATE POLICY "管理者は全員の勤怠を閲覧"
  ON attendance
  FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "管理者は全プロフィールを閲覧" ON profiles;
CREATE POLICY "管理者は全プロフィールを閲覧"
  ON profiles
  FOR SELECT
  USING (public.is_admin());
