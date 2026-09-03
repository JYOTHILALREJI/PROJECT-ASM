"""Extract embedded images (stamp, logos) from the reference NOC PDFs."""
import fitz  # PyMuPDF
import os

SRC = [
    "/home/z/my-project/upload/NOC PROSCAPE ARABIAN RANCHES 02-09-2026.pdf",
    "/home/z/my-project/upload/NOC GREEN AND MORE WARSAN 03-09-2026.pdf",
]
OUT = "/home/z/my-project/scripts/noc-assets"
os.makedirs(OUT, exist_ok=True)

for path in SRC:
    doc = fitz.open(path)
    base = os.path.basename(path).replace("NOC ", "").replace(".pdf", "").replace(" ", "_")
    for pno in range(len(doc)):
        for i, img in enumerate(doc[pno].get_images(full=True)):
            xref = img[0]
            pix = fitz.Pixmap(doc, xref)
            if pix.n - pix.alpha > 3:
                pix = fitz.Pixmap(fitz.csRGB, pix)
            name = f"{base}_p{pno+1}_i{i}.png"
            pix.save(os.path.join(OUT, name))
            print(name, pix.width, "x", pix.height)
    doc.close()
