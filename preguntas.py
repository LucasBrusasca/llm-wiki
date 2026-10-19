"""Nodo «Pregunta»: RAG como nodo del grafo.

Una pregunta guardada con la evidencia que la responde (fragmentos de tus documentos,
con su página), un semáforo de suficiencia y, sólo si se pide, la respuesta redactada
por el LLM citando esa evidencia. Se vuelve a correr a mano; la UI avisa cuando entraron
documentos nuevos al alcance desde la última vez.

Decisiones (Lucas, 2026-10-15): la evidencia sale en segundos y la redacción es a
pedido (el LLM local tarda minutos); busca en la sección actual con opción «todas»;
se actualiza a mano con aviso.

Lógica pura (sin base ni FastAPI) para poder testearla sola; main.py busca y guarda.
"""
from __future__ import annotations

import hashlib
import re
import unicodedata

TODAS = "*"
MAX_PASAJES = 8
CARACTERES_PASAJE = 1400

SIN_FUENTE = "No encontré una fuente que respalde esto. Eso no prueba que no exista."


def id_pregunta(pregunta: str, alcance: str) -> str:
    """Id estable que sale del texto (nunca del LLM): la misma pregunta con el mismo
    alcance es el mismo nodo."""
    plano = unicodedata.normalize("NFKD", pregunta.lower()).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "_", plano).strip("_")[:40] or "pregunta"
    huella = hashlib.sha256(f"{' '.join(pregunta.lower().split())}|{alcance}".encode()).hexdigest()[:6]
    return f"pregunta_{slug}_{huella}"


def semaforo(pasajes: list[dict], cita: float, veto: float) -> dict:
    """Si la evidencia alcanza. `sim` de cada pasaje es su parecido con la pregunta;
    `cita` es el piso para citar un pasaje y `veto` el piso por debajo del cual nada
    responde (los dos calibrados para el modelo de embeddings).

    - verde: dos o más pasajes citables;
    - amarillo: uno solo citable, o pasajes cercanos pero sin llegar a citables;
    - rojo: nada se acerca lo suficiente.

    El motivo se escribe sin porcentajes que confundan (antes el agente decía «86 %,
    debajo del 86 %» por el redondeo)."""
    fuertes = [p for p in pasajes if p["sim"] >= cita]
    docs_fuertes = {p["node_id"] for p in fuertes}
    mejor = max((p["sim"] for p in pasajes), default=0.0)
    if len(fuertes) >= 2:
        motivo = (f"{len(fuertes)} fragmentos de {len(docs_fuertes)} "
                  f"{'documento' if len(docs_fuertes) == 1 else 'documentos'} responden directamente.")
        return {"color": "verde", "motivo": motivo, "citables": len(fuertes)}
    if fuertes:
        return {"color": "amarillo", "citables": 1,
                "motivo": "Un solo fragmento responde directamente: la evidencia es parcial."}
    if mejor >= (cita + veto) / 2:
        return {"color": "amarillo", "citables": 0,
                "motivo": "Hay fragmentos sobre el tema, pero ninguno responde directamente."}
    return {"color": "rojo", "citables": 0, "motivo": SIN_FUENTE}


def armar_prompt(pregunta: str, pasajes: list[dict], cita: float) -> str:
    """Pedido al LLM: responder SÓLO con los pasajes numerados, citando [n], y decir qué
    falta si no alcanzan. Van primero los citables."""
    usables = [p for p in pasajes if p["sim"] >= cita] or pasajes[:3]
    bloques = []
    for i, p in enumerate(usables, start=1):
        pagina = f", pág. {p['page']}" if p.get("page") else ""
        bloques.append(f"[{i}] «{p['label']}»{pagina}:\n{p['texto'][:CARACTERES_PASAJE]}")
    return (
        "Respondé la pregunta usando SÓLO los fragmentos numerados de abajo, en castellano, "
        "claro y completo, en uno a tres párrafos. Después de cada afirmación poné entre "
        "corchetes el número del fragmento que la respalda, por ejemplo [2]. Si los "
        "fragmentos no alcanzan para responder algo, decilo explícitamente en una oración "
        "final que empiece con «Falta:». No agregues conocimiento que no esté en los "
        "fragmentos.\n\n"
        f"PREGUNTA: {pregunta}\n\nFRAGMENTOS:\n\n" + "\n\n".join(bloques)
    ), usables


def citas_usadas(texto: str, n: int) -> list[int]:
    """Los números [n] que la respuesta cita y existen (de 1 a n)."""
    vistos = []
    for m in re.finditer(r"\[(\d{1,2})\]", texto or ""):
        k = int(m.group(1))
        if 1 <= k <= n and k not in vistos:
            vistos.append(k)
    return vistos


def cambio_de_evidencia(antes: list[dict], ahora: list[dict]) -> dict:
    """Qué fragmentos entraron y cuáles salieron al volver a correrla."""
    a = {p["chunk_id"] for p in antes}
    b = {p["chunk_id"] for p in ahora}
    return {"entraron": len(b - a), "salieron": len(a - b), "cambio": a != b}


def descripcion(pregunta: str, sem: dict, pasajes: list[dict], alcance_label: str) -> str:
    docs = list(dict.fromkeys(p["label"] for p in pasajes if p["sim"]))[:3]
    fuentes = f" Se apoya en: {'; '.join(docs)}." if docs else ""
    return f"Pregunta {alcance_label}. Evidencia {sem['color']}: {sem['motivo']}{fuentes}"
