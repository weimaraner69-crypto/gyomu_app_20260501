import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { formatWorkTime } from '@/types'
import type { Profile } from '@/types'

type AttendanceRow = {
  id: string
  user_id: string
  date: string
  clock_in: string | null
  clock_out: string | null
  work_minutes: number | null
  status: string
  profiles: {
    full_name: string
    department: string | null
  }
}

const STATUS_LABEL: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  present:     { label: '出勤',   variant: 'default' },
  absent:      { label: '欠勤',   variant: 'destructive' },
  late:        { label: '遅刻',   variant: 'secondary' },
  early_leave: { label: '早退',   variant: 'secondary' },
  holiday:     { label: '休暇',   variant: 'outline' },
}

export default async function AdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single<Profile>()

  if (profile?.role !== 'admin') redirect('/dashboard')

  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const firstDay = `${year}-${month}-01`
  const lastDay = `${year}-${month}-31`

  const { data: records } = await supabase
    .from('attendance')
    .select(`
      *,
      profiles!inner(full_name, department)
    `)
    .gte('date', firstDay)
    .lte('date', lastDay)
    .order('date', { ascending: false })

  const typedRecords = (records ?? []) as AttendanceRow[]

  // 月間集計
  const summary: Record<string, { name: string; department: string | null; workDays: number; totalMinutes: number }> = {}
  typedRecords.forEach((row) => {
    const key = row.user_id
    if (!summary[key]) {
      summary[key] = {
        name: row.profiles.full_name,
        department: row.profiles.department,
        workDays: 0,
        totalMinutes: 0
      }
    }
    summary[key].workDays++
    summary[key].totalMinutes += row.work_minutes ?? 0
  })

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">管理画面</h1>
          <p className="text-sm text-slate-500">
            {format(now, 'yyyy年MM月', { locale: ja })} の勤怠
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a href="/dashboard">
            <Button variant="outline" size="sm">スタッフ画面へ</Button>
          </a>
          <form action="/api/auth/signout" method="POST">
            <Button variant="ghost" size="sm" type="submit">ログアウト</Button>
          </form>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {/* 月間集計カード */}
        <div>
          <h2 className="text-sm font-medium text-slate-500 mb-3">月間サマリー</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(summary).map(([uid, s]) => (
              <Card key={uid} className="shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{s.name}</CardTitle>
                  {s.department && <p className="text-xs text-slate-500">{s.department}</p>}
                </CardHeader>
                <CardContent className="space-y-1">
                  <p className="text-sm">出勤日数: <span className="font-semibold">{s.workDays}日</span></p>
                  <p className="text-sm">勤務時間: <span className="font-semibold">{formatWorkTime(s.totalMinutes)}</span></p>
                </CardContent>
              </Card>
            ))}
            {Object.keys(summary).length === 0 && (
              <p className="text-sm text-slate-500 col-span-3">今月の記録はまだありません</p>
            )}
          </div>
        </div>

        {/* 勤怠一覧テーブル */}
        <div>
          <h2 className="text-sm font-medium text-slate-500 mb-3">打刻履歴</h2>
          <Card className="shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>日付</TableHead>
                  <TableHead>名前</TableHead>
                  <TableHead>部署</TableHead>
                  <TableHead>出勤</TableHead>
                  <TableHead>退勤</TableHead>
                  <TableHead>勤務時間</TableHead>
                  <TableHead>ステータス</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {typedRecords.map((row) => {
                  const st = STATUS_LABEL[row.status] ?? { label: row.status, variant: 'outline' as const }
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="text-sm">{format(new Date(row.date + 'T00:00:00'), 'M/d (E)', { locale: ja })}</TableCell>
                      <TableCell className="font-medium text-sm">{row.profiles.full_name}</TableCell>
                      <TableCell className="text-sm text-slate-500">{row.profiles.department ?? '-'}</TableCell>
                      <TableCell className="text-sm">{row.clock_in ? format(new Date(row.clock_in), 'HH:mm') : '-'}</TableCell>
                      <TableCell className="text-sm">{row.clock_out ? format(new Date(row.clock_out), 'HH:mm') : '-'}</TableCell>
                      <TableCell className="text-sm">{row.work_minutes != null ? formatWorkTime(row.work_minutes) : '-'}</TableCell>
                      <TableCell>
                        <Badge variant={st.variant}>{st.label}</Badge>
                      </TableCell>
                    </TableRow>
                  )
                })}
                {typedRecords.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-slate-400 py-8">記録がありません</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </div>
      </main>
    </div>
  )
}
