"""
Structured persistence layer — separate from backend.py's
PostgresSaver checkpointer (which only stores LangGraph's internal
conversation-state snapshots, not queryable travel-plan records).

Reuses the same DATABASE_URL as the checkpointer, but through
SQLAlchemy so we get real tables: travel_plan_records,
flight_price_predictions.

NOTE: this file intentionally does NOT import backend.py, to avoid
triggering backend.py's top-level side effects (LLM client creation,
opening the checkpointer's own DB connection) just by importing this
module. get_database_url() below is a deliberate small duplication of
the same logic in backend.py — keep both in sync if you change one.
"""
import os
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

load_dotenv()


def get_database_url() -> str:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise ValueError(
            "DATABASE_URL is missing. Please add your PostgreSQL URL to .env"
        )
    if "sslmode=" not in database_url:
        separator = "&" if "?" in database_url else "?"
        database_url = f"{database_url}{separator}sslmode=require"

    # SQLAlchemy needs an explicit driver in the scheme; the rest of
    # this repo uses psycopg3 (see requirements.txt: psycopg[binary]),
    # so reuse that driver here for consistency.
    if database_url.startswith("postgresql://"):
        database_url = database_url.replace("postgresql://", "postgresql+psycopg://", 1)
    return database_url


engine = create_engine(get_database_url(), pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
