import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { BACKEND_URL } from '../lib/supabase'
import { getAccessToken } from '../hooks/useAuth'
import { useInferenceProgress } from '../hooks/useWebSocket'
import { BrainVisualizer } from '../components/BrainVisualizer'
import { PatientSearch } from '../components/PatientSearch'
import { ProcessStages } from '../components/ProcessStages'
import { PIPELINE_STAGES } from '../lib/pipeline'

const ACCEPTED = ['.nii', '.nii.gz']

/** How long the "Complete" state is shown before navigating to results. */
const COMPLETE_HOLD_MS = 2200
/** Backend silence before the displayed percentage starts creeping. */
const STALL_AFTER_MS = 2500
/** Backend silence before we surface an elapsed-time hint. */
const SHOW_ELAPSED_AFTER_MS = 5000

function isNifti(name: string): boolean {
  const lower = name.toLowerCase()
  return ACCEPTED.some((ext) => lower.endsWith(ext))
}

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function formatSeconds(s: number): string {
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

/**
 * Turns the stepwise backend percentage into a value that is pleasant to
 * display: it never goes backwards, snaps to 100 on completion, and during a
 * long backend silence (e.g. the ~1 min storage upload at 98%) it creeps
 * asymptotically towards the next tick so the UI never looks frozen.
 */
function useDisplayProgress(raw: number, active: boolean, complete: boolean) {
  // Only the timer below writes these; the final value is derived in render.
  const [creep, setCreep] = useState(0)
  const [stalledMs, setStalledMs] = useState(0)
  const lastChange = useRef({ value: raw, at: 0 })

  // Remember when the backend last moved (ref only, no re-render).
  useEffect(() => {
    if (raw !== lastChange.current.value) {
      lastChange.current = { value: raw, at: performance.now() }
    }
  }, [raw])

  useEffect(() => {
    if (!active || complete) return
    lastChange.current.at = performance.now()
    const id = window.setInterval(() => {
      const silence = performance.now() - lastChange.current.at
      setStalledMs(silence)
      if (silence < STALL_AFTER_MS) return
      const base = lastChange.current.value
      // Cap just short of the next backend tick so we never overshoot.
      const cap = Math.min(base + 1.6, 99.4)
      setCreep((c) => {
        // Discard a stale value from a previous run or an earlier stage.
        const from = c < base || c > cap ? base : c
        return from + (cap - from) * 0.02
      })
    }, 200)
    return () => window.clearInterval(id)
  }, [active, complete])

  // Creep is only trusted while it sits inside the current tick's window;
  // anything else is a leftover from an earlier stage or run.
  const creepValid = active && creep > raw && creep <= raw + 1.6
  const display = complete ? 100 : creepValid ? creep : raw
  return { display, stalledMs: active && !complete ? stalledMs : 0 }
}

/* -------------------------------------------------------------------------- */
/* Dev-only simulated run so the visualizer can be tuned without a backend.   */
/* -------------------------------------------------------------------------- */

interface DemoState {
  progress: number
  stage: string
  detail: string | null
  complete: boolean
}

function useDemoRun() {
  const [demo, setDemo] = useState<DemoState | null>(null)
  const timers = useRef<number[]>([])

  const stop = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
    setDemo(null)
  }, [])

  const start = useCallback(() => {
    stop()
    const ticks: Array<[number, DemoState]> = []
    let t = 0
    const push = (delay: number, s: DemoState) => ticks.push([(t += delay), s])
    push(0, { progress: 2, stage: 'Queued', detail: 'Upload received', complete: false })
    push(700, { progress: 10, stage: 'Preprocessing complete', detail: 'Volume loaded', complete: false })
    for (let i = 1; i <= 20; i++) {
      push(220, {
        progress: 15 + Math.round((70 * i) / 20),
        stage: 'Synthesising contrast',
        detail: `Slice ${i * 8}/160`,
        complete: false,
      })
    }
    push(600, { progress: 86, stage: 'Extracting attention heatmap', detail: null, complete: false })
    push(900, { progress: 91, stage: 'AI tumour analysis', detail: 'Slice 77 (2/3)', complete: false })
    push(900, { progress: 95, stage: 'Computing metrics', detail: null, complete: false })
    push(700, { progress: 98, stage: 'Uploading to storage', detail: null, complete: false })
    // Long stall here mirrors production so the creep + elapsed hint can be tuned.
    push(9000, { progress: 100, stage: 'Complete', detail: null, complete: true })
    timers.current = ticks.map(([at, s]) => window.setTimeout(() => setDemo(s), at))
  }, [stop])

  useEffect(() => stop, [stop])

  return { demo, start, stop }
}

/* -------------------------------------------------------------------------- */

export function UploadPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [patientId, setPatientId] = useState(params.get('patient') ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const fileRef = useRef<HTMLInputElement>(null)

  const ws = useInferenceProgress(taskId)
  const { demo, start: startDemo, stop: stopDemo } = useDemoRun()

  // Live values, with the dev-only demo run overriding the socket when active.
  const rawProgress = demo ? demo.progress : ws.progress
  const complete = demo ? demo.complete : Boolean(ws.scanId)
  const failed = !demo && Boolean(ws.error)
  const running = demo
    ? !demo.complete
    : submitting || (taskId !== null && !ws.scanId && !ws.error)
  const started = running || complete || failed || rawProgress > 0

  const { display, stalledMs } = useDisplayProgress(rawProgress, running, complete)

  // Coarse 1 s clock for the elapsed counter while a run is in flight.
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [running])

  // Hold on "Complete" long enough for the brain to finish filling.
  useEffect(() => {
    if (ws.scanId) {
      const t = window.setTimeout(() => navigate(`/results/${ws.scanId}`), COMPLETE_HOLD_MS)
      return () => window.clearTimeout(t)
    }
  }, [ws.scanId, navigate])

  function pickFile(f: File | null) {
    if (!f) return
    if (!isNifti(f.name)) {
      setError('Only .nii and .nii.gz files are accepted.')
      return
    }
    setError(null)
    setFile(f)
  }

  function clearFile() {
    setFile(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    if (running) return
    pickFile(e.dataTransfer.files?.[0] ?? null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!patientId.trim()) return setError('A patient ID is required.')
    if (!file) return setError('Select a NIfTI volume (.nii or .nii.gz).')
    if (!isNifti(file.name)) return setError('Only .nii and .nii.gz files are accepted.')

    const token = await getAccessToken()
    if (!token) return setError('Your session has expired. Sign in again.')

    setSubmitting(true)
    setStartedAt(Date.now())
    try {
      const body = new FormData()
      body.append('file', file)
      body.append('patient_id', patientId.trim())
      const res = await fetch(`${BACKEND_URL}/infer`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body,
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `Backend returned ${res.status}`)
      }
      const data = (await res.json()) as { task_id: string }
      setTaskId(data.task_id)
    } catch (err) {
      setError((err as Error).message)
      setStartedAt(null)
    } finally {
      setSubmitting(false)
    }
  }

  function resetRun() {
    ws.reset()
    setTaskId(null)
    setStartedAt(null)
    stopDemo()
  }

  const stage = demo
    ? demo.stage
    : ws.error
      ? 'Failed'
      : ws.scanId
        ? 'Complete'
        : taskId
          ? ws.stage
          : submitting
            ? 'Uploading volume'
            : 'Ready'

  const stalledSec = Math.floor(stalledMs / 1000)
  const showElapsed = running && stalledMs >= SHOW_ELAPSED_AFTER_MS
  const baseDetail = demo ? demo.detail : taskId ? ws.detail : submitting ? 'Sending to server' : null
  const detail = showElapsed
    ? `${baseDetail ? `${baseDetail} · ` : ''}still working · ${formatSeconds(stalledSec)}`
    : baseDetail

  const elapsedSec = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : null
  const currentStageIndex = PIPELINE_STAGES.reduce(
    (acc, s, i) => (rawProgress >= s.at ? i : acc),
    0,
  )

  return (
    <div className="fade-in upload-page">
      <div className="page-head">
        <div className="page-head__title">
          <span className="eyebrow">Upload</span>
          <h1>Contrast enhancement</h1>
        </div>
        {import.meta.env.DEV && (
          <div className="row" style={{ gap: '0.5rem' }}>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={demo ? stopDemo : startDemo}
              disabled={!demo && running}
            >
              {demo ? 'Stop demo' : 'Simulate run'}
            </button>
          </div>
        )}
      </div>

      <div className="split">
        <PatientSearch
          selectedId={patientId || null}
          onSelect={(p) => setPatientId(p.patient_id)}
        />

        <div className="stack" style={{ '--stack-gap': '1.25rem' } as React.CSSProperties}>
          <div className="panel">
            <div className="panel__head">
              <span className="panel__title">T1 volume</span>
              <span className="small muted">Synthetic T1CE is generated on the server</span>
            </div>
            <div className="panel__body">
              <form onSubmit={handleSubmit} noValidate>
                <div className="form-grid">
                  <div className="field span-2">
                    <label className="field__label" htmlFor="up-patient">
                      Patient ID
                    </label>
                    <input
                      id="up-patient"
                      className="input mono"
                      value={patientId}
                      onChange={(e) => setPatientId(e.target.value)}
                      placeholder="Select from the list or paste an ID"
                      disabled={running}
                      required
                    />
                  </div>

                  <div className="field span-2">
                    <div className="row between">
                      <label className="field__label" htmlFor="up-file">
                        NIfTI file
                      </label>
                      <span className="field__hint mono">.nii · .nii.gz</span>
                    </div>

                    <div
                      className={[
                        'dropzone',
                        dragOver ? 'is-over' : '',
                        file ? 'has-file' : '',
                        running ? 'is-disabled' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onDragEnter={(e) => {
                        e.preventDefault()
                        if (!running) setDragOver(true)
                      }}
                      onDragOver={(e) => {
                        e.preventDefault()
                        if (!running) setDragOver(true)
                      }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={onDrop}
                    >
                      <input
                        ref={fileRef}
                        id="up-file"
                        type="file"
                        accept=".nii,.nii.gz,application/gzip"
                        onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                        disabled={running}
                        aria-describedby="up-file-help"
                        required
                      />

                      <span className="dropzone__icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="26" height="26" fill="none">
                          <path
                            d="M12 16V5m0 0-3.5 3.5M12 5l3.5 3.5"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M4.5 15.5v1.75A2.75 2.75 0 0 0 7.25 20h9.5a2.75 2.75 0 0 0 2.75-2.75V15.5"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                          />
                        </svg>
                      </span>

                      {file ? (
                        <>
                          <span className="dropzone__name">{file.name}</span>
                          <span className="dropzone__meta" id="up-file-help">
                            {formatBytes(file.size)} · drop or click to replace
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="dropzone__title">
                            {dragOver ? 'Release to add volume' : 'Drag & drop a T1 volume'}
                          </span>
                          <span className="dropzone__meta" id="up-file-help">
                            or <span className="dropzone__link">click to browse</span> · NIfTI
                            (.nii, .nii.gz)
                          </span>
                        </>
                      )}
                    </div>

                    {file && !running && (
                      <div className="row between">
                        <span className="field__hint">Volume ready to process.</span>
                        <button type="button" className="link-btn" onClick={clearFile}>
                          Remove file
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {error && (
                  <div className="alert alert--error" role="alert" style={{ marginTop: '1rem' }}>
                    {error}
                  </div>
                )}
                {ws.error && (
                  <div className="alert alert--error" role="alert" style={{ marginTop: '1rem' }}>
                    {ws.error}
                  </div>
                )}

                <div className="form-actions">
                  {ws.error && (
                    <button type="button" className="btn btn--secondary" onClick={resetRun}>
                      Try again
                    </button>
                  )}
                  <button
                    type="submit"
                    className="btn btn--primary"
                    disabled={running || Boolean(demo)}
                    aria-busy={running}
                  >
                    {running ? 'Processing…' : 'Process / Improve Contrast'}
                  </button>
                </div>
              </form>
            </div>
          </div>

          <div className="panel">
            <div className="panel__head">
              <span className="panel__title">Processing</span>
              <span className="small muted mono">
                {complete
                  ? `Done${elapsedSec !== null ? ` in ${formatSeconds(elapsedSec)}` : ''}`
                  : running
                    ? `Step ${currentStageIndex + 1} of ${PIPELINE_STAGES.length}${
                        elapsedSec !== null ? ` · ${formatSeconds(elapsedSec)}` : ''
                      }`
                    : failed
                      ? 'Failed'
                      : 'Idle'}
              </span>
            </div>
            <div className="process-grid">
              <BrainVisualizer
                progress={display}
                stage={stage}
                detail={detail}
                active={running}
                complete={complete}
              />
              <aside className="process-side">
                <ProcessStages
                  progress={rawProgress}
                  started={started}
                  complete={complete}
                  failed={failed}
                  detail={detail}
                />
                {complete && (
                  <div className="alert alert--ok process-side__note" role="status">
                    {demo
                      ? 'Simulation finished.'
                      : 'Synthetic T1CE ready — opening results…'}
                  </div>
                )}
                {!started && (
                  <p className="process-side__note small muted">
                    The brain fills from the bottom up as slices are synthesised. Progress
                    is streamed live from the inference server.
                  </p>
                )}
              </aside>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
