"""Resolve runtime JSON resources in source and packaged layouts."""

from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parent
SOURCE_DATA_DIR = BACKEND_DIR.parent / "data"
BUNDLED_RESOURCE_DIR = BACKEND_DIR / "resources"


def runtime_data_path(filename: str) -> Path:
    """Return a source data file or its PyInstaller-bundled copy."""
    source_path = SOURCE_DATA_DIR / filename
    if source_path.exists():
        return source_path

    bundled_path = BUNDLED_RESOURCE_DIR / filename
    if bundled_path.exists():
        return bundled_path

    raise RuntimeError(f"Runtime resource not found: {filename}")
