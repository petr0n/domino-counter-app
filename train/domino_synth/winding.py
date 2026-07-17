"""Deterministic corner-keypoint winding (build-plan-v2 §5.4).

Rule: sort the 4 corners by polar angle relative to the corners' bounding-box
centre; index 0 = smallest angle in [0, 2pi), proceeding in ascending angle
(clockwise in image coordinates, where y grows downward). Applied identically
to every synthetic label and to real annotation exports (eval/merge_truth.py),
so a keypoint index always has the same geometric meaning.
"""
import math


def wind_corners(corners):
    """Return the 4 (x, y) corners sorted by the canonical winding rule."""
    if len(corners) != 4:
        raise ValueError(f"expected 4 corners, got {len(corners)}")
    xs = [c[0] for c in corners]
    ys = [c[1] for c in corners]
    cx = (min(xs) + max(xs)) / 2.0
    cy = (min(ys) + max(ys)) / 2.0

    def angle(c):
        a = math.atan2(c[1] - cy, c[0] - cx)
        return a if a >= 0 else a + 2 * math.pi

    return sorted(corners, key=angle)
