import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { BACKEND_URL } from '../lib/supabase'
import { getAccessToken } from '../hooks/useAuth'
import { useInferenceProgress } from '../hooks/useWebSocket'
import { BrainVisualizer } from '../components/BrainVisualizer'
import { PatientSearch } from '../components/PatientSearch'

const ACCEPTED = ['.nii', '.nii.gz']

function isNifti(name: string): boolean {
  const lower = name.toLowerCase()
  return ACCEPTED.some((ext) => lower.endsWith(ext))
}

export function UploadPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [patientId, setPatientId] = useState(params.get('patient') ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const ws = useInferenceProgress(taskId)
  const running = submitting || (taskId !== null && !ws.scanId && !ws.error)

  useEffect(() => {
    if (ws.scanId) {
      const t = window.setTimeout(() => navigate(`/results/${ws.scanId}`), 900)
      return () => window.clearTimeout(t)
    }
  }, [ws.scanId, navigate])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!patientId.trim()) return setError('A patient ID is required.')
    if (!file) return setError('Select a NIfTI volume (.nii or .nii.gz).')
    if (!isNifti(file.name)) return setError('Only .nii and .nii.gz files are accepted.')

    const token = await getAccessToken()
    if (!token) return setError('Your session has expired. Sign in again.')

    setSubmitting(true)
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
    } finally {
      setSubmitting(false)
    }
  }

  const stage = ws.error
    ? 'Failed'
    : ws.scanId
      ? 'Complete'
      : taskId
        ? ws.stage
        : submitting
          ? 'Uploading volume'
          : 'Ready'

  return (
    <div className="fade-in">
      <div className="page-head">
        <div className="page-head__title">
          <span className="eyebrow">Upload</span>
          <h1>Contrast enhancement</h1>
        </div>
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
                  <div className="field">
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
                  <div className="field">
                    <label className="field__label" htmlFor="up-file">
                      NIfTI file (.nii, .nii.gz)
                    </label>
                    <input
                      ref={fileRef}
                      id="up-file"
                      className="input"
                      type="file"
                      accept=".nii,.nii.gz,application/gzip"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                      disabled={running}
                      required
                    />
                    {file && (
                      <span className="small muted mono">
                        {file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB
                      </span>
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
                  <button
                    type="submit"
                    className="btn btn--primary"
                    disabled={running}
                    aria-busy={running}
                  >
                    {running ? 'Processing' : 'Process / Improve Contrast'}
                  </button>
                  {ws.error && (
                    <button
                      type="button"
                      className="btn btn--secondary"
                      onClick={() => {
                        ws.reset()
                        setTaskId(null)
                      }}
                    >
                      Try again
                    </button>
                  )}
                </div>
              </form>
            </div>
          </div>

          <div className="panel">
            <div className="panel__head">
              <span className="panel__title">Processing</span>
              <span className="small muted mono">
                {ws.messages.length} update{ws.messages.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="panel__body" style={{ padding: 0 }}>
              <BrainVisualizer progress={ws.progress} stage={stage} active={running} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
