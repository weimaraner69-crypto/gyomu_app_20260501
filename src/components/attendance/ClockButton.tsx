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
    if (!today?.clock_in) return
    setLoading(true)
    const supabase = createClient()
    try {
      const clockIn = new Date(today.clock_in)
      const clockOut = new Date()
      const workMinutes = Math.floor((clockOut.getTime() - clockIn.getTime()) / 1000 / 60)
      const { data } = await supabase.from('attendance')
        .update({
          clock_out: clockOut.toISOString(),
          work_minutes: workMinutes - (today.break_minutes ?? 60)
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
        ) : !today?.clock_out ? (
          <Button
            onClick={handleClockOut}
            disabled={loading}
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
