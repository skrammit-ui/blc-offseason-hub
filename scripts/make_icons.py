#!/usr/bin/env python3
"""
Remove white background from PNGs in the icons folder and export
standard icon sizes with transparent backgrounds.
"""

from PIL import Image
import os

ICONS_DIR = os.path.join(os.path.dirname(__file__), "..", "icons")
SIZES = [16, 32, 64, 128, 256]
COLOR_TOLERANCE = 30  # max per-channel difference to be considered background


def _color_distance(c1, c2):
    return max(abs(c1[0]-c2[0]), abs(c1[1]-c2[1]), abs(c1[2]-c2[2]))


def remove_white_bg(img: Image.Image) -> Image.Image:
    from collections import deque
    img = img.convert("RGBA")
    pixels = img.load()
    w, h = img.size

    # Sample background color from the corner with the most uniform area
    bg_color = pixels[0, 0][:3]

    visited = set()
    queue = deque()
    for c in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        if c not in visited:
            queue.append(c)
            visited.add(c)

    while queue:
        x, y = queue.popleft()
        r, g, b, a = pixels[x, y]
        if _color_distance((r, g, b), bg_color) <= COLOR_TOLERANCE:
            pixels[x, y] = (r, g, b, 0)
            for nx, ny in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)]:
                if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in visited:
                    visited.add((nx, ny))
                    queue.append((nx, ny))

    return img


def process(src_path: str):
    name = os.path.splitext(os.path.basename(src_path))[0]
    out_dir = os.path.join(ICONS_DIR, name)
    os.makedirs(out_dir, exist_ok=True)

    img = Image.open(src_path)
    img = remove_white_bg(img)

    # Crop to bounding box of non-transparent pixels
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)

    for size in SIZES:
        resized = img.resize((size, size), Image.LANCZOS)
        out_path = os.path.join(out_dir, f"{name}-{size}.png")
        resized.save(out_path, "PNG")
        print(f"  Saved {out_path}")

    # Also save a full-size transparent version
    full_path = os.path.join(out_dir, f"{name}.png")
    img.save(full_path, "PNG")
    print(f"  Saved {full_path} (full size)")


if __name__ == "__main__":
    sources = [
        os.path.join(ICONS_DIR, f)
        for f in os.listdir(ICONS_DIR)
        if f.lower().endswith(".png") and not os.path.isdir(os.path.join(ICONS_DIR, f))
    ]

    if not sources:
        print("No PNG files found in icons/")
    else:
        for src in sources:
            print(f"\nProcessing: {src}")
            process(src)

    print("\nDone.")
