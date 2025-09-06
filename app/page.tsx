'use client'


import { useRef, useState } from 'react'


type Role = 'user' | 'assistant'


type Message = {
  role: Role
  content: string
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [conversationId, setConversationId] = useState<string | undefined>()
  const esRef = useRef<EventSource | null>(null)
  const endedRef = useRef(false)
  const seenChunkRef = useRef(false)


  const send = () => {
    const text = input.trim()
    if (!text || loading) return

    // 送信直前で必ずリセット
    endedRef.current = false
    seenChunkRef.current = false

    setMessages((prev) => [...prev, { role: 'user', content: text }, { role: 'assistant', content: '' }])
    setInput('')
    setLoading(true)

    const url = `/api/chat?q=${encodeURIComponent(text)}${conversationId ? `&cid=${encodeURIComponent(conversationId)}` : ''}`
    const es = new EventSource(url)
    esRef.current = es

    // オーバーラップ解決マージ
    const mergeByOverlap = (prev: string, next: string) => {
      if (!prev) return next
      if (!next) return prev

      // 1) 累積（next が全体）なら置き換え
      if (next.startsWith(prev)) return next

      // 2) 逆に巻き戻し（prev が next を包含）ならそのまま
      if (prev.includes(next)) return prev

      // 3) 末尾と先頭の最大重なりを探して結合
      const max = Math.min(prev.length, next.length, 1024) // 無駄に長く走査しない保険
      for (let len = max; len > 0; len--) {
        if (prev.slice(-len) === next.slice(0, len)) {
          return prev + next.slice(len)
        }
      }
      // 4) 重なりが無ければ素直に連結
      return prev + next
    }

    const applyPartial = (partial: string) => {
      setMessages((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (!last || last.role !== 'assistant') return next

        const merged = mergeByOverlap(last.content, partial)

        // （任意の最終クリーンアップ。英語などで "word word" を1語に戻す）
        // 日本語には影響しません（Unicode 対応）。
        const dedup = merged.replace(/\b([\p{L}\p{N}'']+)(\s+\1\b)+/gu, '$1')

        last.content = dedup
        return next
      })
    }

    // --- error ---
    const onError = (ev: Event) => {
      const src = ev.currentTarget as EventSource | null
      const state = src?.readyState

      // こちらで閉じた/正常終了
      if (endedRef.current || state === EventSource.CLOSED) return

      // ★ サーバ側クローズ後の自動再接続(CONNECTING)で、
      //    かつ一度でも部分文字列を受け取っている → もう終わりとして明示終了
      if (seenChunkRef.current && state === EventSource.CONNECTING) {
        endedRef.current = true
        src?.close()
        setLoading(false)
        return
      }

      console.error('SSE error (abnormal)', { state, hadChunk: seenChunkRef.current })
      src?.close()
      setLoading(false)
    }

    es.addEventListener('error', onError)

    // --- message（累積 or 差分のどちらでもOKに）---
    es.addEventListener('message', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data)
        if (typeof data.answer === 'string') {
          seenChunkRef.current = true
          applyPartial(data.answer)
        }
      } catch {}
    })

    // --- もし Dify が message_replace を送る場合にも対応（任意だが堅牢）---
    es.addEventListener('message_replace', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data)
        if (typeof data.answer === 'string') {
          seenChunkRef.current = true
          applyPartial(data.answer) // 置き換え扱いになる
        }
      } catch {}
    })

    // --- message_end ---
    es.addEventListener('message_end', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data)
        if (data.conversation_id) setConversationId(data.conversation_id)
      } catch { }
      endedRef.current = true
      es.removeEventListener('error', onError)
      es.close()
      setLoading(false)
    })
  }

  return (
    <main style={{ minHeight: '100vh', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>Dify Streaming Chat (Next.js)</h1>


      <div style={{ flex: 1, maxWidth: 820, width: '100%', border: '1px solid #e5e5e5', borderRadius: 12, padding: 16, overflow: 'auto' }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
            <div style={{ background: m.role === 'user' ? '#eef2ff' : '#f6f6f7', border: '1px solid #e5e7eb', borderRadius: 18, padding: '8px 12px', maxWidth: '80%', whiteSpace: 'pre-wrap' }}>
              {m.content}
            </div>
          </div>
        ))}
      </div>


      <div style={{ display: 'flex', gap: 8, maxWidth: 820, width: '100%' }}>
        <input
          placeholder="メッセージを入力..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          style={{ flex: 1, border: '1px solid #d1d5db', borderRadius: 12, padding: '10px 12px' }}
          disabled={loading}
        />
        <button onClick={send} disabled={loading} style={{ border: '1px solid #d1d5db', borderRadius: 12, padding: '10px 16px', background: '#fff' }}>
          送信
        </button>
      </div>


      {conversationId && (
        <p style={{ fontSize: 12, color: '#6b7280' }}>Conversation ID: {conversationId}</p>
      )}
    </main>
  )
}
