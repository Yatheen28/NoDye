# Brain Tumor MRI Predictor Module (Portable Package)

This package contains the trained EfficientNet-B0 model and inference engine for Brain Tumor MRI Risk Prediction.
It is designed to take the high-contrast MRI output from your contrast enhancement model and predict tumor probability and classification.

---

## 1. Package Structure
```
tumor_predictor_package/
├── models/
│   └── best_model.pth           # Trained model weights (EfficientNet-B0)
├── src/
│   ├── model.py                 # Neural network architecture & risk scoring
│   ├── dataset.py               # Preprocessing & image transforms
│   └── interpret.py             # Grad-CAM heatmap localization
├── tumor_detector.py            # Main entry point (one-function API)
├── requirements.txt             # Python dependencies
├── example_integration.py       # Quick test script
└── test_sample.png              # Sample MRI image for testing
```

---

## 2. Installation on the Other PC

### Step A: Copy & Extract
Copy `tumor_predictor_package.zip` to your other PC and extract it into your project folder:
```
your_existing_project/
├── your_contrast_model/
├── backend/
│   ├── app.py                   # Your existing FastAPI/Flask server
│   └── tumor_predictor/         # <-- Put the extracted package here!
│       ├── models/
│       ├── src/
│       └── tumor_detector.py
```

### Step B: Install Dependencies
In your project environment on the other PC:
```bash
pip install torch torchvision pillow numpy matplotlib
```
*(or run `pip install -r requirements.txt`)*

---

## 3. How to Connect with Your Existing Contrast Model

In your backend file where your contrast enhancement model runs:

```python
# 1. Import the tumor prediction function
from tumor_detector import predict_tumor_from_image

# 2. In your existing API route:
@app.post("/enhance-and-diagnose")
def process_mri(file):
    # Step 1: Your existing model produces high-contrast MRI
    # enhanced_mri can be a PIL.Image, NumPy array, or file path!
    enhanced_mri = contrast_model.enhance(file)
    
    # Step 2: Predict tumor risk from the enhanced high-contrast scan
    diagnosis = predict_tumor_from_image(enhanced_mri, include_gradcam=True)
    
    # Step 3: Return combined results to frontend
    return {
        # Your contrast model's image:
        "enhanced_image": enhanced_image_url_or_b64,
        
        # Tumor prediction results:
        "overall_tumor_chance_pct": diagnosis["overall_tumor_chance_pct"], # e.g. 97.5%
        "overall_risk_tier": diagnosis["overall_risk_tier"],             # e.g. "High Risk / Primary Suspicion"
        "primary_prediction": diagnosis["primary_prediction"],           # e.g. "Pituitary Tumor"
        "primary_confidence_pct": diagnosis["primary_confidence_pct"],   # e.g. 89.7%
        "categories": diagnosis["categories"],                           # Breakdown for all 4 types
        "gradcam_heatmap": diagnosis["gradcam_base64"]                   # Saliency overlay
    }
```

---

## 4. Output Data Format

The `predict_tumor_from_image()` function returns:
```json
{
  "overall_tumor_chance_pct": 97.5,
  "overall_healthy_chance_pct": 2.5,
  "overall_risk_tier": "High Risk / Primary Suspicion",
  "primary_prediction": "Pituitary Tumor",
  "primary_confidence_pct": 89.7,
  "categories": [
    {
      "class_key": "pituitary_tumor",
      "name": "Pituitary Tumor",
      "percentage": 89.7,
      "risk_tier": "High Risk / Primary Suspicion"
    },
    {
      "class_key": "meningioma_tumor",
      "name": "Meningioma Tumor",
      "percentage": 5.0,
      "risk_tier": "Low Risk / Unlikely"
    },
    {
      "class_key": "glioma_tumor",
      "name": "Glioma Tumor",
      "percentage": 2.8,
      "risk_tier": "Very Low / Negligible"
    },
    {
      "class_key": "no_tumor",
      "name": "Healthy (No Tumor)",
      "percentage": 2.5,
      "risk_tier": "Very Low / Negligible"
    }
  ],
  "gradcam_base64": "data:image/png;base64,..."
}
```

---

## 5. Testing the Package
To verify everything works standalone on the other PC, open a terminal in the extracted folder and run:
```bash
python example_integration.py
```
