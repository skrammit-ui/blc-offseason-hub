#!/usr/bin/env python3
"""
Remove white background from PNGs in the icons folder and export
standard icon sizes with transparent backgrounds.
"""

from PIL import Image
import os

ICONS_DIR = os.path.join(os.path.dirname(__file__), "..", "icons")
SIZES = [16, 32, 64, 128, 256]
WHITE_THRESHOLD = 230  # pixels this bright or brighter are treated as background


def remove_white_bg(img: Image.Image) -> Image.Image:
    img = img.convert("RGBA")
    pixels = img.load()
    w, h = img.size

    # Flood-fill from all four corners to find background pixels
    from collections import deque
    visited = set()
    queue = deque()
    corners = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
    for c in corners:
        if c not in visited:
            queue.append(c)
            visited.add(c)

    while queue:
        x, y = queue.popleft()
        r, g, b, a = pixels[x, y]
        if r >= WHITE_THRESHOLD and g >= WHITE_THRESHOLD and b >= WHITE_THRESHOLD:
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
