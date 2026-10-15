"""Shrinks the CC0 scans in the project's assets-cc0 folder into the small game textures in src/assets/textures.

Usage: python tools/textures/export.py /mnt/project-files/bluebird/assets-cc0
Sources and licences are listed in src/assets/textures/CREDITS.md.
"""
import sys
from pathlib import Path

from PIL import Image, ImageOps

SRC = Path(sys.argv[1])
OUT = Path(__file__).resolve().parents[2] / 'src/assets/textures'

# (source map, output name, size, grey) – grey keeps only the luminance, so the game can tint it.
MAPS = [
    ('snow/fresh-snow/fresh-snow_normal_gl_1k.jpg', 'snow-normal', 512, False),
    ('rock/alpine-rock-stratified/alpine-rock-stratified_albedo_1k.jpg', 'rock-albedo', 512, True),
    ('rock/alpine-rock-stratified/alpine-rock-stratified_normal_gl_1k.jpg', 'rock-normal', 512, False),
]

OUT.mkdir(parents=True, exist_ok=True)
for src, name, size, grey in MAPS:
    im = Image.open(SRC / src).convert('RGB').resize((size, size), Image.LANCZOS)
    if grey:
        # Stretch the luminance so the grain survives tinting, centred on mid grey.
        im = ImageOps.autocontrast(ImageOps.grayscale(im), cutoff=1).convert('RGB')
    im.save(OUT / f'{name}.webp', quality=82, method=6)
    print(name, (OUT / f'{name}.webp').stat().st_size // 1024, 'KB')
