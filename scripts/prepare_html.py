#!/usr/bin/env python3
from pathlib import Path
import base64
import lzma
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "index.source.xz.b64"
OUTPUT = ROOT / "app/src/main/assets/index.html"
PDFS = {
    "a1": "https://www.seguridadaerea.gob.es/sites/default/files/_Formacion.temario.completo.Ed12.pdf",
    "a2": "https://www.seguridadaerea.gob.es/sites/default/files/FOR-UAS-P01-DT04_Ed.05_Formacion.Subcategoria.A2.pdf",
    "sts": "https://www.seguridadaerea.gob.es/sites/default/files/Temario.examen.conocimientos.teoricos.Syllabus.pdf",
    "rtf1": "https://www.seguridadaerea.gob.es/sites/default/files/for-uas-p01-dt10_ed_02_curso_de_radiofonista_rtf_uas_aesa_cap_1.pdf",
    "rtf2": "https://www.seguridadaerea.gob.es/sites/default/files/for-uas-p01-dt11_ed_02_curso_de_radiofonista_rtf_uas_aesa_cap_2.pdf",
    "rtf3": "https://www.seguridadaerea.gob.es/sites/default/files/for-uas-p01-dt12_ed_02_curso_de_radiofonista_rtf_uas_aesa_cap_3.pdf",
    "rtf4": "https://www.seguridadaerea.gob.es/sites/default/files/for-uas-p01-dt13_ed_02_curso_de_radiofonista_rtf_uas_aesa_cap_4.pdf",
    "rtf5": "https://www.seguridadaerea.gob.es/sites/default/files/for-uas-p01-dt14_ed_02_curso_de_radiofonista_rtf_uas_aesa_cap_5.pdf",
    "rtf6": "https://www.seguridadaerea.gob.es/sites/default/files/for-uas-p01-dt15_ed_02_curso_de_radiofonista_rtf_uas_aesa_cap_6.pdf",
    "rtf7": "https://www.seguridadaerea.gob.es/sites/default/files/for-uas-p01-dt22_ed_01_curso_de_radiofonista_rtf_uas_aesa_cap_7.pdf",
}
RENDERS = {
    "quad": "renders/multirotor.webp",
    "vtol": "renders/vtol.webp",
    "radio": "renders/radio.webp",
}

def download(url):
    req = urllib.request.Request(url, headers={"User-Agent":"Mozilla/5.0 Aula-UAS-GitHub-Builder/1.0","Accept":"application/pdf,*/*;q=0.8"})
    with urllib.request.urlopen(req, timeout=120) as response:
        data = response.read()
    if not data.startswith(b"%PDF"):
        raise RuntimeError(f"La descarga no parece un PDF: {url}")
    return data

def main():
    if not SOURCE.exists():
        raise RuntimeError("Falta index.source.xz.b64 en la raíz del repositorio")
    html = lzma.decompress(base64.b64decode(SOURCE.read_text(encoding="ascii"))).decode("utf-8")
    if 'const ARTWORK={quad:"/renders/multirotor.webp",vtol:"/renders/vtol.webp",radio:"/renders/radio.webp"};' not in html:
        raise RuntimeError("El HTML fuente no contiene las rutas de los tres renders")
    for render_id, asset_path in RENDERS.items():
        render = ROOT / "app/src/main/assets" / asset_path
        if not render.exists() or render.stat().st_size < 10_000:
            raise RuntimeError(f"Falta el render {render_id}: {asset_path}")
    embeds = []
    for pdf_id, url in PDFS.items():
        print(f"Descargando {pdf_id}...")
        encoded_pdf = base64.b64encode(download(url)).decode("ascii")
        embeds.append(f'<script type="application/octet-stream" id="pdf-{pdf_id}">{encoded_pdf}</script>')
    if "</body>" not in html:
        raise RuntimeError("HTML fuente no contiene </body>")
    html = html.replace("</body>", "\n".join(embeds) + "\n</body>", 1)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(html, encoding="utf-8")
    print(f"Generado: {OUTPUT} ({OUTPUT.stat().st_size / 1024 / 1024:.1f} MiB)")

if __name__ == "__main__":
    main()
