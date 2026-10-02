"""Rasterize the BKKx Atlas mark into PWA icons from the favicon composition.

Opaque full-bleed dark tile (the platform applies its own mask), the mark
inside the maskable safe zone. Outputs into public/.
"""
import pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path("/Users/nonarkara/Projects/bkk-3d-atlas/public")

MARK = """<g transform="translate(15 15) scale(0.7)">
    <path d="M6 71 L50 89 L94 71 L50 53 Z" fill="#f1efe8"/>
    <path d="M6 51 L50 69 L94 51 L50 33 Z" fill="#b9bda9"/>
    <path d="M6 31 L50 49 L94 31 L50 13 Z" fill="#f1efe8"/>
    <path d="M64 5 C42 15 80 29 60 41 C43 52 66 63 48 75 C41 80 40 88 45 95" fill="none" stroke="#2196f3" stroke-width="11" stroke-linecap="round"/>
  </g>"""
MARK_MASKABLE = MARK.replace("scale(0.7)", "scale(0.55)").replace("translate(15 15)", "translate(22.5 22.5)")

def page_svg(size: int, mark: str) -> str:
    return f"""<!doctype html><html><body style="margin:0">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="{size}" height="{size}" style="display:block">
  <rect width="100" height="100" fill="#11120f"/>{mark}
</svg></body></html>"""

JOBS = [
    ("icon-192.png", 192, MARK),
    ("icon-512.png", 512, MARK),
    ("icon-maskable-192.png", 192, MARK_MASKABLE),
    ("icon-maskable-512.png", 512, MARK_MASKABLE),
    ("apple-touch-icon.png", 180, MARK),
]

with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome")
    for name, size, mark in JOBS:
        page = browser.new_page(viewport={"width": size, "height": size})
        page.set_content(page_svg(size, mark))
        page.wait_for_timeout(300)
        page.screenshot(path=str(ROOT / name), omit_background=False)
        page.close()
        print(f"wrote {name} ({size})")
    browser.close()
