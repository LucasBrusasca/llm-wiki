"""Migración: agrega columnas de procedencia exacta a chunks.

Agrega source_sha256, byte_start y byte_end a la tabla chunks.
Es una migración no destructiva: los datos existentes quedan con NULL
en las nuevas columnas, lo cual indica que la procedencia es desconocida.

Correr una sola vez:
    python database/migrate_provenance.py
"""
import asyncio
from sqlalchemy import text
from database.connection import async_engine
from database.init_db import init_db


async def migrate():
    await init_db()
    
    async with async_engine.begin() as conn:
        # Verificar si las columnas ya existen
        result = await conn.execute(text("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'chunks' AND column_name = 'source_sha256'
        """))
        if result.fetchone():
            print("✓ Las columnas de procedencia ya existen")
            return

        # Agregar columnas de procedencia
        await conn.execute(text("""
            ALTER TABLE chunks 
            ADD COLUMN IF NOT EXISTS source_sha256 VARCHAR,
            ADD COLUMN IF NOT EXISTS byte_start INTEGER,
            ADD COLUMN IF NOT EXISTS byte_end INTEGER
        """))
        
        # Crear índice en source_sha256 para búsquedas rápidas
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_chunks_source_sha256 
            ON chunks (source_sha256)
        """))
        
        print("✓ Columnas de procedencia agregadas a chunks")
        print("  - source_sha256: SHA-256 del archivo fuente al ingestar")
        print("  - byte_start: posición inicial en bytes")
        print("  - byte_end: posición final en bytes")
        print("  Los chunks existentes quedan con NULL (procedencia desconocida)")


if __name__ == "__main__":
    asyncio.run(migrate())
