"""Canonical double-12 pip-grid geometry (build-plan-v2 §5.3, CLAUDE.md domino facts).

Single source of truth for pip layouts: 0-9 use a 3x3 grid, 10-12 use a 4x3
grid (top/bottom rows full at 4; middle row = 10: 2 outer, 11: left/centre/right
with centre NOT column-aligned, 12: 4). Coordinates are in a unit square
(0..1 x 0..1) representing one tile half; (0,0) is the half's top-left.
"""

# 3x3 grid coordinates
_C3 = (0.25, 0.5, 0.75)


def _g3(col, row):
    return (_C3[col], _C3[row])


# Row-major 3x3 cell indices: 0 1 2 / 3 4 5 / 6 7 8
_LAYOUTS_3X3 = {
    0: [],
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 3, 6, 2, 5, 8],
    7: [0, 3, 6, 4, 2, 5, 8],
    8: [0, 1, 2, 3, 5, 6, 7, 8],
    9: [0, 1, 2, 3, 4, 5, 6, 7, 8],
}

# 4x3 grid for 10-12. Orientation measured from the real set (2026-07-16,
# Tier-1 crops): the 4-axis runs ALONG the tile's long axis — an upright
# vertical half shows 4 rows x 3 columns. (First render had it rotated 90°,
# which made the pip CNN systematically misread real dense halves.)
_C4Y = (0.16, 0.44 - 0.06, 0.56 + 0.06, 0.84)  # 4 positions along the length
_C4X = (0.25, 0.5, 0.75)                        # 3 positions across the width


def _col4(x):
    return [(x, y) for y in _C4Y]


_LAYOUTS_4X3 = {
    10: _col4(_C4X[0]) + [(_C4X[1], _C4Y[0]), (_C4X[1], _C4Y[3])] + _col4(_C4X[2]),
    # 11: middle column top / true centre (0.5, not row-aligned) / bottom
    11: _col4(_C4X[0]) + [(_C4X[1], _C4Y[0]), (0.5, 0.5), (_C4X[1], _C4Y[3])] + _col4(_C4X[2]),
    12: _col4(_C4X[0]) + _col4(_C4X[1]) + _col4(_C4X[2]),
}


def pip_positions(count):
    """Unit-square (x, y) centres for `count` pips on one half. 0 <= count <= 12."""
    if not 0 <= count <= 12:
        raise ValueError(f"pip count must be 0-12, got {count}")
    if count <= 9:
        cells = _LAYOUTS_3X3[count]
        return [_g3(i % 3, i // 3) for i in cells]
    return list(_LAYOUTS_4X3[count])


ALL_COUNTS = range(13)

# All 91 unique double-12 tiles as unordered (low, high) pairs.
ALL_TILES = [(a, b) for a in ALL_COUNTS for b in ALL_COUNTS if a <= b]
assert len(ALL_TILES) == 91
