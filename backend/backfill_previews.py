import os
from pathlib import Path
from dotenv import load_dotenv
import nibabel as nib
import numpy as np
import cv2
import tempfile
from supabase import create_client, Client

load_dotenv(Path(__file__).resolve().parent / ".env")

url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_KEY")

supabase: Client = create_client(url, key)

def save_preview_png(pred_path: str, z: int, out_png: str) -> None:
    vol = nib.load(pred_path).get_fdata(dtype=np.float32)
    sl = np.clip(vol[:, :, z], 0.0, 1.0)
    cv2.imwrite(out_png, np.rot90((sl * 255).astype(np.uint8)))

def main():
    # Fetch all scans
    res = supabase.table("scans").select("*").execute()
    scans = res.data

    print(f"Found {len(scans)} scans to process.")

    for scan in scans:
        raw_scan_url = scan.get("raw_scan_url")
        if not raw_scan_url:
            print(f"Scan {scan['scan_id']} has no raw_scan_url, skipping.")
            continue

        prefix = os.path.dirname(raw_scan_url)
        raw_preview_url = f"{prefix}/raw_preview.png"

        # Check if it already exists by trying to download it or list it?
        # Listing is easier, but let's just upload with upsert=true anyway.

        print(f"Processing scan {scan['scan_id']}...")
        try:
            with tempfile.TemporaryDirectory() as tmp:
                raw_path = os.path.join(tmp, "raw.nii.gz")
                preview_path = os.path.join(tmp, "raw_preview.png")

                # Download raw scan
                with open(raw_path, "wb") as f:
                    file_data = supabase.storage.from_("raw-scans").download(raw_scan_url)
                    f.write(file_data)
                
                # We need to normalize the volume like in infer.py
                # Let's see how _normalise and _load_volume are done in infer.py
                # Actually, infer_service.py has save_preview_png which directly reads it. Wait! 
                # inference_service does:
                # t1_norm = _normalise(_load_volume(t1_path))
                # save_preview_png(t1_path, z, raw_preview_png)
                # Ah! save_preview_png loads from pred_path and expects the raw float data.
                # Is the raw data 0.0 to 1.0? If not, save_preview_png will just clip it.
                # Let's import the actual normalise function from inference_service
                
                sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
                from inference_service import _load_volume, _normalise
                
                vol = _load_volume(raw_path)
                vol_norm = _normalise(vol)
                z = vol_norm.shape[2] // 2
                
                # we don't save to file and load again for preview, we can just take the slice
                sl = np.clip(vol_norm[:, :, z], 0.0, 1.0)
                cv2.imwrite(preview_path, np.rot90((sl * 255).astype(np.uint8)))

                # Upload
                with open(preview_path, "rb") as f:
                    supabase.storage.from_("previews").upload(
                        raw_preview_url, f.read(), {"content-type": "image/png", "upsert": "true"}
                    )
                
                print(f"  -> Uploaded {raw_preview_url}")
        except Exception as e:
            print(f"  -> Error: {e}")

if __name__ == "__main__":
    import sys
    main()
