import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

DATABASE_URL      = os.getenv("DATABASE_URL",
    "postgresql+asyncpg://pragma:pragma@localhost:5432/pragmaforge")
DATABASE_URL_SYNC = os.getenv("DATABASE_URL_SYNC",
    "postgresql+psycopg2://pragma:pragma@localhost:5432/pragmaforge")

async_engine      = create_async_engine(DATABASE_URL, echo=False,
                                         pool_size=10, max_overflow=20)
AsyncSessionLocal = async_sessionmaker(async_engine, expire_on_commit=False)

sync_engine       = create_engine(DATABASE_URL_SYNC, pool_size=5, max_overflow=10)
SyncSessionLocal  = sessionmaker(sync_engine)

async def get_async_session():
    async with AsyncSessionLocal() as session:
        yield session

def get_sync_session():
    return SyncSessionLocal()
