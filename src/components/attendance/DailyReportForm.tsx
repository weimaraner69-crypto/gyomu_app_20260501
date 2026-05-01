'use client'
import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/client'
import type { DailyReport } from '@/types'

export function DailyReportForm({ userId, storeId, date }: { userId: string; storeId: string | null; date: string }) {
  const [form, setForm] = useState({
    tasks_done: '',
    achievements: '',
    issues: '',
    tomorrow_plan: ''
  })
  const [existing, setExisting] = useState<DailyReport | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const fetch = async () => {
      const supabase = createClient()
      let query = supabase
        .from('daily_reports')
        .select('*')
        .eq('user_id', userId)
        .eq('date', date)
      query = storeId ? query.eq('store_id', storeId) : query.is('store_id', null)
      const { data } = await query.single()
      if (data) {
        setExisting(data)
        setForm({
          tasks_done: data.tasks_done ?? '',
          achievements: data.achievements ?? '',
          issues: data.issues ?? '',
          tomorrow_plan: data.tomorrow_plan ?? ''
        })
        if (data.submitted_at) setSubmitted(true)
      }
    }
    fetch()
  }, [userId, storeId, date])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!storeId) return
    setLoading(true)
    const supabase = createClient()
    try {
      await supabase.from('daily_reports').upsert({
        ...(existing ? { id: existing.id } : {}),
        user_id: userId,
        store_id: storeId,
        date,
        ...form,
        submitted_at: new Date().toISOString()
      })
      setSubmitted(true)
    } finally {
      setLoading(false)
    }
  }

  if (submitted) {
    return (
      <Card className="shadow-sm">
        <CardContent className="pt-6 text-center py-12">
          <p className="text-green-600 font-medium text-lg">✓ 日報を提出しました</p>
          <p className="text-sm text-slate-500 mt-1">お疲れ様でした！</p>
        </CardContent>
      </Card>
    )
  }

  if (!storeId) {
    return (
      <Card className="shadow-sm">
        <CardContent className="pt-6 text-center py-10">
          <p className="text-amber-700 font-medium">店舗所属が未設定のため日報を提出できません</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle>日報提出</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label>本日の業務内容 <span className="text-red-500">*</span></Label>
            <Textarea
              placeholder="・〇〇の対応&#13;・△△のミーティング"
              rows={4}
              required
              value={form.tasks_done}
              onChange={(e) => setForm({ ...form, tasks_done: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>成果・完了したこと</Label>
            <Textarea
              placeholder="・〇〇を完了した"
              rows={2}
              value={form.achievements}
              onChange={(e) => setForm({ ...form, achievements: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>課題・困ったこと</Label>
            <Textarea
              placeholder="・〇〇に時間がかかっている"
              rows={2}
              value={form.issues}
              onChange={(e) => setForm({ ...form, issues: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>明日の予定</Label>
            <Textarea
              placeholder="・〇〇を対応予定"
              rows={2}
              value={form.tomorrow_plan}
              onChange={(e) => setForm({ ...form, tomorrow_plan: e.target.value })}
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? '提出中...' : '日報を提出する'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
