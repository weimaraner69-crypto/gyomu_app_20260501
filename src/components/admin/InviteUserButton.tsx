'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'

export function InviteUserButton() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(false)

    const form = e.currentTarget
    const data = new FormData(form)
    const email = String(data.get('email') ?? '').trim()
    const full_name = String(data.get('full_name') ?? '').trim()
    const temp_password = String(data.get('temp_password') ?? '')

    const res = await fetch('/api/admin/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, full_name, temp_password }),
    })

    const json = await res.json() as { error?: string }
    setLoading(false)

    if (!res.ok) {
      setError(json.error ?? '登録に失敗しました')
    } else {
      setSuccess(true)
      form.reset()
      setTimeout(() => { setOpen(false); setSuccess(false) }, 2000)
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        ＋ 新規スタッフ登録
      </Button>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border border-slate-200 rounded-lg p-4 bg-white shadow-sm space-y-3 max-w-sm"
    >
      <p className="text-sm font-medium text-slate-700">新規スタッフ登録</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {success && <p className="text-xs text-green-600">登録しました。ページを再読み込みすると一覧に反映されます。</p>}
      <div>
        <label className="text-xs text-slate-500 block mb-0.5">氏名</label>
        <input
          type="text"
          name="full_name"
          required
          placeholder="例: 山田 太郎"
          className="h-8 w-full rounded-md border border-slate-300 px-2 text-sm"
        />
      </div>
      <div>
        <label className="text-xs text-slate-500 block mb-0.5">メールアドレス</label>
        <input
          type="email"
          name="email"
          required
          placeholder="例: taro@example.com"
          className="h-8 w-full rounded-md border border-slate-300 px-2 text-sm"
        />
      </div>
      <div>
        <label className="text-xs text-slate-500 block mb-0.5">仮パスワード（8文字以上）</label>
        <input
          type="text"
          name="temp_password"
          required
          minLength={8}
          placeholder="初回ログイン用パスワード"
          className="h-8 w-full rounded-md border border-slate-300 px-2 text-sm font-mono"
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={loading}>
          {loading ? '登録中…' : '登録する'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => { setOpen(false); setError(null) }}
        >
          キャンセル
        </Button>
      </div>
    </form>
  )
}
