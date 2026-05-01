export type UserRole = 'admin' | 'member'

export interface Profile {
  id: string
  full_name: string
  department: string | null
  role: UserRole
  created_at: string
}

export interface Attendance {
  id: string
  user_id: string
  date: string
  clock_in: string | null
  clock_out: string | null
  work_minutes: number | null
  night_minutes: number
  status: 'present' | 'absent' | 'late' | 'early_leave' | 'holiday'
  note: string | null
  created_at: string
}

export interface DailyReport {
  id: string
  user_id: string
  date: string
  attendance_id: string | null
  tasks_done: string
  achievements: string | null
  issues: string | null
  tomorrow_plan: string | null
  submitted_at: string | null
  reviewed_at: string | null
  reviewed_by: string | null
  created_at: string
}

export function formatWorkTime(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${hours}時間${mins}分`
}
