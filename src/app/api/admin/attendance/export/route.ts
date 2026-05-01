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
  name_kana: string | null
  department: string | null
  employment_type: string | null
  hourly_wage: number | null
}

type StoreRow = {
  id: string
  name: string
}

type TransportRow = {
  user_id: string
  amount: number
}

const EMPLOYMENT_TYPE_LABEL: Record<string, string> = {
  full_time: '正社員',
  part_time: 'アルバイト',
  contract:  '契約社員',
}

const STATUS_LABEL: Record<string, string> = {
  present:     '出勤',
  absent:      '欠勤',
  late:        '遅刻',
  early_leave: '早退',
  holiday:     '休暇',
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

function toHHMM(minutes: number | null | undefined): string {
  if (minutes == null) return ''
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}:${String(m).padStart(2, '0')}`
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
      .select('id, full_name, name_kana, department, employment_type, hourly_wage')
      .in('id', userIds)
    : { data: [] as ProfileRow[] }

  const { data: storeRows } = storeIds.length
    ? await supabase
      .from('stores')
      .select('id, name')
      .in('id', storeIds)
    : { data: [] as StoreRow[] }

  // 交通費
  const { data: transportRows } = userIds.length
    ? await supabase
      .from('monthly_transport_costs')
      .select('user_id, amount')
      .in('user_id', userIds)
      .eq('month', firstDay)
    : { data: [] as TransportRow[] }

  const profileMap = new Map((profileRows ?? []).map((row) => [row.id, row]))
  const storeMap = new Map((storeRows ?? []).map((row) => [row.id, row]))
  const transportMap = new Map((transportRows ?? []).map((row: TransportRow) => [row.user_id, row.amount]))

  const header = [
    '日付', '店舗', '氏名', 'よみがな', '部署', '雇用形態', '時給',
    '出勤', '退勤', '勤務時間(分)', '勤務時間(H:M)', '深夜時間(分)', '深夜時間(H:M)',
    'ステータス', '交通費', '備考'
  ]
  const csvLines = [header.map((cell) => toCsvCell(cell)).join(',')]

  typedAttendanceRows.forEach((row) => {
    const staff = profileMap.get(row.user_id)
    const store = row.store_id ? storeMap.get(row.store_id) : null
    const transport = transportMap.get(row.user_id) ?? 0
    csvLines.push([
      row.date,
      store?.name ?? '',
      staff?.full_name ?? '不明なユーザー',
      staff?.name_kana ?? '',
      staff?.department ?? '',
      staff?.employment_type ? (EMPLOYMENT_TYPE_LABEL[staff.employment_type] ?? staff.employment_type) : '',
      staff?.hourly_wage ?? '',
      toTime(row.clock_in),
      toTime(row.clock_out),
      row.work_minutes ?? '',
      toHHMM(row.work_minutes),
      row.night_minutes,
      toHHMM(row.night_minutes),
      STATUS_LABEL[row.status] ?? row.status,
      transport,
      row.note ?? '',
    ].map((cell) => toCsvCell(cell)).join(','))
  })

  const csvBody = `\uFEFF${csvLines.join('\n')}`
  const storeSuffix = storeId ? `_${storeMap.get(storeId)?.name ?? 'store'}` : ''
  const filename = `kashio_kintal_${year}年${monthNumber}月${storeSuffix}.csv`

  return new Response(csvBody, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    },
  })
}
