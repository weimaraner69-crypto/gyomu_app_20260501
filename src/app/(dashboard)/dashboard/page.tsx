import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ClockButton } from '@/components/attendance/ClockButton'
import { DailyReportForm } from '@/components/attendance/DailyReportForm'
import { Button } from '@/components/ui/button'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { canAccessManagement, type Profile } from '@/types'

type MembershipRow = {
  store_id: string
  stores: { name: string } | null
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single<Profile>()

  const { data: memberships } = await supabase
    .from('user_store_memberships')
    .select('store_id, stores(name)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })

  const typedMemberships = (memberships ?? []) as unknown as MembershipRow[]
  const currentStoreId = typedMemberships[0]?.store_id ?? null
  const currentStoreName = typedMemberships[0]?.stores?.name ?? null

  const today = format(new Date(), 'yyyy-MM-dd')

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ヘッダー */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">出退勤管理</h1>
          <p className="text-sm text-slate-500">
            {format(new Date(), 'yyyy年MM月dd日 (E)', { locale: ja })}
          </p>
          {currentStoreName && <p className="text-xs text-slate-500">現在店舗: {currentStoreName}</p>}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-600">{profile?.full_name ?? user.email}</span>
          <a href="/history">
            <Button variant="outline" size="sm">勤怠履歴</Button>
          </a>
          {canAccessManagement(profile?.role) && (
            <a href="/admin">
              <Button variant="outline" size="sm">管理画面</Button>
            </a>
          )}
          <form action="/api/auth/signout" method="POST">
            <Button variant="ghost" size="sm" type="submit">ログアウト</Button>
          </form>
        </div>
      </header>

      {/* メインコンテンツ */}
      <main className="max-w-2xl mx-auto px-6 py-8 space-y-8">
        <ClockButton userId={user.id} storeId={currentStoreId} />
        <DailyReportForm userId={user.id} storeId={currentStoreId} date={today} />
      </main>
    </div>
  )
}
