"""Physical education requirement helpers."""

from __future__ import annotations


def normalize_name(text: str | None) -> str:
    """Normalize plan labels before comparing them."""
    return "".join((text or "").split())


def is_physical_education_node(node_name: str | None) -> bool:
    """Whether a plan node represents the physical education requirement."""
    return normalize_name(node_name) in {"体育", "体育课", "体育课程"}
