#!/usr/bin/env python3
"""Derive the runtime blob composition from The Met's public-domain scan.

The browser intentionally does not sample the JPEG at runtime: file:// pages cannot
reliably fetch local assets. This script turns the image's dark ink and soft wash
regions into deterministic blob seeds and writes js/art-data.js, which is loaded as
a classic script. Re-run after replacing or re-cropping the source artwork.
"""

from __future__ import annotations

import json
import math
import base64
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "art" / "moonlit-landscape-rosetsu-1794.jpg"
OUTPUT = ROOT / "js" / "art-data.js"
FIELD_OUTPUT = ROOT / "art" / "rosetsu-quantized-field.png"
FALLBACK_OUTPUT = ROOT / "art" / "rosetsu-quantized-fallback.png"

# Excludes the brocade mounting and the mostly empty upper silk, retaining the
# complete painted scene: pine, moon/clouds, foreground pine, and mountain.
CROP = (170, 1050, 1710, 3820)
WORK_SIZE = (254, 400)
INK_COUNT = 43
WASH_COUNT = 24
SEED = 845805  # The Met object id; stable and provenance-readable.


def luminance(rgb: np.ndarray) -> np.ndarray:
    linear = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    return 0.2126 * linear[..., 0] + 0.7152 * linear[..., 1] + 0.0722 * linear[..., 2]


def weighted_kmeans(weight: np.ndarray, count: int, rng: np.random.Generator) -> list[dict]:
    """Cluster a scalar paint field; return covariance-aware elliptical regions."""
    h, w = weight.shape
    yy, xx = np.mgrid[0:h, 0:w]
    points = np.column_stack((xx.ravel() / (w - 1), yy.ravel() / (h - 1)))
    weights = weight.ravel().astype(np.float64)
    keep = weights > np.percentile(weights[weights > 0], 16)
    points, weights = points[keep], weights[keep]
    weights /= weights.sum()

    # Weighted k-means++ starts preserve disconnected brush marks better than a grid.
    centers = [points[rng.choice(len(points), p=weights)]]
    nearest = np.sum((points - centers[0]) ** 2, axis=1)
    for _ in range(1, count):
        p = weights * np.maximum(nearest, 1e-10)
        p /= p.sum()
        c = points[rng.choice(len(points), p=p)]
        centers.append(c)
        nearest = np.minimum(nearest, np.sum((points - c) ** 2, axis=1))
    centers = np.asarray(centers)

    labels = np.zeros(len(points), dtype=np.int32)
    for _ in range(24):
        d2 = np.sum((points[:, None, :] - centers[None, :, :]) ** 2, axis=2)
        labels = np.argmin(d2, axis=1)
        moved = centers.copy()
        for i in range(count):
            m = labels == i
            if np.any(m):
                wm = weights[m]
                moved[i] = np.sum(points[m] * wm[:, None], axis=0) / wm.sum()
        if np.max(np.abs(moved - centers)) < 1e-5:
            centers = moved
            break
        centers = moved

    out = []
    for i, center in enumerate(centers):
        m = labels == i
        if not np.any(m):
            continue
        p, wt = points[m], weights[m]
        wt /= wt.sum()
        delta = p - center
        cov = (delta * wt[:, None]).T @ delta + np.eye(2) * 1e-6
        vals, vecs = np.linalg.eigh(cov)
        order = np.argsort(vals)[::-1]
        vals, vecs = vals[order], vecs[:, order]
        major = vecs[:, 0]
        out.append({
            "x": float(center[0]),
            "y": float(center[1]),
            "spread_x": float(math.sqrt(vals[0])),
            "spread_y": float(math.sqrt(vals[1])),
            "angle": float(math.atan2(-major[1], major[0])),
            "mass": float(weight[keep][labels == i].sum()) if False else float(np.sum(weights[m])),
        })
    return out


def main() -> None:
    image = Image.open(SOURCE).convert("RGB").crop(CROP).resize(WORK_SIZE, Image.Resampling.LANCZOS)
    rgb = np.asarray(image, dtype=np.float32) / 255.0
    lum = luminance(rgb)
    paper = float(np.percentile(lum, 88))
    darkness = np.clip((paper - lum) / max(paper, 1e-5), 0, 1)

    # Two value-frequency layers preserve source structure while assigning one
    # pure pigment per seed: crisp marks -> ink; broad low-frequency tone -> mist.
    ink = np.clip((darkness - 0.13) / 0.58, 0, 1) ** 1.65
    soft = np.asarray(
        Image.fromarray(np.uint8(darkness * 255), "L").filter(ImageFilter.GaussianBlur(13)),
        dtype=np.float32,
    ) / 255.0
    wash = np.clip((soft - 0.095) / 0.27, 0, 1) ** 1.55
    wash *= 1.0 - 0.52 * np.clip((darkness - 0.38) / 0.5, 0, 1)
    ey, ex = np.mgrid[0:WORK_SIZE[1], 0:WORK_SIZE[0]]
    edge = np.minimum.reduce((ex, WORK_SIZE[0] - 1 - ex, ey, WORK_SIZE[1] - 1 - ey)).astype(np.float32)
    edge_fade = np.clip(edge / 30.0, 0, 1) ** 0.72
    ink *= edge_fade
    wash *= edge_fade

    # Runtime scalar-field texture. The portrait scene occupies the right side
    # of a landscape canvas, leaving the site's name a calm paper field. R/G/B
    # are independent pigment coverage—not a flattened colour image.
    fw, fh = 640, 400
    field = np.zeros((fh, fw, 4), dtype=np.uint8)
    field[..., 3] = 255
    x0, x1, y0, y1 = 330, 590, 8, 392
    ink_img = Image.fromarray(np.uint8(np.clip(ink * 1.38, 0, 1) * 255), "L").resize((x1 - x0, y1 - y0), Image.Resampling.BICUBIC)
    wash_img = Image.fromarray(np.uint8(np.clip(wash * 1.22, 0, 1) * 255), "L").resize((x1 - x0, y1 - y0), Image.Resampling.BICUBIC)
    field[y0:y1, x0:x1, 0] = np.asarray(ink_img)
    field[y0:y1, x0:x1, 1] = np.asarray(wash_img)

    # Rosetsu painted the moon in reserve. Translate that identified source
    # region into the third, gold pigment field, then let the original cloud
    # channels cross it as they do in the scan.
    yy, xx = np.mgrid[0:fh, 0:fw]
    mx = x0 + 0.52 * (x1 - x0)
    my = y0 + 0.35 * (y1 - y0)
    mr = 0.125 * (y1 - y0)
    moon = np.clip(1 - np.sqrt((xx - mx) ** 2 + (yy - my) ** 2) / mr, 0, 1)
    moon = np.clip(moon * 1.35, 0, 1) ** 0.55
    field[..., 2] = np.uint8(moon * 255)
    Image.fromarray(field, "RGBA").save(FIELD_OUTPUT, optimize=True)
    paper_rgb = np.array([0xE8, 0xE1, 0xC8], dtype=np.float32) / 255.0
    pigment_rgb = np.array([[0x31, 0x4F, 0x55], [0x7E, 0x95, 0x8B], [0xD7, 0xBA, 0x70]], dtype=np.float32) / 255.0
    depth = field[..., :3].astype(np.float32) / 255.0
    absorption = -np.log(np.maximum(pigment_rgb, 1e-3))
    fallback_rgb = paper_rgb * np.exp(-(depth @ absorption) * np.array([1.0, 1.0, 1.0]))
    Image.fromarray(np.uint8(np.clip(fallback_rgb, 0, 1) * 255), "RGB").save(FALLBACK_OUTPUT, optimize=True)

    rng = np.random.default_rng(SEED)
    defs: list[dict] = []

    # The moon is a reserve (unpainted) circle in the source. Encoding that
    # recognizable source region as a gold field is the only semantic palette
    # translation; the ink/cloud blobs still overlap it exactly as in the scan.
    defs.append({"fx": 0.728, "y": 0.713, "r": 0.126, "pig": 2, "lum": True, "soft": True, "w": 0.92})
    defs.append({"fx": 0.728, "y": 0.713, "r": 0.170, "pig": 2, "lum": True, "soft": True, "w": 0.22})

    for pig, field, count in ((0, ink, INK_COUNT), (1, wash, WASH_COUNT)):
        for c in weighted_kmeans(field, count, rng):
            # Source crop maps into a right-side portrait tableau. Positions remain
            # normalized so resize recomposition retains the recognizable painting.
            fx = 0.715 + (c["x"] - 0.5) * 0.39
            y = 0.035 + (1.0 - c["y"]) * 0.93
            spread = max(c["spread_y"] * 0.93, 0.009)
            radius = min(0.082 if pig == 0 else 0.115, max(0.019 if pig == 0 else 0.033, spread * (2.7 if pig == 0 else 3.1)))
            # Ellipse major/minor ratio is source-derived, damped to prevent needles.
            ratio = min(2.7, max(0.62, c["spread_x"] / max(c["spread_y"], 1e-4) * 0.73))
            mass = min(1.0, max(0.22, c["mass"] * count * (1.35 if pig == 0 else 1.1)))
            defs.append({
                "fx": round(fx, 5), "y": round(y, 5), "r": round(radius, 5),
                "pig": pig, "sx": round(ratio, 4), "a": round(c["angle"], 4),
                "w": round((0.72 + 0.55 * mass) if pig == 0 else (0.35 + 0.38 * mass), 4),
                **({"soft": True} if pig == 1 else {}),
            })

    metadata = {
        "title": "Moonlit Landscape",
        "artist": "Nagasawa Rosetsu (1754–1799)",
        "date": "1794–95",
        "objectId": 845805,
        "sourceUrl": "https://www.metmuseum.org/art/collection/search/845805",
        "imageUrl": "https://images.metmuseum.org/CRDImages/as/original/LC-TR_168_1ab_2020_sr1-006.jpg",
        "license": "Public Domain (The Met Open Access)",
        "crop": list(CROP),
        "sourceSha256": "e0a7a450b4a7aaaf049f3738869febe4ef00d87911e56d4cf7b6fc4b254f8faf",
        "fieldUrl": "art/rosetsu-quantized-field.png",
        "fieldSize": [fw, fh],
    }
    payload = "\"use strict\";\n/* Generated by tools/derive_art.py from the local public-domain scan. */\n"
    payload += "const WC_ART = " + json.dumps({"metadata": metadata, "defs": defs}, separators=(",", ":")) + ";\n"
    field_data = base64.b64encode(FIELD_OUTPUT.read_bytes()).decode("ascii")
    fallback_data = base64.b64encode(FALLBACK_OUTPUT.read_bytes()).decode("ascii")
    payload += "WC_ART.fieldDataUrl = \"data:image/png;base64," + field_data + "\";\n"
    payload += "WC_ART.fallbackDataUrl = \"data:image/png;base64," + fallback_data + "\";\n"
    payload += "document.getElementById('wc-art-field').src = WC_ART.fieldDataUrl;\n"
    payload += "document.getElementById('wc-art-fallback').src = WC_ART.fallbackDataUrl;\n"
    OUTPUT.write_text(payload, encoding="utf-8")
    print(f"wrote {OUTPUT.relative_to(ROOT)} ({len(defs)} audit regions), {FIELD_OUTPUT.relative_to(ROOT)}, and {FALLBACK_OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
