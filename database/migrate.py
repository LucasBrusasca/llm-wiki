"""Importa nodes_generated.json a PostgreSQL. Correr una sola vez."""
import json, asyncio
from pathlib import Path
from sqlalchemy.dialects.postgresql import insert as pg_insert
from database.connection import async_engine
from database.models import Node, Edge
from database.init_db import init_db

async def migrate():
    path = Path("nodes_generated.json")
    if not path.exists():
        print("No hay nodes_generated.json — nada que migrar"); return

    data  = json.loads(path.read_text(encoding="utf-8"))
    nodos = data.get("nodos", [])
    rels  = data.get("relaciones", [])
    await init_db()

    campos_node = {c.key for c in Node.__table__.columns}

    async with async_engine.begin() as conn:
        for n in nodos:
            d = {k: v for k, v in n.items() if k in campos_node}
            await conn.execute(
                pg_insert(Node).values(**d)
                .on_conflict_do_update(index_elements=["id"], set_=d)
            )
        for r in rels:
            src = r.get("source"); tgt = r.get("target")
            if isinstance(src, dict): src = src["id"]
            if isinstance(tgt, dict): tgt = tgt["id"]
            await conn.execute(
                pg_insert(Edge)
                .values(source=src, target=tgt,
                        score=r.get("score"),
                        shared_concepts=r.get("shared_concepts", []),
                        label=r.get("label"),
                        description=r.get("description"))
                .on_conflict_do_nothing()
            )

    print(f"✓ {len(nodos)} nodos y {len(rels)} relaciones migrados")

if __name__ == "__main__":
    asyncio.run(migrate())
