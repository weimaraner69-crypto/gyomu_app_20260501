import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single<{ role: string }>()

  if (!profile || !['owner', 'manager'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json() as { email?: string; full_name?: string; temp_password?: string }
  const { email, full_name, temp_password } = body

  if (
    !email || typeof email !== 'string' || !email.includes('@') ||
    !full_name || typeof full_name !== 'string' || !full_name.trim() ||
    !temp_password || typeof temp_password !== 'string' || temp_password.length < 8
  ) {
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 })
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceRoleKey || !supabaseUrl) {
    return NextResponse.json({ error: 'サーバー設定エラー' }, { status: 500 })
  }

  const adminClient = createAdminClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
    email: email.trim().toLowerCase(),
    password: temp_password,
    email_confirm: true,
  })

  if (createError || !newUser?.user) {
    const msg = createError?.message ?? 'ユーザー作成に失敗しました'
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  await adminClient.from('profiles').upsert({
    id: newUser.user.id,
    full_name: full_name.trim(),
    role: 'staff',
    is_active: true,
  }, { onConflict: 'id' })

  return NextResponse.json({ success: true, user_id: newUser.user.id })
}
