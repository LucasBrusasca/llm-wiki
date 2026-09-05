import asyncio
import hashlib
from sqlalchemy import text
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from database.connection import AsyncSessionLocal, async_engine
from database.models import Base, Document, Node, Source


async def _backfill_traceability():
    """Crea Source/Document para nodos existentes sin alterar nodos ni aristas."""
    async with AsyncSessionLocal() as session:
        nodes = (await session.execute(select(Node))).scalars().all()
        for node in nodes:
            locator = node.fuente_url or node.fuente_path or f"node:{node.id}"
            source_id = f"src_{hashlib.sha256(locator.encode('utf-8')).hexdigest()[:24]}"
            source_values = {
                "id": source_id,
                "kind": node.fuente or "unknown",
                "locator": locator,
                "original_name": node.fuente_label,
                "content_hash": None,
                "source_metadata": {
                    "autor": node.autor,
                    "fecha_doc": node.fecha_doc,
                    "dominio": node.dominio or "personal",
                },
            }
            await session.execute(
                pg_insert(Source).values(**source_values)
                .on_conflict_do_update(
                    index_elements=["id"],
                    set_={k: v for k, v in source_values.items()
                          if k not in ("id", "content_hash")},
                )
            )
            processed_text = "\n".join([
                node.label or "", node.desc or "", node.fragmento or "",
                " | ".join(node.conceptos or []),
            ])
            document_id = f"doc_{hashlib.sha256(node.id.encode('utf-8')).hexdigest()[:24]}"
            document_values = {
                "id": document_id,
                "source_id": source_id,
                "node_id": node.id,
                "parser": node.fuente or "unknown",
                "parser_version": "legacy-node-v1",
                "content_hash": hashlib.sha256(processed_text.encode("utf-8")).hexdigest(),
            }
            await session.execute(
                pg_insert(Document).values(**document_values)
                .on_conflict_do_nothing(index_elements=["id"])
            )
        await session.commit()

async def init_db():
    async with async_engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.run_sync(Base.metadata.create_all)
        # Migración idempotente: columna para la ruta del archivo original ingerido.
        # (create_all no altera tablas ya existentes.)
        await conn.execute(text(
            "ALTER TABLE nodes ADD COLUMN IF NOT EXISTS fuente_path VARCHAR"
        ))
        await conn.execute(text(
            "ALTER TABLE nodes ADD COLUMN IF NOT EXISTS transcript TEXT"
        ))
        await conn.execute(text(
            "ALTER TABLE nodes ADD COLUMN IF NOT EXISTS autor VARCHAR"
        ))
        await conn.execute(text(
            "ALTER TABLE nodes ADD COLUMN IF NOT EXISTS fecha_doc VARCHAR"
        ))
        await conn.execute(text(
            "ALTER TABLE nodes ADD COLUMN IF NOT EXISTS tema VARCHAR"
        ))
        await conn.execute(text(
            "ALTER TABLE nodes ADD COLUMN IF NOT EXISTS flujograma JSON"
        ))
        await conn.execute(text(
            "ALTER TABLE nodes ADD COLUMN IF NOT EXISTS synthesis JSON"
        ))
        await conn.execute(text(
            "ALTER TABLE nodes ADD COLUMN IF NOT EXISTS solve JSON"
        ))
        # Procedencia de relaciones. Las aristas anteriores quedan con estas columnas
        # en NULL a propósito: el sistema no sabe con qué método ni con qué piso se
        # calcularon, y esa ignorancia se muestra como tal en el panel. Inventarles un
        # método sería exactamente el error que estas columnas existen para evitar.
        for _columna in (
            "metodo VARCHAR",
            "base_relacion VARCHAR",
            "evidencia JSON",
            "revision JSON",
        ):
            await conn.execute(text(
                f"ALTER TABLE edges ADD COLUMN IF NOT EXISTS {_columna}"
            ))
        # Vigencia de fuentes. Las fuentes previas quedan en `vigente` con motivo
        # `nunca_verificado`: no se comprobó que sigan vigentes, sólo que nada indica
        # lo contrario. La diferencia importa y por eso el motivo viaja con el estado.
        for _columna in (
            "estado_vigencia VARCHAR DEFAULT 'vigente'",
            "vigencia JSON",
            "revision_vigencia JSON",
        ):
            await conn.execute(text(
                f"ALTER TABLE sources ADD COLUMN IF NOT EXISTS {_columna}"
            ))
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS nodes_embedding_hnsw
            ON nodes USING hnsw (embedding vector_cosine_ops)
        """))
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw
            ON chunks USING hnsw (embedding vector_cosine_ops)
        """))
    await _backfill_traceability()
    print("✓ Base de datos inicializada")

if __name__ == "__main__":
    asyncio.run(init_db())
