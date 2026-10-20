"""Búsqueda por PALABRAS (BM25/tsvector) y su fusión con la búsqueda por SIGNIFICADO (vectores).

Los vectores encuentran «lo que quiere decir» aunque no se usen las mismas palabras;
las palabras encuentran siglas, nombres propios y términos técnicos que los vectores
confunden con otros parecidos. Para buscar PASAJES juntas rinden más que cada una por
separado (eval/evaluar_busqueda.py; antes en multi-rag-energy-ar). Para buscar
DOCUMENTOS no: ahí gana el vector del documento entero solo. La fusión es RRF (Reciprocal Rank Fusion): sólo usa el PUESTO de
cada resultado en cada lista, así que no hay que inventar cómo sumar un coseno con un
puntaje BM25, que están en escalas distintas.

ESCALABILIDAD: Postgres full-text (tsvector + GIN, spanish config) reemplaza el BM25
en memoria cuando hay +10k chunks. El índice se mantiene con un trigger, no hay que
reconstruirlo. Fallback a BM25 en memoria para bases pequeñas o tests sin Postgres.
"""
from __future__ import annotations

import math
import os
import re
import threading
import unicodedata
from collections import Counter, defaultdict

# Constante estándar de RRF (Cormack et al. 2009), la misma de multi-rag-energy-ar.
K_RRF = 60
# Cuántos candidatos aporta cada lista a la fusión. Con 10 quedaban afuera documentos
# que una sola de las dos listas encontraba bien.
PROFUNDIDAD = 50
# Umbral para usar Postgres full-text en vez de BM25 en memoria. Con <10k chunks
# el índice en memoria es más rápido (no hay roundtrip a la DB).
POSTGRES_FTS_THRESHOLD = int(os.getenv("ALGEDI_FTS_THRESHOLD", "10000"))

# Palabras vacías comunes en español e inglés: no distinguen nada y en BM25 sólo meten ruido.
STOP = set("""a al algo algunas algunos ante antes como con contra cual cuando de del desde donde dos el
ella ellas ellos en entre era es esa esas ese eso esos esta estas este esto estos fue ha hay la las le les
lo los mas me mi mismo muy no nos o otra otro para pero por porque que quien se sea ser si sin sobre son su
sus tambien tan te tiene tienen todo todos tu un una uno unos y ya the of and to in is for on with as by an
be are this that from or at it its can which""".split())
TOKEN = re.compile(r"[0-9a-zñü]+")


def plano(t: str) -> str:
    """Minúsculas y sin acentos, salvo ñ y ü (cambian la palabra: «año» no es «ano»)."""
    t = (t or "").casefold().replace("ñ", "\0").replace("ü", "\1")
    t = "".join(c for c in unicodedata.normalize("NFKD", t) if not unicodedata.combining(c))
    return t.replace("\0", "ñ").replace("\1", "ü")


def terminos(t: str) -> list[str]:
    return [w for w in TOKEN.findall(plano(t)) if w not in STOP and len(w) > 1]


class BM25:
    """BM25 clásico (k1=1.2, b=0.75, idf de Lucene). Sin dependencias."""

    def __init__(self, textos: list[str], k1: float = 1.2, b: float = 0.75):
        self.k1, self.b = k1, b
        tf = [Counter(terminos(t)) for t in textos]
        self.largo = [sum(c.values()) for c in tf]
        self.prom = sum(self.largo) / max(1, len(self.largo))
        df = Counter(w for c in tf for w in c)
        n = len(textos)
        self.idf = {w: math.log(1 + (n - f + 0.5) / (f + 0.5)) for w, f in df.items()}
        self.post = defaultdict(list)
        for i, c in enumerate(tf):
            for w, f in c.items():
                self.post[w].append((i, f))

    def puntuar(self, consulta: str) -> dict[int, float]:
        s = defaultdict(float)
        for w in set(terminos(consulta)):
            idf = self.idf.get(w)
            if not idf:
                continue
            for i, f in self.post[w]:
                s[i] += idf * f * (self.k1 + 1) / (
                    f + self.k1 * (1 - self.b + self.b * self.largo[i] / self.prom))
        return s


def rrf(*rankings, k: int = K_RRF, pesos=None) -> list:
    """Fusiona listas ordenadas (de ids) por puesto: peso/(k + puesto)."""
    pesos = pesos or [1.0] * len(rankings)
    s = defaultdict(float)
    for r, w in zip(rankings, pesos):
        for pos, x in enumerate(r):
            s[x] += w / (k + pos + 1)
    return sorted(s, key=lambda x: -s[x])


class IndiceLexico:
    """BM25 sobre los fragmentos de la biblioteca («título del documento + fragmento»)."""

    def __init__(self, filas):
        # filas: (id_fragmento, id_documento, título, contenido)
        self.ids = [f[0] for f in filas]
        self.nodos = [f[1] for f in filas]
        self.bm25 = BM25([f"{f[2] or ''}\n{f[3] or ''}" for f in filas])

    def buscar(self, consulta: str, n: int = PROFUNDIDAD) -> list[tuple[str, str, float]]:
        p = self.bm25.puntuar(consulta)
        top = sorted(p, key=lambda i: -p[i])[:n]
        return [(self.ids[i], self.nodos[i], p[i]) for i in top]


# El índice vive en memoria y se rehace solo cuando cambian los fragmentos: la firma
# (cantidad + suma de hashes de los ids) cambia con cualquier alta o baja.
_indice: tuple | None = None
_lock = threading.Lock()


def indice_vigente(firma) -> IndiceLexico | None:
    actual = _indice
    return actual[1] if actual and actual[0] == firma else None


def construir_indice(firma, filas) -> IndiceLexico:
    global _indice
    idx = IndiceLexico(filas)
    with _lock:
        _indice = (firma, idx)
    return idx


# ── Postgres Full-Text Search (escalable) ────────────────────────────────────

def buscar_postgres_fts(consulta: str, n: int = PROFUNDIDAD) -> list[tuple[str, str, float]] | None:
    """Búsqueda léxica vía Postgres tsvector+GIN (spanish config).
    
    Devuelve [(chunk_id, node_id, rank)] ordenados por relevancia, o None si no hay
    índice tsvector (la tabla no tiene la columna o está vacía).
    
    Usa ts_rank con normalización 32 (divide por longitud del documento) y plainto_tsquery
    que tokeniza la consulta igual que el contenido.
    """
    try:
        from database.connection import get_sync_session
        from sqlalchemy import text
        
        with get_sync_session() as session:
            # Verificar que hay chunks con tsvector
            check = session.execute(text(
                "SELECT EXISTS (SELECT 1 FROM chunks WHERE tsv IS NOT NULL LIMIT 1)"
            )).scalar()
            if not check:
                return None
            
            # Buscar con ts_rank
            query = text("""
                SELECT c.id, d.node_id, ts_rank(c.tsv, plainto_tsquery('spanish', :q), 32) as rank
                FROM chunks c
                JOIN documents d ON c.document_id = d.id
                WHERE c.tsv @@ plainto_tsquery('spanish', :q)
                ORDER BY rank DESC
                LIMIT :n
            """)
            rows = session.execute(query, {"q": consulta, "n": n}).fetchall()
            return [(r[0], r[1], float(r[2])) for r in rows]
    except Exception as e:
        print(f"[busqueda] Postgres FTS failed, falling back to BM25: {e}")
        return None


def buscar_hibrido_postgres(consulta: str, vec_results: list, n: int = PROFUNDIDAD) -> list[str]:
    """Fusiona resultados de vector search con Postgres FTS via RRF.
    
    `vec_results` es [(chunk_id, node_id, sim)] de la búsqueda vectorial.
    Devuelve lista de chunk_ids ordenados por relevancia fusionada.
    """
    fts_results = buscar_postgres_fts(consulta, n)
    if fts_results is None:
        # Sin FTS, solo usar vectores
        return [r[0] for r in vec_results[:n]]
    
    # RRF: fusionar por puesto
    vec_ids = [r[0] for r in vec_results]
    fts_ids = [r[0] for r in fts_results]
    return rrf(vec_ids, fts_ids)[:n]
