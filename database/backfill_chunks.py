"""Genera chunks para documentos existentes sin llamar al LLM ni alterar el grafo."""
from __future__ import annotations

import hashlib
from pathlib import Path

from database.connection import get_sync_session
from database.models import Chunk, Document, Node
from processor import (crear_chunks, crear_chunks_paginas, extraer_paginas_pdf,
                       get_embed_model, _extraer_texto_html, _extraer_texto_office)

BASE = Path(__file__).parents[1].resolve()
UPLOADS = BASE / "uploads"


def _resolve_source(raw_path: str | None) -> Path | None:
    raw = (raw_path or "").replace("\\", "/")
    if not raw:
        return None
    path = Path(raw)
    candidates = [path]
    if not path.is_absolute():
        candidates.append(BASE / path)
    candidates.append(UPLOADS / path.name)
    for candidate in candidates:
        try:
            resolved = candidate.resolve()
            resolved.relative_to(BASE)
        except (OSError, ValueError):
            continue
        if resolved.exists() and resolved.is_file():
            return resolved
    return None


def _excel_text(path: Path, max_rows: int = 500) -> str:
    try:
        import openpyxl
        workbook = openpyxl.load_workbook(str(path), read_only=True, data_only=True)
        sheet = workbook.active
        rows = []
        for index, row in enumerate(sheet.iter_rows(values_only=True)):
            text = " | ".join(str(cell) for cell in row if cell is not None)
            if text.strip():
                rows.append(text)
            if index + 1 >= max_rows:
                break
        workbook.close()
        return "\n".join(rows)
    except Exception as exc:
        print(f"[chunks] no se pudo leer Excel {path.name}: {exc}")
        return ""


def build_chunks_for_node(node: Node) -> list[dict]:
    if node.transcript:
        return crear_chunks(node.transcript)
    path = _resolve_source(node.fuente_path)
    if path is None:
        return []
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return crear_chunks_paginas(extraer_paginas_pdf(path))
    if suffix == ".docx":
        return crear_chunks(_extraer_texto_office(path, ["word/document.xml"]))
    if suffix in (".pptx", ".pptm"):
        return crear_chunks(_extraer_texto_office(path, ["ppt/slides/"]))
    if suffix in (".xlsx", ".xls"):
        return crear_chunks(_excel_text(path))
    if suffix in (".html", ".htm"):
        html = path.read_text(encoding="utf-8", errors="ignore")
        return crear_chunks(_extraer_texto_html(html))
    if suffix in (".txt", ".md"):
        return crear_chunks(path.read_text(encoding="utf-8", errors="ignore"))
    return []


def main():
    model = None
    created = 0
    covered = 0
    skipped = 0
    with get_sync_session() as session:
        nodes = session.query(Node).filter(
            Node.is_centroid == False,
            Node.is_issue == False,
        ).all()
        for node in nodes:
            document = session.query(Document).filter(Document.node_id == node.id).first()
            if document is None:
                skipped += 1
                continue
            if session.query(Chunk).filter(Chunk.document_id == document.id).count() > 0:
                covered += 1
                continue
            chunks = build_chunks_for_node(node)
            if not chunks:
                skipped += 1
                continue
            if model is None:
                model = get_embed_model()
            vectors = model.encode(
                [chunk["content"] for chunk in chunks], batch_size=32, show_progress_bar=False
            )
            for index, (chunk, vector) in enumerate(zip(chunks, vectors)):
                ordinal = int(chunk.get("ordinal", index))
                fingerprint = hashlib.sha256(
                    f"{document.id}:{ordinal}:{chunk['content']}".encode("utf-8")
                ).hexdigest()
                session.add(Chunk(
                    id=f"chk_{fingerprint[:24]}",
                    document_id=document.id,
                    ordinal=ordinal,
                    content=chunk["content"],
                    page=chunk.get("page"),
                    char_start=chunk.get("char_start"),
                    char_end=chunk.get("char_end"),
                    embedding=vector.tolist(),
                    chunk_metadata={"node_id": node.id, "backfilled": True},
                ))
            session.commit()
            created += len(chunks)
            covered += 1
            print(f"[chunks] {node.label}: {len(chunks)} pasajes")
    print(f"[chunks] finalizado: {created} creados, {covered} documentos cubiertos, "
          f"{skipped} sin texto local disponible")


if __name__ == "__main__":
    main()
