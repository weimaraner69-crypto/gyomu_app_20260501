-- ユーザープロフィール（スタッフ情報）
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  department TEXT,
  role TEXT DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 出退勤記録
CREATE TABLE attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  clock_in TIMESTAMPTZ,
  clock_out TIMESTAMPTZ,
  work_minutes INTEGER,
  break_minutes INTEGER DEFAULT 60,
  status TEXT DEFAULT 'present' CHECK (
    status IN ('present', 'absent', 'late', 'early_leave', 'holiday')
  ),
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date)
);

-- 日報
CREATE TABLE daily_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
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
  UNIQUE(user_id, date)
);

-- RLS有効化
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_reports ENABLE ROW LEVEL SECURITY;

-- profiles: 自分のデータのみ操作可能
CREATE POLICY "自分のプロフィールのみ" ON profiles FOR ALL USING (auth.uid() = id);

-- attendance: 自分のデータのみ
CREATE POLICY "自分の勤怠のみ" ON attendance FOR ALL USING (auth.uid() = user_id);

-- daily_reports: 自分のデータのみ
CREATE POLICY "自分の日報のみ" ON daily_reports FOR ALL USING (auth.uid() = user_id);

-- 管理者判定（SECURITY DEFINERでRLS再帰を回避）
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

-- 管理者はattendanceとprofilesを全件閲覧可能
CREATE POLICY "管理者は全員の勤怠を閲覧" ON attendance FOR SELECT
  USING (public.is_admin());

CREATE POLICY "管理者は全プロフィールを閲覧" ON profiles FOR SELECT
  USING (public.is_admin());

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
