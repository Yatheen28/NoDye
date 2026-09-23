"""
Example Integration Script:
Demonstrates how to call the brain tumor predictor on an enhanced MRI scan.
"""
import os
from PIL import Image
import numpy as np

# 1. Import the detector function
from tumor_detector import predict_tumor_from_image

def main():
    # Path to sample image (replace with your contrast model's output)
    sample_path = "test_sample.png"
    if not os.path.exists(sample_path):
        sample_path = os.path.join(os.path.dirname(__file__), "test_sample.png")

    print(f"Loading MRI image: {sample_path}")
    enhanced_mri = Image.open(sample_path)  # Or numpy array / file path

    # 2. Run prediction directly on the image
    print("\nRunning Brain Tumor Risk Analysis...")
    result = predict_tumor_from_image(enhanced_mri, include_gradcam=True)

    # 3. Access results
    print("\n" + "=" * 60)
    print("                 TUMOR RISK ASSESSMENT RESULT")
    print("=" * 60)
    print(f"Overall Tumor Chance   : {result['overall_tumor_chance_pct']}%  [{result['overall_risk_tier']}]")
    print(f"Chance Normal / Healthy: {result['overall_healthy_chance_pct']}%")
    print(f"Primary Diagnosis      : {result['primary_prediction']} ({result['primary_confidence_pct']}%)")
    print("-" * 60)
    print("Full Category Breakdown:")
    for cat in result['categories']:
        print(f"  - {cat['name']:<22}: {cat['percentage']:5.1f}%  [{cat['risk_tier']}]")
    print("=" * 60)
    print(f"Grad-CAM Heatmap Base64: Available ({len(result.get('gradcam_base64', ''))} chars)")
    print("\nIntegration test successful!")

if __name__ == '__main__':
    main()
