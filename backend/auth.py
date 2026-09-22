"""Supabase token verification and patient-ownership checks (service-role)."""
from functools import lru_cache

from fastapi import Header, HTTPException
from supabase import Client, create_client

from config import SUPABASE_SERVICE_KEY, SUPABASE_URL


@lru_cache(maxsize=1)
def service_client() -> Client:
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


def _bearer(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    return authorization.split(" ", 1)[1].strip()


def verify_user(authorization: str | None = Header(default=None)) -> str:
    """FastAPI dependency: returns the hospital's auth uid for a valid token."""
    token = _bearer(authorization)
    try:
        res = service_client().auth.get_user(token)
    except Exception as exc:  # network / invalid token
        raise HTTPException(status_code=401, detail=f"Invalid session: {exc}") from exc
    if not res or not res.user:
        raise HTTPException(status_code=401, detail="Invalid session")
    return res.user.id


def assert_patient_owned(hospital_id: str, patient_id: str) -> None:
    """403 unless `patient_id` belongs to `hospital_id`. Defends against spoofed ids."""
    rows = (
        service_client()
        .table("patients")
        .select("patient_id")
        .eq("hospital_id", hospital_id)
        .eq("patient_id", patient_id)
        .limit(1)
        .execute()
    )
    if not rows.data:
        raise HTTPException(status_code=403, detail="Patient does not belong to this hospital")


def get_owned_scan(hospital_id: str, scan_id: str) -> dict:
    """Return the scan row if its patient belongs to this hospital, else 403/404."""
    sb = service_client()
    scan = sb.table("scans").select("*").eq("scan_id", scan_id).limit(1).execute()
    if not scan.data:
        raise HTTPException(status_code=404, detail="Scan not found")
    row = scan.data[0]
    assert_patient_owned(hospital_id, row["patient_id"])
    return row


def get_hospital_name(hospital_id: str) -> str:
    res = service_client().table("hospitals").select("hospital_name").eq("id", hospital_id).limit(1).execute()
    return res.data[0]["hospital_name"] if res.data else "Hospital"


def get_patient(hospital_id: str, patient_id: str) -> dict:
    """Decrypted patient record via the same RPC path, filtered server-side."""
    sb = service_client()
    res = sb.rpc("get_patient_for_hospital", {"p_hospital": hospital_id, "p_patient": patient_id}).execute()
    if res.data:
        return res.data[0]
    return {"patient_id": patient_id, "name": "(encrypted)", "age": "", "gender": ""}
