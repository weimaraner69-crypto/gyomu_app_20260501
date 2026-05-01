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
import { ResetPasswordButton } from '@/components/admin/ResetPasswordButton'
import { InviteUserButton } from '@/components/admin/InviteUserButton'

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

const ROLE_LABEL: Record<string, string> = {
  owner:            'オーナー',
  manager:          'マネージャー',
  labor_consultant: '社労士',
  staff:            'スタッフ',
}

const EMPLOYMENT_TYPE_LABEL: Record<string, string> = {
  full_time: '正社員',
  part_time: 'アルバイト',
  contract:  '契約社員',
}

const NIGHT_START_HOUR = 22
const NIGHT_END_HOUR = 5

function getBusinessDate(now: Date): string {
  const base = new Date(now)
  if (base.getHours() < 5) {
    base.setDate(base.getDate() - 1)
  }
  return format(base, 'yyyy-MM-dd')
}

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

async function setMonthlyCloseAction(formData: FormData) {
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

  const storeId = String(formData.get('store_id') ?? '')
  const month = String(formData.get('month') ?? '')
  const mode = String(formData.get('mode') ?? 'close')
  const note = String(formData.get('note') ?? '').trim()

  if (!storeId || !month) {
    revalidatePath('/admin')
    return
  }

  if (mode === 'open') {
    await supabase
      .from('monthly_closings')
      .upsert({
        store_id: storeId,
        month,
        is_closed: false,
        closed_at: null,
        closed_by: null,
        note: note || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'store_id,month' })
  } else {
    await supabase
      .from('monthly_closings')
      .upsert({
        store_id: storeId,
        month,
        is_closed: true,
        closed_at: new Date().toISOString(),
        closed_by: user.id,
        note: note || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'store_id,month' })
  }

  revalidatePath('/admin')
}

async function updateEmployeeProfileAction(formData: FormData) {
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

  const targetId = String(formData.get('target_id') ?? '')
  const nameKana = String(formData.get('name_kana') ?? '').trim()
  const employmentType = String(formData.get('employment_type') ?? '')
  const hourlyWageRaw = String(formData.get('hourly_wage') ?? '')
  const isActive = formData.get('is_active') === '1'

  const validEmploymentTypes = ['full_time', 'part_time', 'contract']
  if (!targetId || !validEmploymentTypes.includes(employmentType)) {
    revalidatePath('/admin')
    return
  }

  const hourlyWage = hourlyWageRaw ? parseInt(hourlyWageRaw, 10) : null

  await supabase
    .from('profiles')
    .update({
      name_kana: nameKana || null,
      employment_type: employmentType,
      hourly_wage: hourlyWage,
      is_active: isActive,
    })
    .eq('id', targetId)

  revalidatePath('/admin')
}

async function updateEmployeeRoleAction(formData: FormData) {
  'use server'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single<{ role: string }>()

  if (!profile || profile.role !== 'owner') {
    redirect('/admin')
  }

  const targetId = String(formData.get('target_id') ?? '')
  const newRole = String(formData.get('role') ?? '')

  const validRoles = ['owner', 'manager', 'labor_consultant', 'staff']
  if (!targetId || !validRoles.includes(newRole)) {
    revalidatePath('/admin')
    return
  }

  await supabase
    .from('profiles')
    .update({ role: newRole })
    .eq('id', targetId)

  revalidatePath('/admin')
}

async function updateStoreMembershipAction(formData: FormData) {
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

  const targetId = String(formData.get('target_id') ?? '')
  const storeId = String(formData.get('store_id') ?? '')
  const mode = String(formData.get('mode') ?? 'add')

  if (!targetId || !storeId) {
    revalidatePath('/admin')
    return
  }

  if (mode === 'remove') {
    await supabase
      .from('user_store_memberships')
      .delete()
      .eq('user_id', targetId)
      .eq('store_id', storeId)
  } else {
    await supabase
      .from('user_store_memberships')
      .upsert({ user_id: targetId, store_id: storeId }, { onConflict: 'user_id,store_id' })
  }

  revalidatePath('/admin')
}

async function addWageHistoryAction(formData: FormData) {
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

  const targetId = String(formData.get('target_id') ?? '')
  const hourlyWageRaw = String(formData.get('hourly_wage') ?? '')
  const effectiveFrom = String(formData.get('effective_from') ?? '')
  const note = String(formData.get('note') ?? '').trim()

  if (!targetId || !hourlyWageRaw || !effectiveFrom) {
    revalidatePath('/admin')
    return
  }

  const hourlyWage = parseInt(hourlyWageRaw, 10)
  if (isNaN(hourlyWage) || hourlyWage < 0) {
    revalidatePath('/admin')
    return
  }

  // 既存の未終了履歴を終了させる
  await supabase
    .from('wage_histories')
    .update({ effective_to: effectiveFrom })
    .eq('user_id', targetId)
    .is('effective_to', null)
    .lt('effective_from', effectiveFrom)

  // 新しい時給履歴を挿入
  await supabase
    .from('wage_histories')
    .insert({
      user_id: targetId,
      hourly_wage: hourlyWage,
      effective_from: effectiveFrom,
      effective_to: null,
      note: note || null,
      created_by: user.id,
    })

  // profiles.hourly_wage も更新
  await supabase
    .from('profiles')
    .update({ hourly_wage: hourlyWage })
    .eq('id', targetId)

  revalidatePath('/admin')
}

async function upsertTransportCostAction(formData: FormData) {
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

  const targetId = String(formData.get('target_id') ?? '')
  const month = String(formData.get('month') ?? '')
  const amountRaw = String(formData.get('amount') ?? '0')
  const note = String(formData.get('note') ?? '').trim()

  if (!targetId || !month) {
    revalidatePath('/admin')
    return
  }

  const amount = parseInt(amountRaw, 10)
  if (isNaN(amount) || amount < 0) {
    revalidatePath('/admin')
    return
  }

  await supabase
    .from('monthly_transport_costs')
    .upsert(
      { user_id: targetId, month, amount, note: note || null, updated_by: user.id, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,month' }
    )

  revalidatePath('/admin')
}

async function reviewDailyReportAction(formData: FormData) {
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

  const reportId = String(formData.get('report_id') ?? '')
  if (!reportId) { revalidatePath('/admin'); return }

  await supabase
    .from('daily_reports')
    .update({ reviewed_at: new Date().toISOString(), reviewed_by: user.id })
    .eq('id', reportId)

  revalidatePath('/admin')
}

async function createStoreAction(formData: FormData) {
  'use server'
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single<{ role: string }>()

  if (!profile || profile.role !== 'owner') {
    redirect('/admin')
  }

  const name = String(formData.get('name') ?? '').trim()
  const code = String(formData.get('code') ?? '').trim()
  if (!name || !code) { revalidatePath('/admin'); return }

  await supabase.from('stores').insert({ name, code, is_active: true })
  revalidatePath('/admin')
}

async function updateStoreAction(formData: FormData) {
  'use server'
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single<{ role: string }>()

  if (!profile || profile.role !== 'owner') {
    redirect('/admin')
  }

  const storeId = String(formData.get('store_id') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  if (!storeId || !name) { revalidatePath('/admin'); return }

  await supabase.from('stores').update({ name }).eq('id', storeId)
  revalidatePath('/admin')
}

type StoreRow = {
  id: string
  code: string
  name: string
  is_active: boolean
}

type MonthlyClosingRow = {
  store_id: string
  month: string
  is_closed: boolean
  closed_at: string | null
  closed_by: string | null
  note: string | null
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
  const businessDate = getBusinessDate(now)
  const monthStart = firstDay

  const { data: records } = await supabase
    .from('attendance')
    .select('*')
    .gte('date', firstDay)
    .lte('date', lastDay)
    .order('date', { ascending: false })

  const typedRecords = (records ?? []) as AttendanceRow[]
  const unclockedRecords = typedRecords.filter(
    (row) => !!row.clock_in && !row.clock_out && row.date < businessDate
  )
  const userIds = Array.from(new Set(typedRecords.map((row) => row.user_id)))

  const { data: storeRowsRaw } = await supabase
    .from('stores')
    .select('id, code, name, is_active')
    .order('name', { ascending: true })

  const storeRows = (storeRowsRaw ?? []) as StoreRow[]

  const { data: closingRowsRaw } = await supabase
    .from('monthly_closings')
    .select('store_id, month, is_closed, closed_at, closed_by, note')
    .eq('month', monthStart)

  const closingRows = (closingRowsRaw ?? []) as MonthlyClosingRow[]
  const closedStoreIds = new Set(closingRows.filter((row) => row.is_closed).map((row) => row.store_id))

  const { data: auditRowsRaw } = await supabase
    .from('audit_logs')
    .select('id, table_name, action, actor_user_id, target_user_id, changed_at, before_data, after_data')
    .eq('table_name', 'attendance')
    .order('changed_at', { ascending: false })
    .limit(80)

  // 従業員マスタ用: 全プロフィールと所属
  const { data: allProfilesRaw } = await supabase
    .from('profiles')
    .select('id, full_name, name_kana, department, role, employment_type, hourly_wage, is_active')
    .order('full_name', { ascending: true })
  const allEmployees = (allProfilesRaw ?? []) as (ProfileSummary & {
    role: string
    name_kana: string | null
    employment_type: string | null
    hourly_wage: number | null
    is_active: boolean
  })[]

  const { data: membershipsRaw } = await supabase
    .from('user_store_memberships')
    .select('user_id, store_id')
  const memberships = (membershipsRaw ?? []) as { user_id: string; store_id: string }[]
  const membershipMap = new Map<string, string[]>()
  for (const m of memberships) {
    if (!membershipMap.has(m.user_id)) membershipMap.set(m.user_id, [])
    membershipMap.get(m.user_id)!.push(m.store_id)
  }

  const auditRows = (auditRowsRaw ?? []) as AuditRow[]
  const actorIds = auditRows
    .flatMap((row) => [row.actor_user_id, row.target_user_id])
    .filter((id): id is string => !!id)
  const closingActorIds = closingRows
    .map((row) => row.closed_by)
    .filter((id): id is string => !!id)
  const allProfileIds = Array.from(new Set([...userIds, ...actorIds, ...closingActorIds]))

  const { data: profileRows } = allProfileIds.length
    ? await supabase
      .from('profiles')
      .select('id, full_name, department')
      .in('id', allProfileIds)
    : { data: [] as ProfileSummary[] }

  const profileMap = new Map((profileRows ?? []).map((p) => [p.id, p]))
  const canEditAttendance = profile?.role === 'owner' || profile?.role === 'manager'

  // 時給履歴
  const empIds = allEmployees.map((e) => e.id)
  const { data: wageHistoriesRaw } = empIds.length
    ? await supabase
      .from('wage_histories')
      .select('id, user_id, hourly_wage, effective_from, effective_to, note, created_by, created_at')
      .in('user_id', empIds)
      .order('effective_from', { ascending: false })
    : { data: [] }

  type WageHistoryRow = {
    id: string; user_id: string; hourly_wage: number
    effective_from: string; effective_to: string | null; note: string | null
    created_by: string | null; created_at: string
  }
  const wageHistories = (wageHistoriesRaw ?? []) as WageHistoryRow[]
  const wageHistoryMap = new Map<string, WageHistoryRow[]>()
  for (const wh of wageHistories) {
    if (!wageHistoryMap.has(wh.user_id)) wageHistoryMap.set(wh.user_id, [])
    wageHistoryMap.get(wh.user_id)!.push(wh)
  }

  // 交通費
  type TransportCostRow = { user_id: string; amount: number; note: string | null }
  const { data: transportRaw } = empIds.length
    ? await supabase
      .from('monthly_transport_costs')
      .select('user_id, amount, note')
      .in('user_id', empIds)
      .eq('month', monthStart)
    : { data: [] }
  const transportCosts = (transportRaw ?? []) as TransportCostRow[]
  const transportMap = new Map(transportCosts.map((t) => [t.user_id, t]))

  // 日報（管理者向け）
  type DailyReportAdminRow = {
    id: string; user_id: string; date: string; tasks_done: string
    achievements: string | null; issues: string | null; tomorrow_plan: string | null
    submitted_at: string | null; reviewed_at: string | null; reviewed_by: string | null
  }
  const { data: adminReportsRaw } = await supabase
    .from('daily_reports')
    .select('id, user_id, date, tasks_done, achievements, issues, tomorrow_plan, submitted_at, reviewed_at, reviewed_by')
    .gte('date', firstDay)
    .lte('date', lastDay)
    .not('submitted_at', 'is', null)
    .order('submitted_at', { ascending: false })
  const adminReports = (adminReportsRaw ?? []) as DailyReportAdminRow[]
  const unreviewedCount = adminReports.filter((r) => !r.reviewed_at).length

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

        {/* 従業員マスタ */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-slate-500">従業員マスタ</h2>
            {canEditAttendance && <InviteUserButton />}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {allEmployees.map((emp) => {
              const empStoreIds = membershipMap.get(emp.id) ?? []
              const empStores = empStoreIds
                .map((sid) => storeRows.find((s) => s.id === sid))
                .filter((s): s is StoreRow => !!s)
              const availableStores = storeRows.filter((s) => !empStoreIds.includes(s.id))
              return (
                <Card key={emp.id} className={`shadow-sm ${emp.is_active === false ? 'opacity-60' : ''}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-base">{emp.full_name}</CardTitle>
                        {emp.name_kana && <p className="text-xs text-slate-500 mt-0.5">{emp.name_kana}</p>}
                      </div>
                      <div className="flex gap-1 items-center flex-wrap justify-end">
                        <Badge variant="outline">{ROLE_LABEL[emp.role] ?? emp.role}</Badge>
                        {emp.is_active === false && <Badge variant="destructive">退職</Badge>}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
                      <div><span className="text-slate-400">部署:</span> {emp.department ?? '-'}</div>
                      <div><span className="text-slate-400">雇用形態:</span> {emp.employment_type ? (EMPLOYMENT_TYPE_LABEL[emp.employment_type] ?? emp.employment_type) : '-'}</div>
                      <div><span className="text-slate-400">時給:</span> {emp.hourly_wage != null ? `¥${emp.hourly_wage.toLocaleString()}` : '-'}</div>
                    </div>

                    {/* 所属店舗 */}
                    <div>
                      <p className="text-xs text-slate-400 mb-1">所属店舗</p>
                      <div className="flex flex-wrap gap-1">
                        {empStores.map((store) => (
                          canEditAttendance ? (
                            <form key={store.id} action={updateStoreMembershipAction} className="inline-flex">
                              <input type="hidden" name="target_id" value={emp.id} />
                              <input type="hidden" name="store_id" value={store.id} />
                              <input type="hidden" name="mode" value="remove" />
                              <button
                                type="submit"
                                className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700 hover:bg-red-100 hover:text-red-700 transition-colors"
                              >
                                {store.name} ×
                              </button>
                            </form>
                          ) : (
                            <span key={store.id} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{store.name}</span>
                          )
                        ))}
                        {canEditAttendance && availableStores.length > 0 && (
                          <form action={updateStoreMembershipAction} className="inline-flex gap-1 items-center">
                            <input type="hidden" name="target_id" value={emp.id} />
                            <input type="hidden" name="mode" value="add" />
                            <select name="store_id" className="h-6 rounded-md border border-slate-300 px-1 text-xs">
                              {availableStores.map((store) => (
                                <option key={store.id} value={store.id}>{store.name}</option>
                              ))}
                            </select>
                            <Button type="submit" size="sm" variant="outline" className="h-6 text-xs px-1.5">追加</Button>
                          </form>
                        )}
                        {empStores.length === 0 && !canEditAttendance && (
                          <span className="text-xs text-slate-400">未所属</span>
                        )}
                      </div>
                    </div>

                    {canEditAttendance && (
                      <details className="group">
                        <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700 select-none">
                          基本情報を編集 ▸
                        </summary>
                        <form action={updateEmployeeProfileAction} className="mt-2 space-y-2">
                          <input type="hidden" name="target_id" value={emp.id} />
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-xs text-slate-500 block mb-0.5">よみがな</label>
                              <input
                                type="text"
                                name="name_kana"
                                defaultValue={emp.name_kana ?? ''}
                                placeholder="カタカナ"
                                className="h-7 w-full rounded-md border border-slate-300 px-2 text-xs"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-slate-500 block mb-0.5">雇用形態</label>
                              <select
                                name="employment_type"
                                defaultValue={emp.employment_type ?? 'part_time'}
                                className="h-7 w-full rounded-md border border-slate-300 px-2 text-xs"
                              >
                                <option value="part_time">アルバイト</option>
                                <option value="full_time">正社員</option>
                                <option value="contract">契約社員</option>
                              </select>
                            </div>
                            <div>
                              <label className="text-xs text-slate-500 block mb-0.5">時給（円）</label>
                              <input
                                type="number"
                                name="hourly_wage"
                                defaultValue={emp.hourly_wage ?? ''}
                                placeholder="例: 1100"
                                min={0}
                                className="h-7 w-full rounded-md border border-slate-300 px-2 text-xs"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-slate-500 block mb-0.5">在籍</label>
                              <select
                                name="is_active"
                                defaultValue={emp.is_active !== false ? '1' : '0'}
                                className="h-7 w-full rounded-md border border-slate-300 px-2 text-xs"
                              >
                                <option value="1">在籍中</option>
                                <option value="0">退職</option>
                              </select>
                            </div>
                          </div>
                          <div className="flex gap-2 items-center">
                            <Button type="submit" size="sm" className="h-7 text-xs">保存</Button>
                            {profile.role === 'owner' && (
                              <form action={updateEmployeeRoleAction} className="inline-flex gap-1 items-center">
                                <input type="hidden" name="target_id" value={emp.id} />
                                <select name="role" defaultValue={emp.role} className="h-7 rounded-md border border-slate-300 px-2 text-xs">
                                  <option value="owner">オーナー</option>
                                  <option value="manager">マネージャー</option>
                                  <option value="labor_consultant">社労士</option>
                                  <option value="staff">スタッフ</option>
                                </select>
                                <Button type="submit" size="sm" variant="outline" className="h-7 text-xs px-2">ロール変更</Button>
                              </form>
                            )}
                            <ResetPasswordButton targetId={emp.id} targetName={emp.full_name} />
                          </div>
                        </form>

                        {/* 時給履歴 */}
                        <div className="mt-3 border-t border-slate-100 pt-2">
                          <p className="text-xs font-medium text-slate-500 mb-1">時給変更履歴</p>
                          <div className="space-y-1 mb-2">
                            {(wageHistoryMap.get(emp.id) ?? []).slice(0, 5).map((wh) => (
                              <div key={wh.id} className="flex items-center gap-2 text-xs text-slate-600">
                                <span className="text-slate-400">{format(new Date(wh.effective_from + 'T00:00:00'), 'yyyy/MM/dd', { locale: ja })}</span>
                                <span className="font-medium">¥{wh.hourly_wage.toLocaleString()}</span>
                                {wh.effective_to && <span className="text-slate-400">〜 {format(new Date(wh.effective_to + 'T00:00:00'), 'yyyy/MM/dd', { locale: ja })}</span>}
                                {!wh.effective_to && <span className="text-green-600">現在</span>}
                                {wh.note && <span className="text-slate-400">({wh.note})</span>}
                              </div>
                            ))}
                            {(wageHistoryMap.get(emp.id) ?? []).length === 0 && (
                              <p className="text-xs text-slate-400">履歴なし</p>
                            )}
                          </div>
                          <form action={addWageHistoryAction} className="grid grid-cols-2 gap-1.5">
                            <input type="hidden" name="target_id" value={emp.id} />
                            <div>
                              <label className="text-xs text-slate-400 block mb-0.5">新しい時給</label>
                              <input
                                type="number"
                                name="hourly_wage"
                                placeholder="例: 1200"
                                min={0}
                                required
                                className="h-7 w-full rounded-md border border-slate-300 px-2 text-xs"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-slate-400 block mb-0.5">適用開始日</label>
                              <input
                                type="date"
                                name="effective_from"
                                required
                                className="h-7 w-full rounded-md border border-slate-300 px-2 text-xs"
                              />
                            </div>
                            <div className="col-span-2">
                              <input
                                type="text"
                                name="note"
                                placeholder="メモ（任意）"
                                className="h-7 w-full rounded-md border border-slate-300 px-2 text-xs"
                              />
                            </div>
                            <div className="col-span-2">
                              <Button type="submit" size="sm" variant="outline" className="h-7 text-xs">時給を登録</Button>
                            </div>
                          </form>
                        </div>
                      </details>
                    )}
                  </CardContent>
                </Card>
              )
            })}
            {allEmployees.length === 0 && (
              <p className="text-sm text-slate-500 col-span-2">スタッフが登録されていません</p>
            )}
          </div>
        </div>

        {/* 交通費入力 */}
        {canEditAttendance && (
          <div>
            <h2 className="text-sm font-medium text-slate-500 mb-3">
              交通費入力 — {format(new Date(monthStart + 'T00:00:00'), 'yyyy年MM月', { locale: ja })}
            </h2>
            <Card className="shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>名前</TableHead>
                    <TableHead>現在の金額</TableHead>
                    <TableHead>金額 / メモ</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allEmployees.filter((e) => e.is_active !== false).map((emp) => {
                    const current = transportMap.get(emp.id)
                    return (
                      <TableRow key={emp.id}>
                        <TableCell className="text-sm font-medium">{emp.full_name}</TableCell>
                        <TableCell className="text-sm text-slate-500">
                          {current ? `¥${current.amount.toLocaleString()}` : '-'}
                        </TableCell>
                        <TableCell>
                          <form action={upsertTransportCostAction} className="flex gap-1 items-center">
                            <input type="hidden" name="target_id" value={emp.id} />
                            <input type="hidden" name="month" value={monthStart} />
                            <input
                              type="number"
                              name="amount"
                              defaultValue={current?.amount ?? 0}
                              min={0}
                              className="h-7 w-24 rounded-md border border-slate-300 px-2 text-xs"
                            />
                            <input
                              type="text"
                              name="note"
                              defaultValue={current?.note ?? ''}
                              placeholder="メモ"
                              className="h-7 w-28 rounded-md border border-slate-300 px-2 text-xs"
                            />
                            <Button type="submit" size="sm" variant="outline" className="h-7 text-xs px-2">保存</Button>
                          </form>
                        </TableCell>
                        <TableCell></TableCell>
                      </TableRow>
                    )
                  })}
                  {allEmployees.filter((e) => e.is_active !== false).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-slate-400 py-4">在籍スタッフがいません</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Card>
          </div>
        )}

        {/* 人件費速報 */}
        {canEditAttendance && (
          <div>
            <h2 className="text-sm font-medium text-slate-500 mb-3">
              人件費速報 — {format(new Date(monthStart + 'T00:00:00'), 'yyyy年MM月', { locale: ja })}
            </h2>
            <Card className="shadow-sm overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>名前</TableHead>
                    <TableHead className="text-right">勤務時間</TableHead>
                    <TableHead className="text-right">時給</TableHead>
                    <TableHead className="text-right">人件費概算</TableHead>
                    <TableHead className="text-right">交通費</TableHead>
                    <TableHead className="text-right">合計</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allEmployees.filter((e) => e.is_active !== false).map((emp) => {
                    const totalMinutes = summary[emp.id]?.totalMinutes ?? 0
                    const hourlyWage = emp.hourly_wage
                    const laborCost = hourlyWage != null ? Math.floor(totalMinutes / 60 * hourlyWage) : null
                    const transportCost = transportMap.get(emp.id)?.amount ?? 0
                    const total = laborCost != null ? laborCost + transportCost : null
                    return (
                      <TableRow key={emp.id}>
                        <TableCell className="text-sm font-medium">{emp.full_name}</TableCell>
                        <TableCell className="text-sm text-right">{totalMinutes > 0 ? formatWorkTime(totalMinutes) : '-'}</TableCell>
                        <TableCell className="text-sm text-right">{hourlyWage != null ? `¥${hourlyWage.toLocaleString()}` : <span className="text-slate-400">未設定</span>}</TableCell>
                        <TableCell className="text-sm text-right">{laborCost != null ? `¥${laborCost.toLocaleString()}` : '-'}</TableCell>
                        <TableCell className="text-sm text-right">{transportCost > 0 ? `¥${transportCost.toLocaleString()}` : '-'}</TableCell>
                        <TableCell className="text-sm text-right font-semibold">{total != null ? `¥${total.toLocaleString()}` : '-'}</TableCell>
                      </TableRow>
                    )
                  })}
                  {(() => {
                    const activeEmps = allEmployees.filter((e) => e.is_active !== false)
                    if (activeEmps.length === 0) return null
                    let grandLaborCost = 0
                    let grandTransport = 0
                    let anyWage = false
                    for (const emp of activeEmps) {
                      const totalMinutes = summary[emp.id]?.totalMinutes ?? 0
                      if (emp.hourly_wage != null) {
                        grandLaborCost += Math.floor(totalMinutes / 60 * emp.hourly_wage)
                        anyWage = true
                      }
                      grandTransport += transportMap.get(emp.id)?.amount ?? 0
                    }
                    return (
                      <TableRow className="bg-slate-50">
                        <TableCell className="text-sm font-semibold">合計</TableCell>
                        <TableCell />
                        <TableCell />
                        <TableCell className="text-sm text-right font-semibold">{anyWage ? `¥${grandLaborCost.toLocaleString()}` : '-'}</TableCell>
                        <TableCell className="text-sm text-right font-semibold">{grandTransport > 0 ? `¥${grandTransport.toLocaleString()}` : '-'}</TableCell>
                        <TableCell className="text-sm text-right font-semibold">{anyWage ? `¥${(grandLaborCost + grandTransport).toLocaleString()}` : '-'}</TableCell>
                      </TableRow>
                    )
                  })()}
                  {allEmployees.filter((e) => e.is_active !== false).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-slate-400 py-4">在籍スタッフがいません</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              <div className="px-4 py-2 text-xs text-slate-400 border-t border-slate-100">
                ※ 時給未設定のスタッフは人件費計算から除外されます。当月の勤務時間に基づく概算値です。
              </div>
            </Card>
          </div>
        )}

        <div>
          <h2 className="text-sm font-medium text-slate-500 mb-3">CSV出力</h2>
          <Card className="shadow-sm">
            <CardContent className="pt-6 space-y-3">
              <div className="flex flex-wrap gap-2">
                <a href={`/api/admin/attendance/export?month=${monthStart}`}>
                  <Button size="sm" variant="outline">全店舗CSV</Button>
                </a>
                {storeRows.map((store) => (
                  <a key={store.id} href={`/api/admin/attendance/export?month=${monthStart}&store_id=${store.id}`}>
                    <Button size="sm" variant="outline">{store.name} CSV</Button>
                  </a>
                ))}
              </div>
              <p className="text-xs text-slate-500">対象月の勤怠一覧をCSV形式で出力します。</p>
            </CardContent>
          </Card>
        </div>

        {/* 店舗管理 */}
        {profile?.role === 'owner' && (
          <div>
            <h2 className="text-sm font-medium text-slate-500 mb-3">店舗管理</h2>
            <Card className="shadow-sm">
              <CardContent className="pt-6 space-y-3">
                {storeRows.map((store) => (
                  <form key={store.id} action={updateStoreAction} className="flex items-center gap-2">
                    <input type="hidden" name="store_id" value={store.id} />
                    <input
                      type="text"
                      name="name"
                      defaultValue={store.name}
                      required
                      className="h-8 w-40 rounded-md border border-slate-300 px-2 text-sm"
                    />
                    <span className="text-xs text-slate-400">({store.code})</span>
                    <Button type="submit" size="sm" variant="outline" className="h-8 text-xs">名称更新</Button>
                  </form>
                ))}
                {storeRows.length === 0 && (
                  <p className="text-sm text-slate-400">店舗が登録されていません</p>
                )}
                <div className="pt-2 border-t border-slate-100">
                  <p className="text-xs text-slate-500 mb-2">新規店舗を追加</p>
                  <form action={createStoreAction} className="flex items-center gap-2">
                    <div>
                      <label className="text-xs text-slate-400 block mb-0.5">店舗コード</label>
                      <input
                        type="text"
                        name="code"
                        required
                        placeholder="例: store01"
                        className="h-8 w-28 rounded-md border border-slate-300 px-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 block mb-0.5">店舗名</label>
                      <input
                        type="text"
                        name="name"
                        required
                        placeholder="例: 渋谷店"
                        className="h-8 w-36 rounded-md border border-slate-300 px-2 text-sm"
                      />
                    </div>
                    <div className="self-end">
                      <Button type="submit" size="sm" className="h-8 text-xs">追加</Button>
                    </div>
                  </form>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* 月次締め */}
        <div>
          <h2 className="text-sm font-medium text-slate-500 mb-3">月次締め</h2>
          <Card className="shadow-sm">
            <CardContent className="pt-6 space-y-3">
              {storeRows.map((store) => {
                const closeInfo = closingRows.find((row) => row.store_id === store.id)
                const isClosed = !!closeInfo?.is_closed
                const closer = closeInfo?.closed_by ? profileMap.get(closeInfo.closed_by) : null

                return (
                  <form key={store.id} action={setMonthlyCloseAction} className="grid grid-cols-1 md:grid-cols-8 gap-2 items-center rounded-md border border-slate-200 p-3">
                    <input type="hidden" name="store_id" value={store.id} />
                    <input type="hidden" name="month" value={monthStart} />

                    <div className="md:col-span-2">
                      <p className="text-sm font-medium">{store.name}</p>
                      <p className="text-xs text-slate-500">対象月: {format(new Date(monthStart + 'T00:00:00'), 'yyyy年MM月', { locale: ja })}</p>
                    </div>

                    <div className="md:col-span-3 text-xs text-slate-600">
                      {isClosed ? (
                        <>
                          <p>状態: 締め済み</p>
                          <p>実行者: {closer?.full_name ?? '-'}</p>
                          <p>日時: {closeInfo?.closed_at ? format(new Date(closeInfo.closed_at), 'M/d HH:mm', { locale: ja }) : '-'}</p>
                        </>
                      ) : (
                        <p>状態: 未締め</p>
                      )}
                    </div>

                    <input
                      type="text"
                      name="note"
                      defaultValue={closeInfo?.note ?? ''}
                      placeholder="メモ（任意）"
                      className="h-8 rounded-md border border-slate-300 px-2 text-xs md:col-span-2"
                    />

                    {canEditAttendance ? (
                      isClosed ? (
                        <Button type="submit" size="sm" variant="outline" name="mode" value="open" className="md:col-span-1">締め解除</Button>
                      ) : (
                        <Button type="submit" size="sm" name="mode" value="close" className="md:col-span-1">締め実行</Button>
                      )
                    ) : (
                      <p className="text-xs text-slate-500 md:col-span-1">権限なし</p>
                    )}
                  </form>
                )
              })}
              {storeRows.length === 0 && (
                <p className="text-sm text-slate-500">対象店舗がありません</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 未退勤アラート */}
        {unclockedRecords.length > 0 && (
          <div>
            <h2 className="text-sm font-medium text-red-600 mb-3">未退勤アラート</h2>
            <Card className="shadow-sm border-red-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-base text-red-700">{unclockedRecords.length}件の未退勤があります</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {unclockedRecords.map((row) => {
                  const rowProfile = profileMap.get(row.user_id)
                  const rowClosed = !!row.store_id && closedStoreIds.has(row.store_id)
                  return (
                    <form key={row.id} action={updateAttendanceAction} className="grid grid-cols-1 md:grid-cols-7 gap-2 items-center rounded-md border border-red-100 p-3 bg-red-50/40">
                      <input type="hidden" name="id" value={row.id} />
                      <input type="hidden" name="date" value={row.date} />
                      <input type="hidden" name="clock_in_time" value={row.clock_in ? format(new Date(row.clock_in), 'HH:mm') : ''} />
                      <div className="md:col-span-2 text-sm">
                        <p className="font-medium">{rowProfile?.full_name ?? '不明なユーザー'}</p>
                        <p className="text-slate-600">{format(new Date(row.date + 'T00:00:00'), 'M/d (E)', { locale: ja })}</p>
                      </div>
                      <div className="text-sm text-slate-700">出勤 {row.clock_in ? format(new Date(row.clock_in), 'HH:mm') : '-'}</div>
                      <input
                        type="time"
                        name="clock_out_time"
                        disabled={rowClosed}
                        className="h-8 rounded-md border border-slate-300 px-2 text-xs"
                      />
                      <select
                        name="status"
                        defaultValue={row.status}
                        disabled={rowClosed}
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
                        placeholder="未退勤の補正理由"
                        disabled={rowClosed}
                        className="h-8 rounded-md border border-slate-300 px-2 text-xs"
                      />
                      {rowClosed ? (
                        <p className="text-xs text-red-700">締め済みのため補正不可</p>
                      ) : (
                        <Button type="submit" size="sm" className="md:col-span-1">補正保存</Button>
                      )}
                    </form>
                  )
                })}
              </CardContent>
            </Card>
          </div>
        )}

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
                  const rowClosed = !!row.store_id && closedStoreIds.has(row.store_id)
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
                        {!!row.clock_in && !row.clock_out && row.date < businessDate && (
                          <Badge variant="destructive" className="ml-2">未退勤</Badge>
                        )}
                        {rowClosed && (
                          <Badge variant="outline" className="ml-2">締め済み</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {canEditAttendance && !rowClosed ? (
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
                        ) : rowClosed ? (
                          <p className="text-xs text-slate-500">締め済みのため修正不可</p>
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

        {/* 日報レビュー */}
        <div>
          <h2 className="text-sm font-medium text-slate-500 mb-3">
            日報レビュー
            {unreviewedCount > 0 && (
              <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                未確認 {unreviewedCount}件
              </span>
            )}
          </h2>
          <Card className="shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>日付</TableHead>
                  <TableHead>名前</TableHead>
                  <TableHead>業務内容</TableHead>
                  <TableHead>状態</TableHead>
                  <TableHead>確認</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {adminReports.map((report) => {
                  const reportProfile = profileMap.get(report.user_id)
                  return (
                    <TableRow key={report.id} className={!report.reviewed_at ? 'bg-amber-50/40' : ''}>
                      <TableCell className="text-sm whitespace-nowrap">
                        {format(new Date(report.date + 'T00:00:00'), 'M/d (E)', { locale: ja })}
                      </TableCell>
                      <TableCell className="text-sm font-medium">
                        {reportProfile?.full_name ?? '不明'}
                      </TableCell>
                      <TableCell className="text-sm max-w-xs">
                        <details>
                          <summary className="cursor-pointer text-slate-600 hover:text-slate-900 select-none">
                            {report.tasks_done.slice(0, 30)}{report.tasks_done.length > 30 ? '…' : ''}
                          </summary>
                          <div className="mt-1 space-y-1 text-xs text-slate-600">
                            <p><span className="font-medium">業務内容:</span> {report.tasks_done}</p>
                            {report.achievements && <p><span className="font-medium">成果:</span> {report.achievements}</p>}
                            {report.issues && <p><span className="font-medium">課題:</span> {report.issues}</p>}
                            {report.tomorrow_plan && <p><span className="font-medium">明日の予定:</span> {report.tomorrow_plan}</p>}
                          </div>
                        </details>
                      </TableCell>
                      <TableCell>
                        {report.reviewed_at ? (
                          <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                            確認済み
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                            未確認
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {canEditAttendance && !report.reviewed_at && (
                          <form action={reviewDailyReportAction}>
                            <input type="hidden" name="report_id" value={report.id} />
                            <Button type="submit" size="sm" variant="outline" className="h-7 text-xs">確認済みにする</Button>
                          </form>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
                {adminReports.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-slate-400 py-8">今月の提出日報はありません</TableCell>
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
