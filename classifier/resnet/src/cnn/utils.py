import os
import yaml
import torch


def load_config():
    """Loads the shared config.yaml file."""
    config_path = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "../../../config.yaml")
    )
    with open(config_path, "r") as f:
        return yaml.safe_load(f)


def get_device():
    """Returns the best available torch device (MPS, CUDA, or CPU)."""
    if torch.backends.mps.is_available():
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def get_gauge(scale_name: str, config: dict) -> float:
    """Calculates the rail gauge for a given scale name."""
    layout = config.get("layout")
    if not layout:
        raise ValueError("Fatal Error: 'layout' section is missing in config.yaml.")

    standard_gauge = layout.get("standard_gauge")
    if standard_gauge is None:
        raise ValueError(
            "Fatal Error: 'layout.standard_gauge' is missing in config.yaml."
        )

    scale_to_ratio = layout.get("scale_to_ratio")
    if not scale_to_ratio:
        raise ValueError(
            "Fatal Error: 'layout.scale_to_ratio' is missing in config.yaml."
        )

    ratio = scale_to_ratio.get(scale_name)
    if ratio is None:
        raise ValueError(
            f"Fatal Error: Scale '{scale_name}' is missing in layout.scale_to_ratio in config.yaml."
        )

    return standard_gauge / ratio
