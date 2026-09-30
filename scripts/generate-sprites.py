#!/usr/bin/env python3
# generate-sprites.py
#
# Procedural sprite generator for the Hat Pets drop.
# Reads traits.json, builds a 200 sprite plan, and renders animated GIFs
# (64x64, 6 frame idle bounce) into hat-nft/out/.
#
# Outputs:
#   sprite_000.gif ... sprite_199.gif
#   metadata.json  (array of token metadata records)
#   attributes.json (array of JSON STRINGS, each the OpenSea attributes shape)
#
# All randomness is seeded so runs are reproducible.

import json
import os
import random
from collections import Counter
from io import BytesIO

from PIL import Image, ImageDraw

# ======================================================================
# Paths
# ======================================================================

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRAITS_PATH = os.path.join(REPO_ROOT, "traits.json")
OUT_DIR = os.path.join(REPO_ROOT, "out")

# ======================================================================
# Rendering constants
# ======================================================================

CANVAS_W = 64
CANVAS_H = 64
FRAMES = 6
FRAME_DURATION_MS = 140
BOUNCE_OFFSETS = [0, -1, -2, -1, 0, 1]
SIZE_LIMIT = 24000  # SSTORE2 cap (bytes per GIF)

# ======================================================================
# Background palette
# ======================================================================

BACKGROUND_COLORS = {
    "Field":    (0x5a, 0x8a, 0x3a),
    "Market":   (0xc7, 0xa3, 0x6a),
    "Terminal": (0x0a, 0x1a, 0x0a),
    "Dawn":     (0xf5, 0xb8, 0x96),
    "Dusk":     (0x5c, 0x2a, 0x5a),
    "Starry":   (0x0b, 0x15, 0x30),
    "Golden":   (0xd9, 0xa6, 0x37),
    "Void":     (0x00, 0x00, 0x00),
}

# ======================================================================
# Produce color palette (RGB per produce name)
# ======================================================================

PRODUCE_COLORS = {
    "Potato":          (0xa0, 0x7a, 0x4a),
    "Corn":            (0xf0, 0xd0, 0x40),
    "Wheat":           (0xd9, 0xb8, 0x60),
    "Rice":            (0xf2, 0xee, 0xd6),
    "Carrot":          (0xe0, 0x75, 0x20),
    "Onion":           (0xe6, 0xc7, 0x9a),
    "Cabbage":         (0x6f, 0xa8, 0x55),
    "Lettuce":         (0x88, 0xc0, 0x55),
    "Tomato":          (0xd0, 0x40, 0x30),
    "Cucumber":        (0x3f, 0x7a, 0x3a),
    "Strawberry":      (0xe0, 0x33, 0x4a),
    "Apple":           (0xc8, 0x2a, 0x2a),
    "Watermelon":      (0x2a, 0x7a, 0x3a),
    "Pumpkin":         (0xd9, 0x6a, 0x1a),
    "Eggplant":        (0x5a, 0x2a, 0x6a),
    "Bell Pepper":     (0xe0, 0x33, 0x33),
    "Blueberry":       (0x35, 0x4a, 0x9c),
    "Saffron":         (0xe0, 0x8a, 0x1a),
    "Vanilla":         (0xe8, 0xd8, 0xb0),
    "Wasabi":          (0x7a, 0xc0, 0x55),
    "Dragonfruit":     (0xe0, 0x40, 0x8a),
    "Heirloom Tomato": (0x8a, 0x35, 0x55),
    "Blue Corn":       (0x4a, 0x55, 0xa0),
    "Ghost Pepper":    (0xf2, 0xea, 0xd6),
}

DEFAULT_PRODUCE_COLOR = (0xa0, 0xa0, 0xa0)

# Body, skin, and accent colors for the three character archetypes.
CHARACTER_STYLES = {
    "Farmer": {
        "skin": (0xe4, 0xc0, 0x9a),
        "body": (0x3a, 0x6a, 0x2a),
        "arm":  (0x2a, 0x55, 0x1f),
    },
    "Trader": {
        "skin": (0xe4, 0xc0, 0x9a),
        "body": (0x6a, 0x3a, 0x2a),
        "arm":  (0x4a, 0x2a, 0x1a),
    },
    "Hacker": {
        "skin": (0xd8, 0xb8, 0x90),
        "body": (0x20, 0x20, 0x28),
        "arm":  (0x18, 0x18, 0x20),
    },
}

# ======================================================================
# Plan generation
# ======================================================================

def load_traits():
    with open(TRAITS_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def weighted_pick(rng, items, archetype, weight_key="weight"):
    """Pick one item by weight. archetype_pref triples the local weight."""
    local = []
    for item in items:
        w = float(item.get(weight_key, 1))
        prefs = item.get("archetype_pref") or []
        if archetype in prefs:
            w *= 3.0
        local.append(w)
    total = sum(local)
    r = rng.random() * total
    acc = 0.0
    for item, w in zip(items, local):
        acc += w
        if r <= acc:
            return item
    return items[-1]


def pick_produce(rng, traits, archetype):
    """Pick produce by tier weight, respecting archetype kind constraint."""
    pool = list(traits["produce"])

    if archetype == "Fruit":
        pool = [p for p in pool if p["kind"] == "fruit"]
    elif archetype == "Veg":
        pool = [p for p in pool if p["kind"] == "veg"]
    # Farmer, Trader, Hacker keep the full pool.

    tier_weights = traits["produceTierWeights"]
    local = [float(tier_weights.get(p["tier"], 1)) for p in pool]
    total = sum(local)
    r = rng.random() * total
    acc = 0.0
    for p, w in zip(pool, local):
        acc += w
        if r <= acc:
            return p
    return pool[-1]


def build_plan(traits, rng):
    """Build the full 200 sprite trait plan."""
    plan = []
    for archetype_def in traits["archetypes"]:
        archetype = archetype_def["name"]
        for _ in range(archetype_def["count"]):
            produce = pick_produce(rng, traits, archetype)
            hat = weighted_pick(rng, traits["hats"], archetype)
            background = weighted_pick(rng, traits["backgrounds"], archetype)
            aura = weighted_pick(rng, traits["auras"], archetype)
            plan.append({
                "archetype": archetype,
                "archetype_kind": archetype_def["kind"],
                "produce": produce["name"],
                "produce_kind": produce["kind"],
                "produce_tier": produce["tier"],
                "hat": hat["name"],
                "background": background["name"],
                "aura": aura["name"],
            })
    return plan

# ======================================================================
# Drawing helpers
# ======================================================================

def fill_background(draw, bg_name, frame_idx):
    color = BACKGROUND_COLORS.get(bg_name, (0x10, 0x10, 0x10))
    draw.rectangle([0, 0, CANVAS_W - 1, CANVAS_H - 1], fill=color)

    if bg_name == "Terminal":
        # Green dot grid.
        dot = (0x1a, 0x6a, 0x2a)
        for y in range(4, CANVAS_H, 6):
            for x in range(4, CANVAS_W, 6):
                draw.point((x, y), fill=dot)
    elif bg_name == "Starry":
        # Deterministic star field with a small per frame twinkle.
        star_rng = random.Random(91 + frame_idx)
        for _ in range(28):
            sx = star_rng.randint(0, CANVAS_W - 1)
            sy = star_rng.randint(0, CANVAS_H - 1)
            draw.point((sx, sy), fill=(0xff, 0xff, 0xff))


def draw_produce_icon(draw, cx, cy, radius, color):
    """Small held produce: filled circle with a darker shade rim."""
    rim = tuple(max(0, c - 40) for c in color)
    draw.ellipse([cx - radius, cy - radius, cx + radius, cy + radius],
                 fill=color, outline=rim)


def draw_character(draw, archetype, produce_name, body_dy):
    """Draw a small humanoid silhouette holding produce at the side."""
    style = CHARACTER_STYLES[archetype]
    body_color = style["body"]
    arm_color = style["arm"]
    skin = style["skin"]

    # Body trunk (centered).
    body_top = 32 + body_dy
    body_bot = 54 + body_dy
    body_left = 26
    body_right = 38
    draw.rectangle([body_left, body_top, body_right, body_bot], fill=body_color)

    # Head.
    head_top = 20 + body_dy
    head_bot = 31 + body_dy
    head_left = 26
    head_right = 38
    draw.rectangle([head_left, head_top, head_right, head_bot], fill=skin)

    # Eyes.
    draw.point((29, 25 + body_dy), fill=(0x10, 0x10, 0x10))
    draw.point((35, 25 + body_dy), fill=(0x10, 0x10, 0x10))

    # Arms.
    draw.rectangle([21, body_top + 2, 25, body_top + 12], fill=arm_color)
    draw.rectangle([39, body_top + 2, 43, body_top + 12], fill=arm_color)

    # Produce held at the right hand.
    produce_color = PRODUCE_COLORS.get(produce_name, DEFAULT_PRODUCE_COLOR)
    draw_produce_icon(draw, 45, body_top + 12, 3, produce_color)


# ======================================================================
# Per produce silhouette functions.
# Each one paints the produce body around (cx, cy). The hat overlay code
# assumes the silhouette tops out roughly at cy + 18 above center, so
# each shape stays inside a 32x36 envelope centered on (cx, cy).
# ======================================================================

def _leaf_green():
    return (0x4a, 0x95, 0x35)


def _stem_brown():
    return (0x5a, 0x35, 0x1a)


def _draw_potato(draw, cx, cy, color, rim):
    # Lumpy brown blob: a few overlapping ellipses.
    draw.ellipse([cx - 14, cy - 12, cx + 12, cy + 10], fill=color, outline=rim)
    draw.ellipse([cx - 10, cy - 16, cx + 8, cy + 2],   fill=color, outline=rim)
    draw.ellipse([cx + 2,  cy - 14, cx + 14, cy + 4],  fill=color, outline=rim)
    draw.ellipse([cx - 12, cy + 2,  cx + 6,  cy + 14], fill=color, outline=rim)
    # Darker spots (eyes of the potato, not the face).
    for px, py in [(cx - 6, cy - 6), (cx + 4, cy - 8), (cx - 2, cy + 4), (cx + 7, cy + 2)]:
        draw.point((px, py), fill=rim)


def _draw_corn(draw, cx, cy, color, rim):
    # Tall yellow cylinder with kernel grid and husk leaves.
    husk = _leaf_green()
    husk_rim = (0x2a, 0x55, 0x1f)
    # Husk leaves on left and right.
    draw.polygon([(cx - 12, cy - 12), (cx - 6, cy - 16), (cx - 4, cy + 14), (cx - 12, cy + 10)],
                 fill=husk, outline=husk_rim)
    draw.polygon([(cx + 12, cy - 12), (cx + 6, cy - 16), (cx + 4, cy + 14), (cx + 12, cy + 10)],
                 fill=husk, outline=husk_rim)
    # Cob.
    draw.rectangle([cx - 6, cy - 14, cx + 6, cy + 14], fill=color, outline=rim)
    # Kernel grid (3 columns x 6 rows of darker dots).
    for ky in range(-10, 12, 4):
        for kx in (-4, 0, 4):
            draw.point((cx + kx, cy + ky), fill=rim)


def _draw_wheat(draw, cx, cy, color, rim):
    # Central stalk with diagonal spikelets.
    draw.line([(cx, cy - 16), (cx, cy + 14)], fill=rim)
    draw.rectangle([cx - 1, cy - 16, cx + 1, cy + 14], fill=color)
    for sy in range(-14, 12, 4):
        draw.line([(cx - 1, cy + sy), (cx - 7, cy + sy - 3)], fill=color)
        draw.line([(cx + 1, cy + sy), (cx + 7, cy + sy - 3)], fill=color)
        draw.point((cx - 7, cy + sy - 3), fill=rim)
        draw.point((cx + 7, cy + sy - 3), fill=rim)


def _draw_rice(draw, cx, cy, color, rim):
    # Bundle of 7 tan grain ovals.
    grains = [
        (cx - 6, cy - 14), (cx + 4, cy - 12), (cx - 2, cy - 6),
        (cx - 8, cy + 2),  (cx + 6, cy),     (cx, cy + 8),
        (cx + 2, cy + 14),
    ]
    for gx, gy in grains:
        draw.ellipse([gx - 3, gy - 5, gx + 3, gy + 5], fill=color, outline=rim)


def _draw_carrot(draw, cx, cy, color, rim):
    # Downward orange triangle with green fronds at top.
    leaf = _leaf_green()
    leaf_rim = (0x2a, 0x55, 0x1f)
    draw.polygon([(cx - 10, cy - 8), (cx + 10, cy - 8), (cx, cy + 16)],
                 fill=color, outline=rim)
    # Horizontal ridges.
    draw.line([(cx - 8, cy - 2), (cx + 8, cy - 2)], fill=rim)
    draw.line([(cx - 5, cy + 4),  (cx + 5, cy + 4)],  fill=rim)
    # Fronds: 3 leafy tufts.
    draw.polygon([(cx - 9, cy - 8), (cx - 4, cy - 18), (cx - 1, cy - 8)],
                 fill=leaf, outline=leaf_rim)
    draw.polygon([(cx - 5, cy - 8), (cx, cy - 20), (cx + 5, cy - 8)],
                 fill=leaf, outline=leaf_rim)
    draw.polygon([(cx + 1, cy - 8), (cx + 4, cy - 18), (cx + 9, cy - 8)],
                 fill=leaf, outline=leaf_rim)


def _draw_onion(draw, cx, cy, color, rim):
    # Round pale yellow with thin radial skin lines and small sprout.
    leaf = _leaf_green()
    draw.ellipse([cx - 12, cy - 10, cx + 12, cy + 14], fill=color, outline=rim)
    # Curved radial skin lines.
    draw.line([(cx - 10, cy - 4), (cx - 8, cy + 12)], fill=rim)
    draw.line([(cx - 4, cy - 10), (cx - 2, cy + 14)], fill=rim)
    draw.line([(cx + 4, cy - 10), (cx + 2, cy + 14)], fill=rim)
    draw.line([(cx + 10, cy - 4), (cx + 8, cy + 12)], fill=rim)
    # Sprout.
    draw.line([(cx, cy - 10), (cx, cy - 16)], fill=leaf)
    draw.line([(cx - 1, cy - 14), (cx + 1, cy - 16)], fill=leaf)


def _draw_cabbage(draw, cx, cy, color, rim):
    # Green sphere with concentric layer arcs.
    draw.ellipse([cx - 14, cy - 14, cx + 14, cy + 14], fill=color, outline=rim)
    draw.arc([cx - 10, cy - 10, cx + 10, cy + 10], start=200, end=340, fill=rim)
    draw.arc([cx - 6,  cy - 6,  cx + 6,  cy + 6],  start=200, end=340, fill=rim)
    draw.arc([cx - 12, cy - 12, cx + 12, cy + 12], start=20,  end=160, fill=rim)


def _draw_lettuce(draw, cx, cy, color, rim):
    # Frilly bulb: overlapping ellipses make a cloud-like outline.
    blobs = [
        (cx,      cy - 12, 8, 6),
        (cx - 10, cy - 6,  8, 8),
        (cx + 10, cy - 6,  8, 8),
        (cx - 8,  cy + 6,  9, 9),
        (cx + 8,  cy + 6,  9, 9),
        (cx,      cy + 4,  12, 10),
    ]
    for bx, by, rx, ry in blobs:
        draw.ellipse([bx - rx, by - ry, bx + rx, by + ry], fill=color, outline=rim)
    # Inner veins.
    draw.line([(cx - 6, cy), (cx - 10, cy + 6)], fill=rim)
    draw.line([(cx + 6, cy), (cx + 10, cy + 6)], fill=rim)


def _draw_tomato(draw, cx, cy, color, rim):
    # Round red with green calyx and brown stem.
    leaf = _leaf_green()
    leaf_rim = (0x2a, 0x55, 0x1f)
    draw.ellipse([cx - 13, cy - 10, cx + 13, cy + 14], fill=color, outline=rim)
    # 5 point star calyx.
    draw.polygon([
        (cx, cy - 14), (cx + 5, cy - 8), (cx + 10, cy - 8),
        (cx + 6, cy - 4), (cx + 8, cy + 2), (cx, cy - 2),
        (cx - 8, cy + 2), (cx - 6, cy - 4), (cx - 10, cy - 8),
        (cx - 5, cy - 8),
    ], fill=leaf, outline=leaf_rim)
    # Stem.
    draw.rectangle([cx - 1, cy - 18, cx + 1, cy - 13], fill=_stem_brown())


def _draw_cucumber(draw, cx, cy, color, rim):
    # Long horizontal green oblong with darker bumps.
    draw.ellipse([cx - 16, cy - 6, cx + 16, cy + 8], fill=color, outline=rim)
    for bx in (cx - 11, cx - 5, cx + 1, cx + 7, cx + 13):
        draw.point((bx, cy - 2), fill=rim)
        draw.point((bx + 1, cy + 4), fill=rim)
    # Stem nub on the left.
    draw.line([(cx - 16, cy), (cx - 19, cy - 2)], fill=_stem_brown())


def _draw_strawberry(draw, cx, cy, color, rim):
    # Red teardrop, yellow seeds, leafy crown.
    leaf = _leaf_green()
    leaf_rim = (0x2a, 0x55, 0x1f)
    draw.polygon([
        (cx - 13, cy - 6), (cx - 10, cy - 10), (cx, cy - 12),
        (cx + 10, cy - 10), (cx + 13, cy - 6),
        (cx + 8, cy + 6), (cx, cy + 16), (cx - 8, cy + 6),
    ], fill=color, outline=rim)
    # Yellow seed dots.
    seed = (0xf6, 0xe2, 0x60)
    for sx, sy in [(cx - 6, cy - 4), (cx, cy - 6), (cx + 6, cy - 4),
                   (cx - 4, cy + 2), (cx + 4, cy + 2),
                   (cx - 2, cy + 8), (cx + 2, cy + 8), (cx, cy + 12)]:
        draw.point((sx, sy), fill=seed)
    # Green leafy crown (5 small triangles).
    for ox in (-8, -4, 0, 4, 8):
        draw.polygon([
            (cx + ox - 2, cy - 9), (cx + ox + 2, cy - 9), (cx + ox, cy - 14),
        ], fill=leaf, outline=leaf_rim)


def _draw_apple(draw, cx, cy, color, rim):
    # Round red with vertical stem and side leaf.
    leaf = _leaf_green()
    leaf_rim = (0x2a, 0x55, 0x1f)
    draw.ellipse([cx - 13, cy - 10, cx + 13, cy + 14], fill=color, outline=rim)
    # Top dimple.
    draw.line([(cx - 3, cy - 10), (cx + 3, cy - 10)], fill=rim)
    # Stem.
    draw.rectangle([cx - 1, cy - 16, cx + 1, cy - 10], fill=_stem_brown())
    # Leaf at stem base.
    draw.polygon([(cx + 1, cy - 13), (cx + 7, cy - 16), (cx + 6, cy - 11)],
                 fill=leaf, outline=leaf_rim)


def _draw_watermelon(draw, cx, cy, color, rim):
    # Wide green oval with darker vertical stripes.
    draw.ellipse([cx - 16, cy - 12, cx + 16, cy + 14], fill=color, outline=rim)
    draw.line([(cx - 8, cy - 11), (cx - 8, cy + 13)], fill=rim)
    draw.line([(cx,     cy - 12), (cx,     cy + 14)], fill=rim)
    draw.line([(cx + 8, cy - 11), (cx + 8, cy + 13)], fill=rim)
    # Curly stem on top.
    draw.line([(cx, cy - 12), (cx + 2, cy - 16)], fill=_stem_brown())


def _draw_pumpkin(draw, cx, cy, color, rim):
    # Round orange with vertical rib lines and short green stem.
    leaf = _leaf_green()
    draw.ellipse([cx - 15, cy - 11, cx + 15, cy + 14], fill=color, outline=rim)
    # Rib arcs.
    draw.arc([cx - 12, cy - 11, cx - 4, cy + 14], start=0, end=180, fill=rim)
    draw.arc([cx + 4,  cy - 11, cx + 12, cy + 14], start=0, end=180, fill=rim)
    draw.line([(cx, cy - 11), (cx, cy + 14)], fill=rim)
    # Stem.
    draw.rectangle([cx - 2, cy - 16, cx + 2, cy - 10], fill=leaf)


def _draw_eggplant(draw, cx, cy, color, rim):
    # Downward purple teardrop with green calyx.
    leaf = _leaf_green()
    leaf_rim = (0x2a, 0x55, 0x1f)
    draw.polygon([
        (cx - 9, cy - 6), (cx - 6, cy - 10), (cx + 6, cy - 10), (cx + 9, cy - 6),
        (cx + 11, cy + 2), (cx + 6, cy + 12), (cx, cy + 16),
        (cx - 6, cy + 12), (cx - 11, cy + 2),
    ], fill=color, outline=rim)
    # Highlight stripe.
    draw.line([(cx - 4, cy - 4), (cx - 6, cy + 6)], fill=rim)
    # Green calyx.
    draw.polygon([
        (cx - 8, cy - 8), (cx - 2, cy - 14), (cx + 2, cy - 14),
        (cx + 8, cy - 8), (cx + 4, cy - 6), (cx - 4, cy - 6),
    ], fill=leaf, outline=leaf_rim)


def _draw_bell_pepper(draw, cx, cy, color, rim):
    # Bell shape: narrower at top, wider with lobes at bottom.
    leaf = _leaf_green()
    leaf_rim = (0x2a, 0x55, 0x1f)
    draw.polygon([
        (cx - 8, cy - 8), (cx - 12, cy - 2), (cx - 14, cy + 6),
        (cx - 10, cy + 14), (cx - 4, cy + 12), (cx, cy + 14),
        (cx + 4, cy + 12), (cx + 10, cy + 14), (cx + 14, cy + 6),
        (cx + 12, cy - 2), (cx + 8, cy - 8),
    ], fill=color, outline=rim)
    # Lobe indents.
    draw.line([(cx - 4, cy + 4), (cx - 4, cy + 12)], fill=rim)
    draw.line([(cx + 4, cy + 4), (cx + 4, cy + 12)], fill=rim)
    # Green stem.
    draw.rectangle([cx - 2, cy - 14, cx + 2, cy - 8], fill=leaf, outline=leaf_rim)


def _draw_blueberry(draw, cx, cy, color, rim):
    # Cluster of 6 small dark blue circles.
    centers = [
        (cx - 7, cy - 8), (cx + 5, cy - 9), (cx - 9, cy + 2),
        (cx + 3, cy + 1), (cx - 3, cy + 10), (cx + 9, cy + 8),
    ]
    for bx, by in centers:
        draw.ellipse([bx - 5, by - 5, bx + 5, by + 5], fill=color, outline=rim)
        # Crown nub on each berry.
        draw.point((bx, by - 5), fill=rim)


def _draw_saffron(draw, cx, cy, color, rim):
    # 5 thin curved strands radiating from a center point.
    draw.line([(cx, cy), (cx - 10, cy - 12)], fill=color)
    draw.line([(cx, cy), (cx + 10, cy - 12)], fill=color)
    draw.line([(cx, cy), (cx - 14, cy + 4)], fill=color)
    draw.line([(cx, cy), (cx + 14, cy + 4)], fill=color)
    draw.line([(cx, cy), (cx, cy + 16)], fill=color)
    # Bend each strand slightly with a parallel offset stroke.
    draw.line([(cx - 2, cy + 1), (cx - 12, cy - 10)], fill=rim)
    draw.line([(cx + 2, cy + 1), (cx + 12, cy - 10)], fill=rim)
    draw.line([(cx - 1, cy + 2), (cx - 12, cy + 8)], fill=rim)
    draw.line([(cx + 1, cy + 2), (cx + 12, cy + 8)], fill=rim)
    # Center knot.
    draw.ellipse([cx - 2, cy - 2, cx + 2, cy + 2], fill=rim)


def _draw_vanilla(draw, cx, cy, color, rim):
    # Long narrow pod, rounded ends.
    pod = _stem_brown()
    pod_rim = (0x35, 0x1f, 0x10)
    draw.rounded_rectangle([cx - 4, cy - 16, cx + 4, cy + 16],
                           radius=4, fill=pod, outline=pod_rim)
    # Subtle ridge.
    draw.line([(cx, cy - 12), (cx, cy + 12)], fill=pod_rim)
    # Tiny cream highlight near the cap (uses the assigned color).
    draw.point((cx - 1, cy - 14), fill=color)
    draw.point((cx + 1, cy - 14), fill=color)


def _draw_wasabi(draw, cx, cy, color, rim):
    # Lumpy green tinged root mass: 3 overlapping irregular blobs.
    draw.ellipse([cx - 14, cy - 8,  cx + 4,  cy + 10], fill=color, outline=rim)
    draw.ellipse([cx - 4,  cy - 12, cx + 14, cy + 6],  fill=color, outline=rim)
    draw.ellipse([cx - 8,  cy + 2,  cx + 10, cy + 16], fill=color, outline=rim)
    # Texture pits.
    for px, py in [(cx - 8, cy - 4), (cx + 6, cy - 6), (cx, cy + 6),
                   (cx - 4, cy + 12), (cx + 8, cy + 2)]:
        draw.point((px, py), fill=rim)


def _draw_dragonfruit(draw, cx, cy, color, rim):
    # Pink oval with green spike leaves protruding from the outline.
    leaf = _leaf_green()
    leaf_rim = (0x2a, 0x55, 0x1f)
    draw.ellipse([cx - 12, cy - 14, cx + 12, cy + 14], fill=color, outline=rim)
    # Spike leaves around the body.
    spikes = [
        ((cx - 12, cy - 10), (cx - 18, cy - 12), (cx - 10, cy - 4)),
        ((cx - 10, cy - 14), (cx - 8,  cy - 20), (cx - 4, cy - 12)),
        ((cx + 4,  cy - 14), (cx + 6,  cy - 20), (cx + 10, cy - 12)),
        ((cx + 12, cy - 8),  (cx + 18, cy - 10), (cx + 12, cy - 2)),
        ((cx + 12, cy + 6),  (cx + 18, cy + 10), (cx + 10, cy + 12)),
        ((cx - 12, cy + 6),  (cx - 18, cy + 10), (cx - 10, cy + 12)),
    ]
    for a, b, c in spikes:
        draw.polygon([a, b, c], fill=leaf, outline=leaf_rim)


def _draw_heirloom_tomato(draw, cx, cy, color, rim):
    # Round purple red with horizontal striations and green calyx.
    leaf = _leaf_green()
    leaf_rim = (0x2a, 0x55, 0x1f)
    draw.ellipse([cx - 14, cy - 10, cx + 14, cy + 14], fill=color, outline=rim)
    # Striations.
    draw.line([(cx - 12, cy - 4), (cx + 12, cy - 4)], fill=rim)
    draw.line([(cx - 13, cy + 2),  (cx + 13, cy + 2)],  fill=rim)
    draw.line([(cx - 11, cy + 8),  (cx + 11, cy + 8)],  fill=rim)
    # Calyx.
    draw.polygon([
        (cx - 8, cy - 10), (cx - 4, cy - 14), (cx, cy - 12),
        (cx + 4, cy - 14), (cx + 8, cy - 10), (cx + 4, cy - 6),
        (cx - 4, cy - 6),
    ], fill=leaf, outline=leaf_rim)


def _draw_blue_corn(draw, cx, cy, color, rim):
    # Tall blue purple cylinder with kernel grid.
    husk = (0x3a, 0x55, 0x2a)
    husk_rim = (0x20, 0x35, 0x18)
    draw.polygon([(cx - 12, cy - 12), (cx - 6, cy - 16), (cx - 4, cy + 14), (cx - 12, cy + 10)],
                 fill=husk, outline=husk_rim)
    draw.polygon([(cx + 12, cy - 12), (cx + 6, cy - 16), (cx + 4, cy + 14), (cx + 12, cy + 10)],
                 fill=husk, outline=husk_rim)
    draw.rectangle([cx - 6, cy - 14, cx + 6, cy + 14], fill=color, outline=rim)
    for ky in range(-10, 12, 4):
        for kx in (-4, 0, 4):
            draw.point((cx + kx, cy + ky), fill=rim)


def _draw_ghost_pepper(draw, cx, cy, color, rim):
    # Long pale curved teardrop tapering down.
    leaf = _leaf_green()
    leaf_rim = (0x2a, 0x55, 0x1f)
    draw.polygon([
        (cx - 5, cy - 10), (cx - 2, cy - 14), (cx + 5, cy - 12),
        (cx + 8, cy - 6), (cx + 7, cy + 2), (cx + 4, cy + 10),
        (cx, cy + 16), (cx - 4, cy + 8), (cx - 7, cy),
    ], fill=color, outline=rim)
    # Highlight.
    draw.line([(cx - 3, cy - 6), (cx - 1, cy + 8)], fill=rim)
    # Green stem cap.
    draw.rectangle([cx - 4, cy - 16, cx + 4, cy - 10], fill=leaf, outline=leaf_rim)


PRODUCE_BODY = {
    "Potato":          _draw_potato,
    "Corn":            _draw_corn,
    "Wheat":           _draw_wheat,
    "Rice":            _draw_rice,
    "Carrot":          _draw_carrot,
    "Onion":           _draw_onion,
    "Cabbage":         _draw_cabbage,
    "Lettuce":         _draw_lettuce,
    "Tomato":          _draw_tomato,
    "Cucumber":        _draw_cucumber,
    "Strawberry":      _draw_strawberry,
    "Apple":           _draw_apple,
    "Watermelon":      _draw_watermelon,
    "Pumpkin":         _draw_pumpkin,
    "Eggplant":        _draw_eggplant,
    "Bell Pepper":     _draw_bell_pepper,
    "Blueberry":       _draw_blueberry,
    "Saffron":         _draw_saffron,
    "Vanilla":         _draw_vanilla,
    "Wasabi":          _draw_wasabi,
    "Dragonfruit":     _draw_dragonfruit,
    "Heirloom Tomato": _draw_heirloom_tomato,
    "Blue Corn":       _draw_blue_corn,
    "Ghost Pepper":    _draw_ghost_pepper,
}


def _draw_generic_blob(draw, cx, cy, color, rim):
    """Fallback silhouette: plain colored ellipse."""
    draw.ellipse([cx - 16, cy - 18, cx + 16, cy + 18], fill=color, outline=rim)


def draw_sentient(draw, produce_name, body_dy):
    """Sentient produce: the body IS the produce."""
    color = PRODUCE_COLORS.get(produce_name, DEFAULT_PRODUCE_COLOR)
    rim = tuple(max(0, c - 50) for c in color)

    cx = 32
    cy = 36 + body_dy

    silhouette = PRODUCE_BODY.get(produce_name, _draw_generic_blob)
    silhouette(draw, cx, cy, color, rim)

    # Eyes (white sclera with black pupil).
    eye_y = cy - 4
    draw.ellipse([cx - 8, eye_y - 3, cx - 3, eye_y + 2], fill=(0xff, 0xff, 0xff),
                 outline=(0x10, 0x10, 0x10))
    draw.ellipse([cx + 3, eye_y - 3, cx + 8, eye_y + 2], fill=(0xff, 0xff, 0xff),
                 outline=(0x10, 0x10, 0x10))
    draw.point((cx - 5, eye_y), fill=(0x10, 0x10, 0x10))
    draw.point((cx + 5, eye_y), fill=(0x10, 0x10, 0x10))

    # Mouth (small smile).
    mouth_y = cy + 4
    draw.line([(cx - 4, mouth_y), (cx - 2, mouth_y + 2)], fill=(0x10, 0x10, 0x10))
    draw.line([(cx - 2, mouth_y + 2), (cx + 2, mouth_y + 2)], fill=(0x10, 0x10, 0x10))
    draw.line([(cx + 2, mouth_y + 2), (cx + 4, mouth_y)], fill=(0x10, 0x10, 0x10))


def draw_hat(draw, hat_name, archetype_kind, body_dy):
    """Hat sits on top of the head. For sentient produce, on top of the blob."""
    if hat_name == "None":
        return

    if archetype_kind == "character":
        head_top_y = 20 + body_dy
        center_x = 32
    else:
        head_top_y = 36 + body_dy - 18  # top of the sentient ellipse
        center_x = 32

    if hat_name == "Straw":
        brim = (0xd9, 0xb8, 0x60)
        crown = (0xb8, 0x95, 0x40)
        draw.rectangle([center_x - 11, head_top_y - 1, center_x + 11, head_top_y + 1],
                       fill=brim)
        draw.rectangle([center_x - 5, head_top_y - 5, center_x + 5, head_top_y - 1],
                       fill=crown)
    elif hat_name == "Beanie":
        cap = (0x55, 0x6a, 0xb8)
        cuff = (0x35, 0x4a, 0x95)
        draw.rectangle([center_x - 7, head_top_y - 1, center_x + 7, head_top_y + 1],
                       fill=cuff)
        draw.ellipse([center_x - 7, head_top_y - 7, center_x + 7, head_top_y],
                     fill=cap)
    elif hat_name == "Cowboy":
        brim = (0x6a, 0x3a, 0x1a)
        crown = (0x4a, 0x2a, 0x10)
        draw.rectangle([center_x - 12, head_top_y - 1, center_x + 12, head_top_y + 1],
                       fill=brim)
        draw.rectangle([center_x - 6, head_top_y - 6, center_x + 6, head_top_y - 1],
                       fill=crown)
        draw.line([(center_x - 6, head_top_y - 6), (center_x + 6, head_top_y - 6)],
                  fill=(0x2a, 0x18, 0x08))
    elif hat_name == "Hooded":
        hood = (0x18, 0x18, 0x22)
        draw.ellipse([center_x - 9, head_top_y - 4, center_x + 9, head_top_y + 14],
                     fill=hood)
        # Re-expose the face area as a darker shadow.
        draw.rectangle([center_x - 6, head_top_y + 4, center_x + 6, head_top_y + 12],
                       fill=(0x05, 0x05, 0x08))
    elif hat_name == "Bandana":
        red = (0xc8, 0x2a, 0x2a)
        knot = (0x95, 0x1a, 0x1a)
        draw.polygon([
            (center_x - 7, head_top_y + 2),
            (center_x + 7, head_top_y + 2),
            (center_x, head_top_y + 7),
        ], fill=red)
        draw.point((center_x - 7, head_top_y + 2), fill=knot)
        draw.point((center_x + 7, head_top_y + 2), fill=knot)
    elif hat_name == "Wizard":
        cone = (0x35, 0x2a, 0x6a)
        star = (0xf0, 0xd0, 0x40)
        draw.polygon([
            (center_x - 6, head_top_y),
            (center_x + 6, head_top_y),
            (center_x, head_top_y - 12),
        ], fill=cone)
        draw.point((center_x, head_top_y - 8), fill=star)
        draw.point((center_x - 1, head_top_y - 7), fill=star)
        draw.point((center_x + 1, head_top_y - 7), fill=star)
        draw.point((center_x, head_top_y - 6), fill=star)
    elif hat_name == "Crown":
        gold = (0xe6, 0xc2, 0x2a)
        rim = (0xa0, 0x80, 0x10)
        points = [
            (center_x - 8, head_top_y + 1),
            (center_x - 6, head_top_y - 4),
            (center_x - 3, head_top_y),
            (center_x, head_top_y - 5),
            (center_x + 3, head_top_y),
            (center_x + 6, head_top_y - 4),
            (center_x + 8, head_top_y + 1),
        ]
        draw.polygon(points, fill=gold, outline=rim)


def apply_shimmer(img, frame_idx):
    rng = random.Random(311 + frame_idx)
    px = img.load()
    for _ in range(3):
        x = rng.randint(8, CANVAS_W - 9)
        y = rng.randint(8, CANVAS_H - 9)
        px[x, y] = (0xff, 0xff, 0xff)


def apply_glitch(img, frame_idx):
    if frame_idx % 2 == 0:
        return
    src = img.copy()
    sp = src.load()
    dp = img.load()
    shift = 2
    for y in range(CANVAS_H):
        for x in range(CANVAS_W):
            r, g, b = sp[x, y][:3]
            xr = (x + shift) % CANVAS_W
            xb = (x - shift) % CANVAS_W
            rr, _, _ = sp[xr, y][:3]
            _, _, bb = sp[xb, y][:3]
            dp[x, y] = (rr, g, bb)


def apply_legendary(img, frame_idx):
    """Animated golden outline that hue shifts per frame."""
    palette_cycle = [
        (0xff, 0xd7, 0x30),
        (0xff, 0xc0, 0x10),
        (0xff, 0xe8, 0x60),
        (0xff, 0xb0, 0x00),
        (0xff, 0xee, 0x88),
        (0xff, 0xa6, 0x18),
    ]
    color = palette_cycle[frame_idx % len(palette_cycle)]
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, CANVAS_W - 1, CANVAS_H - 1], outline=color)
    d.rectangle([1, 1, CANVAS_W - 2, CANVAS_H - 2], outline=color)

# ======================================================================
# Per frame composition
# ======================================================================

def render_frame(traits_for_sprite, frame_idx):
    img = Image.new("RGB", (CANVAS_W, CANVAS_H), (0, 0, 0))
    draw = ImageDraw.Draw(img)

    fill_background(draw, traits_for_sprite["background"], frame_idx)

    body_dy = BOUNCE_OFFSETS[frame_idx]

    archetype = traits_for_sprite["archetype"]
    archetype_kind = traits_for_sprite["archetype_kind"]
    produce_name = traits_for_sprite["produce"]

    if archetype_kind == "character":
        draw_character(draw, archetype, produce_name, body_dy)
    else:
        draw_sentient(draw, produce_name, body_dy)

    draw_hat(draw, traits_for_sprite["hat"], archetype_kind, body_dy)

    aura = traits_for_sprite["aura"]
    if aura == "Shimmer":
        apply_shimmer(img, frame_idx)
    elif aura == "Glitch":
        apply_glitch(img, frame_idx)
    elif aura == "Legendary":
        apply_legendary(img, frame_idx)

    return img


def encode_gif(frames, palette_colors):
    buf = BytesIO()
    converted = [
        f.convert("P", palette=Image.ADAPTIVE, colors=palette_colors)
        for f in frames
    ]
    converted[0].save(
        buf,
        format="GIF",
        save_all=True,
        append_images=converted[1:],
        duration=FRAME_DURATION_MS,
        loop=0,
        optimize=True,
        disposal=2,
    )
    return buf.getvalue()


def render_sprite(traits_for_sprite, sprite_id):
    frames = [render_frame(traits_for_sprite, i) for i in range(FRAMES)]
    data = encode_gif(frames, palette_colors=32)
    if len(data) <= SIZE_LIMIT:
        return data

    # Retry with 16 colors and 4 frames.
    smaller_frames = [render_frame(traits_for_sprite, i)
                      for i in (0, 1, 3, 4)]
    data = encode_gif(smaller_frames, palette_colors=16)
    if len(data) <= SIZE_LIMIT:
        return data

    raise RuntimeError(
        "Sprite {} exceeds SSTORE2 size limit even after fallback "
        "(traits: {}).".format(sprite_id, traits_for_sprite)
    )

# ======================================================================
# Rarity
# ======================================================================

def compute_rarity(plan):
    """Inverse frequency sum across the 5 trait categories."""
    counters = {
        "archetype":  Counter(p["archetype"]  for p in plan),
        "produce":    Counter(p["produce"]    for p in plan),
        "hat":        Counter(p["hat"]        for p in plan),
        "background": Counter(p["background"] for p in plan),
        "aura":       Counter(p["aura"]       for p in plan),
    }
    total = len(plan)
    scores = []
    for p in plan:
        score = 0.0
        for cat, counter in counters.items():
            freq = counter[p[cat]] / total
            if freq > 0:
                score += 1.0 / freq
        scores.append(score)
    ranked = sorted(
        range(len(scores)), key=lambda i: scores[i], reverse=True
    )
    ranks = [0] * len(scores)
    for rank_index, idx in enumerate(ranked):
        ranks[idx] = rank_index + 1
    return scores, ranks

# ======================================================================
# Main
# ======================================================================

def main():
    random.seed(42)
    rng = random.Random(42)

    traits = load_traits()
    os.makedirs(OUT_DIR, exist_ok=True)

    plan = build_plan(traits, rng)
    if len(plan) != traits["totalSupply"]:
        raise RuntimeError(
            "Plan size {} does not match totalSupply {}.".format(
                len(plan), traits["totalSupply"])
        )

    rarity_scores, rarity_ranks = compute_rarity(plan)

    metadata = []
    attributes = []
    max_bytes = 0

    for i, sprite_traits in enumerate(plan):
        sprite_id = i
        file_name = "sprite_{:03d}.gif".format(sprite_id)
        file_path = os.path.join(OUT_DIR, file_name)

        gif_bytes = render_sprite(sprite_traits, sprite_id)
        with open(file_path, "wb") as f:
            f.write(gif_bytes)
        if len(gif_bytes) > max_bytes:
            max_bytes = len(gif_bytes)

        public_traits = {
            "archetype":  sprite_traits["archetype"],
            "produce":    sprite_traits["produce"],
            "hat":        sprite_traits["hat"],
            "background": sprite_traits["background"],
            "aura":       sprite_traits["aura"],
        }
        metadata.append({
            "id": sprite_id,
            "file": file_name,
            "traits": public_traits,
            "rarityScore": round(rarity_scores[i], 4),
            "rarityRank": rarity_ranks[i],
        })

        opensea_attrs = [
            {"trait_type": "Archetype",  "value": sprite_traits["archetype"]},
            {"trait_type": "Produce",    "value": sprite_traits["produce"]},
            {"trait_type": "Hat",        "value": sprite_traits["hat"]},
            {"trait_type": "Background", "value": sprite_traits["background"]},
            {"trait_type": "Aura",       "value": sprite_traits["aura"]},
        ]
        attributes.append(json.dumps(opensea_attrs, separators=(",", ":")))

    with open(os.path.join(OUT_DIR, "metadata.json"), "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)

    with open(os.path.join(OUT_DIR, "attributes.json"), "w", encoding="utf-8") as f:
        json.dump(attributes, f, indent=2)

    archetype_counts = Counter(p["archetype"] for p in plan)
    aura_counts = Counter(p["aura"] for p in plan)

    print("Hat Pets sprite generation complete.")
    print("Total sprites: {}".format(len(plan)))
    print("Archetype breakdown:")
    for name in ["Farmer", "Trader", "Hacker", "Fruit", "Veg"]:
        print("  {}: {}".format(name, archetype_counts.get(name, 0)))
    print("Aura breakdown:")
    for name in ["None", "Shimmer", "Glitch", "Legendary"]:
        print("  {}: {}".format(name, aura_counts.get(name, 0)))
    print("Largest GIF size: {} bytes (limit {}).".format(max_bytes, SIZE_LIMIT))


if __name__ == "__main__":
    main()
