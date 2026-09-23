import os
import io
import base64
from typing import Union, Dict, Any
from PIL import Image
import numpy as np
import torch
import torch.nn.functional as F

from src.dataset import get_transforms, DEFAULT_CLASSES, CLASS_DISPLAY_NAMES
from src.model import BrainTumorClassifier
from src.interpret import GradCAM, overlay_gradcam_on_image, create_side_by_side_visualization

_MODEL = None
_DEVICE = None
_CLASSES = None

def _get_model(model_path: str = None):
    global _MODEL, _DEVICE, _CLASSES
    if _MODEL is not None:
        return _MODEL, _DEVICE, _CLASSES

    if model_path is None:
        # Default relative to this file
        base_dir = os.path.dirname(os.path.abspath(__file__))
        model_path = os.path.join(base_dir, "models", "best_model.pth")

    if not os.path.exists(model_path):
        raise FileNotFoundError(f"Trained model not found at: {model_path}")

    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    checkpoint = torch.load(model_path, map_location=device)
    classes = checkpoint.get('classes', DEFAULT_CLASSES)

    model = BrainTumorClassifier(num_classes=len(classes), pretrained=False)
    model.load_state_dict(checkpoint['model_state_dict'])
    model.to(device)
    model.eval()

    _MODEL = model
    _DEVICE = device
    _CLASSES = classes
    return _MODEL, _DEVICE, _CLASSES


def predict_tumor_from_image(
    image_input: Union[str, Image.Image, np.ndarray, bytes],
    model_path: str = None,
    include_gradcam: bool = True
) -> Dict[str, Any]:
    """
    Drop-in predictor for brain tumor classification and risk assessment.
    Accepts:
        - PIL Image (e.g. output from contrast enhancement model)
        - NumPy array (e.g. HWC array in [0, 255] or [0, 1])
        - File path string (.png, .jpg)
        - Raw bytes
    Returns:
        JSON-serializable dictionary with tumor chance %, risk tiers, and Grad-CAM base64.
    """
    # 1. Normalize input to PIL RGB Image
    if isinstance(image_input, str):
        if not os.path.exists(image_input):
            raise FileNotFoundError(f"Image file not found: {image_input}")
        pil_img = Image.open(image_input).convert('RGB')
    elif isinstance(image_input, Image.Image):
        pil_img = image_input.convert('RGB')
    elif isinstance(image_input, np.ndarray):
        arr = image_input.copy()
        if arr.dtype != np.uint8:
            if arr.max() <= 1.0:
                arr = (arr * 255).astype(np.uint8)
            else:
                arr = arr.astype(np.uint8)
        # Handle grayscale (H, W) or (H, W, 1)
        if len(arr.shape) == 2:
            pil_img = Image.fromarray(arr).convert('RGB')
        elif len(arr.shape) == 3 and arr.shape[2] == 1:
            pil_img = Image.fromarray(arr[:, :, 0]).convert('RGB')
        else:
            pil_img = Image.fromarray(arr).convert('RGB')
    elif isinstance(image_input, bytes):
        pil_img = Image.open(io.BytesIO(image_input)).convert('RGB')
    else:
        raise ValueError(f"Unsupported image_input type: {type(image_input)}")

    model, device, classes = _get_model(model_path)

    # 2. Run inference
    transform = get_transforms(224, is_train=False)
    img_tensor = transform(pil_img).unsqueeze(0).to(device)
    img_tensor.requires_grad = True

    logits = model(img_tensor)
    probs = F.softmax(logits, dim=1).detach().squeeze(0).cpu().numpy().tolist()

    assessment = BrainTumorClassifier.format_risk_assessment(
        probs, class_names=classes, display_names=CLASS_DISPLAY_NAMES
    )

    # 3. Compute Grad-CAM localization if requested
    if include_gradcam:
        cam = GradCAM(model)
        top_idx = int(torch.argmax(logits, dim=1).item())
        heatmap, _ = cam.generate_heatmap(img_tensor, target_class_idx=top_idx)
        overlay = overlay_gradcam_on_image(pil_img, heatmap)

        # Create 3-panel visualization into in-memory buffer
        viz_img = create_side_by_side_visualization(
            pil_img, heatmap, overlay,
            title=f"Finding: {assessment['primary_prediction']} ({assessment['primary_confidence_pct']}%)"
        )
        
        buffer = io.BytesIO()
        viz_img.save(buffer, format="PNG")
        b64_str = base64.b64encode(buffer.getvalue()).decode("utf-8")
        assessment['gradcam_base64'] = f"data:image/png;base64,{b64_str}"

    return assessment
