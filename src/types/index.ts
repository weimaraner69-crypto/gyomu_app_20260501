export type UserRole = 'owner' | 'manager' | 'labor_consultant' | 'staff'

export const MANAGEMENT_ROLES: UserRole[] = ['owner', 'manager', 'labor_consultant']

export function canAccessManagement(role: UserRole | null | undefined): boolean {
  return !!role && MANAGEMENT_ROLES.includes(role)
}

export interface Profile {
  id: string
  full_name: string
  department: string | null
  role: UserRole
  created_at: string
}

export interface Store {
  id: string
  code: string
  name: string
  is_active: boolean
  created_at: string
}

export interface UserStoreMembership {
  id: string
  user_id: string
  store_id: string
  created_at: string
}

export interface Attendance {
  id: string
  user_id: string
  store_id: string | null
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
  store_id: string | null
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
