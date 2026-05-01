import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { canAccessManagement, formatWorkTime } from '@/types'
import type { Profile } from '@/types'

type AttendanceRow = {
  id: string
  user_id: string
  store_id: string | null
  date: string
  clock_in: string | null
  clock_out: string | null
  work_minutes: number | null
  night_minutes: number
  status: string
  note: string | null
}

type ProfileSummary = {
  id: string
  full_name: string
  department: string | null
}

type AuditRow = {
  id: string
  table_name: 'attendance' | 'daily_reports'
  action: 'insert' | 'update' | 'delete'
  actor_user_id: string | null
  target_user_id: string | null
  changed_at: string
  before_data: {
    clock_in?: string | null
    clock_out?: string | null
    status?: string | null
    note?: string | null
  } | null
  after_data: {
    clock_in?: string | null
    clock_out?: string | null
    status?: string | null
    note?: string | null
  } | null
}

const STATUS_LABEL: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  present:     { label: '出勤',   variant: 'default' },
  absent:      { label: '欠勤',   variant: 'destructive' },
  late:        { label: '遅刻',   variant: 'secondary' },
  early_leave: { label: '早退',   variant: 'secondary' },
  holiday:     { label: '休暇',   variant: 'outline' },
}

const NIGHT_START_HOUR = 22
const NIGHT_END_HOUR = 5

function parseTimeValue(date: string, timeValue: string): Date | null {
  if (!timeValue) return null
  return new Date(`${date}T${timeValue}:00+09:00`)
}

function calcMinutesDiff(start: Date, end: Date): number {
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000 / 60))
}

function calcNightMinutes(clockIn: Date, clockOut: Date): number {
  let total = 0
  const cursor = new Date(clockIn)
  cursor.setHours(0, 0, 0, 0)
  cursor.setDate(cursor.getDate() - 1)

  while (cursor <= clockOut) {
    const nightStart = new Date(cursor)
    nightStart.setHours(NIGHT_START_HOUR, 0, 0, 0)
    const nightEnd = new Date(cursor)
    nightEnd.setDate(nightEnd.getDate() + 1)
    nightEnd.setHours(NIGHT_END_HOUR, 0, 0, 0)

    const overlapStart = Math.max(clockIn.getTime(), nightStart.getTime())
    const overlapEnd = Math.min(clockOut.getTime(), nightEnd.getTime())
    if (overlapEnd > overlapStart) {
      total += Math.floor((overlapEnd - overlapStart) / 1000 / 60)
    }

    cursor.setDate(cursor.getDate() + 1)
  }

  return total
}

function toTimeLabel(value: string | null | undefined): string {
  if (!value) return '-'
  return format(new Date(value), 'HH:mm')
}

function buildChangeSummary(row: AuditRow): string {
  const beforeClockIn = row.before_data?.clock_in ?? null
  const afterClockIn = row.after_data?.clock_in ?? null
  const beforeClockOut = row.before_data?.clock_out ?? null
  const afterClockOut = row.after_data?.clock_out ?? null
  const beforeStatus = row.before_data?.status ?? null
  const afterStatus = row.after_data?.status ?? null
  const beforeNote = row.before_data?.note ?? null
  const afterNote = row.after_data?.note ?? null

  const changes: string[] = []
  if (beforeClockIn !== afterClockIn) changes.push(`出勤 ${toTimeLabel(beforeClockIn)} → ${toTimeLabel(afterClockIn)}`)
  if (beforeClockOut !== afterClockOut) changes.push(`退勤 ${toTimeLabel(beforeClockOut)} → ${toTimeLabel(afterClockOut)}`)
  if (beforeStatus !== afterStatus) changes.push(`ステータス ${beforeStatus ?? '-'} → ${afterStatus ?? '-'}`)
  if (beforeNote !== afterNote) changes.push('備考を変更')

  if (changes.length === 0) {
    if (row.action === 'insert') return 'レコード作成'
    if (row.action === 'delete') return 'レコード削除'
    return '更新'
  }
  return changes.join(' / ')
}

async function updateAttendanceAction(formData: FormData) {
  'use server'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single<{ role: string }>()

  if (!profile || !['owner', 'manager'].includes(profile.role)) {
    redirect('/admin')
  }

  const id = String(formData.get('id') ?? '')
  const date = String(formData.get('date') ?? '')
  const clockInTime = String(formData.get('clock_in_time') ?? '')
  const clockOutTime = String(formData.get('clock_out_time') ?? '')
  const status = String(formData.get('status') ?? 'present')
  const noteRaw = String(formData.get('note') ?? '')

  if (!id || !date) {
    revalidatePath('/admin')
    return
  }

  const clockIn = parseTimeValue(date, clockInTime)
  const clockOut = parseTimeValue(date, clockOutTime)

  let workMinutes: number | null = null
  let nightMinutes = 0
  if (clockIn && clockOut && clockOut.getTime() > clockIn.getTime()) {
    workMinutes = calcMinutesDiff(clockIn, clockOut)
    nightMinutes = calcNightMinutes(clockIn, clockOut)
  }

  await supabase
    .from('attendance')
    .update({
      clock_in: clockIn ? clockIn.toISOString() : null,
      clock_out: clockOut ? clockOut.toISOString() : null,
      work_minutes: workMinutes,
      night_minutes: nightMinutes,
      status,
      note: noteRaw.trim() ? noteRaw.trim() : null,
    })
    .eq('id', id)

  revalidatePath('/admin')
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

  if (!canAccessManagement(profile?.role)) redirect('/dashboard')

  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const firstDay = `${year}-${month}-01`
  const lastDay = `${year}-${month}-31`

  const { data: records } = await supabase
    .from('attendance')
    .select('*')
    .gte('date', firstDay)
    .lte('date', lastDay)
    .order('date', { ascending: false })

  const typedRecords = (records ?? []) as AttendanceRow[]
  const userIds = Array.from(new Set(typedRecords.map((row) => row.user_id)))

  const { data: auditRowsRaw } = await supabase
    .from('audit_logs')
    .select('id, table_name, action, actor_user_id, target_user_id, changed_at, before_data, after_data')
    .eq('table_name', 'attendance')
    .order('changed_at', { ascending: false })
    .limit(80)

  const auditRows = (auditRowsRaw ?? []) as AuditRow[]
  const actorIds = auditRows
    .flatMap((row) => [row.actor_user_id, row.target_user_id])
    .filter((id): id is string => !!id)
  const allProfileIds = Array.from(new Set([...userIds, ...actorIds]))

  const { data: profileRows } = allProfileIds.length
    ? await supabase
      .from('profiles')
      .select('id, full_name, department')
      .in('id', allProfileIds)
    : { data: [] as ProfileSummary[] }

  const profileMap = new Map((profileRows ?? []).map((p) => [p.id, p]))
  const canEditAttendance = profile.role === 'owner' || profile.role === 'manager'

  // 月間集計
  const summary: Record<string, { name: string; department: string | null; workDays: number; totalMinutes: number }> = {}
  typedRecords.forEach((row) => {
    const key = row.user_id
    const rowProfile = profileMap.get(row.user_id)
    if (!summary[key]) {
      summary[key] = {
        name: rowProfile?.full_name ?? '不明なユーザー',
        department: rowProfile?.department ?? null,
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
                  <TableHead>修正</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {typedRecords.map((row) => {
                  const rowProfile = profileMap.get(row.user_id)
                  const st = STATUS_LABEL[row.status] ?? { label: row.status, variant: 'outline' as const }
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="text-sm">{format(new Date(row.date + 'T00:00:00'), 'M/d (E)', { locale: ja })}</TableCell>
                      <TableCell className="font-medium text-sm">{rowProfile?.full_name ?? '不明なユーザー'}</TableCell>
                      <TableCell className="text-sm text-slate-500">{rowProfile?.department ?? '-'}</TableCell>
                      <TableCell className="text-sm">{row.clock_in ? format(new Date(row.clock_in), 'HH:mm') : '-'}</TableCell>
                      <TableCell className="text-sm">{row.clock_out ? format(new Date(row.clock_out), 'HH:mm') : '-'}</TableCell>
                      <TableCell className="text-sm">{row.work_minutes != null ? formatWorkTime(row.work_minutes) : '-'}</TableCell>
                      <TableCell>
                        <Badge variant={st.variant}>{st.label}</Badge>
                      </TableCell>
                      <TableCell>
                        {canEditAttendance ? (
                          <form action={updateAttendanceAction} className="grid grid-cols-2 gap-2 min-w-[320px]">
                            <input type="hidden" name="id" value={row.id} />
                            <input type="hidden" name="date" value={row.date} />
                            <input
                              type="time"
                              name="clock_in_time"
                              defaultValue={row.clock_in ? format(new Date(row.clock_in), 'HH:mm') : ''}
                              className="h-8 rounded-md border border-slate-300 px-2 text-xs"
                            />
                            <input
                              type="time"
                              name="clock_out_time"
                              defaultValue={row.clock_out ? format(new Date(row.clock_out), 'HH:mm') : ''}
                              className="h-8 rounded-md border border-slate-300 px-2 text-xs"
                            />
                            <select
                              name="status"
                              defaultValue={row.status}
                              className="h-8 rounded-md border border-slate-300 px-2 text-xs"
                            >
                              <option value="present">出勤</option>
                              <option value="absent">欠勤</option>
                              <option value="late">遅刻</option>
                              <option value="early_leave">早退</option>
                              <option value="holiday">休暇</option>
                            </select>
                            <input
                              type="text"
                              name="note"
                              defaultValue={row.note ?? ''}
                              placeholder="備考"
                              className="h-8 rounded-md border border-slate-300 px-2 text-xs"
                            />
                            <Button type="submit" size="sm" className="col-span-2">保存</Button>
                          </form>
                        ) : (
                          <p className="text-xs text-slate-500">修正権限なし</p>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
                {typedRecords.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-slate-400 py-8">記録がありません</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </div>

        {/* 修正履歴テーブル */}
        <div>
          <h2 className="text-sm font-medium text-slate-500 mb-3">勤怠修正履歴</h2>
          <Card className="shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>更新日時</TableHead>
                  <TableHead>対象者</TableHead>
                  <TableHead>操作</TableHead>
                  <TableHead>変更者</TableHead>
                  <TableHead>変更内容</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditRows.map((row) => {
                  const actor = row.actor_user_id ? profileMap.get(row.actor_user_id) : null
                  const target = row.target_user_id ? profileMap.get(row.target_user_id) : null
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="text-sm">{format(new Date(row.changed_at), 'M/d HH:mm', { locale: ja })}</TableCell>
                      <TableCell className="text-sm">{target?.full_name ?? '-'}</TableCell>
                      <TableCell className="text-sm">{row.action}</TableCell>
                      <TableCell className="text-sm">{actor?.full_name ?? '-'}</TableCell>
                      <TableCell className="text-sm text-slate-600 whitespace-normal">{buildChangeSummary(row)}</TableCell>
                    </TableRow>
                  )
                })}
                {auditRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-slate-400 py-8">履歴がありません</TableCell>
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
