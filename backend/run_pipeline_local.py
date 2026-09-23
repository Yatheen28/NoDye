"""Run the full two-model pipeline on one BraTS T1 file WITHOUT Supabase.

    python run_pipeline_local.py ../test-data/BraTS2021_00495_t1.nii.gz --out ./local_out

Exercises exactly the functions run_inference_job() calls, in the same order:

    T1 .nii.gz -> infer_volume() [Model 1] -> synthetic_t1ce.nii.gz
               -> tumor_service.run_tumor_analysis() [adapter + Model 2]
               -> pdf_service.build_report_pdf()

Useful for verifying the integration locally and for reproducing a result.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import inference_service  # noqa: E402
import tumor_service  # noqa: E402
from infer import infer_volume  # noqa: E402  (importable after inference_service adds ML_DIR to sys.path)
from pdf_service import build_report_pdf  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("t1_path")
    ap.add_argument("--out", default="local_out")
    ap.add_argument("--slices", type=int, default=None, help="override TUMOR_SLICE_COUNT")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    def progress(pct, stage, detail=None):
        print(f"[{pct:3d}%] {stage}" + (f" - {detail}" if detail else ""))

    t0 = time.time()
    print("== Model 1: contrast synthesis ==")
    out_nii = os.path.join(args.out, "synthetic_t1ce.nii.gz")
    infer_volume(args.t1_path, None, out_nii, generator=inference_service.load_model_once())
    print(f"   -> {out_nii}  ({time.time() - t0:.1f}s)")

    print("== Existing preview / attention map ==")
    t1_norm = inference_service._normalise(inference_service._load_volume(args.t1_path))
    z = t1_norm.shape[2] // 2
    preview_png = os.path.join(args.out, "preview.png")
    heatmap_png = os.path.join(args.out, "heatmap.png")
    inference_service.save_preview_png(out_nii, z, preview_png)
    inference_service.extract_attention_heatmap(t1_norm, z, heatmap_png)

    print("== Model 2: tumour classification on synthetic T1CE ==")
    t1 = time.time()
    kwargs = {"slice_count": args.slices} if args.slices else {}
    try:
        analysis, files = tumor_service.run_tumor_analysis(out_nii, os.path.join(args.out, "tumor"), progress=progress, **kwargs)
    except tumor_service.TumorAnalysisError as exc:
        analysis, files = tumor_service.failed_analysis(exc), []
        print(f"   !! tumour analysis failed: {exc}")
    print(f"   -> {len(files)} PNGs  ({time.time() - t1:.1f}s)")
    with open(os.path.join(args.out, "tumor_analysis.json"), "w") as fh:
        json.dump(analysis, fh, indent=2)

    print("== Report ==")
    rep = analysis.get("representative_slice")
    rep_row = next((s for s in analysis.get("slices", []) if s["z"] == rep), None)
    tumor_images = {}
    if rep_row:
        for key, rel in rep_row["images"].items():
            local = next(p for n, p in files if n == rel)
            with open(local, "rb") as fh:
                tumor_images[key] = fh.read()
    pdf = build_report_pdf(
        hospital_name="Local Test Hospital",
        patient={"patient_id": "LOCAL-001", "name": "Test Patient", "age": "--", "gender": "--"},
        scan={"scan_id": "local-run", "created_at": time.strftime("%Y-%m-%dT%H:%M:%S")},
        preview_png=open(preview_png, "rb").read(),
        heatmap_png=open(heatmap_png, "rb").read(),
        tumor_analysis=analysis,
        tumor_images=tumor_images,
    )
    pdf_path = os.path.join(args.out, "report.pdf")
    with open(pdf_path, "wb") as fh:
        fh.write(pdf)
    print(f"   -> {pdf_path} ({len(pdf) // 1024} KB)")

    print("\n== Summary ==")
    if analysis.get("status") == "ok":
        pf = analysis["primary_finding"]
        print(f"tumor_detected      : {analysis['tumor_detected']}")
        print(f"primary_finding     : {pf['name']} ({pf['mean_probability_pct']}%, {pf['risk_tier']})")
        print(f"overall_tumor_chance: {analysis['overall_tumor_chance_pct']}% [{analysis['overall_risk_tier']}]")
        print(f"slices analysed     : {analysis['slices_analyzed']}")
        print(f"tumour-positive     : {analysis['tumor_positive_slices']}")
        for c in analysis["categories"]:
            print(f"   {c['name']:<20} mean {c['mean_probability_pct']:5.1f}%  max {c['max_probability_pct']:5.1f}%  votes {c['slices_predicted']}")
    else:
        print(f"status: {analysis.get('status')}  error: {analysis.get('error')}")
    print(f"total {time.time() - t0:.1f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
