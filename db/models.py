"""
Structured tables — the missing piece vs. the original repo, which
only persisted LangGraph conversation-state checkpoints, not queryable
plan records.
"""
import uuid
from datetime import datetime

from sqlalchemy import Column, String, Text, DateTime, JSON, Integer
from sqlalchemy.dialects.postgresql import UUID

from db.database import Base


def gen_uuid():
    return str(uuid.uuid4())


class TravelPlanRecord(Base):
    """One row per /api/travel call — the full multi-agent output."""
    __tablename__ = "travel_plan_records"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    thread_id = Column(String, index=True, nullable=False)
    user_query = Column(Text, nullable=False)

    flight_results = Column(Text, nullable=True)
    hotel_results = Column(Text, nullable=True)
    weather_results = Column(Text, nullable=True)
    local_info_results = Column(Text, nullable=True)
    itinerary = Column(Text, nullable=True)
    final_answer = Column(Text, nullable=True)

    price_prediction = Column(JSON, nullable=True)
    sentiment_summary = Column(JSON, nullable=True)

    llm_calls = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
