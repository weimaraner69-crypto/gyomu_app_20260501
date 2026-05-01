-- 4ロールモデルへの移行
-- 実行対象: 既に supabase-setup.sql を適用済みの環境

-- 旧ロール値を新ロール値へ移行
UPDATE profiles
SET role = CASE role
  WHEN 'admin' THEN 'owner'
  WHEN 'member' THEN 'staff'
  ELSE role
END;

-- ロール制約を4ロールへ変更
ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('owner', 'manager', 'labor_consultant', 'staff'));

-- 既定値を staff に変更
ALTER TABLE profiles
  ALTER COLUMN role SET DEFAULT 'staff';

-- 管理ロール判定を新ロールに合わせる
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
      AND role IN ('owner', 'manager', 'labor_consultant')
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
