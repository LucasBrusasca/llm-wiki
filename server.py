import anthropic
import json
import os
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from dotenv import load_dotenv
from socketserver import ThreadingMixIn

load_dotenv()
client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

def encontrar_nodos_relevantes(pregunta, max_resultados=5):
    try:
        with open("nodes_generated.json", "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return []
    stopwords = {'el','la','los','las','un','una','de','en','que','es','y','a','con','por','para','del','al','se','no','lo','su','sus'}
    palabras = {w for w in pregunta.lower().split() if len(w) > 2 and w not in stopwords}
    if not palabras:
        return []
    scored = []
    for nodo in data.get("nodos", []):
        texto = f"{nodo.get('label','')} {nodo.get('desc','')} {nodo.get('fragmento','')}".lower()
        score = sum(1 for p in palabras if p in texto)
        if score > 0:
            scored.append((score, nodo["id"]))
    scored.sort(reverse=True)
    return [nid for _, nid in scored[:max_resultados]]

class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/doc?"):
            self._serve_doc()
        elif self.path.startswith("/thumbnail?"):
            self._serve_thumbnail()
        else:
            SimpleHTTPRequestHandler.do_GET(self)

    def _serve_doc(self):
        params = parse_qs(urlparse(self.path).query)
        rel = params.get("p", [""])[0]
        if not rel:
            self.send_response(400); self.end_headers(); return
        base = Path(__file__).parent.resolve()
        try:
            target = (base / rel).resolve()
            if not str(target).startswith(str(base)):
                raise ValueError("path traversal")
            if not target.exists():
                raise FileNotFoundError()
        except Exception:
            self.send_response(404); self.end_headers(); return
        ct = {"pdf":"application/pdf","mp3":"audio/mpeg","wav":"audio/wav","ogg":"audio/ogg"}.get(
            target.suffix.lower().lstrip("."), "application/octet-stream")
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ct)
        self.send_header("Content-Disposition", f'inline; filename="{target.name}"')
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _serve_thumbnail(self):
        params = parse_qs(urlparse(self.path).query)
        rel = params.get("p", [""])[0]
        if not rel:
            self.send_response(400); self.end_headers(); return
        base = Path(__file__).parent.resolve()
        try:
            target = (base / rel).resolve()
            if not str(target).startswith(str(base)):
                raise ValueError("path traversal")
            if not target.exists():
                raise FileNotFoundError()
        except Exception:
            self.send_response(404); self.end_headers(); return
        try:
            import fitz
            doc = fitz.open(str(target))
            page = doc[0]
            pix = page.get_pixmap(matrix=fitz.Matrix(1.2, 1.2), alpha=False)
            img_data = pix.tobytes("png")
            doc.close()
        except Exception as e:
            print(f"Thumbnail error: {e}")
            self.send_response(500); self.end_headers(); return
        self.send_response(200)
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(img_data)))
        self.send_header("Cache-Control", "public, max-age=86400")
        self.end_headers()
        self.wfile.write(img_data)

    def do_POST(self):
        if self.path == "/agent":
            length = int(self.headers["Content-Length"])
            body = json.loads(self.rfile.read(length))
            system = body.get("system","Sos el agente de PragmaForge.")
            messages = body.get("messages",[])
            try:
                from processor import query_llm
                reply = query_llm(messages, system)
            except Exception as e:
                reply = f"Error: {str(e)}"
                print(f"ERROR LLM: {e}")
            ultima_pregunta = messages[-1]["content"] if messages else ""
            nodos_rel = encontrar_nodos_relevantes(ultima_pregunta)
            self.send_response(200)
            self.send_header("Content-Type","application/json")
            self.send_header("Access-Control-Allow-Origin","*")
            self.end_headers()
            self.wfile.write(json.dumps({"reply": reply, "nodos_relevantes": nodos_rel}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin","*")
        self.send_header("Access-Control-Allow-Methods","POST, GET")
        self.send_header("Access-Control-Allow-Headers","Content-Type")
        self.end_headers()

    def log_message(self, format, *args):
        print(f"{self.command} {self.path}")

if __name__ == "__main__": 
    class ThreadedHTTPServer(ThreadingMixIn, HTTPServer): pass
    print("PragmaForge server corriendo en http://localhost:8000")
    ThreadedHTTPServer(("",8000), Handler).serve_forever()