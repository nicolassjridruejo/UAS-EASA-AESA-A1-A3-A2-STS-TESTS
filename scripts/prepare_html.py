#!/usr/bin/env python3
from pathlib import Path
import base64
import lzma
import urllib.request
import json
from pypdf import PdfReader
from io import BytesIO

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

def patch_reader_ux(html):
    start = html.find("function renderReader(){")
    end = html.find(" function getPDF(k)", start)
    if start < 0 or end < 0:
        raise RuntimeError("No se ha encontrado renderReader para aplicar la mejora de lectura")

    replacement = r'''function formatManualPage(text){
   const raw=String(text||'').replace(/\r/g,'').trim();if(!raw)return '<div class="manual-empty">Esta página contiene principalmente elementos gráficos. Abre el PDF para verla íntegra.</div>';
   const lines=raw.split(/\n+/).map(x=>x.trim()).filter(Boolean),blocks=[];let para=[];
   const flush=()=>{if(!para.length)return;const joined=para.join(' ').replace(/\s+/g,' ').trim();if(joined)blocks.push(`<p>${esc(joined)}</p>`);para=[];};
   const isHeading=line=>line.length<115&&(/^(\d+(?:\.\d+)*[.)]?\s+|[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ0-9 /(),.\-]{5,})/.test(line)||/^(Servicio|Clasificación|Zonas|Procedimientos|Comunicaciones|Meteorología|Navegación|Reglamentación|Factores humanos|Conocimiento|Mitigación|Operaciones)\b/i.test(line));
   const isBullet=line=>/^(?:[-•·]|\d+[.)]|[a-z][.)])\s+/.test(line);
   let list=[];const flushList=()=>{if(list.length){blocks.push('<ul>'+list.map(x=>`<li>${esc(x)}</li>`).join('')+'</ul>');list=[];}};
   for(const line of lines){
     if(isBullet(line)){flush();list.push(line.replace(/^(?:[-•·]|\d+[.)]|[a-z][.)])\s+/,''));continue;}
     flushList();
     if(isHeading(line)){flush();blocks.push(`<h3>${esc(line)}</h3>`);continue;}
     para.push(line);if(/[.:;!?]$/.test(line)&&para.join(' ').length>220)flush();
   }
   flushList();flush();return blocks.join('');
 }
 function renderReader(){const d=MANUALS[docKey];if(!d){go('theory');return;}docPage=Math.min(Math.max(docPage,0),d.pages.length-1);const fromQuestion=evidenceReturn&&state.active&&!state.active.ended,backLabel=fromQuestion?`← Volver a la pregunta ${state.active.index+1}`:'← Volver al temario',pageText=d.pages[docPage]||'';$('#view').innerHTML=`<section class="reader"><div class="split reader-head"><div><p class="eyebrow">MATERIAL OFICIAL · AESA</p><h2>${esc(d.title)}</h2><p class="small muted">Página ${docPage+1} de ${d.pages.length}</p></div><button class="reader-return primary" data-act="evidenceBack">${backLabel}</button></div><p class="small muted">Vista ordenada del texto extraído. El contenido original se conserva debajo y el PDF completo sigue disponible.</p><div class="actions"><button class="primary" data-act="pdf" data-id="${docKey}">Abrir PDF completo</button><button data-act="downloadPDF" data-id="${docKey}">Descargar PDF</button><a href="${esc(DATA.sources[docKey].url)}" target="_blank" rel="noopener noreferrer">Fuente original ↗</a></div><div class="field"><label for="docSearch">Buscar en este documento</label><input id="docSearch" type="search" placeholder="Por ejemplo: geocaging, colación, NOTAM…"></div><div id="docSearchResults"></div><div class="pagination"><button data-act="docPage" data-step="-1" ${docPage===0?'disabled':''}>Anterior</button><label class="small">Página <input type="number" id="docPageInput" min="1" max="${d.pages.length}" value="${docPage+1}"> de ${d.pages.length}</label><button data-act="docPage" data-step="1" ${docPage===d.pages.length-1?'disabled':''}>Siguiente</button></div><article id="docText" class="manual-page">${formatManualPage(pageText)}</article><details class="manual-original"><summary>Ver texto original extraído</summary><pre>${esc(pageText)||'Esta página contiene principalmente elementos gráficos.'}</pre></details><div class="pagination"><button data-act="docPage" data-step="-1" ${docPage===0?'disabled':''}>Anterior</button><button class="reader-return" data-act="evidenceBack">${backLabel}</button><button data-act="docPage" data-step="1" ${docPage===d.pages.length-1?'disabled':''}>Siguiente</button></div></section>`;}'''
    html = html[:start] + replacement + html[end:]

    css = r'''
<style>
.reader-head{align-items:flex-start;gap:16px}.reader-return{white-space:nowrap}.manual-page{margin-top:18px;padding:20px;border:1px solid var(--line);border-radius:16px;background:#0d1921;line-height:1.68}.manual-page h3{margin:24px 0 10px;color:var(--accent);font-size:1.05rem;line-height:1.35}.manual-page h3:first-child{margin-top:0}.manual-page p{margin:0 0 14px}.manual-page ul{margin:8px 0 18px;padding-left:22px}.manual-page li{margin:7px 0}.manual-original{margin:16px 0;border:1px solid var(--line);border-radius:12px;background:#0a141b}.manual-original summary{cursor:pointer;padding:14px 16px;color:var(--accent);font-weight:700}.manual-original pre{margin:0;padding:16px;white-space:pre-wrap;line-height:1.55;border-top:1px solid var(--line);overflow:auto}.manual-empty{padding:24px;color:var(--muted)}@media(max-width:680px){.reader-head{display:block}.reader-head .reader-return{width:100%;margin-top:14px}.manual-page{padding:16px}.reader>.pagination .reader-return{flex:1}}
</style>
'''
    style_marker = '<link rel="stylesheet" href="/assistant/uas-assistant.css">'
    if style_marker not in html:
        raise RuntimeError("No se ha encontrado el marcador CSS del asistente")
    html = html.replace(style_marker, css + style_marker, 1)

    click_marker = "document.addEventListener('click',onAction);"
    if click_marker not in html:
        raise RuntimeError("No se ha encontrado el manejador principal de clics")
    back_handler = """\n window.AulaUASHandleBack=function(){const d=$('#evidenceDialog');if(d&&(d.open||d.hasAttribute('open'))){if(d.close)d.close();else d.removeAttribute('open');return true;}if(view==='reader'){const back=evidenceReturn&&state.active&&!state.active.ended?evidenceReturn:'theory';evidenceReturn='';go(back);return true;}return false;};"""
    html = html.replace(click_marker, click_marker + back_handler, 1)

    html = html.replace('<p class="eyebrow">FUNDAMENTO DE LA RESPUESTA</p><h2>${esc(q.id)}</h2>',
                        '<p class="eyebrow">POR QUÉ ESTA ES LA RESPUESTA</p><h2>${esc(q.concept||q.id)}</h2>', 1)
    html = html.replace('<button class="close-evidence" data-act="closeEvidence">Cerrar</button>',
                        '<button class="close-evidence" data-act="closeEvidence">Volver a la pregunta</button>', 1)
    return html

def main():
    if not SOURCE.exists():
        raise RuntimeError("Falta index.source.xz.b64 en la raíz del repositorio")
    html = lzma.decompress(base64.b64decode(SOURCE.read_text(encoding="ascii"))).decode("utf-8")
    html = patch_reader_ux(html)
    if 'const ARTWORK={quad:"/renders/multirotor.webp",vtol:"/renders/vtol.webp",radio:"/renders/radio.webp"};' not in html:
        raise RuntimeError("El HTML fuente no contiene las rutas de los tres renders")
    for render_id, asset_path in RENDERS.items():
        render = ROOT / "app/src/main/assets" / asset_path
        if not render.exists() or render.stat().st_size < 10_000:
            raise RuntimeError(f"Falta el render {render_id}: {asset_path}")
    for marker in (
        'window.UAS_ASSISTANT_BOOTSTRAP=',
        '<script src="/assistant/uas-assistant.js"></script>',
        '<script src="/assistant/uas-assistant-adapter.js"></script>',
        'Ver fuente, ubicación y pasaje',
        'Vista ordenada del texto extraído',
        'Volver a la pregunta',
    ):
        if marker not in html:
            raise RuntimeError(f"El HTML fuente no contiene la integración requerida: {marker}")
    for asset_path in (
        "assistant/uas-assistant.js",
        "assistant/uas-assistant-adapter.js",
        "assistant/uas-assistant.css",
        "assistant/dragonfly-v02-visual.js",
        "assistant/assets/idle.webp",
        "assistant/assets/scan.webp",
        "assistant/assets/explain.webp",
        "assistant/assets/celebrate.webp",
    ):
        asset = ROOT / "app/src/main/assets" / asset_path
        if not asset.exists() or asset.stat().st_size < 1_000:
            raise RuntimeError(f"Falta un recurso del asistente: {asset_path}")
    embeds = []
    manuals = {}
    for pdf_id, url in PDFS.items():
        print(f"Descargando {pdf_id}...")
        pdf = download(url)
        encoded_pdf = base64.b64encode(pdf).decode("ascii")
        embeds.append(f'<script type="application/octet-stream" id="pdf-{pdf_id}">{encoded_pdf}</script>')
        reader = PdfReader(BytesIO(pdf))
        pages = []
        for page in reader.pages:
            text = (page.extract_text() or "").replace("\x00", "").strip()
            pages.append(text)
        manuals[pdf_id] = {"title": None, "pages": pages}
    marker = 'const MANUALS='
    start = html.index(marker) + len(marker)
    end = html.index(';\n', start)
    original = json.loads(html[start:end])
    for key, item in manuals.items():
        item["title"] = original[key]["title"]
    html = html[:start] + json.dumps(manuals, ensure_ascii=False, separators=(",", ":")) + html[end:]
    if "</body>" not in html:
        raise RuntimeError("HTML fuente no contiene </body>")
    visual_tag = '<script src="/assistant/dragonfly-v02-visual.js"></script>'
    html = html.replace("</body>", "\n".join(embeds) + "\n" + visual_tag + "\n</body>", 1)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(html, encoding="utf-8")
    print(f"Generado: {OUTPUT} ({OUTPUT.stat().st_size / 1024 / 1024:.1f} MiB)")

if __name__ == "__main__":
    main()
