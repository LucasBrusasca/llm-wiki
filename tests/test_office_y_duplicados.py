"""Vista previa de Word/PowerPoint (estructura leída del XML) y detección de fuentes
repetidas antes de procesarlas."""
import tempfile
import unittest
import zipfile
from pathlib import Path

import office_preview as op

W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' \
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' \
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ' \
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' \
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
RELS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"'


def docx(ruta: Path):
    with zipfile.ZipFile(ruta, "w") as z:
        z.writestr("word/styles.xml", f'<w:styles {W}><w:style w:styleId="Ttulo1"><w:name w:val="heading 1"/></w:style></w:styles>')
        z.writestr("word/_rels/document.xml.rels",
                   f'<Relationships {RELS}><Relationship Id="rId5" Target="media/image1.png"/>'
                   f'<Relationship Id="rId6" Target="media/image2.emf"/></Relationships>')
        z.writestr("word/media/image1.png", b"\x89PNG fake")
        z.writestr("word/document.xml", f'''<w:document {W}><w:body>
          <w:p><w:pPr><w:pStyle w:val="Ttulo1"/></w:pPr><w:r><w:t>Introducción</w:t></w:r></w:p>
          <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Negrita</w:t></w:r><w:r><w:t xml:space="preserve"> y normal</w:t></w:r></w:p>
          <w:p><w:pPr><w:numPr><w:ilvl w:val="1"/></w:numPr></w:pPr><w:r><w:t>Un punto</w:t></w:r></w:p>
          <w:p><w:r><w:rPr><w:rFonts w:ascii="Consolas"/></w:rPr><w:t>x &lt;- 1</w:t></w:r></w:p>
          <w:p><w:r><w:drawing><a:blip r:embed="rId5"/></w:drawing></w:r><w:r><w:drawing><a:blip r:embed="rId6"/></w:drawing></w:r></w:p>
          <w:tbl><w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
        </w:body></w:document>''')


def pptx(ruta: Path):
    with zipfile.ZipFile(ruta, "w") as z:
        z.writestr("ppt/presentation.xml", f'<p:presentation {P}><p:sldIdLst>'
                   f'<p:sldId id="257" r:id="rId3"/><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>')
        z.writestr("ppt/_rels/presentation.xml.rels",
                   f'<Relationships {RELS}><Relationship Id="rId2" Target="slides/slide1.xml"/>'
                   f'<Relationship Id="rId3" Target="slides/slide2.xml"/></Relationships>')
        z.writestr("ppt/slides/_rels/slide2.xml.rels",
                   f'<Relationships {RELS}><Relationship Id="rId1" Target="../media/image9.jpg"/></Relationships>')
        z.writestr("ppt/media/image9.jpg", b"jpg")
        z.writestr("ppt/slides/slide1.xml", f'''<p:sld {P}><p:cSld><p:spTree>
          <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Segunda</a:t></a:r></a:p></p:txBody></p:sp>
        </p:spTree></p:cSld></p:sld>''')
        z.writestr("ppt/slides/slide2.xml", f'''<p:sld {P}><p:cSld><p:spTree>
          <p:sp><p:nvSpPr><p:nvPr/></p:nvSpPr><p:txBody><a:p><a:r><a:t>Primera</a:t></a:r></a:p></p:txBody></p:sp>
          <p:sp><p:nvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:txBody>
            <a:p><a:r><a:t>Punto uno</a:t></a:r></a:p><a:p><a:pPr lvl="1"/><a:r><a:rPr b="1"/><a:t>Sub</a:t></a:r></a:p></p:txBody></p:sp>
          <p:pic><p:blipFill><a:blip r:embed="rId1"/></p:blipFill></p:pic>
        </p:spTree></p:cSld></p:sld>''')


class OfficeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_word_con_estructura(self):
        docx(self.dir / "a.docx")
        b = op.vista_previa(str(self.dir / "a.docx"))["bloques"]
        self.assertEqual([x["t"] for x in b], ["h", "p", "li", "code", "img", "tabla"])
        self.assertEqual(b[0]["nivel"], 1)
        self.assertEqual(b[1]["runs"], [{"texto": "Negrita", "b": True, "i": False, "mono": False},
                                        {"texto": " y normal", "b": False, "i": False, "mono": False}])
        self.assertEqual(b[2]["nivel"], 1)
        self.assertEqual(b[3]["texto"], "x <- 1")
        self.assertEqual(b[4]["src"], "word/media/image1.png")          # el .emf no se ofrece
        self.assertEqual(b[5]["filas"], [["A", "B"]])

    def test_ppt_en_el_orden_de_la_presentacion(self):
        pptx(self.dir / "a.pptx")
        d = op.vista_previa(str(self.dir / "a.pptx"))
        self.assertEqual(d["total"], 2)
        s1, s2 = d["diapositivas"]
        self.assertEqual(s1["titulo"], "Primera")                       # cuadro corto sin marcador
        self.assertEqual([(x["t"], x.get("nivel")) for x in s1["bloques"]], [("li", 0), ("li", 1), ("img", None)])
        self.assertTrue(s1["bloques"][1]["runs"][0]["b"])
        self.assertEqual(s1["bloques"][2]["src"], "ppt/media/image9.jpg")
        self.assertEqual(s2["titulo"], "Segunda")

    def test_medios_solo_de_la_carpeta_de_medios(self):
        docx(self.dir / "a.docx")
        datos, tipo = op.medio(str(self.dir / "a.docx"), "word/media/image1.png")
        self.assertEqual((datos[:4], tipo), (b"\x89PNG", "image/png"))
        for parte in ("word/document.xml", "../../.env", "word/media/no.png", "word/media/x.exe"):
            with self.assertRaises(op.OfficeInvalido):
                op.medio(str(self.dir / "a.docx"), parte)

    def test_archivo_que_no_es_office(self):
        (self.dir / "x.docx").write_bytes(b"no soy un zip")
        with self.assertRaises(op.OfficeInvalido):
            op.vista_previa(str(self.dir / "x.docx"))


class UrlNormalizadaTests(unittest.TestCase):
    def test_misma_pagina_escrita_distinto(self):
        from main import _url_normalizada
        base = _url_normalizada("https://www.bcra.gob.ar/estadisticas-indicadores/")
        for variante in ("http://bcra.gob.ar/estadisticas-indicadores",
                         "https://WWW.BCRA.gob.ar/estadisticas-indicadores/#tabla",
                         "https://www.bcra.gob.ar/estadisticas-indicadores/?utm_source=x&fbclid=1"):
            self.assertEqual(_url_normalizada(variante), base)
        self.assertNotEqual(_url_normalizada("https://bcra.gob.ar/estadisticas-indicadores?serie=2"), base)
        self.assertEqual(_url_normalizada("https://x.com/a?b=2&a=1"), _url_normalizada("https://x.com/a?a=1&b=2"))


if __name__ == "__main__":
    unittest.main()
