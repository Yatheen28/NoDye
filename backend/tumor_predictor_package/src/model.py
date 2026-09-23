import torch
import torch.nn as nn
import torchvision.models as models
from torchvision.models import EfficientNet_B0_Weights
from typing import Dict, Any, List

def get_risk_tier(probability: float) -> str:
    """
    Stratifies individual probability into clinical risk categories.
    """
    if probability >= 0.50:
        return "High Chance"
    elif probability >= 0.15:
        return "Medium Chance"
    elif probability >= 0.03:
        return "Low Chance"
    else:
        return "Very Low Chance"


class BrainTumorClassifier(nn.Module):
    """
    EfficientNet-B0 transfer learning architecture for Brain Tumor MRI Classification.
    Computes calibrated multi-class probabilities and detailed multi-type risk profiles.
    """
    def __init__(self, num_classes: int = 4, pretrained: bool = True):
        super().__init__()
        weights = EfficientNet_B0_Weights.DEFAULT if pretrained else None
        self.backbone = models.efficientnet_b0(weights=weights)
        
        in_features = self.backbone.classifier[1].in_features
        # Enhanced classifier head with batch norm and dropout for regularization
        self.backbone.classifier = nn.Sequential(
            nn.Dropout(p=0.3, inplace=True),
            nn.Linear(in_features, 256),
            nn.BatchNorm1d(256),
            nn.SiLU(inplace=True),
            nn.Dropout(p=0.2, inplace=True),
            nn.Linear(256, num_classes)
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.backbone(x)

    @classmethod
    def format_risk_assessment(
        cls,
        probs: List[float],
        class_names: List[str] = ['glioma_tumor', 'meningioma_tumor', 'no_tumor', 'pituitary_tumor'],
        display_names: Dict[str, str] = None
    ) -> Dict[str, Any]:
        """
        Takes softmax probabilities for the 4 classes and generates the full multi-type risk assessment:
        - Chance of having any tumor (%)
        - Overall risk tier
        - Per-type chance (%) and risk tier for every category
        - Primary and secondary findings
        """
        if display_names is None:
            display_names = {
                'glioma_tumor': 'Glioma Tumor',
                'meningioma_tumor': 'Meningioma Tumor',
                'no_tumor': 'Healthy (No Tumor)',
                'pituitary_tumor': 'Pituitary Tumor'
            }

        prob_dict = {class_names[i]: float(probs[i]) for i in range(len(class_names))}
        
        # Tumor chance is 1.0 - P(no_tumor)
        p_no_tumor = prob_dict.get('no_tumor', 0.0)
        overall_tumor_chance = max(0.0, min(1.0, 1.0 - p_no_tumor))

        # Risk breakdown for every category
        type_breakdowns = []
        for name in class_names:
            prob = prob_dict[name]
            disp_name = display_names.get(name, name)
            is_tumor = (name != 'no_tumor')
            tier = get_risk_tier(prob)
            type_breakdowns.append({
                'class_key': name,
                'name': disp_name,
                'probability': round(prob, 4),
                'percentage': round(prob * 100.0, 1),
                'risk_tier': tier,
                'is_tumor_type': is_tumor
            })

        # Sort breakdown by descending probability
        type_breakdowns_sorted = sorted(type_breakdowns, key=lambda x: x['probability'], reverse=True)
        primary_finding = type_breakdowns_sorted[0]
        secondary_finding = type_breakdowns_sorted[1] if len(type_breakdowns_sorted) > 1 else None

        overall_risk_tier = get_risk_tier(overall_tumor_chance)

        return {
            'overall_tumor_chance_pct': round(overall_tumor_chance * 100.0, 1),
            'overall_healthy_chance_pct': round(p_no_tumor * 100.0, 1),
            'overall_risk_tier': overall_risk_tier,
            'primary_prediction': primary_finding['name'],
            'primary_confidence_pct': primary_finding['percentage'],
            'secondary_prediction': secondary_finding['name'] if secondary_finding else None,
            'secondary_confidence_pct': secondary_finding['percentage'] if secondary_finding else None,
            'categories': type_breakdowns
        }
