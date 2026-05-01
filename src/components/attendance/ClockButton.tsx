'use client'
import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/client'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import type { Attendance } from '@/types'

const NIGHT_START_HOUR = 22
const NIGHT_END_HOUR = 5

function getBusinessDate(now: Date): string {
  const base = new Date(now)
  if (base.getHours() < 5) {
    base.setDate(base.getDate() - 1)
  }
  return format(base, 'yyyy-MM-dd')
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

export function ClockButton({ userId, storeId }: { userId: string; storeId: string | null }) {
  const [today, setToday] = useState<Attendance | null>(null)
  const [now, setNow] = useState(new Date())
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const fetchToday = async () => {
      const supabase = createClient()
      let query = supabase
        .from('attendance')
        .select('*')
        .eq('user_id', userId)
        .eq('date', getBusinessDate(new Date()))
      query = storeId ? query.eq('store_id', storeId) : query.is('store_id', null)
      const { data } = await query.single()
      setToday(data)
    }
    fetchToday()
  }, [userId, storeId])

  const handleClockIn = async () => {
    if (!storeId) return
    setLoading(true)
    const supabase = createClient()
    try {
      const { data } = await supabase.from('attendance').upsert({
        user_id: userId,
        store_id: storeId,
        date: getBusinessDate(new Date()),
        clock_in: new Date().toISOString(),
        status: 'present'
      }).select().single()
      setToday(data)
    } finally {
      setLoading(false)
    }
  }

  const handleClockOut = async () => {
    if (!today?.clock_in || !storeId) return
    setLoading(true)
    const supabase = createClient()
    try {
      const clockIn = new Date(today.clock_in)
      const clockOut = new Date()
      const workMinutes = calcMinutesDiff(clockIn, clockOut)
      const nightMinutes = calcNightMinutes(clockIn, clockOut)
      const { data } = await supabase.from('attendance')
        .update({
          clock_out: clockOut.toISOString(),
          work_minutes: workMinutes,
          night_minutes: nightMinutes
        })
        .eq('id', today.id)
        .select().single()
      setToday(data)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="max-w-sm mx-auto shadow-sm">
      <CardContent className="pt-6 text-center space-y-4">
        <div>
          <p className="text-sm text-slate-500">
            {format(now, 'yyyy年MM月dd日 (E)', { locale: ja })}
          </p>
          <p className="text-5xl font-bold tabular-nums tracking-tight">
            {format(now, 'HH:mm:ss')}
          </p>
        </div>

        <div className="text-sm text-slate-600 space-y-1 min-h-[3rem]">
          {!storeId && (
            <p className="text-amber-700">店舗所属が未設定のため打刻できません</p>
          )}
          {today?.clock_in && (
            <p>出勤: <span className="font-semibold">{format(new Date(today.clock_in), 'HH:mm')}</span></p>
          )}
          {today?.clock_out && (
            <p>退勤: <span className="font-semibold">{format(new Date(today.clock_out), 'HH:mm')}</span></p>
          )}
        </div>

        {!today?.clock_in ? (
          <Button
            onClick={handleClockIn}
            disabled={loading || !storeId}
            size="lg"
            className="w-full bg-green-600 hover:bg-green-700 text-white text-lg font-bold tracking-widest"
          >
            出　勤
          </Button>
        ) : !today?.clock_out ? (
          <Button
            onClick={handleClockOut}
            disabled={loading || !storeId}
            size="lg"
            variant="outline"
            className="w-full border-red-300 text-red-600 hover:bg-red-50 text-lg font-bold tracking-widest"
          >
            退　勤
          </Button>
        ) : (
          <p className="text-sm text-slate-500 py-2">本日の打刻完了</p>
        )}
      </CardContent>
    </Card>
  )
}
