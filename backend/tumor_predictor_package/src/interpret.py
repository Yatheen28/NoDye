import os
import numpy as np
from PIL import Image
import matplotlib.pyplot as plt
import matplotlib.cm as cm
import torch
import torch.nn.functional as F


class GradCAM:
    """
    Grad-CAM implementation for visualizing class activation maps on MRI brain scans.
    Highlights suspicious tumor regions that contributed to the model's prediction.
    """
    def __init__(self, model, target_layer=None):
        self.model = model
        self.model.eval()
        
        # Default to the final convolutional block in EfficientNet
        if target_layer is None:
            self.target_layer = self.model.backbone.features[-1]
        else:
            self.target_layer = target_layer

        self.gradients = None
        self.activations = None

        # Register forward and backward hooks
        self.target_layer.register_forward_hook(self._save_activation)
        self.target_layer.register_full_backward_hook(self._save_gradient)

    def _save_activation(self, module, input, output):
        self.activations = output.detach()

    def _save_gradient(self, module, grad_input, grad_output):
        self.gradients = grad_output[0].detach()

    def generate_heatmap(self, input_tensor, target_class_idx=None):
        """
        Computes Grad-CAM heatmap for a given input tensor (1, 3, H, W).
        If target_class_idx is None, uses the class with the highest logit.
        """
        self.model.zero_grad()
        output = self.model(input_tensor)

        if target_class_idx is None:
            target_class_idx = torch.argmax(output, dim=1).item()

        # Score for target class
        score = output[0, target_class_idx]
        score.backward(retain_graph=True)

        # Global average pooling of gradients
        # gradients shape: (1, C, H, W)
        pooled_gradients = torch.mean(self.gradients, dim=[0, 2, 3])

        # Weight activations by gradients
        activations = self.activations[0]  # (C, H, W)
        for i in range(activations.size(0)):
            activations[i, :, :] *= pooled_gradients[i]

        heatmap = torch.mean(activations, dim=0).cpu().numpy()
        heatmap = np.maximum(heatmap, 0)  # ReLU
        
        # Normalize between 0 and 1
        max_val = np.max(heatmap)
        if max_val > 1e-8:
            heatmap /= max_val
        else:
            heatmap = np.zeros_like(heatmap)

        return heatmap, target_class_idx


def overlay_gradcam_on_image(original_image: Image.Image, heatmap: np.ndarray, alpha: float = 0.45) -> Image.Image:
    """
    Overlays Grad-CAM heatmap onto the original MRI image.
    Uses 'jet' colormap for clear clinical visualization.
    """
    orig_w, orig_h = original_image.size
    
    # Resize heatmap to match original image dimensions using PIL
    heatmap_img = Image.fromarray((heatmap * 255).astype(np.uint8)).resize((orig_w, orig_h), Image.Resampling.BICUBIC)
    heatmap_resized = np.array(heatmap_img) / 255.0

    # Apply colormap
    try:
        import matplotlib
        colormap = matplotlib.colormaps['jet']
    except Exception:
        colormap = plt.cm.jet
    colored_heatmap = colormap(heatmap_resized)[:, :, :3]  # (H, W, 3) in [0, 1]
    colored_heatmap_uint8 = (colored_heatmap * 255).astype(np.uint8)

    # Convert original to RGB array
    orig_rgb = np.array(original_image.convert('RGB'))

    # Blend original and heatmap
    blended = (orig_rgb * (1.0 - alpha) + colored_heatmap_uint8 * alpha).astype(np.uint8)
    return Image.fromarray(blended)


def create_side_by_side_visualization(
    original_img: Image.Image,
    heatmap: np.ndarray,
    overlay_img: Image.Image,
    title: str = "MRI Grad-CAM Tumor Localization",
    output_path: str = None
) -> Image.Image:
    """
    Creates a clear 3-panel figure: [Original MRI] [Attention Heatmap] [Diagnostic Overlay]
    """
    fig, axes = plt.subplots(1, 3, figsize=(15, 5))
    
    axes[0].imshow(original_img)
    axes[0].set_title("Input MRI Scan", fontsize=12)
    axes[0].axis('off')

    axes[1].imshow(heatmap, cmap='jet')
    axes[1].set_title("Grad-CAM Activation Map", fontsize=12)
    axes[1].axis('off')

    axes[2].imshow(overlay_img)
    axes[2].set_title("Suspicious Region Overlay", fontsize=12)
    axes[2].axis('off')

    plt.suptitle(title, fontsize=14, y=0.98)
    plt.tight_layout()

    if output_path:
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        plt.savefig(output_path, dpi=200, bbox_inches='tight')
        plt.close()
        return Image.open(output_path)
    else:
        import io
        buf = io.BytesIO()
        plt.savefig(buf, format='png', dpi=150, bbox_inches='tight')
        plt.close()
        buf.seek(0)
        return Image.open(buf)
