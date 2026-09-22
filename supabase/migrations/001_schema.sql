-- NoDye schema. Run in the Supabase SQL editor (or `supabase db push`).
-- Prerequisite: in Vault, create a secret named `patient_pii_key` (32+ random chars).

create extension if not exists pgcrypto;

-- 1. Hospitals: one row per Supabase Auth account (pre-created, no signup flow)
create table if not exists hospitals (
  id uuid primary key references auth.users(id) on delete cascade,
  hospital_name text not null,
  created_at timestamptz default now()
);

-- 2. Patients: a record owned by one hospital, not a login. PII is encrypted.
create table if not exists patients (
  patient_id text primary key,
  hospital_id uuid not null references hospitals(id),
  name_enc bytea not null,
  age int not null,
  gender text not null,
  phone_enc bytea not null,
  address_enc bytea not null,
  created_at timestamptz default now()
);

-- 3. Scans: one row per processed MRI. *_url columns hold storage object paths.
create table if not exists scans (
  scan_id uuid primary key default gen_random_uuid(),
  patient_id text not null references patients(patient_id),
  raw_scan_url text,
  result_scan_url text,
  preview_image_url text,
  attention_map_url text,
  psnr numeric,
  ssim numeric,
  mae numeric,
  metrics_source text check (metrics_source in ('measured', 'benchmark')),
  pdf_url text,
  created_at timestamptz default now()
);

-- RLS: the real isolation mechanism.
alter table hospitals enable row level security;
alter table patients enable row level security;
alter table scans enable row level security;

drop policy if exists "hospital_self" on hospitals;
create policy "hospital_self" on hospitals
  for select using (id = auth.uid());

drop policy if exists "hospital_isolation_patients" on patients;
create policy "hospital_isolation_patients" on patients
  for all using (hospital_id = auth.uid()) with check (hospital_id = auth.uid());

drop policy if exists "hospital_isolation_scans" on scans;
create policy "hospital_isolation_scans" on scans
  for all using (
    patient_id in (select patient_id from patients where hospital_id = auth.uid())
  );

-- Patient ID generator helper: <first 4 of hospital uid>-<YYYYMMDD>-<seq>
create or replace function generate_patient_id(hospital_uid uuid)
returns text language plpgsql as $$
declare
  h_code text;
  seq int;
begin
  h_code := substring(hospital_uid::text from 1 for 4);
  select count(*) + 1 into seq from patients where hospital_id = hospital_uid
    and created_at::date = current_date;
  return upper(h_code) || '-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad(seq::text, 3, '0');
end; $$;

-- RPC: Register patient. SECURITY DEFINER bypasses RLS, so it scopes to auth.uid() itself.
create or replace function register_patient(
  p_name text, p_age int, p_gender text, p_phone text, p_address text
) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  new_id text;
  enc_key text := (select decrypted_secret from vault.decrypted_secrets v where v.name = 'patient_pii_key');
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if enc_key is null then
    raise exception 'vault secret patient_pii_key is not configured';
  end if;
  new_id := generate_patient_id(auth.uid());
  insert into patients (patient_id, hospital_id, name_enc, age, gender, phone_enc, address_enc)
  values (
    new_id, auth.uid(),
    pgp_sym_encrypt(p_name, enc_key, 'cipher-algo=aes256'::text),
    p_age, p_gender,
    pgp_sym_encrypt(p_phone, enc_key, 'cipher-algo=aes256'::text),
    pgp_sym_encrypt(p_address, enc_key, 'cipher-algo=aes256'::text)
  );
  return new_id;
end; $$;

-- RPC: Caller's patients, decrypted. Filters by auth.uid() internally (mandatory: SECURITY DEFINER).
create or replace function get_my_patients()
returns table(patient_id text, name text, age int, gender text, phone text, address text, created_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare
  enc_key text := (select decrypted_secret from vault.decrypted_secrets v where v.name = 'patient_pii_key');
begin
  return query
  select p.patient_id,
         pgp_sym_decrypt(p.name_enc, enc_key)::text,
         p.age, p.gender,
         pgp_sym_decrypt(p.phone_enc, enc_key)::text,
         pgp_sym_decrypt(p.address_enc, enc_key)::text,
         p.created_at
  from patients p where p.hospital_id = auth.uid()
  order by p.created_at desc;
end; $$;

-- RPC used only by the backend (service role) for the PDF: decrypt one patient for a given hospital.
create or replace function get_patient_for_hospital(p_hospital uuid, p_patient text)
returns table(patient_id text, name text, age int, gender text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  enc_key text := (select decrypted_secret from vault.decrypted_secrets v where v.name = 'patient_pii_key');
begin
  return query
  select p.patient_id, pgp_sym_decrypt(p.name_enc, enc_key)::text, p.age, p.gender
  from patients p where p.hospital_id = p_hospital and p.patient_id = p_patient;
end; $$;
revoke execute on function get_patient_for_hospital(uuid, text) from anon, authenticated;

grant execute on function register_patient(text, int, text, text, text) to authenticated;
grant execute on function get_my_patients() to authenticated;

-- Storage buckets (private). Objects are keyed `<hospital_uid>/<patient_id>/<scan_id>/<file>`.
insert into storage.buckets (id, name, public)
values ('raw-scans','raw-scans',false), ('result-scans','result-scans',false),
       ('previews','previews',false), ('heatmaps','heatmaps',false), ('reports','reports',false)
on conflict (id) do nothing;

-- Hospitals may read only objects under their own uid prefix (backend writes with service role).
drop policy if exists "hospital_read_own_objects" on storage.objects;
create policy "hospital_read_own_objects" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('raw-scans','result-scans','previews','heatmaps','reports')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Seed hospitals based on created Auth users
insert into hospitals (id, hospital_name) values 
  ('835358e6-d649-43df-abcd-dae47c45fa09', 'Father Muller Hospital'),
  ('1c438343-aace-499c-bb2f-2c549ca235f1', 'St. Joseph Hospital'),
  ('18ddca27-5802-4c98-94f1-9d5f5c488ff3', 'Yenepoya Hospital')
on conflict (id) do nothing;
