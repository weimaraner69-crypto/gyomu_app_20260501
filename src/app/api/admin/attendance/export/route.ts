import { createClient } from '@/lib/supabase/server'
import { canAccessManagement, type Profile } from '@/types'

type AttendanceExportRow = {
  date: string
  clock_in: string | null
  clock_out: string | null
  work_minutes: number | null
  night_minutes: number
  status: string
  note: string | null
  user_id: string
  store_id: string | null
}

type ProfileRow = {
  id: string
  full_name: string
  department: string | null
}

type StoreRow = {
  id: string
  name: string
}

function toCsvCell(value: string | number | null | undefined): string {
  const text = value == null ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

function toTime(value: string | null): string {
  if (!value) return ''
  return new Intl.DateTimeFormat('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Tokyo',
  }).format(new Date(value))
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single<Profile>()

  if (!canAccessManagement(profile?.role)) {
    return new Response('Forbidden', { status: 403 })
  }

  const url = new URL(request.url)
  const month = url.searchParams.get('month')
  const storeId = url.searchParams.get('store_id')

  const baseDate = month ? new Date(`${month}T00:00:00+09:00`) : new Date()
  const year = baseDate.getFullYear()
  const monthNumber = String(baseDate.getMonth() + 1).padStart(2, '0')
  const firstDay = `${year}-${monthNumber}-01`
  const lastDay = `${year}-${monthNumber}-31`

  let attendanceQuery = supabase
    .from('attendance')
    .select('date, clock_in, clock_out, work_minutes, night_minutes, status, note, user_id, store_id')
    .gte('date', firstDay)
    .lte('date', lastDay)
    .order('date', { ascending: true })

  if (storeId) {
    attendanceQuery = attendanceQuery.eq('store_id', storeId)
  }

  const { data: attendanceRows, error: attendanceError } = await attendanceQuery

  if (attendanceError) {
    return new Response(attendanceError.message, { status: 400 })
  }

  const typedAttendanceRows = (attendanceRows ?? []) as AttendanceExportRow[]
  const userIds = Array.from(new Set(typedAttendanceRows.map((row) => row.user_id)))
  const storeIds = Array.from(new Set(typedAttendanceRows.map((row) => row.store_id).filter((id): id is string => !!id)))

  const { data: profileRows } = userIds.length
    ? await supabase
      .from('profiles')
      .select('id, full_name, department')
      .in('id', userIds)
    : { data: [] as ProfileRow[] }

  const { data: storeRows } = storeIds.length
    ? await supabase
      .from('stores')
      .select('id, name')
      .in('id', storeIds)
    : { data: [] as StoreRow[] }

  const profileMap = new Map((profileRows ?? []).map((row) => [row.id, row]))
  const storeMap = new Map((storeRows ?? []).map((row) => [row.id, row]))

  const header = ['日付', '店舗', '氏名', '部署', '出勤', '退勤', '勤務時間(分)', '深夜時間(分)', 'ステータス', '備考']
  const csvLines = [header.map((cell) => toCsvCell(cell)).join(',')]

  typedAttendanceRows.forEach((row) => {
    const staff = profileMap.get(row.user_id)
    const store = row.store_id ? storeMap.get(row.store_id) : null
    csvLines.push([
      row.date,
      store?.name ?? '',
      staff?.full_name ?? '不明なユーザー',
      staff?.department ?? '',
      toTime(row.clock_in),
      toTime(row.clock_out),
      row.work_minutes ?? '',
      row.night_minutes,
      row.status,
      row.note ?? '',
    ].map((cell) => toCsvCell(cell)).join(','))
  })

  const csvBody = `\uFEFF${csvLines.join('\n')}`
  const fileSuffix = storeId ? `_${storeMap.get(storeId)?.name ?? 'store'}` : '_all'
  const filename = `attendance_${firstDay}${fileSuffix}.csv`

  return new Response(csvBody, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    },
  })
}
