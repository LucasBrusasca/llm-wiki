import asyncio
from sqlalchemy import text
from database.connection import async_engine
from database.models import Base

async def init_db():
    async with async_engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.run_sync(Base.metadata.create_all)
        # Migración idempotente: columna para la ruta del archivo original ingerido.
        # (create_all no altera tablas ya existentes.)
        await conn.execute(text(
            "ALTER TABLE nodes ADD COLUMN IF NOT EXISTS fuente_path VARCHAR"
        ))
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS nodes_embedding_hnsw
            ON nodes USING hnsw (embedding vector_cosine_ops)
        """))
    print("✓ Base de datos inicializada")

if __name__ == "__main__":
    asyncio.run(init_db())
