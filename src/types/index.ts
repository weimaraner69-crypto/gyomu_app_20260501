export type UserRole = 'owner' | 'manager' | 'labor_consultant' | 'staff'

export const MANAGEMENT_ROLES: UserRole[] = ['owner', 'manager', 'labor_consultant']

export function canAccessManagement(role: UserRole | null | undefined): boolean {
  return !!role && MANAGEMENT_ROLES.includes(role)
}

export type EmploymentType = 'full_time' | 'part_time' | 'contract'

export const EMPLOYMENT_TYPE_LABEL: Record<EmploymentType, string> = {
  full_time: '正社員',
  part_time: 'アルバイト',
  contract:  '契約社員',
}

export interface Profile {
  id: string
  full_name: string
  name_kana: string | null
  department: string | null
  role: UserRole
  employment_type: EmploymentType | null
  hourly_wage: number | null
  is_active: boolean
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
  clock_in_latitude: number | null
  clock_in_longitude: number | null
  clock_out_latitude: number | null
  clock_out_longitude: number | null
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

export interface AuditLog {
  id: string
  table_name: 'attendance' | 'daily_reports'
  record_id: string
  action: 'insert' | 'update' | 'delete'
  actor_user_id: string | null
  target_user_id: string | null
  store_id: string | null
  changed_at: string
  before_data: Record<string, unknown> | null
  after_data: Record<string, unknown> | null
}

export function formatWorkTime(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${hours}時間${mins}分`
}

export interface WageHistory {
  id: string
  user_id: string
  hourly_wage: number
  effective_from: string
  effective_to: string | null
  note: string | null
  created_by: string | null
  created_at: string
}
