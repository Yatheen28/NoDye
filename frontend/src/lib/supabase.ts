import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!supabaseUrl || !supabaseAnonKey) {
  // Fail loudly at startup rather than with an opaque network error later.
  // eslint-disable-next-line no-console
  console.error(
    'NoDye: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set in .env',
  )
}

export const supabase = createClient(
  supabaseUrl ?? 'http://localhost:54321',
  supabaseAnonKey ?? 'missing-anon-key',
)

export const BACKEND_URL: string =
  (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? 'http://localhost:8000'

export function backendWsUrl(path: string): string {
  const base = new URL(BACKEND_URL)
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
  base.pathname = path
  base.search = ''
  return base.toString()
}

/* ------------------------------------------------------------------------ */
/* Domain types                                                             */
/* ------------------------------------------------------------------------ */

export interface Patient {
  patient_id: string
  name: string
  age: number
  gender: string
  phone: string
  address: string
  created_at: string
}

export type MetricsSource = 'measured' | 'benchmark'

// --------------------------------------------------------------------------
// Model 2 (tumor classifier) types — mirrors tumor_service.py output schema
// --------------------------------------------------------------------------

export interface TumorCategory {
  class_key: string
  name: string
  mean_probability_pct: number
  max_probability_pct: number
  slices_predicted: number
  risk_tier: string
  is_tumor_type: boolean
  insight: string
}

export interface TumorSliceImages {
  mri?: string      // object path in heatmaps bucket
  heatmap?: string
  overlay?: string
}

export interface TumorSlice {
  z: number
  predicted_class: string
  predicted_name: string
  confidence_pct: number
  tumor_chance_pct: number
  probabilities: Record<string, number>
  probabilities_pct: Record<string, number>
  images: TumorSliceImages
}

export interface TumorPrimaryFinding {
  class_key: string
  name: string
  mean_probability_pct: number
  risk_tier: string
}

export interface TumorAnalysis {
  status: 'ok' | 'failed' | 'disabled' | string
  error?: string | null
  error_kind?: string
  tumor_detected?: boolean
  overall_tumor_chance_pct?: number
  overall_healthy_chance_pct?: number
  overall_risk_tier?: string
  primary_finding?: TumorPrimaryFinding
  aggregation?: string
  categories?: TumorCategory[]
  slices_total?: number
  slices_generated_range?: [number, number]
  slices_analyzed?: number[]
  tumor_positive_slices?: number[]
  tumor_positive_count?: number
  representative_slice?: number
  not_available?: Record<string, string>
  summary_text?: string
  disclaimer?: string
  model?: {
    name: string
    checkpoint: string
    classes: string[]
    input: string
    device: string
    architecture?: string
    epoch?: number
    val_f1?: number | null
    val_acc?: number | null
  }
  source?: string
  slices?: TumorSlice[]
  images_bucket?: string
}

/** Compact tumor summary sent in the WebSocket 'complete' event. */
export interface TumorSummary {
  status: string
  error?: string | null
  tumor_detected?: boolean
  primary_finding?: string
  primary_probability_pct?: number
  overall_tumor_chance_pct?: number
  overall_risk_tier?: string
}

export interface Scan {
  scan_id: string
  patient_id: string
  raw_scan_url: string | null
  result_scan_url: string | null
  preview_image_url: string | null
  attention_map_url: string | null
  psnr: number | null
  ssim: number | null
  mae: number | null
  metrics_source: MetricsSource | null
  pdf_url: string | null
  created_at: string
  // Model 2 result stored as JSONB in the scans table (migration 002)
  tumor_analysis?: TumorAnalysis | null
}

/**
 * Storage buckets are private. The `*_url` columns on `scans` hold object
 * paths inside their bucket; the browser signs them on demand using the
 * logged-in hospital's session (storage RLS scopes objects by hospital uid).
 */
export type Bucket = 'raw-scans' | 'result-scans' | 'previews' | 'heatmaps' | 'reports'

export async function signedUrl(
  bucket: Bucket,
  objectPath: string | null,
  expiresInSeconds = 60 * 30,
): Promise<string | null> {
  if (!objectPath) return null
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(objectPath, expiresInSeconds)
  if (error) {
    // eslint-disable-next-line no-console
    console.warn(`signedUrl(${bucket}/${objectPath}) failed`, error.message)
    return null
  }
  return data.signedUrl
}

export async function fetchMyPatients(): Promise<Patient[]> {
  const { data, error } = await supabase.rpc('get_my_patients')
  if (error) throw new Error(error.message)
  return (data ?? []) as Patient[]
}

export interface RegisterPatientInput {
  name: string
  age: number
  gender: string
  phone: string
  address: string
}

export async function registerPatient(input: RegisterPatientInput): Promise<string> {
  const { data, error } = await supabase.rpc('register_patient', {
    p_name: input.name,
    p_age: input.age,
    p_gender: input.gender,
    p_phone: input.phone,
    p_address: input.address,
  })
  if (error) throw new Error(error.message)
  return data as string
}

export async function fetchScansForPatient(patientId: string): Promise<Scan[]> {
  const { data, error } = await supabase
    .from('scans')
    .select('*')
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as Scan[]
}

export async function fetchScan(scanId: string): Promise<Scan | null> {
  const { data, error } = await supabase
    .from('scans')
    .select('*')
    .eq('scan_id', scanId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as Scan | null) ?? null
}
