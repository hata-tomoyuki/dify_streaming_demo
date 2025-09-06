import type { NextRequest } from 'next/server'
export const dynamic = 'force-dynamic' // キャッシュ抑止


export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url)
    const q = searchParams.get('q')?.trim() || ''
    const cid = searchParams.get('cid') || undefined // Dify の conversation_id
    const user = process.env.DIFY_USER_ID || 'demo-user'


    if (!q) return new Response('Missing q', { status: 400 })


    const apiKey = process.env.DIFY_API_KEY
    const apiUrl = process.env.DIFY_API_URL || 'https://api.dify.ai/v1'
    if (!apiKey) return new Response('Missing DIFY_API_KEY', { status: 500 })


    const payload = {
        inputs: {},
        query: q,
        response_mode: 'streaming',
        user,
        ...(cid ? { conversation_id: cid } : {})
    }


    const upstream = await fetch(`${apiUrl}/chat-messages`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'text/event-stream'
        },
        body: JSON.stringify(payload)
    })


    // 上流エラーハンドリング
    if (!upstream.ok || !upstream.body) {
        const detail = await upstream.text().catch(() => '')
        return new Response(`Upstream error: ${upstream.status} ${detail}`, { status: 502 })
    }


    // SSE をそのままパススルー
    const stream = new ReadableStream({
        start(controller) {
            const enc = new TextEncoder()
            // ★ ブラウザの自動再接続間隔を極大化（実質オフに近い）
            controller.enqueue(enc.encode('retry: 100000000\n\n'))

            const reader = upstream.body!.getReader()
                ; (async () => {
                    try {
                        while (true) {
                            const { done, value } = await reader.read()
                            if (done) break
                            controller.enqueue(value)
                        }
                    } catch (e) {
                        controller.enqueue(
                            enc.encode(`event: error\ndata: ${JSON.stringify({ error: String(e) })}\n\n`)
                        )
                    } finally {
                        controller.close()
                    }
                })()
        }
    })


    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'Transfer-Encoding': 'chunked'
        }
    })
}
