import { useCallback, useEffect, useRef, useState } from 'react'
import { backendWsUrl } from '../lib/supabase'

/** Message shape emitted by the FastAPI `/ws/infer/{task_id}` endpoint. */
export interface ProgressMessage {
  type: 'progress' | 'complete' | 'error'
  progress: number // 0..100
  stage: string
  detail?: string
  scan_id?: string
  metrics?: { psnr: number; ssim: number; mae: number; source: string }
}

export type WsStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

export interface InferenceProgress {
  status: WsStatus
  progress: number
  stage: string
  detail: string | null
  scanId: string | null
  error: string | null
  messages: ProgressMessage[]
}

const INITIAL: InferenceProgress = {
  status: 'idle',
  progress: 0,
  stage: 'Waiting',
  detail: null,
  scanId: null,
  error: null,
  messages: [],
}

/**
 * Connects to the inference progress stream for a task id. Reconnects are not
 * attempted: the backend replays the full event history on connect, so a
 * caller can simply re-mount to recover.
 */
export function useInferenceProgress(taskId: string | null): InferenceProgress & {
  reset: () => void
} {
  const [state, setState] = useState<InferenceProgress>(INITIAL)
  const socketRef = useRef<WebSocket | null>(null)

  const reset = useCallback(() => {
    socketRef.current?.close()
    socketRef.current = null
    setState(INITIAL)
  }, [])

  useEffect(() => {
    if (!taskId) return

    const ws = new WebSocket(backendWsUrl(`/ws/infer/${taskId}`))
    socketRef.current = ws
    setState((s) => ({ ...s, status: 'connecting' }))

    ws.onopen = () => setState((s) => ({ ...s, status: 'open' }))

    ws.onmessage = (ev: MessageEvent<string>) => {
      let msg: ProgressMessage
      try {
        msg = JSON.parse(ev.data) as ProgressMessage
      } catch {
        return
      }
      setState((s) => ({
        ...s,
        progress: Math.max(s.progress, Math.min(100, Math.max(0, msg.progress ?? s.progress))),
        stage: msg.stage ?? s.stage,
        detail: msg.detail ?? null,
        scanId: msg.type === 'complete' ? (msg.scan_id ?? null) : s.scanId,
        error: msg.type === 'error' ? (msg.detail ?? 'Inference failed') : s.error,
        messages: [...s.messages, msg],
      }))
      if (msg.type === 'complete' || msg.type === 'error') ws.close()
    }

    ws.onerror = () => setState((s) => ({ ...s, status: 'error' }))
    ws.onclose = () =>
      setState((s) => (s.status === 'error' ? s : { ...s, status: 'closed' }))

    return () => {
      ws.close()
      if (socketRef.current === ws) socketRef.current = null
    }
  }, [taskId])

  return { ...state, reset }
}
