import { useEffect, useMemo, useState } from 'react'
import { fetchMyPatients, type Patient } from '../lib/supabase'

interface PatientSearchProps {
  selectedId: string | null
  onSelect: (patient: Patient) => void
  /** Increment to force a refetch (e.g. after registering a patient). */
  refreshKey?: number
}

/**
 * Sidebar search over the logged-in hospital's patients. The `get_my_patients`
 * RPC does the row scoping server-side (auth.uid()), so this component only
 * filters the already-authorised list client-side.
 */
export function PatientSearch({ selectedId, onSelect, refreshKey = 0 }: PatientSearchProps) {
  const [patients, setPatients] = useState<Patient[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    setError(null)
    fetchMyPatients()
      .then((rows) => {
        if (!cancelled) setPatients(rows)
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setError(e.message)
          setPatients([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  const filtered = useMemo(() => {
    if (!patients) return []
    const q = query.trim().toLowerCase()
    if (!q) return patients
    return patients.filter(
      (p) => p.patient_id.toLowerCase().includes(q) || p.name.toLowerCase().includes(q),
    )
  }, [patients, query])

  return (
    <aside className="panel" aria-label="Patient search">
      <div className="panel__head">
        <span className="panel__title">Patients</span>
        {patients && (
          <span className="small muted mono">
            {filtered.length} / {patients.length}
          </span>
        )}
      </div>

      <div style={{ padding: '0.9rem 1.25rem', borderBottom: '1px solid var(--line)' }}>
        <label className="visually-hidden" htmlFor="patient-search">
          Search by patient ID or name
        </label>
        <input
          id="patient-search"
          className="input"
          type="search"
          placeholder="Search by ID or name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
      </div>

      {error && (
        <div style={{ padding: '1rem 1.25rem' }}>
          <div className="alert alert--error" role="alert">
            {error}
          </div>
        </div>
      )}

      {patients === null ? (
        <ul className="list" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} style={{ padding: '0.75rem 1.25rem', borderBottom: '1px solid var(--line)' }}>
              <div className="skeleton skeleton--text" style={{ width: '40%' }} />
              <div className="skeleton skeleton--text" style={{ width: '70%' }} />
            </li>
          ))}
        </ul>
      ) : filtered.length === 0 ? (
        <p className="small muted" style={{ padding: '1.25rem' }}>
          {patients.length === 0
            ? 'No patients registered yet. Use the form to add the first record.'
            : 'No patients match that search.'}
        </p>
      ) : (
        <ul className="list" style={{ maxHeight: 520, overflowY: 'auto' }}>
          {filtered.map((p) => (
            <li key={p.patient_id}>
              <button
                type="button"
                className={`list-item${p.patient_id === selectedId ? ' is-selected' : ''}`}
                onClick={() => onSelect(p)}
                aria-pressed={p.patient_id === selectedId}
              >
                <span className="list-item__name">{p.name}</span>
                <span className="list-item__id">{p.patient_id}</span>
                <span className="list-item__meta">
                  {p.age} y, {p.gender}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
