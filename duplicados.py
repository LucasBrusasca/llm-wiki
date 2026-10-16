"""Posibles duplicados de la biblioteca, para revisarlos a mano (nada se borra solo).

Grupos «seguros» (es la misma fuente): el mismo video de YouTube, los mismos bytes de
archivo aunque cambie el nombre, la misma página aunque la URL esté escrita distinto.
Grupos «probables»: contenido casi idéntico (los vectores del documento casi iguales) o
el mismo título y el mismo tipo de fuente. Lógica pura: main.py junta los datos.
"""
from __future__ import annotations

import hashlib
import re
import unicodedata

UMBRAL_CONTENIDO = 0.985


def _titulo_normalizado(label: str) -> str:
    t = unicodedata.normalize("NFKD", (label or "").lower()).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", " ", t).strip()


class _Conjuntos:
    def __init__(self, ids):
        self.padre = {i: i for i in ids}

    def raiz(self, a):
        while self.padre[a] != a:
            self.padre[a] = self.padre[self.padre[a]]
            a = self.padre[a]
        return a

    def unir(self, a, b):
        ra, rb = self.raiz(a), self.raiz(b)
        if ra != rb:
            self.padre[rb] = ra


def clave_grupo(ids) -> str:
    """Huella de un grupo, para recordar «no son duplicados» aunque cambie el orden."""
    return hashlib.sha256("|".join(sorted(ids)).encode()).hexdigest()[:16]


def agrupar(nodos: list[dict], *, pares_contenido: list[tuple[str, str, float]] = (),
            descartados: set[str] = frozenset()) -> list[dict]:
    """`nodos`: [{id, label, fuente, video, hash, url, ...}] (video/hash/url pueden faltar).
    `pares_contenido`: pares (a, b, coseno) de documentos casi idénticos.
    Devuelve [{clave, fuerza, motivo, ids}] sin los grupos que la persona ya descartó."""
    ids = [n["id"] for n in nodos]
    seguros = _Conjuntos(ids)
    motivos: dict[str, set[str]] = {}
    for campo, motivo in (("video", "el mismo video"), ("hash", "el mismo archivo"), ("url", "la misma página")):
        primero: dict[str, str] = {}
        for n in nodos:
            v = n.get(campo)
            if not v:
                continue
            if v in primero:
                seguros.unir(primero[v], n["id"])
                motivos.setdefault(n["id"], set()).add(motivo)
                motivos.setdefault(primero[v], set()).add(motivo)
            else:
                primero[v] = n["id"]

    grupos: dict[str, list[str]] = {}
    for i in ids:
        grupos.setdefault(seguros.raiz(i), []).append(i)
    salida = []
    en_seguro = set()
    for miembros in grupos.values():
        if len(miembros) > 1:
            en_seguro.update(miembros)
            razones = sorted(set().union(*(motivos.get(m, set()) for m in miembros)))
            salida.append({"fuerza": "seguro", "motivo": " y ".join(razones), "ids": sorted(miembros)})

    # Probables: no repiten lo que ya está en un grupo seguro.
    probables = _Conjuntos(ids)
    razon_prob: dict[str, set[str]] = {}
    for a, b, cos in pares_contenido:
        if cos >= UMBRAL_CONTENIDO and not (a in en_seguro and b in en_seguro and seguros.raiz(a) == seguros.raiz(b)):
            probables.unir(a, b)
            for x in (a, b):
                razon_prob.setdefault(x, set()).add("contenido casi igual")
    por_titulo: dict[tuple, str] = {}
    for n in nodos:
        k = (_titulo_normalizado(n.get("label")), (n.get("fuente") or "").lower())
        if not k[0] or len(k[0]) < 6:
            continue
        if k in por_titulo and not (n["id"] in en_seguro and seguros.raiz(n["id"]) == seguros.raiz(por_titulo[k])):
            probables.unir(por_titulo[k], n["id"])
            for x in (por_titulo[k], n["id"]):
                razon_prob.setdefault(x, set()).add("el mismo título")
        else:
            por_titulo.setdefault(k, n["id"])
    grupos_p: dict[str, list[str]] = {}
    for i in ids:
        grupos_p.setdefault(probables.raiz(i), []).append(i)
    for miembros in grupos_p.values():
        if len(miembros) > 1:
            razones = sorted(set().union(*(razon_prob.get(m, set()) for m in miembros)))
            salida.append({"fuerza": "probable", "motivo": " y ".join(razones), "ids": sorted(miembros)})

    for g in salida:
        g["clave"] = clave_grupo(g["ids"])
    orden = {"seguro": 0, "probable": 1}
    return sorted((g for g in salida if g["clave"] not in descartados),
                  key=lambda g: (orden[g["fuerza"]], -len(g["ids"]), g["motivo"]))


def sugerido(nodos: list[dict]) -> str:
    """Cuál conviene conservar: el más conectado (es el que está integrado al grafo); a
    igualdad, el que entró primero. No «el más nuevo»: el 23/08 se reingirieron 22 papers
    cuyo LLM sólo vio el final del texto y salieron con títulos absurdos («List of Nobel
    laureates in Physics» para «Lost in the Middle»). Es sólo una sugerencia; el resumen
    del que quede se puede mejorar con «Reprocesar»."""
    return min(nodos, key=lambda n: (-(n.get("relaciones") or 0), n.get("created_at") or "9999"))["id"]
