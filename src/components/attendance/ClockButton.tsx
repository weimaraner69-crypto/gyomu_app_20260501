'use client'
import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/client'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import type { Attendance } from '@/types'

export function ClockButton({ userId }: { userId: string }) {
  const [today, setToday] = useState<Attendance | null>(null)
  const [now, setNow] = useState(new Date())
  const [loading, setLoading] = useState(false)

  const totalBreakMinutes = today?.break_minutes ?? 0

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const fetchToday = async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('attendance')
        .select('*')
        .eq('user_id', userId)
        .eq('date', format(new Date(), 'yyyy-MM-dd'))
        .single()
      setToday(data)
    }
    fetchToday()
  }, [userId])

  const handleClockIn = async () => {
    setLoading(true)
    const supabase = createClient()
    try {
      const { data } = await supabase.from('attendance').upsert({
        user_id: userId,
        date: format(new Date(), 'yyyy-MM-dd'),
        clock_in: new Date().toISOString(),
        status: 'present'
      }).select().single()
      setToday(data)
    } finally {
      setLoading(false)
    }
  }

  const handleClockOut = async () => {
    if (!today?.clock_in || today.break_started_at) return
    setLoading(true)
    const supabase = createClient()
    try {
      const clockIn = new Date(today.clock_in)
      const clockOut = new Date()
      const workMinutes = Math.floor((clockOut.getTime() - clockIn.getTime()) / 1000 / 60)
      const netWorkMinutes = Math.max(0, workMinutes - totalBreakMinutes)
      const { data } = await supabase.from('attendance')
        .update({
          clock_out: clockOut.toISOString(),
          work_minutes: netWorkMinutes
        })
        .eq('id', today.id)
        .select().single()
      setToday(data)
    } finally {
      setLoading(false)
    }
  }

  const handleBreakStart = async () => {
    if (!today?.clock_in || today.clock_out || today.break_started_at) return
    setLoading(true)
    const supabase = createClient()
    try {
      const { data } = await supabase.from('attendance')
        .update({ break_started_at: new Date().toISOString() })
        .eq('id', today.id)
        .select().single()
      setToday(data)
    } finally {
      setLoading(false)
    }
  }

  const handleBreakEnd = async () => {
    if (!today?.break_started_at) return
    setLoading(true)
    const supabase = createClient()
    try {
      const breakStart = new Date(today.break_started_at)
      const breakEnd = new Date()
      const addMinutes = Math.max(0, Math.floor((breakEnd.getTime() - breakStart.getTime()) / 1000 / 60))
      const { data } = await supabase.from('attendance')
        .update({
          break_started_at: null,
          break_minutes: totalBreakMinutes + addMinutes
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
          {today?.clock_in && (
            <p>出勤: <span className="font-semibold">{format(new Date(today.clock_in), 'HH:mm')}</span></p>
          )}
          {today?.break_started_at && (
            <p>休憩中: <span className="font-semibold">{format(new Date(today.break_started_at), 'HH:mm')}〜</span></p>
          )}
          {(today?.clock_in || today?.clock_out) && (
            <p>休憩合計: <span className="font-semibold">{totalBreakMinutes}分</span></p>
          )}
          {today?.clock_out && (
            <p>退勤: <span className="font-semibold">{format(new Date(today.clock_out), 'HH:mm')}</span></p>
          )}
        </div>

        {!today?.clock_in ? (
          <Button
            onClick={handleClockIn}
            disabled={loading}
            size="lg"
            className="w-full bg-green-600 hover:bg-green-700 text-white text-lg font-bold tracking-widest"
          >
            出　勤
          </Button>
        ) : today.break_started_at ? (
          <Button
            onClick={handleBreakEnd}
            disabled={loading}
            size="lg"
            className="w-full bg-blue-600 hover:bg-blue-700 text-white text-lg font-bold tracking-widest"
          >
            休憩戻り
          </Button>
        ) : !today?.clock_out ? (
          <div className="grid grid-cols-2 gap-3">
            <Button
              onClick={handleBreakStart}
              disabled={loading}
              size="lg"
              variant="outline"
              className="w-full border-amber-300 text-amber-700 hover:bg-amber-50 text-base font-bold tracking-widest"
            >
              休憩入り
            </Button>
            <Button
              onClick={handleClockOut}
              disabled={loading}
              size="lg"
              variant="outline"
              className="w-full border-red-300 text-red-600 hover:bg-red-50 text-base font-bold tracking-widest"
            >
              退　勤
            </Button>
          </div>
        ) : (
          <p className="text-sm text-slate-500 py-2">本日の打刻完了</p>
        )}
      </CardContent>
    </Card>
  )
}
