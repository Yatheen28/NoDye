import os
from PIL import Image
from typing import Tuple, List, Dict
import torch
from torch.utils.data import Dataset, DataLoader, random_split
from torchvision import transforms

# Friendly human-readable class names
CLASS_DISPLAY_NAMES = {
    'glioma_tumor': 'Glioma Tumor',
    'meningioma_tumor': 'Meningioma Tumor',
    'no_tumor': 'Healthy (No Tumor)',
    'pituitary_tumor': 'Pituitary Tumor'
}

DEFAULT_CLASSES = ['glioma_tumor', 'meningioma_tumor', 'no_tumor', 'pituitary_tumor']


def get_transforms(image_size: int = 224, is_train: bool = True):
    """
    Returns data transforms for MRI images.
    Applies gentle spatial and contrast augmentations for training.
    """
    if is_train:
        return transforms.Compose([
            transforms.Resize((image_size, image_size)),
            transforms.RandomHorizontalFlip(p=0.5),
            transforms.RandomRotation(degrees=15),
            transforms.ColorJitter(brightness=0.1, contrast=0.1),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406],
                                 std=[0.229, 0.224, 0.225])
        ])
    else:
        return transforms.Compose([
            transforms.Resize((image_size, image_size)),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406],
                                 std=[0.229, 0.224, 0.225])
        ])


class BrainTumorDataset(Dataset):
    """
    Custom PyTorch Dataset for Brain Tumor MRI scans.
    Supports PNG, JPG, and ensures any color format (RGBA/grayscale) is converted to RGB.
    """
    def __init__(self, samples: List[Tuple[str, int]], transform=None):
        self.samples = samples  # List of (file_path, label_idx)
        self.transform = transform

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        file_path, label = self.samples[idx]
        # Open and ensure RGB format (handles transparent PNGs, 16-bit, grayscale, etc.)
        img = Image.open(file_path).convert('RGB')
        
        if self.transform:
            img = self.transform(img)
            
        return img, label, file_path


def load_dataset_samples(root_dir: str, classes: List[str] = DEFAULT_CLASSES) -> List[Tuple[str, int]]:
    """
    Scans a directory split for images and builds a list of (filepath, class_idx).
    """
    samples = []
    valid_exts = {'.png', '.jpg', '.jpeg', '.bmp', '.tif', '.tiff'}
    
    for idx, class_name in enumerate(classes):
        class_folder = os.path.join(root_dir, class_name)
        if not os.path.exists(class_folder):
            continue
        for fname in os.listdir(class_folder):
            ext = os.path.splitext(fname)[1].lower()
            if ext in valid_exts:
                full_path = os.path.join(class_folder, fname)
                samples.append((full_path, idx))
                
    return samples


def get_dataloaders(
    data_dir: str,
    batch_size: int = 32,
    val_split: float = 0.15,
    image_size: int = 224,
    seed: int = 42
) -> Tuple[DataLoader, DataLoader, DataLoader, Dict[int, str]]:
    """
    Creates train, validation, and test dataloaders from the Kaggle dataset structure.
    Expects data_dir to contain 'Training' and 'Testing' folders.
    """
    train_dir = os.path.join(data_dir, 'Training')
    test_dir = os.path.join(data_dir, 'Testing')

    # Load raw file paths
    train_val_samples = load_dataset_samples(train_dir)
    test_samples = load_dataset_samples(test_dir)

    # Split train into train and validation
    total_train = len(train_val_samples)
    val_size = int(total_train * val_split)
    train_size = total_train - val_size

    generator = torch.Generator().manual_seed(seed)
    train_subset, val_subset = random_split(
        train_val_samples, [train_size, val_size], generator=generator
    )

    train_data = [train_val_samples[i] for i in train_subset.indices]
    val_data = [train_val_samples[i] for i in val_subset.indices]

    train_dataset = BrainTumorDataset(train_data, transform=get_transforms(image_size, is_train=True))
    val_dataset = BrainTumorDataset(val_data, transform=get_transforms(image_size, is_train=False))
    test_dataset = BrainTumorDataset(test_samples, transform=get_transforms(image_size, is_train=False))

    train_loader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True, num_workers=0)
    val_loader = DataLoader(val_dataset, batch_size=batch_size, shuffle=False, num_workers=0)
    test_loader = DataLoader(test_dataset, batch_size=batch_size, shuffle=False, num_workers=0)

    idx_to_class = {i: c for i, c in enumerate(DEFAULT_CLASSES)}

    return train_loader, val_loader, test_loader, idx_to_class
