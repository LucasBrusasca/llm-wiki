"""Papelera: sacar un documento del grafo sin perderlo.

Mandarlo a la papelera lo saca de todas las tablas vivas —grafo, biblioteca, búsqueda,
agente— y guarda una copia exacta de lo que colgaba de él: sus aristas, notas,
documento y pasajes (con sus embeddings) y una copia de sus fuentes. Una fuente se
borra de las vivas sólo si ya ningún documento la usa. Restaurar vuelve a poner todo
tal cual, sin recalcular nada.

Sólo «eliminar definitivamente» borra la copia, y eso pide la clave de administrador
(main.py). Acá no se toca el disco: `eliminar` dice qué archivo quedó sin dueño y el que
llama decide (los del vault, carpeta del usuario, nunca se borran).

Todo recibe una sesión sync de SQLAlchemy y no hace commit: la transacción la maneja
el que llama (main.py en un thread; los tests, contra una base descartable).
"""
from __future__ import annotations

import base64
from datetime import datetime

import numpy as np
from sqlalchemy import DateTime, delete, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from database.models import (Chunk, Document, Edge, IngestJob, Node, Papelera,
                             ScriptRun, Section, Source, UserNote)

VERSION = 1


class Conflicto(Exception):
    """Restaurar pisaría un nodo vivo con el mismo id (p. ej. se volvió a ingerir)."""


# ── Copia exacta de una fila ──────────────────────────────────────────────────

def _es_vector(col) -> bool:
    try:
        from pgvector.sqlalchemy import Vector
    except ImportError:
        return False
    return isinstance(col.type, Vector)


def a_json(fila) -> dict:
    """Una fila ORM como dict serializable, sin perder nada: los vectores van como
    float32 en base64 (exacto: pgvector guarda float4) y las fechas en ISO."""
    salida = {}
    for col in fila.__table__.columns:
        valor = getattr(fila, col.key)
        if valor is not None and _es_vector(col):
            valor = base64.b64encode(np.asarray(valor, dtype=np.float32).tobytes()).decode("ascii")
        elif isinstance(valor, datetime):
            valor = valor.isoformat()
        salida[col.key] = valor
    return salida


def de_json(modelo, datos: dict, *, sin: tuple = ()) -> dict:
    """La inversa de a_json: los valores listos para insertar en `modelo`."""
    salida = {}
    for col in modelo.__table__.columns:
        if col.key not in datos or col.key in sin:
            continue
        valor = datos[col.key]
        if isinstance(valor, str) and _es_vector(col):
            valor = np.frombuffer(base64.b64decode(valor), dtype=np.float32).tolist()
        elif isinstance(valor, str) and isinstance(col.type, DateTime):
            valor = datetime.fromisoformat(valor)
        salida[col.key] = valor
    return salida


# ── Mandar a la papelera ──────────────────────────────────────────────────────

def contar(session, ids: list[str]) -> dict:
    """Lo que se va con estos nodos, para mostrarlo antes de confirmar."""
    vivos = session.scalars(select(Node.id).where(Node.id.in_(list(dict.fromkeys(ids))))).all()
    if not vivos:
        return {"documentos": 0, "aristas": 0, "notas": 0, "pasajes": 0, "corridas": 0}
    cuenta = lambda consulta: session.scalar(consulta) or 0  # noqa: E731
    return {
        "documentos": len(vivos),
        "aristas": cuenta(select(func.count()).select_from(Edge).where(
            or_(Edge.source.in_(vivos), Edge.target.in_(vivos)))),
        "notas": cuenta(select(func.count()).select_from(UserNote).where(UserNote.node_id.in_(vivos))),
        "pasajes": cuenta(select(func.count()).select_from(Chunk)
                          .join(Document, Document.id == Chunk.document_id)
                          .where(Document.node_id.in_(vivos))),
        "corridas": cuenta(select(func.count()).select_from(ScriptRun).where(ScriptRun.node_id.in_(vivos))),
    }


def mover(session, ids: list[str]) -> list[int]:
    """Manda cada nodo a la papelera (una fila por nodo). Los que no existen se
    ignoran. Devuelve los ids de papelera creados."""
    creados = []
    for node_id in dict.fromkeys(ids):
        nodo = session.get(Node, node_id)
        if nodo is None:
            continue
        aristas = session.scalars(select(Edge).where(
            or_(Edge.source == node_id, Edge.target == node_id))).all()
        notas = session.scalars(select(UserNote).where(UserNote.node_id == node_id)).all()
        documentos = session.scalars(select(Document).where(Document.node_id == node_id)).all()
        doc_ids = [d.id for d in documentos]
        pasajes = session.scalars(
            select(Chunk).where(Chunk.document_id.in_(doc_ids)).order_by(Chunk.document_id, Chunk.ordinal)
        ).all() if doc_ids else []
        src_ids = sorted({d.source_id for d in documentos})
        fuentes = session.scalars(select(Source).where(Source.id.in_(src_ids))).all() if src_ids else []
        corridas = session.scalars(select(ScriptRun.id).where(ScriptRun.node_id == node_id)).all()
        jobs = session.scalars(select(IngestJob.id).where(IngestJob.node_id == node_id)).all()

        item = Papelera(
            node_id=node_id, label=nodo.label, tipo=nodo.type, dominio=nodo.dominio,
            fuente=nodo.fuente, fuente_label=nodo.fuente_label, fuente_path=nodo.fuente_path,
            resumen={"aristas": len(aristas), "notas": len(notas),
                     "pasajes": len(pasajes), "corridas": len(corridas)},
            contenido={
                "version": VERSION,
                "nodo": a_json(nodo),
                "aristas": [a_json(a) for a in aristas],
                "notas": [a_json(n) for n in notas],
                "documentos": [a_json(d) for d in documentos],
                "pasajes": [a_json(p) for p in pasajes],
                "fuentes": [a_json(f) for f in fuentes],
                "corridas": list(corridas),
                "jobs": list(jobs),
            },
        )
        session.add(item)
        # Documentos (sus pasajes caen en cascada) y el nodo (aristas y notas en
        # cascada; corridas y jobs quedan con node_id NULL hasta que vuelva).
        if doc_ids:
            session.execute(delete(Document).where(Document.id.in_(doc_ids)))
        session.execute(delete(Node).where(Node.id == node_id))
        if src_ids:
            usadas = set(session.scalars(
                select(Document.source_id).where(Document.source_id.in_(src_ids))).all())
            libres = [s for s in src_ids if s not in usadas]
            if libres:
                session.execute(delete(Source).where(Source.id.in_(libres)))
        session.flush()
        creados.append(item.id)
    return creados


# ── Restaurar ─────────────────────────────────────────────────────────────────

def restaurar(session, papelera_id: int) -> dict:
    """Vuelve a poner el nodo y todo lo suyo. Una arista hacia otro nodo que también
    está en la papelera pasa a la copia de ese otro: vuelve cuando vuelva él."""
    item = session.get(Papelera, papelera_id)
    if item is None:
        raise LookupError("Ese documento ya no está en la papelera.")
    node_id, c = item.node_id, item.contenido
    if session.get(Node, node_id) is not None:
        raise Conflicto(f"«{item.label}» ya está de nuevo en el grafo (se volvió a ingerir): "
                        "no hace falta restaurarlo.")

    for f in c.get("fuentes", []):   # si sigue viva, gana la viva (vigencia más nueva)
        session.execute(pg_insert(Source).values(**de_json(Source, f))
                        .on_conflict_do_nothing(index_elements=["id"]))
    session.execute(pg_insert(Node).values(**de_json(Node, c["nodo"])))
    if item.dominio:
        session.execute(pg_insert(Section).values(nombre=item.dominio)
                        .on_conflict_do_nothing(index_elements=["nombre"]))
    for d in c.get("documentos", []):
        session.execute(pg_insert(Document).values(**de_json(Document, d))
                        .on_conflict_do_nothing(index_elements=["id"]))
    pasajes = [de_json(Chunk, p) for p in c.get("pasajes", [])]
    if pasajes:
        session.execute(pg_insert(Chunk).values(pasajes).on_conflict_do_nothing(index_elements=["id"]))
    for n in c.get("notas", []):
        session.add(UserNote(**de_json(UserNote, n, sin=("id",))))

    aristas = {"restauradas": 0, "esperan": 0, "perdidas": 0}
    for a in c.get("aristas", []):
        otro = a["target"] if a["source"] == node_id else a["source"]
        if otro == node_id or session.get(Node, otro) is not None:
            res = session.execute(pg_insert(Edge).values(**de_json(Edge, a, sin=("id",)))
                                  .on_conflict_do_nothing())
            aristas["restauradas"] += res.rowcount or 0
            continue
        duenio = session.scalars(select(Papelera).where(
            Papelera.node_id == otro, Papelera.id != item.id
        ).order_by(Papelera.eliminado_at.desc(), Papelera.id.desc())).first()
        if duenio is None:   # el otro extremo se eliminó definitivamente
            aristas["perdidas"] += 1
            continue
        resto = dict(duenio.contenido)
        resto["aristas"] = list(resto.get("aristas", [])) + [a]
        duenio.contenido = resto
        aristas["esperan"] += 1

    if c.get("corridas"):
        session.execute(update(ScriptRun).where(ScriptRun.id.in_(c["corridas"]), ScriptRun.node_id.is_(None))
                        .values(node_id=node_id))
    if c.get("jobs"):
        session.execute(update(IngestJob).where(IngestJob.id.in_(c["jobs"]), IngestJob.node_id.is_(None))
                        .values(node_id=node_id))
    dominio, label = item.dominio, item.label
    session.delete(item)
    session.flush()
    return {"node_id": node_id, "label": label, "dominio": dominio, "aristas": aristas}


# ── Eliminar definitivamente ──────────────────────────────────────────────────

def eliminar(session, papelera_id: int) -> dict:
    """Borra la copia para siempre. Devuelve qué quedó sin dueño en el disco: el
    archivo (si ningún nodo vivo ni otra copia lo usa) y si la miniatura se puede
    borrar (si no hay un nodo vivo con ese id). El que llama los borra tras el commit."""
    item = session.get(Papelera, papelera_id)
    if item is None:
        raise LookupError("Ese documento ya no está en la papelera.")
    node_id, ruta = item.node_id, item.fuente_path
    session.delete(item)
    session.flush()
    archivo = None
    if ruta:
        en_uso = (session.scalar(select(func.count()).select_from(Node).where(Node.fuente_path == ruta))
                  or session.scalar(select(func.count()).select_from(Papelera).where(Papelera.fuente_path == ruta)))
        archivo = None if en_uso else ruta
    miniatura = session.get(Node, node_id) is None
    return {"node_id": node_id, "archivo": archivo, "miniatura": miniatura}


def vaciar(session) -> list[dict]:
    """Elimina definitivamente todo lo que hay en la papelera."""
    return [eliminar(session, i) for i in session.scalars(select(Papelera.id)).all()]
