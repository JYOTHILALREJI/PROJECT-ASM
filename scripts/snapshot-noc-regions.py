"""Snapshot exact letterhead/stamp regions from reference NOCs at 300 DPI.

The reference PDFs embed images that Word stretched non-uniformly, so we
re-snapshot the regions from the rendered page instead — guarantees the
generated NOC matches the reference pixel-for-pixel.
"""
import fitz

PROSCAPE = "/home/z/my-project/upload/NOC PROSCAPE ARABIAN RANCHES 02-09-2026.pdf"
GREEN = "/home/z/my-project/upload/NOC GREEN AND MORE WARSAN 03-09-2026.pdf"
OUT = "/home/z/my-project/src/assets/noc"

# All rects in PDF points (A4 = 595.28 x 841.89, origin top-left for fitz)
JOBS = [
    (PROSCAPE, 0, fitz.Rect(0, 0, 595.28, 119), f"{OUT}/letterhead.png"),
    (PROSCAPE, 1, fitz.Rect(368, 84, 520, 172), f"{OUT}/stamp-procurement.png"),
    (GREEN, 1, fitz.Rect(358, 310, 508, 442), f"{OUT}/stamp-signature.png"),
]

for src, pno, rect, out in JOBS:
    doc = fitz.open(src)
    page = doc[pno]
    pix = page.get_pixmap(clip=rect, dpi=300, alpha=False)
    pix.save(out)
    print(out, pix.width, "x", pix.height)
    doc.close()
