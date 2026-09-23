"""NoDye backend: POST /infer, WS /ws/infer/{task_id}, GET /scans/{scan_id}/pdf."""
from __future__ import annotations

import asyncio
import json
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import Response  # noqa: E402

import inference_service  # noqa: E402
import tumor_service  # noqa: E402
from auth import assert_patient_owned, get_hospital_name, get_owned_scan, get_patient, service_client, verify_user  # noqa: E402
from config import BUCKET_HEATMAP, BUCKET_PREVIEW, BUCKET_REPORTS, CHECKPOINT_PATH, TUMOR_ANALYSIS_ENABLED  # noqa: E402
from pdf_service import build_report_pdf  # noqa: E402


@asynccontextmanager
async def lifespan(_app: FastAPI):
    inference_service.load_model_once()
    # Model 2 is optional at startup: a missing checkpoint is reported on /health
    # and in each scan's tumor_analysis.status instead of preventing boot.
    if TUMOR_ANALYSIS_ENABLED:
        try:
            tumor_service.load_tumor_model_once()
        except tumor_service.TumorAnalysisError as exc:
            print(f"[NoDye] WARNING: tumour classifier unavailable: {exc}")
    yield


app = FastAPI(title="NoDye API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

# task_id -> {"events": [dict], "subscribers": set[asyncio.Queue]}
_TASKS: dict[str, dict] = {}


@app.get("/health")
def health():
    return {
        "ok": True,
        "device": inference_service.device_name(),
        "checkpoint": os.path.basename(CHECKPOINT_PATH),
        "tumor_model": {"enabled": TUMOR_ANALYSIS_ENABLED, **tumor_service.tumor_model_status()},
    }


def _publish(task_id: str, event: dict, loop: asyncio.AbstractEventLoop) -> None:
    def _do():
        task = _TASKS.get(task_id)
        if not task:
            return
        task["events"].append(event)
        for q in list(task["subscribers"]):
            q.put_nowait(event)

    loop.call_soon_threadsafe(_do)


@app.post("/infer")
async def infer(
    file: UploadFile = File(...),
    patient_id: str = Form(...),
    ground_truth: UploadFile | None = File(default=None),
    hospital_id: str = Depends(verify_user),
):
    name = file.filename or ""
    if not (name.endswith(".nii") or name.endswith(".nii.gz")):
        raise HTTPException(status_code=400, detail="Only .nii / .nii.gz files are accepted")
    assert_patient_owned(hospital_id, patient_id)

    upload_bytes = await file.read()
    gt_bytes = await ground_truth.read() if ground_truth else None

    task_id = str(uuid.uuid4())
    _TASKS[task_id] = {"events": [], "subscribers": set()}
    loop = asyncio.get_running_loop()

    def progress(pct: int, stage: str, detail: str | None) -> None:
        _publish(task_id, {"type": "progress", "progress": pct, "stage": stage, "detail": detail}, loop)

    def worker():
        try:
            progress(2, "Queued", "Upload received")
            result = inference_service.run_inference_job(
                sb=service_client(),
                hospital_id=hospital_id,
                patient_id=patient_id,
                upload_bytes=upload_bytes,
                original_filename=name,
                gt_bytes=gt_bytes,
                progress=progress,
            )
            _publish(
                task_id,
                {
                    "type": "complete",
                    "progress": 100,
                    "stage": "Complete",
                    "scan_id": result["scan_id"],
                    "metrics": result["metrics"],
                    "tumor": result.get("tumor"),
                },
                loop,
            )
        except Exception as exc:  # surfaced to the client over the socket
            _publish(task_id, {"type": "error", "progress": 100, "stage": "Failed", "detail": str(exc)}, loop)

    loop.run_in_executor(None, worker)
    return {"task_id": task_id}


@app.websocket("/ws/infer/{task_id}")
async def ws_infer(ws: WebSocket, task_id: str):
    await ws.accept()
    task = _TASKS.get(task_id)
    if not task:
        await ws.send_text(json.dumps({"type": "error", "progress": 100, "stage": "Failed", "detail": "Unknown task"}))
        await ws.close()
        return

    q: asyncio.Queue = asyncio.Queue()
    task["subscribers"].add(q)
    try:
        # Replay history so late connections see the full state.
        for ev in list(task["events"]):
            await ws.send_text(json.dumps(ev))
        if task["events"] and task["events"][-1]["type"] in ("complete", "error"):
            return
        while True:
            ev = await q.get()
            await ws.send_text(json.dumps(ev))
            if ev["type"] in ("complete", "error"):
                return
    except WebSocketDisconnect:
        pass
    finally:
        task["subscribers"].discard(q)
        try:
            await ws.close()
        except Exception:
            pass


@app.get("/scans/{scan_id}/pdf")
def scan_pdf(scan_id: str, hospital_id: str = Depends(verify_user)):
    sb = service_client()
    scan = get_owned_scan(hospital_id, scan_id)
    patient = get_patient(hospital_id, scan["patient_id"])
    hospital_name = get_hospital_name(hospital_id)

    preview = _download(sb, BUCKET_PREVIEW, scan.get("preview_image_url"))
    heatmap = _download(sb, BUCKET_HEATMAP, scan.get("attention_map_url"))

    # Model 2 images for the representative slice (MRI / Grad-CAM / overlay).
    tumor_analysis = scan.get("tumor_analysis") or None
    tumor_images = _tumor_report_images(sb, tumor_analysis)

    try:
        pdf_bytes = build_report_pdf(
            hospital_name=hospital_name,
            patient=patient,
            scan=scan,
            preview_png=preview,
            heatmap_png=heatmap,
            tumor_analysis=tumor_analysis,
            tumor_images=tumor_images,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Report generation failed: {exc}") from exc

    object_path = f"{hospital_id}/{scan['patient_id']}/{scan_id}/report.pdf"
    try:
        sb.storage.from_(BUCKET_REPORTS).upload(object_path, pdf_bytes, {"content-type": "application/pdf", "upsert": "true"})
        sb.table("scans").update({"pdf_url": object_path}).eq("scan_id", scan_id).execute()
    except Exception as exc:
        print(f"[NoDye] PDF upload skipped: {exc}")

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="NoDye_{scan["patient_id"]}_{scan_id[:8]}.pdf"'},
    )


def _download(sb, bucket: str, path: str | None) -> bytes | None:
    if not path:
        return None
    try:
        return sb.storage.from_(bucket).download(path)
    except Exception as exc:
        print(f"[NoDye] download {bucket}/{path} failed: {exc}")
        return None


def _tumor_report_images(sb, analysis: dict | None) -> dict[str, bytes]:
    """Fetch the representative slice's MRI / heat map / overlay PNGs for the PDF."""
    if not analysis or analysis.get("status") != "ok":
        return {}
    rep = analysis.get("representative_slice")
    slice_row = next((s for s in analysis.get("slices", []) if s.get("z") == rep), None)
    if not slice_row:
        return {}
    bucket = analysis.get("images_bucket", BUCKET_HEATMAP)
    out: dict[str, bytes] = {}
    for key, path in (slice_row.get("images") or {}).items():
        data = _download(sb, bucket, path)
        if data:
            out[key] = data
    return out
