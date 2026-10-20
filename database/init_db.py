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
        # Línea temporal del grafo: known_since (cuándo Algedi supo del nodo) y
        # valid_from (cuándo el contenido empezó a valer). Backfill de created_at.
        # Las columnas ya están en el modelo (882273f) pero las bases existentes
        # no las tenían: sin este ALTER el SELECT de Node revienta.
        await conn.execute(text(
            "ALTER TABLE nodes ADD COLUMN IF NOT EXISTS known_since TIMESTAMPTZ"
        ))
        await conn.execute(text(
            "ALTER TABLE nodes ADD COLUMN IF NOT EXISTS valid_from TIMESTAMPTZ"
        ))
        await conn.execute(text(
            "UPDATE nodes SET known_since = created_at "
            "WHERE known_since IS NULL AND created_at IS NOT NULL"
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
        # Corridas del workbench: horas de inicio y fin explícitas (antes sólo había
        # `created_at`, que es cuándo se guardó la fila, no cuándo corrió).
        for _columna in ("started_at TIMESTAMPTZ", "finished_at TIMESTAMPTZ"):
            await conn.execute(text(
                f"ALTER TABLE script_runs ADD COLUMN IF NOT EXISTS {_columna}"
            ))
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_script_runs_node
            ON script_runs (node_id, created_at DESC)
        """))
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS nodes_embedding_hnsw
            ON nodes USING hnsw (embedding vector_cosine_ops)
        """))
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw
            ON chunks USING hnsw (embedding vector_cosine_ops)
        """))
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_ingest_jobs_status
            ON ingest_jobs (status)
        """))
        # ── Full-text search (tsvector + GIN) para búsqueda léxica en Postgres ─
        # Reemplaza el BM25 en memoria: escala mejor y no hay que reconstruir el
        # índice en cada cambio. La configuración 'spanish' tokeniza bien castellano.
        await conn.execute(text("""
            ALTER TABLE chunks ADD COLUMN IF NOT EXISTS tsv tsvector
        """))
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS chunks_tsv_gin ON chunks USING gin(tsv)
        """))
        # Trigger para actualizar tsv automáticamente (backfill corre aparte).
        await conn.execute(text("""
            CREATE OR REPLACE FUNCTION chunks_tsv_update() RETURNS trigger AS $$
            BEGIN
                NEW.tsv := to_tsvector('spanish', coalesce(NEW.content, ''));
                RETURN NEW;
            END
            $$ LANGUAGE plpgsql
        """))
        await conn.execute(text("""
            DROP TRIGGER IF EXISTS chunks_tsv_trigger ON chunks
        """))
        await conn.execute(text("""
            CREATE TRIGGER chunks_tsv_trigger
            BEFORE INSERT OR UPDATE OF content ON chunks
            FOR EACH ROW EXECUTE FUNCTION chunks_tsv_update()
        """))
        # Backfill tsvector para chunks existentes sin tsv
        await conn.execute(text("""
            UPDATE chunks SET tsv = to_tsvector('spanish', coalesce(content, ''))
            WHERE tsv IS NULL
        """))
    await _backfill_traceability()
    print("✓ Base de datos inicializada")

if __name__ == "__main__":
    asyncio.run(init_db())
