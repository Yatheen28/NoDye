import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PatientSearch } from '../components/PatientSearch'
import { registerPatient, fetchScansForPatient, type Patient, type Scan } from '../lib/supabase'

/* -------------------------------------------------------------------------- */
/* Register patient form                                                       */
/* -------------------------------------------------------------------------- */

interface RegisterFormProps {
  onRegistered: (patientId: string) => void
}

function RegisterForm({ onRegistered }: RegisterFormProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  /** Allow only digits in the phone field and cap at 10 characters */
  function handlePhoneInput(e: React.FormEvent<HTMLInputElement>) {
    const raw = e.currentTarget.value
    // Strip anything that isn't a digit
    const digitsOnly = raw.replace(/\D/g, '').slice(0, 10)
    e.currentTarget.value = digitsOnly
  }

  /** Allow only letters, spaces, and dots in the name field */
  function handleNameInput(e: React.FormEvent<HTMLInputElement>) {
    const raw = e.currentTarget.value
    e.currentTarget.value = raw.replace(/[^a-zA-Z\s.]/g, '')
  }

  /** Allow only digits in the age field */
  function handleAgeInput(e: React.FormEvent<HTMLInputElement>) {
    const raw = e.currentTarget.value
    e.currentTarget.value = raw.replace(/\D/g, '').slice(0, 3)
  }

  function validate(fd: FormData): Record<string, string> {
    const errors: Record<string, string> = {}

    const name = (fd.get('name') as string).trim()
    const ageStr = (fd.get('age') as string).trim()
    const gender = fd.get('gender') as string
    const phone = (fd.get('phone') as string).trim()

    // Name: required, letters/spaces/dots only
    if (!name) {
      errors.name = 'Full name is required.'
    } else if (!/^[a-zA-Z\s.]+$/.test(name)) {
      errors.name = 'Name must contain only letters, spaces, and dots.'
    }

    // Age: required, integer between 1 and 130
    if (!ageStr) {
      errors.age = 'Age is required.'
    } else {
      const age = parseInt(ageStr, 10)
      if (isNaN(age) || age < 1 || age > 130) {
        errors.age = 'Age must be a number between 1 and 130.'
      }
    }

    // Gender: required
    if (!gender) {
      errors.gender = 'Gender is required.'
    }

    // Phone: optional, but if provided must be exactly 10 digits (Indian standard)
    if (phone) {
      if (!/^\d{10}$/.test(phone)) {
        errors.phone = 'Phone number must be exactly 10 digits (Indian standard). No symbols or letters.'
      } else if (!/^[6-9]/.test(phone)) {
        errors.phone = 'Indian mobile numbers must start with 6, 7, 8, or 9.'
      }
    }

    return errors
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setFieldErrors({})

    const fd = new FormData(e.currentTarget)
    const errors = validate(fd)

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      setError('Please fix the highlighted fields before proceeding.')
      return
    }

    setBusy(true)

    const name = (fd.get('name') as string).trim()
    const age = parseInt(fd.get('age') as string, 10)
    const gender = fd.get('gender') as string
    const phone = (fd.get('phone') as string).trim()
    const address = (fd.get('address') as string).trim()

    try {
      const id = await registerPatient({ name, age, gender, phone, address })
      setSuccess(`Patient registered — ID: ${id}`)
        ; (e.target as HTMLFormElement).reset()
      onRegistered(id)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="form-grid">
        <div className="field">
          <label className="field__label" htmlFor="reg-name">
            Full name <span aria-hidden="true">*</span>
          </label>
          <input
            id="reg-name"
            name="name"
            className={`input${fieldErrors.name ? ' input--error' : ''}`}
            type="text"
            required
            autoComplete="off"
            onInput={handleNameInput}
          />
          {fieldErrors.name && (
            <span className="field__error" role="alert">{fieldErrors.name}</span>
          )}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="reg-age">
            Age <span aria-hidden="true">*</span>
          </label>
          <input
            id="reg-age"
            name="age"
            className={`input${fieldErrors.age ? ' input--error' : ''}`}
            type="text"
            inputMode="numeric"
            required
            autoComplete="off"
            onInput={handleAgeInput}
          />
          {fieldErrors.age && (
            <span className="field__error" role="alert">{fieldErrors.age}</span>
          )}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="reg-gender">
            Gender <span aria-hidden="true">*</span>
          </label>
          <select
            id="reg-gender"
            name="gender"
            className={`select${fieldErrors.gender ? ' input--error' : ''}`}
            required
            defaultValue=""
          >
            <option value="" disabled>
              Select…
            </option>
            <option value="Female">Female</option>
            <option value="Male">Male</option>
            <option value="Non-binary">Non-binary</option>
            <option value="Prefer not to say">Prefer not to say</option>
          </select>
          {fieldErrors.gender && (
            <span className="field__error" role="alert">{fieldErrors.gender}</span>
          )}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="reg-phone">
            Phone <span className="small muted">(10-digit Indian mobile)</span>
          </label>
          <input
            id="reg-phone"
            name="phone"
            className={`input${fieldErrors.phone ? ' input--error' : ''}`}
            type="tel"
            inputMode="numeric"
            maxLength={10}
            autoComplete="off"
            onInput={handlePhoneInput}
          />
          {fieldErrors.phone && (
            <span className="field__error" role="alert">{fieldErrors.phone}</span>
          )}
        </div>

        <div className="field span-2">
          <label className="field__label" htmlFor="reg-address">
            Address
          </label>
          <input
            id="reg-address"
            name="address"
            className="input"
            type="text"
            autoComplete="off"
          />
        </div>
      </div>

      {error && (
        <div className="alert alert--error" role="alert" style={{ marginTop: '1rem' }}>
          {error}
        </div>
      )}
      {success && (
        <div className="alert alert--ok" role="status" style={{ marginTop: '1rem' }}>
          {success}
        </div>
      )}

      <div className="form-actions">
        <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy}>
          {busy ? 'Registering…' : 'Register patient'}
        </button>
      </div>
    </form>
  )
}

/* -------------------------------------------------------------------------- */
/* Scan history for selected patient                                           */
/* -------------------------------------------------------------------------- */

interface ScanHistoryProps {
  patient: Patient
  onViewResults: (scanId: string) => void
  onUpload: (patientId: string) => void
}

function ScanHistory({ patient, onViewResults, onUpload }: ScanHistoryProps) {
  const [scans, setScans] = useState<Scan[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Fetch on mount / patient change
  useState(() => {
    let cancelled = false
    setScans(null)
    setError(null)
    fetchScansForPatient(patient.patient_id)
      .then((rows) => {
        if (!cancelled) setScans(rows)
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setError(e.message)
          setScans([])
        }
      })
    return () => {
      cancelled = true
    }
  })

  return (
    <div className="stack" style={{ '--stack-gap': '1.25rem' } as React.CSSProperties}>
      {/* Patient details */}
      <div className="panel">
        <div className="panel__head">
          <span className="panel__title">Patient details</span>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={() => onUpload(patient.patient_id)}
          >
            Upload new scan
          </button>
        </div>
        <div className="panel__body">
          <dl className="kv">
            <dt>Patient ID</dt>
            <dd className="mono">{patient.patient_id}</dd>
            <dt>Name</dt>
            <dd>{patient.name}</dd>
            <dt>Age</dt>
            <dd>{patient.age}</dd>
            <dt>Gender</dt>
            <dd>{patient.gender}</dd>
            {patient.phone && (
              <>
                <dt>Phone</dt>
                <dd>{patient.phone}</dd>
              </>
            )}
            {patient.address && (
              <>
                <dt>Address</dt>
                <dd>{patient.address}</dd>
              </>
            )}
            <dt>Registered</dt>
            <dd>{new Date(patient.created_at).toLocaleDateString()}</dd>
          </dl>
        </div>
      </div>

      {/* Scan history */}
      <div className="panel">
        <div className="panel__head">
          <span className="panel__title">Scan history</span>
          {scans && (
            <span className="small muted mono">{scans.length} scan{scans.length !== 1 ? 's' : ''}</span>
          )}
        </div>

        {error && (
          <div style={{ padding: '1rem 1.25rem' }}>
            <div className="alert alert--error" role="alert">
              {error}
            </div>
          </div>
        )}

        {scans === null ? (
          <div style={{ padding: '1.25rem' }}>
            <div className="skeleton skeleton--text" style={{ width: '60%' }} />
            <div className="skeleton skeleton--text" style={{ width: '40%', marginTop: '0.5rem' }} />
          </div>
        ) : scans.length === 0 ? (
          <p className="small muted" style={{ padding: '1.25rem' }}>
            No scans yet.{' '}
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              style={{ marginLeft: '0.5rem' }}
              onClick={() => onUpload(patient.patient_id)}
            >
              Upload first scan
            </button>
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Scan ID</th>
                <th>Date</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {scans.map((s) => (
                <tr key={s.scan_id}>
                  <td className="mono small">{s.scan_id.slice(0, 8)}…</td>
                  <td>{new Date(s.created_at).toLocaleDateString()}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => onViewResults(s.scan_id)}
                    >
                      View results
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export function PatientPage() {
  const navigate = useNavigate()
  const [selected, setSelected] = useState<Patient | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  function handleRegistered(_id: string) {
    setRefreshKey((k) => k + 1)
  }

  return (
    <div className="fade-in">
      <div className="page-head">
        <div className="page-head__title">
          <span className="eyebrow">Patients</span>
          <h1>Patient records</h1>
        </div>
      </div>

      <div className="split">
        {/* Left: search sidebar */}
        <PatientSearch
          selectedId={selected?.patient_id ?? null}
          onSelect={setSelected}
          refreshKey={refreshKey}
        />

        {/* Right: detail / register form */}
        <div>
          {selected ? (
            <ScanHistory
              patient={selected}
              onViewResults={(id) => navigate(`/results/${id}`)}
              onUpload={(patientId) => navigate(`/upload?patient=${patientId}`)}
            />
          ) : (
            <div className="panel">
              <div className="panel__head">
                <span className="panel__title">Register new patient</span>
              </div>
              <div className="panel__body">
                <RegisterForm onRegistered={handleRegistered} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
