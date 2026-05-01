'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'

export function ResetPasswordButton({ targetId, targetName }: { targetId: string; targetName: string }) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<'idle' | 'success' | 'error'>('idle')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 8) return
    setLoading(true)
    setResult('idle')
    const res = await fetch('/api/admin/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_id: targetId, new_password: password }),
    })
    setLoading(false)
    if (res.ok) {
      setResult('success')
      setPassword('')
      setTimeout(() => { setOpen(false); setResult('idle') }, 2000)
    } else {
      setResult('error')
    }
  }

  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" className="h-7 text-xs px-2" onClick={() => setOpen(true)}>
        仮PW発行
      </Button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-1 min-w-[180px]">
      <p className="text-xs text-slate-500">{targetName} の新しいパスワード</p>
      <div className="flex gap-1">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="8文字以上"
          minLength={8}
          required
          className="h-7 rounded-md border border-slate-300 px-2 text-xs flex-1"
        />
        <Button type="submit" size="sm" variant="default" className="h-7 text-xs px-2" disabled={loading}>
          {loading ? '...' : '設定'}
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => { setOpen(false); setResult('idle') }}>
          ×
        </Button>
      </div>
      {result === 'success' && <p className="text-xs text-green-600">パスワードを更新しました</p>}
      {result === 'error' && <p className="text-xs text-red-600">更新に失敗しました</p>}
    </form>
  )
}
