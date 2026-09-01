from sqlalchemy import (Column, String, Float, Integer, Boolean,
                        Text, DateTime, JSON, UniqueConstraint, ForeignKey)
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.sql import func
try:
    from pgvector.sqlalchemy import Vector
    HAS_PGVECTOR = True
except ImportError:
    HAS_PGVECTOR = False

class Base(DeclarativeBase):
    pass

class Node(Base):
    __tablename__ = "nodes"
    id            = Column(String, primary_key=True)
    label         = Column(String, nullable=False)
    type          = Column(String, default="DOCUMENTO")
    desc          = Column(Text)
    fragmento     = Column(Text)
    conceptos     = Column(JSON, default=list)
    embedding     = Column(Vector(384) if HAS_PGVECTOR else JSON)
    x3d           = Column(Float)
    y3d           = Column(Float)
    z3d           = Column(Float)
    x_pca         = Column(Float)
    y_pca         = Column(Float)
    z_pca         = Column(Float)
    cluster       = Column(Integer, default=-1)
    dominio       = Column(String, default="personal")
    fuente        = Column(String)
    fuente_url    = Column(String)
    fuente_path   = Column(String)
    fuente_label  = Column(String)
    autor         = Column(String)   # canal (YouTube) / autor (PDF, Word, etc.)
    fecha_doc     = Column(String)   # fecha de publicación/creación del contenido (ISO, si existe)
    tema          = Column(String)   # tema/categoría legible asignado por LLM (taxonomía del grafo)
    flujograma    = Column(JSON)     # etapas/conexiones extraídas de un issue con proceso
    synthesis     = Column(JSON)     # reporte 4-agentes del issue (proceso/riesgos/creativo/red_team)
    solve         = Column(JSON)     # solución trazable + revisión crítica + decisión humana
    is_centroid   = Column(Boolean, default=False)
    is_issue      = Column(Boolean, default=False)
    tags          = Column(JSON, default=list)
    rich_html     = Column(Text)
    transcript    = Column(Text)   # transcripción completa (videos de YouTube)
    created_at    = Column(DateTime, server_default=func.now())
    updated_at    = Column(DateTime, server_default=func.now(), onupdate=func.now())

class Edge(Base):
    __tablename__ = "edges"
    __table_args__ = (UniqueConstraint("source", "target"),)
    id              = Column(Integer, primary_key=True, autoincrement=True)
    source          = Column(String, ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False)
    target          = Column(String, ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False)
    score           = Column(Float)
    shared_concepts = Column(JSON, default=list)
    label           = Column(String)
    description     = Column(Text)
    is_manual       = Column(Boolean, default=False)
    created_at      = Column(DateTime, server_default=func.now())

class GraphStat(Base):
    """Estadísticas derivadas del grafo, medidas por el recálculo global.

    Existe por una razón concreta: el piso de similitud de las aristas es data-driven
    (percentil de la distribución real del corpus) y sólo se puede medir recorriendo
    todos los pares. La ingesta incremental no puede hacer eso, así que lee acá el
    último piso medido en vez de inventar un umbral mágico.
    """
    __tablename__ = "graph_stats"
    key        = Column(String, primary_key=True)
    value      = Column(JSON, default=dict)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class AuditLog(Base):
    __tablename__ = "audit_log"
    id                 = Column(Integer, primary_key=True, autoincrement=True)
    query              = Column(Text)
    agent_mode         = Column(String)
    node_ids_consulted = Column(JSON, default=list)
    response           = Column(Text)
    created_at         = Column(DateTime, server_default=func.now())

class UserNote(Base):
    __tablename__ = "user_notes"
    id         = Column(Integer, primary_key=True, autoincrement=True)
    node_id    = Column(String, ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False)
    content    = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class Source(Base):
    """Fuente original estable: archivo, URL, video, paper o dataset."""
    __tablename__ = "sources"
    id              = Column(String, primary_key=True)
    kind            = Column(String, nullable=False)
    locator         = Column(Text, nullable=False)
    original_name   = Column(String)
    content_hash    = Column(String, index=True)
    source_metadata = Column(JSON, default=dict)
    created_at      = Column(DateTime, server_default=func.now())
    updated_at      = Column(DateTime, server_default=func.now(), onupdate=func.now())


class Document(Base):
    """Versión procesada de una Source y vínculo compatible con el Node actual."""
    __tablename__ = "documents"
    id             = Column(String, primary_key=True)
    source_id      = Column(String, ForeignKey("sources.id", ondelete="CASCADE"), nullable=False)
    node_id        = Column(String, ForeignKey("nodes.id", ondelete="SET NULL"), unique=True)
    parser         = Column(String)
    parser_version = Column(String)
    content_hash   = Column(String, index=True)
    created_at     = Column(DateTime, server_default=func.now())
    updated_at     = Column(DateTime, server_default=func.now(), onupdate=func.now())


class Chunk(Base):
    """Pasaje localizable; será la unidad mínima de recuperación y evidencia."""
    __tablename__ = "chunks"
    __table_args__ = (UniqueConstraint("document_id", "ordinal"),)
    id             = Column(String, primary_key=True)
    document_id    = Column(String, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    ordinal        = Column(Integer, nullable=False)
    content        = Column(Text, nullable=False)
    page           = Column(Integer)
    char_start     = Column(Integer)
    char_end       = Column(Integer)
    embedding      = Column(Vector(384) if HAS_PGVECTOR else JSON)
    chunk_metadata = Column(JSON, default=dict)
    created_at     = Column(DateTime, server_default=func.now())
