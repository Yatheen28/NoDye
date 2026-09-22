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
