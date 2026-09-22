import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { BACKEND_URL, fetchScan, signedUrl, type Scan } from '../lib/supabase'
import { getAccessToken } from '../hooks/useAuth'

interface Urls {
  preview: string | null
  heatmap: string | null
  result: string | null
}

export function ResultsPage() {
  const { scanId } = useParams<{ scanId: string }>()
  const [scan, setScan] = useState<Scan | null | undefined>(undefined)
  const [urls, setUrls] = useState<Urls>({ preview: null, heatmap: null, result: null })
  const [error, setError] = useState<string | null>(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)

  useEffect(() => {
    if (!scanId) return
    let cancelled = false
    fetchScan(scanId)
      .then(async (s) => {
        if (cancelled) return
        setScan(s)
        if (!s) return
        const [preview, heatmap, result] = await Promise.all([
          signedUrl('previews', s.preview_image_url),
          signedUrl('heatmaps', s.attention_map_url),
          signedUrl('result-scans', s.result_scan_url),
        ])
        if (!cancelled) setUrls({ preview, heatmap, result })
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [scanId])

  async function generatePdf() {
    if (!scanId) return
    setPdfBusy(true)
    setPdfError(null)
    try {
      const token = await getAccessToken()
      const res = await fetch(`${BACKEND_URL}/scans/${scanId}/pdf`, {
        headers: { Authorization: `Bearer ${token ?? ''}` },
      })
      if (!res.ok) throw new Error((await res.text()) || `Backend returned ${res.status}`)
      const blob = await res.blob()
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href
      a.download = `NoDye_${scan?.patient_id ?? 'scan'}_${scanId.slice(0, 8)}.pdf`
      a.click()
      URL.revokeObjectURL(href)
    } catch (e) {
      setPdfError((e as Error).message)
    } finally {
      setPdfBusy(false)
    }
  }

  if (error) {
    return (
      <div className="alert alert--error" role="alert">
        {error}
      </div>
    )
  }

  if (scan === null) {
    return (
      <div className="fade-in">
        <div className="alert alert--warn">
          Scan not found, or it belongs to another hospital.{' '}
          <Link to="/patients">Back to patients</Link>
        </div>
      </div>
    )
  }

  const loading = scan === undefined

  return (
    <div className="fade-in">
      <div className="page-head">
        <div className="page-head__title">
          <span className="eyebrow">Results</span>
          <h1>Synthetic T1CE</h1>
          {scan && (
            <p className="small muted mono">
              Patient {scan.patient_id} · scan {scan.scan_id.slice(0, 8)} ·{' '}
              {new Date(scan.created_at).toLocaleString()}
            </p>
          )}
        </div>
        <div className="form-actions" style={{ margin: 0 }}>
          {scan && (
            <Link className="btn btn--secondary" to={`/upload?patient=${scan.patient_id}`}>
              New scan
            </Link>
          )}
          <button
            type="button"
            className="btn btn--primary"
            onClick={generatePdf}
            disabled={loading || pdfBusy}
            aria-busy={pdfBusy}
          >
            {pdfBusy ? 'Generating' : 'Generate PDF'}
          </button>
        </div>
      </div>

      {pdfError && (
        <div className="alert alert--error" role="alert" style={{ marginBottom: '1rem' }}>
          {pdfError}
        </div>
      )}

      {/* Two images side by side */}
      <div className="results-images">
        <ImagePanel
          title="Synthetic T1CE"
          subtitle="Input T1 vs generated T1CE"
          src={urls.preview}
          loading={loading}
          alt="Preview of the synthetic contrast-enhanced slice"
          zoomable
        />
        <ImagePanel
          title="Attention heatmap"
          subtitle="Sigmoid output of gate att1 (highest resolution)"
          src={urls.heatmap}
          loading={loading}
          alt="Attention gate heatmap overlaid on the slice"
        />
      </div>

      {/* Downloads panel – full width below */}
      <div className="panel" style={{ marginTop: '1.5rem' }}>
        <div className="panel__head">
          <span className="panel__title">Downloads</span>
        </div>
        <div className="panel__body">
          <div className="form-actions" style={{ margin: 0, flexWrap: 'wrap' }}>
            <a
              className="btn btn--secondary"
              href={urls.result ?? undefined}
              download
              aria-disabled={!urls.result}
            >
              Synthetic T1CE (.nii.gz)
            </a>
            <a
              className="btn btn--secondary"
              href={urls.preview ?? undefined}
              download
              aria-disabled={!urls.preview}
            >
              Preview PNG
            </a>
            <a
              className="btn btn--ghost"
              href={urls.heatmap ?? undefined}
              download
              aria-disabled={!urls.heatmap}
            >
              Heatmap PNG
            </a>
          </div>
          <p className="small muted" style={{ marginTop: '0.75rem' }}>
            Links are signed for 30 minutes and scoped to your hospital.
          </p>
        </div>
      </div>
    </div>
  )
}

function ImagePanel({
  title,
  subtitle,
  src,
  loading,
  alt,
}: {
  title: string
  subtitle: string
  src: string | null
  loading: boolean
  alt: string
}) {
  const [imgError, setImgError] = useState(false)

  // Reset error state if src changes
  useEffect(() => {
    setImgError(false)
  }, [src])

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="panel__head" style={{ minHeight: '84px', alignItems: 'flex-start' }}>
        <span className="panel__title" style={{ marginTop: '2px' }}>{title}</span>
        <span className="small muted" style={{ textAlign: 'right', flex: 1, lineHeight: 1.4 }}>{subtitle}</span>
      </div>
      <div 
        className="panel__body" 
        style={{ 
          background: '#000000', 
          padding: 0, 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          overflow: 'hidden',
          flexGrow: 1
        }}
      >
        {loading || !src ? (
          <div className="skeleton" style={{ width: '100%', height: '100%', minHeight: '300px' }} />
        ) : imgError ? (
          <div className="small muted" style={{ padding: '2rem', textAlign: 'center', minHeight: '300px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            Preview not available<br/>
            <span style={{ fontSize: '0.8em', opacity: 0.7 }}>(Legacy scan)</span>
          </div>
        ) : (
          <img 
            src={src} 
            alt={alt} 
            style={{ 
              width: '100%', 
              height: 'auto',
              display: 'block' 
            }} 
            onError={() => setImgError(true)}
          />
        )}
      </div>
    </div>
  )
}
