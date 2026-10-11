"""Decisiones tipadas, al estilo de un «modelo de decisión» (como JEV de TypeSafe).

No genera texto: dada una situación y una lista CERRADA de opciones devuelve cuál
elige, con una probabilidad por opción, o se abstiene para que se pregunte en vez de
adivinar. La respuesta siempre es una de las opciones válidas (o ninguna).

Este es el decisor LOCAL: similitud e5 entre la situación y cada opción —su
descripción y sus ejemplos—, convertida en probabilidades con un softmax. Es la línea
de base medida en eval/evaluar_jev.py. Otro decisor (JEV por API, Laya) se enchufa con
la misma firma y se compara con las mismas preguntas.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

# e5 junta los cosenos entre ~0.75 y ~0.95: con 0.02, una ventaja de 0.05 de coseno es
# ~12 veces más probabilidad. Medido en eval/evaluar_jev.py.
TEMPERATURA = 0.02
# Para elegir hace falta ser la opción más probable con claridad; si no, se pregunta.
PROB_MINIMA = 0.45
MARGEN_MINIMO = 0.15


@dataclass
class Opcion:
    clave: str
    texto: str                                   # qué es (se compara como pasaje)
    ejemplos: list[str] = field(default_factory=list)   # pedidos típicos (como consultas)
    sesgo: float = 0.0                           # ajuste en unidades de coseno (señales del contexto)
    etiqueta: str = ""


@dataclass
class Decision:
    eleccion: str | None
    probabilidades: dict[str, float]
    motivo: str
    decisor: str = "local-e5"
    puntajes: dict[str, float] = field(default_factory=dict)

    @property
    def confianza(self) -> float:
        return max(self.probabilidades.values(), default=0.0)

    def ranking(self, n: int = 3) -> list[tuple[str, float]]:
        return sorted(self.probabilidades.items(), key=lambda kv: -kv[1])[:n]

    def a_dict(self, etiquetas: dict[str, str] | None = None, n: int = 4) -> dict:
        etiquetas = etiquetas or {}
        return {
            "eleccion": self.eleccion, "motivo": self.motivo, "decisor": self.decisor,
            "opciones": [{"clave": k, "etiqueta": etiquetas.get(k, k), "probabilidad": round(p, 3)}
                         for k, p in self.ranking(n)],
        }


_VECTORES: dict[tuple[str, str], np.ndarray] = {}
_TOPE_CACHE = 5000


def vectores(textos: list[str], rol: str) -> list[np.ndarray]:
    """Vectores e5 con caché: las fichas y los ejemplos se repiten en cada pedido."""
    from processor import embed_consultas, embed_pasajes
    faltan = list(dict.fromkeys(t for t in textos if (rol, t) not in _VECTORES))
    if faltan:
        if len(_VECTORES) > _TOPE_CACHE:
            _VECTORES.clear()
        nuevos = embed_consultas(faltan) if rol == "consulta" else embed_pasajes(faltan)
        for t, v in zip(faltan, nuevos):
            _VECTORES[(rol, t)] = np.asarray(v, dtype=np.float32)
    return [_VECTORES[(rol, t)] for t in textos]


def puntajes(estado: str, opciones: list[Opcion]) -> dict[str, float]:
    """Coseno de la situación con lo más parecido de cada opción (descripción o
    alguno de sus ejemplos), más el sesgo de la opción."""
    q = vectores([estado], "consulta")[0]
    salida = {}
    for op in opciones:
        mejor = float(vectores([op.texto], "pasaje")[0] @ q) if op.texto else -1.0
        if op.ejemplos:
            mejor = max([mejor] + [float(v @ q) for v in vectores(op.ejemplos, "consulta")])
        salida[op.clave] = mejor + op.sesgo
    return salida


def softmax(valores: dict[str, float], temperatura: float = TEMPERATURA) -> dict[str, float]:
    if not valores:
        return {}
    tope = max(valores.values())
    exp = {k: math.exp((v - tope) / temperatura) for k, v in valores.items()}
    total = sum(exp.values())
    return {k: e / total for k, e in exp.items()}


def decidir(valores: dict[str, float], *, temperatura: float = TEMPERATURA,
            prob_minima: float = PROB_MINIMA, margen_minimo: float = MARGEN_MINIMO,
            piso: float | None = None) -> Decision:
    """Elige sobre puntajes ya calculados. `piso`: puntaje mínimo absoluto de la mejor
    opción (con una sola opción la probabilidad relativa no dice nada)."""
    if not valores:
        return Decision(None, {}, "no hay opciones")
    p = softmax(valores, temperatura)
    orden = sorted(p, key=p.get, reverse=True)
    mejor = orden[0]
    segunda = p[orden[1]] if len(orden) > 1 else 0.0
    if piso is not None and valores[mejor] < piso:
        return Decision(None, p, "ninguna opción se parece lo suficiente", puntajes=valores)
    if p[mejor] < prob_minima or p[mejor] - segunda < margen_minimo:
        return Decision(None, p, "dos o más opciones quedan parejas", puntajes=valores)
    return Decision(mejor, p, "la más parecida, con claridad", puntajes=valores)


def elegir(estado: str, opciones: list[Opcion], **kw) -> Decision:
    """Choice: una opción de la lista (o ninguna, si hay duda)."""
    return decidir(puntajes(estado, opciones), **kw)
