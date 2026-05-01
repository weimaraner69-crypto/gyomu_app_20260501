import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table'
import { format, startOfMonth, endOfMonth, subMonths, addMonths } from 'date-fns'
import { ja } from 'date-fns/locale'
import { formatWorkTime, type Profile } from '@/types'
import type { Attendance, DailyReport } from '@/types'

const STATUS_LABEL: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  present:     { label: '出勤',   variant: 'default' },
  absent:      { label: '欠勤',   variant: 'destructive' },
  late:        { label: '遅刻',   variant: 'secondary' },
  early_leave: { label: '早退',   variant: 'secondary' },
  holiday:     { label: '休暇',   variant: 'outline' },
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single<Profile>()

  // 表示月を searchParams から決定
  const params = await searchParams
  let targetDate: Date
  if (params.month) {
    const parsed = new Date(params.month + '-01T00:00:00')
    targetDate = isNaN(parsed.getTime()) ? new Date() : parsed
  } else {
    targetDate = new Date()
  }

  const firstDay = format(startOfMonth(targetDate), 'yyyy-MM-dd')
  const lastDay = format(endOfMonth(targetDate), 'yyyy-MM-dd')
  const prevMonth = format(subMonths(targetDate, 1), 'yyyy-MM')
  const nextMonth = format(addMonths(targetDate, 1), 'yyyy-MM')
  const currentMonth = format(new Date(), 'yyyy-MM')
  const isCurrentMonth = format(targetDate, 'yyyy-MM') === currentMonth

  // 勤怠取得
  const { data: attendanceRaw } = await supabase
    .from('attendance')
    .select('*')
    .eq('user_id', user.id)
    .gte('date', firstDay)
    .lte('date', lastDay)
    .order('date', { ascending: false })

  const attendanceList = (attendanceRaw ?? []) as Attendance[]

  // 日報取得
  const { data: reportRaw } = await supabase
    .from('daily_reports')
    .select('id, date, tasks_done, achievements, issues, tomorrow_plan, submitted_at, reviewed_at')
    .eq('user_id', user.id)
    .gte('date', firstDay)
    .lte('date', lastDay)

  type ReportRow = Pick<DailyReport, 'id' | 'date' | 'tasks_done' | 'submitted_at' | 'reviewed_at'> & {
    achievements: string | null
    issues: string | null
    tomorrow_plan: string | null
  }
  const reportMap = new Map(
    (reportRaw ?? [] as ReportRow[]).map((r) => [r.date, r])
  )

  // 月間集計
  const totalWorkDays = attendanceList.filter((r) => r.work_minutes != null && r.work_minutes > 0).length
  const totalWorkMinutes = attendanceList.reduce((sum, r) => sum + (r.work_minutes ?? 0), 0)
  const totalNightMinutes = attendanceList.reduce((sum, r) => sum + (r.night_minutes ?? 0), 0)

  // 店舗名マップ
  const storeIds = Array.from(new Set(attendanceList.map((r) => r.store_id).filter((id): id is string => !!id)))
  const { data: storeRaw } = storeIds.length
    ? await supabase.from('stores').select('id, name').in('id', storeIds)
    : { data: [] }
  const storeMap = new Map((storeRaw ?? []).map((s: { id: string; name: string }) => [s.id, s.name]))

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">勤怠履歴</h1>
          <p className="text-sm text-slate-500">{profile?.full_name ?? user.email}</p>
        </div>
        <div className="flex items-center gap-3">
          <a href="/dashboard">
            <Button variant="outline" size="sm">打刻画面へ</Button>
          </a>
          <form action="/api/auth/signout" method="POST">
            <Button variant="ghost" size="sm" type="submit">ログアウト</Button>
          </form>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {/* 月ナビゲーション */}
        <div className="flex items-center justify-between">
          <a href={`/history?month=${prevMonth}`}>
            <Button variant="outline" size="sm">← 前月</Button>
          </a>
          <h2 className="text-base font-semibold text-slate-800">
            {format(targetDate, 'yyyy年MM月', { locale: ja })}
          </h2>
          {!isCurrentMonth ? (
            <a href={`/history?month=${nextMonth}`}>
              <Button variant="outline" size="sm">翌月 →</Button>
            </a>
          ) : (
            <Button variant="outline" size="sm" disabled>翌月 →</Button>
          )}
        </div>

        {/* 月間サマリー */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="shadow-sm">
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs text-slate-500">出勤日数</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="text-2xl font-bold text-slate-900">{totalWorkDays}<span className="text-sm font-normal text-slate-500 ml-1">日</span></p>
            </CardContent>
          </Card>
          <Card className="shadow-sm">
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs text-slate-500">総勤務時間</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="text-2xl font-bold text-slate-900">{formatWorkTime(totalWorkMinutes)}</p>
            </CardContent>
          </Card>
          <Card className="shadow-sm">
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs text-slate-500">深夜時間</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="text-2xl font-bold text-slate-900">{formatWorkTime(totalNightMinutes)}</p>
            </CardContent>
          </Card>
        </div>

        {/* 打刻履歴テーブル */}
        <Card className="shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>日付</TableHead>
                <TableHead>店舗</TableHead>
                <TableHead>出勤</TableHead>
                <TableHead>退勤</TableHead>
                <TableHead>勤務時間</TableHead>
                <TableHead>深夜</TableHead>
                <TableHead>ステータス</TableHead>
                <TableHead>日報</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {attendanceList.map((row) => {
                const st = STATUS_LABEL[row.status] ?? { label: row.status, variant: 'outline' as const }
                const report = reportMap.get(row.date)
                const hasUnclocked = !!row.clock_in && !row.clock_out
                return (
                  <TableRow key={row.id}>
                    <TableCell className="text-sm whitespace-nowrap">
                      {format(new Date(row.date + 'T00:00:00'), 'M/d (E)', { locale: ja })}
                    </TableCell>
                    <TableCell className="text-sm text-slate-500">
                      {row.store_id ? (storeMap.get(row.store_id) ?? '-') : '-'}
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.clock_in ? format(new Date(row.clock_in), 'HH:mm') : '-'}
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.clock_out ? format(new Date(row.clock_out), 'HH:mm') : (
                        hasUnclocked ? <span className="text-red-600 font-medium">未退勤</span> : '-'
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.work_minutes != null ? formatWorkTime(row.work_minutes) : '-'}
                    </TableCell>
                    <TableCell className="text-sm text-slate-500">
                      {row.night_minutes > 0 ? formatWorkTime(row.night_minutes) : '-'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={st.variant}>{st.label}</Badge>
                    </TableCell>
                    <TableCell>
                      {report ? (
                        <details className="max-w-xs">
                          <summary className="cursor-pointer select-none">
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                              report.reviewed_at
                                ? 'bg-green-100 text-green-700'
                                : 'bg-slate-100 text-slate-600'
                            }`}>
                              {report.reviewed_at ? '確認済' : '提出済'}
                            </span>
                          </summary>
                          <div className="mt-1 space-y-1 text-xs text-slate-600 bg-white border border-slate-200 rounded-md p-2">
                            <p><span className="font-medium">業務内容:</span> {report.tasks_done}</p>
                            {report.achievements && <p><span className="font-medium">成果:</span> {report.achievements}</p>}
                            {report.issues && <p><span className="font-medium">課題:</span> {report.issues}</p>}
                            {report.tomorrow_plan && <p><span className="font-medium">明日の予定:</span> {report.tomorrow_plan}</p>}
                          </div>
                        </details>
                      ) : (
                        <span className="text-xs text-slate-400">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
              {attendanceList.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-slate-400 py-8">
                    この月の記録はありません
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      </main>
    </div>
  )
}
